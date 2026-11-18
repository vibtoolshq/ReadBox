"""Disposable DKIM agent tests. Run only inside an ephemeral CI container build."""
import base64, hashlib, importlib.util, json, os, pathlib, stat, tempfile, unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("dkim_agent", "/usr/local/bin/dkim-agent.py")
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)

class KeyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="dkim-ci-")
        self.addCleanup(self.temp.cleanup)
        root = pathlib.Path(self.temp.name)
        agent.PRIV, agent.PUB, agent.IPC = root / "private", root / "public", root / "ipc"
        agent.PRIV.mkdir(mode=0o700)
        agent.PUB.mkdir(mode=0o700)
        agent.IPC.mkdir(mode=0o700)

    def stage(self, domain="example.test"):
        with self.assertRaisesRegex(agent.Refused, "ESCROW_REQUIRED"):
            agent.provision(domain)
        key = agent.PRIV / domain / "mail.private"
        self.assertTrue(key.is_file())
        self.assertFalse((agent.PUB / domain / "mail.txt").exists())
        return key

    def receipt(self, key, domain="example.test"):
        public = base64.b64decode(agent.key_material(key), validate=True)
        digest = hashlib.sha256(key.read_bytes()).hexdigest()
        record = {"version": 1, "domain": domain, "privateSha256": digest,
                  "publicSha256": hashlib.sha256(public).hexdigest(),
                  "ciphertextSha256": "a" * 64,
                  "objectKey": "readbox/dkim-escrow/v1/" + domain + "/" + digest + ".age",
                  "bucket": "disposable-fixture", "verified": True}
        receipt = key.parent / "escrow.json"
        receipt.write_text(json.dumps(record), encoding="ascii")
        receipt.chmod(0o644)
        return receipt

    def test_key_generation_is_idempotent_and_private_not_public(self):
        private = self.stage()
        self.receipt(private)
        self.assertEqual(agent.provision("example.test")["state"], "created")
        public = agent.PUB / "example.test" / "mail.txt"
        before = private.read_bytes()
        self.assertIn(b"PRIVATE KEY", before)
        self.assertEqual(private.stat().st_mode & 0o777, 0o600)
        self.assertNotIn(b"PRIVATE KEY", public.read_bytes())
        self.assertEqual(agent.provision("example.test")["state"], "existing")
        self.assertEqual(private.read_bytes(), before)

    def test_public_without_private_is_never_overwritten(self):
        folder = agent.PUB / "example.test"
        folder.mkdir()
        f = folder / "mail.txt"
        f.write_text('"v=DKIM1; k=rsa; p=LEGACY"')
        with self.assertRaisesRegex(agent.Refused, "PUBLIC_WITHOUT_PRIVATE"):
            agent.provision("example.test")
        self.assertEqual(f.read_text(), '"v=DKIM1; k=rsa; p=LEGACY"')

    def test_conflicting_public_never_replaced(self):
        key = self.stage()
        self.receipt(key)
        agent.provision("example.test")
        path = agent.PUB / "example.test" / "mail.txt"
        path.write_text('"v=DKIM1; k=rsa; p=DIFFERENT"')
        with self.assertRaisesRegex(agent.Refused, "PUBLIC_KEY_CONFLICT"):
            agent.provision("example.test")

    def test_openssl_legacy_and_v3_rsa_size_headers(self):
        for header in (b"Private-Key: (2048 bit)\n",
                       b"Private-Key: (2048 bit, 2 primes)\n"):
            with self.subTest(header=header):
                with mock.patch.object(agent, "cmd", side_effect=[header, b"TEST_DER"]) as runner:
                    result = agent.key_material(pathlib.Path("/disposable/mock-private.pem"))
                    self.assertEqual(result, agent.base64.b64encode(b"TEST_DER").decode("ascii"))
                    self.assertEqual(runner.call_count, 2)

    def test_weak_or_malformed_rsa_headers_still_fail_closed(self):
        for header in (b"Private-Key: (1024 bit)\n",
                       b"Private-Key: (1024 bit, 2 primes)\n",
                       b"Private-Key: (2048 bit, invalid suffix)\n"):
            with self.subTest(header=header):
                with mock.patch.object(agent, "cmd", return_value=header) as runner:
                    with self.assertRaisesRegex(agent.Refused, "INVALID_PRIVATE_KEY"):
                        agent.key_material(pathlib.Path("/disposable/mock-private.pem"))
                    self.assertEqual(runner.call_count, 1)

    def test_missing_or_tampered_escrow_blocks_public_key(self):
        key = self.stage()
        self.assertFalse((agent.PUB / "example.test" / "mail.txt").exists())
        receipt = self.receipt(key)
        data = json.loads(receipt.read_text())
        data["privateSha256"] = "b" * 64
        receipt.write_text(json.dumps(data), encoding="ascii")
        with self.assertRaisesRegex(agent.Refused, "ESCROW_RECEIPT_INVALID"):
            agent.provision("example.test")
        self.assertFalse((agent.PUB / "example.test" / "mail.txt").exists())
        receipt.unlink()
        with self.assertRaisesRegex(agent.Refused, "ESCROW_REQUIRED"):
            agent.provision("example.test")

    def test_escrow_receipt_wrong_permissions_fail_closed(self):
        key = self.stage()
        receipt = self.receipt(key)
        receipt.chmod(0o666)
        with self.assertRaisesRegex(agent.Refused, "ESCROW_RECEIPT_INVALID"):
            agent.provision("example.test")

    def test_symlinks_and_traversal_rejected(self):
        with self.assertRaisesRegex(agent.Refused, "INVALID_DOMAIN"):
            agent.provision("../unsafe")
        (agent.PRIV / "evil.test").symlink_to(agent.PUB, target_is_directory=True)
        with self.assertRaisesRegex(agent.Refused, "UNSAFE_DIRECTORY"):
            agent.provision("evil.test")

if __name__ == "__main__":
    unittest.main(verbosity=1)
