#!/usr/bin/env python3
"""ReadBox AU-01: fixed-purpose root host bridge for Docker Compose updates.

No arbitrary commands, URLs, paths, git refs, shell arguments or network
listeners are accepted from the web application. The host independently pins
two trusted main refs and delegates to the existing guarded Compose updater.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import http.server
import json
import os
from pathlib import Path
import re
import secrets
import socket
import socketserver
import stat
import struct
import subprocess
import threading
import time

ROOT = Path("/opt/readbox")
STATE = Path("/var/lib/readbox-updater")
STATE_FILE = STATE / "status.json"
SERVICE_UID = 1001
SERVICE_GID = 1001
SOCKET_NAME = "agent.sock"
TOKEN_NAME = "access.token"
ALLOWED_REPOS = (
    "https://github.com/vibtoolshq/ReadBox.git",
    "https://github.com/JILLU-Games/ReadBox.git",
)
SHA = re.compile(r"^[0-9a-f]{40}$")
LOCK = threading.Lock()
ACTIVE = False
NONCES: dict[str, float] = {}


def run(argv: list[str], timeout: int = 20) -> str:
    proc = subprocess.run(argv, cwd=ROOT, capture_output=True, text=True,
                          timeout=timeout, check=False,
                          env={**os.environ, "GIT_TERMINAL_PROMPT": "0",
                               "GCM_INTERACTIVE": "never"})
    if proc.returncode:
        raise RuntimeError("HOST_COMMAND_FAILED")
    return proc.stdout.strip()


def safe_path(path: Path, mode: int | None = None) -> bool:
    try:
        st = path.lstat()
        return stat.S_ISREG(st.st_mode) and not path.is_symlink() and (
            mode is None or stat.S_IMODE(st.st_mode) == mode)
    except OSError:
        return False


def atomic_status(step: str, message: str, progress: int, **extra: object) -> None:
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    record = {"step": step, "message": message, "progress": progress,
              "updated_at": int(time.time()), **extra}
    temporary = STATE / (".status." + secrets.token_hex(8))
    with temporary.open("x", encoding="utf-8") as stream:
        json.dump(record, stream, separators=(",", ":"))
    os.chmod(temporary, 0o600)
    os.replace(temporary, STATE_FILE)


def read_status() -> dict:
    try:
        if not safe_path(STATE_FILE, 0o600):
            return {"step": "idle", "message": "No host update requested",
                    "progress": 0}
        value = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError("invalid status")
        return {k: value[k] for k in ("step", "message", "progress",
                                      "updated_at", "target_sha")
                if k in value}
    except (OSError, ValueError, KeyError, TypeError):
        return {"step": "error", "message": "Host status is unreadable; operator review required",
                "progress": -1}


def remote_main_refs() -> str:
    heads = []
    for remote in ALLOWED_REPOS:
        out = run(["git", "ls-remote", "--exit-code", remote, "refs/heads/main"], 25)
        sha = out.split()[0] if out else ""
        if not SHA.fullmatch(sha):
            raise RuntimeError("UNTRUSTED_REMOTE_REF")
        heads.append(sha)
    if heads[0] != heads[1]:
        raise RuntimeError("SOURCE_MIRROR_MISMATCH")
    return heads[0]


def host_check(include_remote: bool = False) -> tuple[list[dict], str, str]:
    checks: list[dict] = []
    def check(name: str, passed: bool, detail: str) -> None:
        checks.append({"name": name, "passed": passed, "detail": detail})
    check("host Git checkout", ROOT.is_dir() and (ROOT / ".git").exists(),
          "/opt/readbox")
    current = ""
    try:
        current = run(["git", "rev-parse", "HEAD"], 8)
        check("host branch main", run(["git", "branch", "--show-current"], 8) == "main",
              "main")
        check("clean Git working tree", run(["git", "status", "--porcelain"], 8) == "",
              "No local uncommitted files")
        remote = run(["git", "remote", "get-url", "origin"], 8)
        check("approved Git origin", remote in ALLOWED_REPOS or
              remote.rstrip("/") in [x[:-4] for x in ALLOWED_REPOS],
              "Official source or mirror only")
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired):
        check("host Git status", False, "Git checkout unavailable")
    check("private production environment", safe_path(ROOT / ".env", 0o600),
          "/opt/readbox/.env mode 0600")
    key = Path("/var/lib/readbox-backup/identity.txt")
    check("age encryption identity", safe_path(key, 0o600),
          "Host private identity mode 0600")
    backup_root = Path("/root/.readbox-secrets/pre-update")
    try:
        bstat = backup_root.lstat()
        backup_safe = stat.S_ISDIR(bstat.st_mode) and bstat.st_uid == 0 and (
            stat.S_IMODE(bstat.st_mode) == 0o700) and not backup_root.is_symlink()
    except OSError:
        backup_safe = False
    check("private pre-update backup directory", backup_safe,
          "/root/.readbox-secrets/pre-update mode 0700")
    for name in ("git", "docker", "python3", "age", "flock"):
        try:
            run(["/usr/bin/which", name], 5)
            check("command: " + name, True, name)
        except (OSError, RuntimeError, subprocess.TimeoutExpired):
            check("command: " + name, False, name)
    try:
        run(["docker", "image", "inspect", "ubuntu:24.04"], 12)
        check("pinned recovery image present", True, "ubuntu:24.04")
    except (OSError, RuntimeError, subprocess.TimeoutExpired):
        check("pinned recovery image present", False, "ubuntu:24.04")
    check("existing guarded Compose updater",
          safe_path(ROOT / "scripts/install/readbox-update.sh"),
          "scripts/install/readbox-update.sh")
    if include_remote and all(c["passed"] for c in checks):
        try:
            target = remote_main_refs()
            check("source and mirror main parity", True, target[:12])
        except (OSError, RuntimeError, subprocess.TimeoutExpired):
            check("source and mirror main parity", False,
                  "Remote refs unavailable or mismatched")
    else:
        target = ""
    return checks, current, target


def do_update(target_sha: str) -> None:
    global ACTIVE
    try:
        atomic_status("verify", "Checking pinned main and host preflight", 5,
                      target_sha=target_sha)
        checks, current, remote_sha = host_check(include_remote=True)
        if any(not item["passed"] for item in checks):
            raise RuntimeError("HOST_PREFLIGHT_BLOCKED")
        if remote_sha != target_sha:
            raise RuntimeError("TARGET_MAIN_CHANGED")
        if current == target_sha:
            atomic_status("complete", "Host already at verified main", 100,
                          target_sha=target_sha)
            return
        # Existing updater performs the global maintenance lock, encrypted R05
        # snapshot, clean fast-forward, Compose rebuild and bounded health.
        atomic_status("update", "Creating encrypted backup and deploying verified main", 15,
                      target_sha=target_sha)
        recipient = run(["age-keygen", "-y", "/var/lib/readbox-backup/identity.txt"], 5)
        if not re.fullmatch(r"age1[023456789acdefghjklmnpqrstuvwxyz]{55,}", recipient):
            raise RuntimeError("UNSAFE_BACKUP_RECIPIENT")
        run_env = {**os.environ, "READBOX_UPDATE_TARGET_SHA": target_sha,
                   "READBOX_UPDATE_REQUIRE_PARITY": "1",
                   "READBOX_BACKUP_RECIPIENT": recipient,
                   "READBOX_BACKUP_DIR": "/root/.readbox-secrets/pre-update",
                   "READBOX_COMPOSE_PROJECT": "readbox",
                   "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never"}
        proc = subprocess.run(
            ["/bin/bash", str(ROOT / "scripts/install/readbox-update.sh")],
            cwd=ROOT, env=run_env, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, timeout=1200, check=False)
        if proc.returncode:
            raise RuntimeError("SAFE_COMPOSE_UPDATE_FAILED")
        if run(["git", "rev-parse", "HEAD"], 8) != target_sha:
            raise RuntimeError("UPDATED_SHA_MISMATCH")
        atomic_status("complete", "Verified Docker Compose update and health passed", 100,
                      target_sha=target_sha)
    except (OSError, RuntimeError, subprocess.TimeoutExpired):
        atomic_status("error", "Host update blocked or failed; preserve encrypted backup and review host logs", -1,
                      target_sha=target_sha)
    finally:
        with LOCK:
            ACTIVE = False


class UnixHTTPServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    allow_reuse_address = False


class Handler(http.server.BaseHTTPRequestHandler):
    def address_string(self):
        return "local-bridge"

    def log_message(self, *_args):
        pass

    def answer(self, status: int, body: dict):
        result = json.dumps(body, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(result)))
        self.end_headers()
        self.wfile.write(result)

    def do_POST(self):
        global ACTIVE
        try:
            peer = struct.unpack("3i", self.connection.getsockopt(
                socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            if peer[1] != SERVICE_UID or peer[2] != SERVICE_GID:
                self.answer(403, {"error": "FORBIDDEN"})
                return
            if self.path != "/rpc" or int(self.headers.get("Content-Length", "0")) not in range(1, 4097):
                self.answer(400, {"error": "INVALID_REQUEST"})
                return
            raw = self.rfile.read(int(self.headers["Content-Length"]))
            timestamp = self.headers.get("X-ReadBox-Timestamp", "")
            nonce = self.headers.get("X-ReadBox-Nonce", "")
            sig = self.headers.get("X-ReadBox-Signature", "")
            if not re.fullmatch(r"[0-9]{10,12}", timestamp) or abs(time.time()-int(timestamp)) > 60 \
               or not re.fullmatch(r"[0-9a-f]{32}", nonce) or not re.fullmatch(r"[0-9a-f]{64}", sig):
                self.answer(403, {"error": "AUTHENTICATION_FAILED"})
                return
            signable = timestamp + "." + nonce + "." + hashlib.sha256(raw).hexdigest()
            expected = hmac.new(self.server.access_token,
                                signable.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, sig):
                self.answer(403, {"error": "AUTHENTICATION_FAILED"})
                return
            with LOCK:
                now = time.time()
                for old, when in list(NONCES.items()):
                    if now - when > 65:
                        NONCES.pop(old, None)
                if nonce in NONCES or len(NONCES) >= 4096:
                    self.answer(403, {"error": "REPLAY_REFUSED"})
                    return
                NONCES[nonce] = now
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise ValueError("Invalid payload")
            action = payload.get("action")
            if action == "status" and set(payload) == {"action"}:
                self.answer(200, {"status": read_status()})
            elif action == "preflight" and set(payload) == {"action"}:
                checks, current, _ = host_check(False)
                self.answer(200, {"status": "ready" if all(c["passed"] for c in checks) else "blocked",
                                  "checks": checks, "current_sha": current})
            elif action == "start" and set(payload) == {"action", "target_sha", "confirm"}:
                sha = payload["target_sha"]
                if not isinstance(sha, str) or not SHA.fullmatch(sha) or payload["confirm"] is not True:
                    self.answer(400, {"error": "TARGET_INVALID"})
                    return
                with LOCK:
                    if ACTIVE or read_status().get("step") in ("verify", "update", "queued", "error"):
                        self.answer(409, {"error": "UPDATE_ALREADY_RUNNING"})
                        return
                    checks, _, _ = host_check(False)
                    if not all(c["passed"] for c in checks):
                        self.answer(503, {"error": "HOST_PREFLIGHT_BLOCKED"})
                        return
                    ACTIVE = True
                    atomic_status("queued", "Host update queued", 0, target_sha=sha)
                    threading.Thread(target=do_update, args=(sha,), daemon=True).start()
                self.answer(202, {"status": "queued"})
            else:
                self.answer(400, {"error": "ACTION_NOT_ALLOWED"})
        except (ValueError, KeyError, TypeError, json.JSONDecodeError):
            self.answer(400, {"error": "INVALID_REQUEST"})
        except (OSError, RuntimeError):
            self.answer(503, {"error": "HOST_BRIDGE_UNAVAILABLE"})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket-dir", type=Path, required=True)
    args = parser.parse_args()
    if os.geteuid() != 0 or str(ROOT) != "/opt/readbox":
        raise SystemExit("ROOT_OR_ROOT_PATH_REQUIRED")
    folder = args.socket_dir
    if not folder.is_dir() or folder.is_symlink():
        raise SystemExit("UNSAFE_SOCKET_DIRECTORY")
    token_path = folder / TOKEN_NAME
    if not safe_path(token_path, 0o640):
        raise SystemExit("UNSAFE_ACCESS_TOKEN")
    token = token_path.read_text().strip()
    if not re.fullmatch(r"[0-9a-f]{64}", token):
        raise SystemExit("INVALID_ACCESS_TOKEN")
    socket_path = folder / SOCKET_NAME
    if socket_path.is_symlink():
        raise SystemExit("UNSAFE_SOCKET_PATH")
    if socket_path.exists():
        if not stat.S_ISSOCK(socket_path.lstat().st_mode):
            raise SystemExit("FOREIGN_SOCKET_REFUSED")
        socket_path.unlink()
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(STATE, 0o700)
    previous = read_status()
    if previous.get("step") in ("queued", "verify", "update"):
        atomic_status("error", "Interrupted host update requires operator review", -1)
    with UnixHTTPServer(str(socket_path), Handler) as server:
        server.access_token = token.encode("ascii")
        os.chmod(socket_path, 0o660)
        os.chown(socket_path, 0, SERVICE_GID)
        server.serve_forever(poll_interval=0.25)


if __name__ == "__main__":
    main()
