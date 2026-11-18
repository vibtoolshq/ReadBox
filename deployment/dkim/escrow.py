#!/usr/bin/env python3
"""DKIM-03: host-only age/R2 private-key escrow. No public DNS or live restore."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys
from types import SimpleNamespace

PRIVATE_VOLUME = "readbox_readbox_dkim_private"
PREFIX = "readbox/dkim-escrow/v1/"
RECIPIENT_PATH = Path("/var/lib/readbox-backup/recipient.txt")
IDENTITY_PATH = Path("/var/lib/readbox-backup/identity.txt")
R2_STATE = Path("/var/lib/readbox-backup")
BACKUP_CODE = Path("/opt/readbox/deployment/backup-agent")
GLOBAL_LOCK = Path("/run/lock/readbox-backup-global.lock")
DOMAIN = re.compile(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\Z")
HEX = re.compile(r"[a-f0-9]{64}\Z")
RECEIPT_FIELDS = frozenset({"version", "domain", "privateSha256", "publicSha256",
                            "ciphertextSha256", "objectKey", "bucket", "verified"})
MAX_PRIVATE = 16384
MAX_CIPHER = 32768


class EscrowRefused(Exception):
    """Sanitized refusal; underlying secrets and network errors never printed."""
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def validate_domain(value: str) -> str:
    if not isinstance(value, str) or len(value) > 253 or not DOMAIN.fullmatch(value):
        raise EscrowRefused("INVALID_DOMAIN")
    return value


def safe_regular(path: Path, mode: int | None = None) -> bool:
    try:
        st = path.lstat()
    except FileNotFoundError:
        return False
    if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
        raise EscrowRefused("UNSAFE_FILE")
    if mode is not None and stat.S_IMODE(st.st_mode) != mode:
        raise EscrowRefused("UNSAFE_MODE")
    return True


def private_material(root: Path, domain: str) -> tuple[Path, bytes, bytes]:
    validate_domain(domain)
    folder = root / domain
    if folder.is_symlink() or not folder.is_dir():
        raise EscrowRefused("PRIVATE_DOMAIN_MISSING")
    key = folder / "mail.private"
    if not safe_regular(key, 0o600):
        raise EscrowRefused("PRIVATE_KEY_MISSING")
    if key.stat().st_uid != 1001 and os.getenv("READBOX_DKIM03_DISPOSABLE") != "1":
        raise EscrowRefused("KEY_OWNER_REFUSED")
    pem = key.read_bytes()
    if len(pem) < 100 or len(pem) > MAX_PRIVATE:
        raise EscrowRefused("INVALID_PRIVATE_KEY")
    try:
        info = subprocess.run(["openssl", "pkey", "-in", str(key), "-text", "-noout"],
                              capture_output=True, check=True, timeout=15).stdout
        match = re.search(rb"(?m)^Private-Key: \((\d+) bit(?:, [2-9][0-9]* primes)?\)\r?$", info)
        if not match or int(match.group(1)) < 2048:
            raise EscrowRefused("INVALID_PRIVATE_KEY")
        public = subprocess.run(["openssl", "rsa", "-in", str(key), "-RSAPublicKey_out",
                                 "-outform", "DER"], capture_output=True,
                                check=True, timeout=15).stdout
    except (subprocess.SubprocessError, OSError):
        raise EscrowRefused("INVALID_PRIVATE_KEY") from None
    return key, pem, public


def age_encrypt(raw: bytes, recipient: str) -> bytes:
    if not re.fullmatch(r"age1[023456789acdefghjklmnpqrstuvwxyz]{55,}", recipient):
        raise EscrowRefused("INVALID_RECIPIENT")
    try:
        p = subprocess.run(["age", "-r", recipient], input=raw, capture_output=True,
                           check=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        raise EscrowRefused("AGE_ENCRYPT_FAILED") from None
    if not (0 < len(p.stdout) <= MAX_CIPHER):
        raise EscrowRefused("CIPHER_SIZE_INVALID")
    return p.stdout


def age_decrypt(cipher: bytes, identity: Path) -> bytes:
    if not safe_regular(identity, 0o600):
        raise EscrowRefused("AGE_IDENTITY_UNSAFE")
    try:
        p = subprocess.run(["age", "-d", "-i", str(identity)], input=cipher,
                           capture_output=True, check=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        raise EscrowRefused("AGE_DECRYPT_FAILED") from None
    if len(p.stdout) > MAX_PRIVATE:
        raise EscrowRefused("PLAIN_SIZE_INVALID")
    return p.stdout


def object_key(domain: str, priv_digest: str) -> str:
    validate_domain(domain)
    if not HEX.fullmatch(priv_digest):
        raise EscrowRefused("INVALID_DIGEST")
    return PREFIX + domain + "/" + priv_digest + ".age"


def receipt_bytes(receipt: dict) -> bytes:
    return (json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii")


def checked_receipt(root: Path, domain: str, raw: bytes, public: bytes) -> dict:
    path = root / domain / "escrow.json"
    if not safe_regular(path, 0o644) or path.stat().st_uid != 0:
        raise EscrowRefused("ESCROW_REQUIRED")
    try:
        if path.stat().st_size > 2048:
            raise ValueError("receipt limit")
        data = json.loads(path.read_bytes())
        if not isinstance(data, dict) or set(data) != RECEIPT_FIELDS:
            raise ValueError("receipt fields")
        if data["version"] != 1 or data["verified"] is not True or data["domain"] != domain:
            raise ValueError("receipt identity")
        if data["privateSha256"] != sha(raw) or data["publicSha256"] != sha(public):
            raise ValueError("key mismatch")
        if not isinstance(data["ciphertextSha256"], str) or not HEX.fullmatch(data["ciphertextSha256"]):
            raise ValueError("ciphertext digest")
        if data["objectKey"] != object_key(domain, sha(raw)):
            raise ValueError("object mismatch")
        if not isinstance(data["bucket"], str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,62}", data["bucket"]):
            raise ValueError("bucket")
    except (OSError, ValueError, TypeError, KeyError, UnicodeError):
        raise EscrowRefused("ESCROW_RECEIPT_INVALID") from None
    return data


def remote_read(client, bucket: str, key: str) -> tuple[bytes, dict]:
    try:
        head = client.head_object(Bucket=bucket, Key=key)
        n = head.get("ContentLength")
        metadata = head.get("Metadata", {})
        if not isinstance(n, int) or not 0 < n <= MAX_CIPHER:
            raise EscrowRefused("REMOTE_METADATA_INVALID")
        stream = client.get_object(Bucket=bucket, Key=key)["Body"]
        try:
            chunks, total = [], 0
            for block in iter(lambda: stream.read(8192), b""):
                total += len(block)
                if total > MAX_CIPHER:
                    raise EscrowRefused("REMOTE_SIZE_INVALID")
                chunks.append(block)
        finally:
            stream.close()
        cipher = b"".join(chunks)
        if total != n:
            raise EscrowRefused("REMOTE_SIZE_MISMATCH")
        return cipher, metadata
    except EscrowRefused:
        raise
    except Exception:
        raise EscrowRefused("R2_REMOTE_UNAVAILABLE") from None


def verified_remote(client, bucket: str, key: str, expected: bytes,
                    priv_digest: str, pub_digest: str) -> None:
    cipher, metadata = remote_read(client, bucket, key)
    if (cipher != expected or metadata.get("sha256") != sha(expected) or
            metadata.get("private-sha256") != priv_digest or
            metadata.get("public-sha256") != pub_digest or
            metadata.get("format") != "age-dkim-v1"):
        raise EscrowRefused("R2_REMOTE_CONFLICT")


def upload_immutable(client, bucket: str, key: str, cipher: bytes,
                     priv_digest: str, pub_digest: str):
    # Missing HEAD is the *only* case in which a conditional create is attempted.
    try:
        client.head_object(Bucket=bucket, Key=key)
        exists = True
    except Exception as error:
        code = (getattr(error, "response", {}).get("ResponseMetadata", {})
                .get("HTTPStatusCode"))
        if code != 404:
            raise EscrowRefused("R2_PREFLIGHT_UNAVAILABLE") from None
        exists = False
    if not exists:
        try:
            # R2 must support conditional S3 writes; unsupported = fail closed.
            client.put_object(Bucket=bucket, Key=key, Body=cipher, IfNoneMatch="*",
                              Metadata={"sha256": sha(cipher), "private-sha256": priv_digest,
                                        "public-sha256": pub_digest, "format": "age-dkim-v1"},
                              ContentType="application/octet-stream")
        except Exception:
            # Lost ACK may mean a successful PUT; never PUT again here.
            # Matching full remote readback is sufficient; conflict refuses.
            pass
    verified_remote(client, bucket, key, cipher, priv_digest, pub_digest)


def publish_receipt(root: Path, domain: str, record: dict):
    destination = root / domain / "escrow.json"
    if destination.exists() or destination.is_symlink():
        if not safe_regular(destination, 0o644) or destination.stat().st_uid != 0:
            raise EscrowRefused("ESCROW_RECEIPT_CONFLICT")
        if destination.read_bytes() != receipt_bytes(record):
            raise EscrowRefused("ESCROW_RECEIPT_CONFLICT")
        return
    tmp = destination.with_name(".escrow-" + secrets.token_hex(12))
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
        with os.fdopen(fd, "wb") as out:
            out.write(receipt_bytes(record))
            out.flush()
            os.fsync(out.fileno())
        # Host may run with umask 077; agent UID 1001 needs read-only access.
        os.chmod(tmp, 0o644)
        os.link(tmp, destination, follow_symlinks=False)
    except FileExistsError:
        raise EscrowRefused("ESCROW_RECEIPT_CONFLICT") from None
    finally:
        tmp.unlink(missing_ok=True)


def escrow_domain(root: Path, domain: str, *, recipient: str, identity: Path,
                  client, bucket: str) -> dict:
    key, pem, public = private_material(root, domain)
    digest = sha(pem)
    remote_key = object_key(domain, digest)
    if not isinstance(bucket, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,62}", bucket):
        raise EscrowRefused("INVALID_BUCKET")
    # Age encryption is randomized: existing immutable key/receipt must be
    # verified BEFORE producing another ciphertext for the same object key.
    existing = root / domain / "escrow.json"
    if existing.exists() or existing.is_symlink():
        old = checked_receipt(root, domain, pem, public)
        if old["bucket"] != bucket:
            raise EscrowRefused("ESCROW_RECEIPT_CONFLICT")
        remote_bytes, remote_meta = remote_read(client, bucket, remote_key)
        if (sha(remote_bytes) != old["ciphertextSha256"] or
                age_decrypt(remote_bytes, identity) != pem or
                remote_meta.get("sha256") != old["ciphertextSha256"] or
                remote_meta.get("private-sha256") != digest or
                remote_meta.get("public-sha256") != sha(public) or
                remote_meta.get("format") != "age-dkim-v1"):
            raise EscrowRefused("R2_REMOTE_CONFLICT")
        return {"escrow": "verified_existing", "domain": domain}
    # A crash after PUT but before receipt publication leaves immutable bytes.
    # Recover those exact bytes, never overwrite with randomized new age bytes.
    try:
        client.head_object(Bucket=bucket, Key=remote_key)
        remote_exists = True
    except Exception as error:
        if (getattr(error, "response", {}).get("ResponseMetadata", {})
                .get("HTTPStatusCode")) != 404:
            raise EscrowRefused("R2_PREFLIGHT_UNAVAILABLE") from None
        remote_exists = False
    if remote_exists:
        cipher, meta = remote_read(client, bucket, remote_key)
        if (meta.get("sha256") != sha(cipher) or
                meta.get("private-sha256") != digest or
                meta.get("public-sha256") != sha(public) or
                meta.get("format") != "age-dkim-v1" or
                age_decrypt(cipher, identity) != pem):
            raise EscrowRefused("R2_REMOTE_CONFLICT")
    else:
        cipher = age_encrypt(pem, recipient)
        if age_decrypt(cipher, identity) != pem:
            raise EscrowRefused("AGE_ROUNDTRIP_MISMATCH")
        upload_immutable(client, bucket, remote_key, cipher, digest, sha(public))
    record = {"version": 1, "domain": domain, "privateSha256": digest,
              "publicSha256": sha(public), "ciphertextSha256": sha(cipher),
              "objectKey": remote_key, "bucket": bucket, "verified": True}
    publish_receipt(root, domain, record)
    return {"escrow": "verified", "domain": domain}


def recover_disposable(root: Path, domain: str, priv_digest: str, *,
                       identity: Path, client, bucket: str, destination: Path) -> str:
    """Offline disaster simulation: recover from R2 + age identity alone.

    The old DKIM private volume and receipt are NOT read; root is a fresh
    disposable test root, and no production target is exposed by the CLI.
    """
    if (os.getenv("READBOX_DKIM03_DISPOSABLE") != "1" or
            os.getenv("GITHUB_ACTIONS") != "true" or
            os.getenv("GITHUB_REPOSITORY") != "JILLU-Games/ReadBox"):
        raise EscrowRefused("LIVE_RECOVERY_NOT_AUTHORIZED")
    key = object_key(domain, priv_digest)
    cipher, meta = remote_read(client, bucket, key)
    if (meta.get("sha256") != sha(cipher) or
            meta.get("private-sha256") != priv_digest or
            meta.get("format") != "age-dkim-v1" or
            not isinstance(meta.get("public-sha256"), str) or
            not HEX.fullmatch(meta["public-sha256"])):
        raise EscrowRefused("RECOVERY_CIPHER_CONFLICT")
    recovered = age_decrypt(cipher, identity)
    if sha(recovered) != priv_digest:
        raise EscrowRefused("RECOVERED_KEY_MISMATCH")
    try:
        der = subprocess.run(["openssl", "rsa", "-RSAPublicKey_out",
                              "-outform", "DER"], input=recovered,
                             capture_output=True, check=True, timeout=15).stdout
    except (OSError, subprocess.SubprocessError):
        raise EscrowRefused("RECOVERY_KEY_INVALID") from None
    if sha(der) != meta["public-sha256"]:
        raise EscrowRefused("RECOVERY_PUBLIC_MISMATCH")
    if (destination.exists() or destination.is_symlink() or
            destination.parent != root / "disposable-recovered" or
            root.is_symlink()):
        raise EscrowRefused("RECOVERY_TARGET_REFUSED")
    destination.parent.mkdir(mode=0o700, exist_ok=True)
    fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as out:
        out.write(recovered)
        out.flush()
        os.fsync(out.fileno())
    return sha(recovered)


def live_client():
    if os.geteuid() != 0 or os.getenv("READBOX_DKIM03_DISPOSABLE") == "1":
        raise EscrowRefused("HOST_ROOT_REQUIRED")
    if not BACKUP_CODE.is_dir() or not safe_regular(RECIPIENT_PATH, 0o600):
        raise EscrowRefused("HOST_BACKUP_PREREQUISITE_MISSING")
    if not safe_regular(IDENTITY_PATH, 0o600):
        raise EscrowRefused("HOST_IDENTITY_MISSING")
    sys.path.insert(0, str(BACKUP_CODE))
    try:
        from r2 import R2Adapter, _client
        config = R2Adapter(SimpleNamespace(root=R2_STATE), None)._current()
        if not config:
            raise EscrowRefused("R2_NOT_CONFIGURED")
        return config["bucket"], _client(config), RECIPIENT_PATH.read_text().strip()
    except EscrowRefused:
        raise
    except Exception:
        raise EscrowRefused("R2_HOST_CONFIGURATION_UNAVAILABLE") from None


def live_root() -> Path:
    result = subprocess.run(["docker", "volume", "inspect", PRIVATE_VOLUME,
                             "--format", "{{.Mountpoint}}"], capture_output=True,
                            check=True, text=True, timeout=10).stdout.strip()
    root = Path(result)
    if not root.is_absolute() or root.is_symlink() or not root.is_dir():
        raise EscrowRefused("UNSAFE_PRIVATE_VOLUME")
    return root


def main():
    parser = argparse.ArgumentParser(description="DKIM-03 host-only escrow; no live restore")
    parser.add_argument("action", choices=("escrow", "verify"))
    parser.add_argument("domain")
    args = parser.parse_args()
    try:
        if os.geteuid() != 0:
            raise EscrowRefused("ROOT_REQUIRED")
        domain = validate_domain(args.domain)
        root = live_root()
        bucket, client, recipient = live_client()
        if GLOBAL_LOCK.is_symlink():
            raise EscrowRefused("UNSAFE_MAINTENANCE_LOCK")
        fd = os.open(GLOBAL_LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            inner = os.open(root / ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            try:
                fcntl.flock(inner, fcntl.LOCK_EX | fcntl.LOCK_NB)
                if args.action == "escrow":
                    result = escrow_domain(root, domain, recipient=recipient, identity=IDENTITY_PATH,
                                           client=client, bucket=bucket)
                else:
                    key, pem, pub = private_material(root, domain)
                    record = checked_receipt(root, domain, pem, pub)
                    cipher, metadata = remote_read(client, bucket, record["objectKey"])
                    if (record["bucket"] != bucket or sha(cipher) != record["ciphertextSha256"]
                            or metadata.get("sha256") != sha(cipher)
                            or age_decrypt(cipher, IDENTITY_PATH) != pem):
                        raise EscrowRefused("ESCROW_VERIFY_FAILED")
                    result = {"escrow": "verified_existing", "domain": domain}
            finally:
                fcntl.flock(inner, fcntl.LOCK_UN)
                os.close(inner)
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)
        print(json.dumps(result, separators=(",", ":")))
    except (EscrowRefused, OSError, subprocess.SubprocessError) as exc:
        code = exc.code if isinstance(exc, EscrowRefused) else "ESCROW_UNAVAILABLE"
        print("DKIM03_REFUSED:" + code, file=sys.stderr)
        raise SystemExit(2) from None


if __name__ == "__main__":
    main()
