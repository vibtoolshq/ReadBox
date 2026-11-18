"""Disposable DKIM agent tests. Run only inside an ephemeral CI container build."""
import importlib.util, os, pathlib, stat, tempfile, unittest
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

    def test_key_generation_is_idempotent_and_private_not_public(self):
        self.assertEqual(agent.provision("example.test")["state"], "created")
        private = agent.PRIV / "example.test" / "mail.private"
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
        agent.provision("example.test")
        path = agent.PUB / "example.test" / "mail.txt"
        path.write_text('"v=DKIM1; k=rsa; p=DIFFERENT"')
        with self.assertRaisesRegex(agent.Refused, "PUBLIC_KEY_CONFLICT"):
            agent.provision("example.test")

    def test_symlinks_and_traversal_rejected(self):
        with self.assertRaisesRegex(agent.Refused, "INVALID_DOMAIN"):
            agent.provision("../unsafe")
        (agent.PRIV / "evil.test").symlink_to(agent.PUB, target_is_directory=True)
        with self.assertRaisesRegex(agent.Refused, "UNSAFE_DIRECTORY"):
            agent.provision("evil.test")

if __name__ == "__main__":
    unittest.main(verbosity=1)
