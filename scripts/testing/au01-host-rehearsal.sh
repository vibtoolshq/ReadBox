#!/usr/bin/env bash
# AU-01 bounded mock host/Unix IPC verification: disposable GitHub runner ONLY.
set -Eeuo pipefail
[[ "${READBOX_AU01_DISPOSABLE:-}" == 1 &&
   "${GITHUB_ACTIONS:-}" == true &&
   "${GITHUB_REPOSITORY:-}" == JILLU-Games/ReadBox ]] || {
  echo AU01_DISPOSABLE_RUNNER_REQUIRED >&2; exit 70;
}
python3 -m py_compile scripts/updater/compose_host_worker.py
bash -n scripts/install/readbox-updater-host-install.sh scripts/install/readbox-update.sh
python3 - <<'PY'
import hashlib, hmac, http.client, importlib.util, json, os, pathlib, secrets
import socket, tempfile, threading, time, unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("host", "scripts/updater/compose_host_worker.py")
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
token = ("ab" * 32).encode()
sha = "b" * 40

class TestHostBridge(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="readbox-au01-disposable-")
        cls.folder = pathlib.Path(cls.tmp.name)
        host.STATE = cls.folder / "state"
        host.STATE_FILE = host.STATE / "status.json"
        host.SERVICE_UID = os.getuid()
        host.SERVICE_GID = os.getgid()
        host.NONCES.clear()
        host.ACTIVE = False
        cls.server = host.UnixHTTPServer(str(cls.folder / "agent.sock"), host.Handler)
        cls.server.access_token = token
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    def send(self, payload, nonce=None, bad_sig=False):
        raw = json.dumps(payload, separators=(",", ":")).encode()
        stamp = str(int(time.time()))
        nonce = nonce or secrets.token_hex(16)
        signed = stamp+"."+nonce+"."+hashlib.sha256(raw).hexdigest()
        signature = hmac.new(token, signed.encode(), hashlib.sha256).hexdigest()
        if bad_sig:
            signature = "0" * 64
        class Conn(http.client.HTTPConnection):
            def __init__(self, sockdir):
                super().__init__("localhost", timeout=3)
                self.sockdir = sockdir
            def connect(self):
                self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                self.sock.connect(str(self.sockdir / "agent.sock"))
        conn = Conn(self.folder)
        conn.request("POST", "/rpc", body=raw, headers={
          "Content-Type":"application/json",
          "X-ReadBox-Timestamp":stamp,
          "X-ReadBox-Nonce":nonce,
          "X-ReadBox-Signature":signature})
        res = conn.getresponse()
        out = res.status, json.loads(res.read())
        conn.close()
        return out

    def test_01_signed_read_only_status(self):
        code, answer = self.send({"action":"status"})
        self.assertEqual(code, 200)
        self.assertEqual(answer["status"]["step"], "idle")

    def test_02_tamper_hmac_refused(self):
        code, answer = self.send({"action":"status"}, bad_sig=True)
        self.assertEqual(code, 403)
        self.assertEqual(answer["error"], "AUTHENTICATION_FAILED")

    def test_03_nonce_replay_refused(self):
        nonce = secrets.token_hex(16)
        self.assertEqual(self.send({"action":"status"}, nonce=nonce)[0], 200)
        self.assertEqual(self.send({"action":"status"}, nonce=nonce)[0], 403)

    def test_04_arbitrary_command_url_fields_refused(self):
        for extra in ({"command":"rm -rf /"}, {"url":"https://evil.test/x"}, {"target_sha":"../etc/passwd"}):
            payload={"action":"start", "target_sha":sha, "confirm":True, **extra}
            code, _ = self.send(payload)
            self.assertEqual(code, 400)

    def test_05_preflight_only_real_host_evidence(self):
        with mock.patch.object(host, "host_check", return_value=(
            [{"name":"fixture","passed":False,"detail":"unsafe"}], sha, "")):
            code, answer = self.send({"action":"preflight"})
            self.assertEqual(code, 200)
            self.assertEqual(answer["status"], "blocked")

    def test_06_invalid_sha_and_missing_confirmation_refused(self):
        self.assertEqual(self.send({"action":"start","target_sha":"x","confirm":True})[0],400)
        self.assertEqual(self.send({"action":"start","target_sha":sha,"confirm":False})[0],400)

    def test_07_mismatch_fails_before_backup_or_docker(self):
        host.ACTIVE=True
        with mock.patch.object(host, "host_check", return_value=(
            [{"name":"fixture","passed":True,"detail":"ok"}], "a"*40, "a"*40)), \
             mock.patch.object(host.subprocess,"run", side_effect=AssertionError("NO_HOST_MUTATION_ALLOWED")):
            host.do_update(sha)
        self.assertEqual(host.read_status()["step"],"error")
        self.assertFalse(host.ACTIVE)

    def test_08_operator_review_blocks_repeated_start(self):
        with mock.patch.object(host, "host_check", return_value=(
            [{"name":"fixture","passed":True,"detail":"ok"}], sha, sha)):
            code, answer = self.send({"action":"start","target_sha":sha,"confirm":True})
            self.assertEqual(code, 409)
            self.assertEqual(answer["error"], "UPDATE_ALREADY_RUNNING")

if __name__ == "__main__":
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(TestHostBridge)
    result=unittest.TextTestRunner(verbosity=1).run(suite)
    if not result.wasSuccessful():
        raise SystemExit(1)
    print("AU01_AUTHENTICATED_IPC_REPLAY_DEFAULT_DENY_PASS")
    print("AU01_MISMATCH_FAIL_CLOSED_NO_HOST_MUTATION_PASS")
PY
echo AU01_DISPOSABLE_HOST_SECURITY_PASS
