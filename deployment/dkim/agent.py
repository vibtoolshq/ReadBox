#!/usr/bin/env python3
"""DKIM-01: isolated offline key provisioner. No mail signing or networking."""
import base64, fcntl, hashlib, hmac, json, os, pathlib, re, secrets
import socket, socketserver, stat, struct, subprocess, time

PRIV = pathlib.Path("/var/lib/readbox-dkim/private")
PUB = pathlib.Path("/etc/opendkim/keys")
IPC = pathlib.Path("/run/readbox-dkim")
TOKEN, SOCK = IPC / "access.token", IPC / "agent.sock"
LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
DOMAIN = re.compile(r"(?=.{1,253}$)" + LABEL + r"(?:\." + LABEL + r")+\Z")
NONCES = {}

class Refused(Exception): pass

def regular(path):
    try: mode = path.lstat().st_mode
    except FileNotFoundError: return False
    if not stat.S_ISREG(mode): raise Refused("UNSAFE_PATH")
    return True

def directory(path, mode):
    try: path.mkdir(mode=mode)
    except FileExistsError:
        if not stat.S_ISDIR(path.lstat().st_mode): raise Refused("UNSAFE_DIRECTORY")
    if path.is_symlink() or not path.is_dir(): raise Refused("UNSAFE_DIRECTORY")

def cmd(*args):
    result = subprocess.run(["openssl", *map(str, args)], capture_output=True,
                            timeout=20, check=False)
    if result.returncode: raise Refused("KEY_OPERATION_FAILED")
    return result.stdout

def key_material(priv):
    info = cmd("pkey", "-in", priv, "-text", "-noout")
    bits = re.search(rb"Private-Key: \((\d+) bit\)", info)
    if not bits or int(bits.group(1)) < 2048: raise Refused("INVALID_PRIVATE_KEY")
    return base64.b64encode(cmd("rsa", "-in", priv, "-RSAPublicKey_out",
                                "-outform", "DER")).decode("ascii")

def current_public(path):
    content = "".join(re.findall(r'"([^"]*)"', path.read_text("ascii")))
    match = re.search(r"(?:^|[;\s])p=([A-Za-z0-9+/=]+)", content)
    if not match: raise Refused("INVALID_PUBLIC_RECORD")
    return match.group(1)

def exclusive_write(path, data, mode):
    tmp = path.with_name(".tmp-" + secrets.token_hex(12))
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(tmp, path, follow_symlinks=False)  # never replaces an existing key
    finally: tmp.unlink(missing_ok=True)

def provision(domain):
    if not isinstance(domain, str) or not DOMAIN.fullmatch(domain):
        raise Refused("INVALID_DOMAIN")
    lockfd = os.open(PRIV / ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lockfd, fcntl.LOCK_EX)
        privdir, pubdir = PRIV / domain, PUB / domain
        directory(privdir, 0o700)
        directory(pubdir, 0o755)
        keyfile, txtfile = privdir / "mail.private", pubdir / "mail.txt"
        has_priv, has_pub = regular(keyfile), regular(txtfile)
        if has_pub and not has_priv: raise Refused("PUBLIC_WITHOUT_PRIVATE")
        if not has_priv:
            tmpkey = privdir / (".key-" + secrets.token_hex(10))
            try:
                cmd("genpkey", "-algorithm", "RSA", "-pkeyopt",
                    "rsa_keygen_bits:2048", "-out", tmpkey)
                os.chmod(tmpkey, 0o600)
                exclusive_write(keyfile, tmpkey.read_bytes(), 0o600)
            finally: tmpkey.unlink(missing_ok=True)
        key = key_material(keyfile)
        if has_pub:
            if current_public(txtfile) != key: raise Refused("PUBLIC_KEY_CONFLICT")
            return {"state": "existing", "public_ready": True}
        parts = ["v=DKIM1; k=rsa; ", "p=" + key[:180]] + [
            key[i:i+180] for i in range(180, len(key), 180)]
        record = "mail._domainkey IN TXT (\n" + "".join(
            '  "' + part + '"\n' for part in parts) + ")\n"
        exclusive_write(txtfile, record.encode("ascii"), 0o644)
        return {"state": "created", "public_ready": True}
    finally:
        fcntl.flock(lockfd, fcntl.LOCK_UN)
        os.close(lockfd)

class Handler(socketserver.StreamRequestHandler):
    def setup(self):
        # A stalled authenticated client must never monopolize the single worker.
        self.request.settimeout(5)
        super().setup()

    def handle(self):
        try:
            rawpeer = self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
            if struct.unpack("3i", rawpeer)[1] != 1001: raise Refused("ACCESS_DENIED")
            raw = self.rfile.readline(2049)
            if len(raw) > 2048 or not raw.endswith(b"\n"):
                raise Refused("INVALID_REQUEST")
            value = json.loads(raw)
            if not isinstance(value, dict) or set(value) != {
                "action", "domain", "timestamp", "nonce", "signature"
            } or value["action"] != "provision":
                raise Refused("INVALID_REQUEST")
            domain, stamp, nonce, signature = (
                value["domain"], value["timestamp"], value["nonce"], value["signature"])
            if not isinstance(domain, str) or not DOMAIN.fullmatch(domain):
                raise Refused("INVALID_DOMAIN")
            if type(stamp) is not int or abs(time.time() - stamp) > 60:
                raise Refused("EXPIRED_REQUEST")
            if not isinstance(nonce, str) or not re.fullmatch(r"[a-f0-9]{32}", nonce):
                raise Refused("INVALID_NONCE")
            if not isinstance(signature, str) or not re.fullmatch(r"[a-f0-9]{64}", signature):
                raise Refused("INVALID_SIGNATURE")
            expected = hmac.new(self.server.secret,
                f"{stamp}.{nonce}.{domain}".encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(signature, expected):
                raise Refused("ACCESS_DENIED")
            now = time.monotonic()
            for n, ts in list(NONCES.items()):
                if now - ts > 120: del NONCES[n]
            if nonce in NONCES: raise Refused("REPLAY_REFUSED")
            if len(NONCES) >= 4096: raise Refused("REPLAY_CAPACITY")
            NONCES[nonce] = now
            result = {"ok": True, **provision(domain)}
        except Refused as error: result = {"ok": False, "code": str(error)}
        except (OSError, ValueError, subprocess.TimeoutExpired):
            result = {"ok": False, "code": "PROVISION_UNAVAILABLE"}
        self.wfile.write((json.dumps(result, separators=(",", ":")) + "\n").encode())

def main():
    os.umask(0o077)
    for path, mode in [(PRIV, 0o700), (PUB, 0o755), (IPC, 0o700)]:
        directory(path, mode)
    if regular(TOKEN):
        if TOKEN.stat().st_mode & 0o077: raise SystemExit("UNSAFE_TOKEN_PERMISSIONS")
        value = TOKEN.read_text("ascii").strip()
        if not re.fullmatch(r"[a-f0-9]{64}", value):
            raise SystemExit("INVALID_EXISTING_TOKEN")
    else:
        exclusive_write(TOKEN, (secrets.token_hex(32) + "\n").encode(), 0o600)
        value = TOKEN.read_text("ascii").strip()
    if SOCK.exists() or SOCK.is_symlink():
        if not stat.S_ISSOCK(SOCK.lstat().st_mode):
            raise SystemExit("UNSAFE_EXISTING_SOCKET")
        SOCK.unlink()
    server = socketserver.UnixStreamServer(str(SOCK), Handler)
    os.chmod(SOCK, 0o600)
    server.secret = bytes.fromhex(value)
    try: server.serve_forever(poll_interval=0.2)
    finally:
        server.server_close()
        SOCK.unlink(missing_ok=True)

if __name__ == "__main__": main()
