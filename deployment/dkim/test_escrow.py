"""DKIM-03 disposable offline age/R2 key escrow and restoration tests."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

if (os.getenv("READBOX_DKIM03_DISPOSABLE") != "1" or
        os.getenv("GITHUB_ACTIONS") != "true" or
        os.getenv("GITHUB_REPOSITORY") != "JILLU-Games/ReadBox" or
        os.geteuid() != 0):
    raise SystemExit("DKIM03_DISPOSABLE_CI_ROOT_ONLY")

spec = importlib.util.spec_from_file_location("dkim_escrow", Path(__file__).with_name("escrow.py"))
escrow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(escrow)


class Missing(Exception):
    response = {"ResponseMetadata": {"HTTPStatusCode": 404}}


class FakeR2:
    def __init__(self):
        self.objects = {}
        self.lose_ack = False
        self.interrupt = False
        self.puts = 0

    def head_object(self, *, Bucket, Key):
        if (Bucket, Key) not in self.objects:
            raise Missing()
        raw, metadata = self.objects[Bucket, Key]
        return {"ContentLength": len(raw), "Metadata": metadata}

    def get_object(self, *, Bucket, Key):
        raw, metadata = self.objects[Bucket, Key]
        return {"Body": io.BytesIO(raw)}

    def put_object(self, *, Bucket, Key, Body, IfNoneMatch, Metadata, ContentType):
        if IfNoneMatch != "*" or (Bucket, Key) in self.objects:
            raise ValueError("conditional create only")
        self.puts += 1
        if self.interrupt:
            raise TimeoutError("interrupted before upload")
        self.objects[Bucket, Key] = (Body, Metadata)
        if self.lose_ack:
            raise TimeoutError("ACK lost after upload")
        return {}


class EscrowCases(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="dkim03-ci-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.private = self.root / "private"
        self.private.mkdir(mode=0o700)
        self.domain = "example.test"
        self.folder = self.private / self.domain
        self.folder.mkdir(mode=0o700)
        self.key = self.folder / "mail.private"
        subprocess.run(["openssl", "genpkey", "-algorithm", "RSA",
                        "-pkeyopt", "rsa_keygen_bits:2048", "-out", str(self.key)],
                       check=True, capture_output=True, timeout=20)
        self.key.chmod(0o600)
        self.identity = self.root / "identity.txt"
        subprocess.run(["age-keygen", "-o", str(self.identity)],
                       check=True, capture_output=True, timeout=10)
        self.identity.chmod(0o600)
        self.recipient = subprocess.check_output(
            ["age-keygen", "-y", str(self.identity)], text=True).strip()
        self.client = FakeR2()
        self.bucket = "disposable-bucket"

    def perform(self):
        return escrow.escrow_domain(
            self.private, self.domain, recipient=self.recipient,
            identity=self.identity, client=self.client, bucket=self.bucket)

    def test_valid_RSA_2048_immutable_escrow_and_idempotency(self):
        first = self.perform()
        self.assertEqual(first["escrow"], "verified")
        original = self.key.read_bytes()
        self.assertEqual(self.perform()["escrow"], "verified_existing")
        self.assertEqual(self.client.puts, 1)
        self.assertEqual(self.key.read_bytes(), original)
        receipt = json.loads((self.folder / "escrow.json").read_text())
        self.assertEqual(receipt["privateSha256"], escrow.sha(original))
        self.assertEqual(len(self.client.objects), 1)
        cipher, metadata = next(iter(self.client.objects.values()))
        self.assertNotIn(b"PRIVATE KEY", cipher)
        self.assertEqual(escrow.age_decrypt(cipher, self.identity), original)
        self.assertEqual(metadata["sha256"], escrow.sha(cipher))

    def test_lost_ack_is_verified_without_duplicate_put(self):
        self.client.lose_ack = True
        self.assertEqual(self.perform()["escrow"], "verified")
        self.assertEqual(self.client.puts, 1)

    def test_interrupted_upload_does_not_publish_receipt(self):
        self.client.interrupt = True
        with self.assertRaisesRegex(escrow.EscrowRefused, "R2_REMOTE_UNAVAILABLE"):
            self.perform()
        self.assertFalse((self.folder / "escrow.json").exists())

    def test_immutable_remote_conflict_never_overwritten(self):
        key = escrow.object_key(self.domain, escrow.sha(self.key.read_bytes()))
        self.client.objects[self.bucket, key] = (b"another-cipher", {"sha256": "0" * 64})
        with self.assertRaisesRegex(escrow.EscrowRefused, "R2_REMOTE_CONFLICT"):
            self.perform()
        self.assertEqual(self.client.puts, 0)
        self.assertFalse((self.folder / "escrow.json").exists())

    def test_wrong_age_identity_refused(self):
        other = self.root / "wrong-identity.txt"
        subprocess.run(["age-keygen", "-o", str(other)], check=True, capture_output=True)
        other.chmod(0o600)
        encrypted = escrow.age_encrypt(self.key.read_bytes(), self.recipient)
        with self.assertRaisesRegex(escrow.EscrowRefused, "AGE_DECRYPT_FAILED"):
            escrow.age_decrypt(encrypted, other)

    def test_crash_after_upload_before_receipt_recovers_same_immutable_bytes(self):
        with mock.patch.object(escrow, "publish_receipt",
                               side_effect=RuntimeError("simulated crash")):
            with self.assertRaisesRegex(RuntimeError, "simulated crash"):
                self.perform()
        self.assertFalse((self.folder / "escrow.json").exists())
        self.assertEqual(self.client.puts, 1)
        self.assertEqual(self.perform()["escrow"], "verified")
        self.assertEqual(self.client.puts, 1)

    def test_corrupt_remote_ciphertext_refused(self):
        self.perform()
        key = next(iter(self.client.objects))
        raw, meta = self.client.objects[key]
        self.client.objects[key] = (raw[:-8] + b"CORRUPTED", meta)
        with self.assertRaisesRegex(escrow.EscrowRefused, "R2_REMOTE_CONFLICT"):
            self.perform()

    def test_recovery_after_losing_original_private_volume_and_receipt(self):
        self.perform()
        original = self.key.read_bytes()
        digest = escrow.sha(original)
        from shutil import rmtree
        rmtree(self.private)
        fresh_root = self.root / "new-disposable-volume"
        fresh_root.mkdir(mode=0o700)
        destination = fresh_root / "disposable-recovered" / "mail.private"
        recovered_sha = escrow.recover_disposable(
            fresh_root, self.domain, digest, identity=self.identity,
            client=self.client, bucket=self.bucket, destination=destination)
        self.assertEqual(recovered_sha, digest)
        self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
        self.assertEqual(destination.read_bytes(), original)
        with self.assertRaisesRegex(escrow.EscrowRefused, "RECOVERY_TARGET_REFUSED"):
            escrow.recover_disposable(fresh_root, self.domain, digest,
                                      identity=self.identity, client=self.client,
                                      bucket=self.bucket, destination=destination)

    def test_recovery_requires_disposable_gate(self):
        self.perform()
        digest = escrow.sha(self.key.read_bytes())
        with mock.patch.dict(os.environ, {"READBOX_DKIM03_DISPOSABLE": "0"}):
            with self.assertRaisesRegex(escrow.EscrowRefused, "LIVE_RECOVERY_NOT_AUTHORIZED"):
                escrow.recover_disposable(
                    self.private, self.domain, digest, identity=self.identity,
                    client=self.client, bucket=self.bucket,
                    destination=self.private / "disposable-recovered" / "mail.private")

    def test_bad_receipt_fails_closed(self):
        self.perform()
        receipt = self.folder / "escrow.json"
        data = json.loads(receipt.read_text())
        data["publicSha256"] = "0" * 64
        receipt.write_text(json.dumps(data))
        with self.assertRaisesRegex(escrow.EscrowRefused, "ESCROW_RECEIPT_INVALID"):
            self.perform()

    def test_symlinked_key_and_domain_traversal_refused(self):
        self.key.rename(self.folder / "real-key.pem")
        self.key.symlink_to(self.folder / "real-key.pem")
        with self.assertRaisesRegex(escrow.EscrowRefused, "UNSAFE_FILE"):
            self.perform()
        with self.assertRaisesRegex(escrow.EscrowRefused, "INVALID_DOMAIN"):
            escrow.validate_domain("../example.test")


if __name__ == "__main__":
    unittest.main(verbosity=2)
