# DKIM-03 — Host-only encrypted escrow and isolated recovery

## Status and boundary

**Source implementation only.** Frozen baseline:
`d2faedcebd302f488c515daba57441f59ff3a687`.
No production R2 upload, key generation, DNS write, service deployment, restore,
tag or release is permitted in this source phase. The existing ReadBox
Postfix/Dovecot stack remains **inbound-only**; this does not enable signing.

DKIM-03 closes the *missing offsite private-key custody* prerequisite for
a later controlled rollout. Existing R05/BR04 `age-r05-v1` backup
archives **do not contain** `readbox_readbox_dkim_private`. DKIM-03 neither
changes nor claims to extend that backup/restore format.

## Trust boundary

1. `dkim-provisioner` is an offline UID 1001 container, with no network,
   R2 credentials or host Docker socket. On a new domain, it creates a
   private `mail.private` in the private volume but refuses to create the
   public `mail.txt` until its per-domain root-owned receipt is valid.
   Initial Admin Panel provision request may return an unavailable/error
   state, **by design**, until escrow completes. It must not be retried
   repeatedly; the operator performs escrow next. No app/UI/API code changed.
2. Host-only `deployment/dkim/escrow.py` runs as root from the pinned,
   already installed, hash-locked backup-agent Python 3.12 runtime. It
   reads the existing protected host R2 config via the existing adapter,
   plus the existing age recipient and decryption identity.
   **No** new keys/credentials are generated or rotated. Never print secret
   material or run the script inside Web or the DKIM container.
3. The helper acquires the existing backup/update maintenance lock and the
   provisioner's private-volume lock. It rejects symlinks, non-0600 private
   keys, invalid domain names, RSA sizes below 2048 and unsafe state.
4. Host helper age-encrypts the PEM with the existing age recipient, verifies
   local decryption, then performs a conditional S3/R2 put
   (`IfNoneMatch: *`) into the dedicated key namespace:
   `readbox/dkim-escrow/v1/<domain>/<sha256-private-pem>.age`.
   Existing `readbox/managed/` backup objects are never read, changed or
   deleted by this helper. No arbitrary URL, object key or bucket input.
5. Remote HEAD + full GET/readback, exact ciphertext digest, private-key
   hash and public-key fingerprint are verified before a root-owned,
   mode-0644 receipt is published into the private domain directory.
   An existing receipt/immutable remote copy is rechecked, not overwritten.
   Lost write acknowledgments or crashes before the receipt can recover
   by validating the already-existing remote object. Conflicts fail closed.
6. Agent checks the exact local receipt, root ownership, mode, domain,
   private key hash, public RSA fingerprint, ciphertext hash, fixed R2 key
   and verified marker. It then emits a public TXT without changing the
   private key. Repeat provision is idempotent; conflicting public keys
   are refused. This is an **offline host-asserted receipt**, *not* the
   agent making a fresh R2 network call. A compromised trusted host/agent
   or its writable private volume is outside this receipt's trust model.
7. No production restore API or write-to-live-volume option exists. A
   disposable-only CI recovery function reconstructs a private PEM from
   independent R2 ciphertext + age identity after deleting the original
   fixture private volume/receipt; compares private SHA256 and recovered
   RSA public fingerprint, creates a mode-0600 file in a fresh CI-only
   directory, and rejects overwrite.

**Important custody limitation:** losing the host age identity renders
offsite .age archives unreadable. Maintain and test an **independent**
offsite backup of the existing age identity and R2 credentials before
real key generation. Neither is embedded in a DKIM ciphertext object.

## Controlled production operator workflow — NOT authorized by DKIM-03

The following is a **future gated sequence**, not a live deployment action:

- Confirm exact source/mirror target SHA, clean host, encrypted pre-update
  backup, Docker/backup agent health; deploy through existing Admin Panel
  with a single explicit operator confirmation. No source patch on the VPS.
- Recreate only the opt-in DKIM container from the deployed image after
  verifying private/IPCs, preserving existing keys and volumes; observe
  its one-time health result.
- Independently verify existing age identity escrow and R2 recovery
  credentials can be restored to a disposable host. Do not expose them in
  ChatGPT, browser logs, GitHub Actions or documentation.
- For a new authorized domain only: use the existing Admin Panel DKIM
  action **once** to stage `mail.private` (an expected `ESCROW_REQUIRED`
  refusal means no public key was published); perform the root-only host
  escrow; verify the receipt and remote ciphertext; then repeat that
  specific Admin Panel operation once to publish the matching public
  `mail.txt`. No automatic DNS write unless independently approved.
- Host root escrow invocation after separate approval and prerequisites:
  `/opt/readbox-backup-agent/current/bin/python /opt/readbox/deployment/dkim/escrow.py escrow example.com`.
  Read-only verification: same command with `verify example.com`.
  Change `example.com` only to an existing verified domain. No
  `recover` production command exists.
- Only after private escrow and DNS-zone confirmation may Cloudflare's
  existing DKIM-only DNS publisher or manual TXT record be used. No
  signing/outbound SMTP is implemented. Existing conflict records must
  never be overwritten; stop and review.

## Disposable CI acceptance

`.github/workflows/dkim03-ci.yml` is scoped to this phase and uses
**real** age encryption and openssl RSA-2048 fixture keys, mocked
immutable/conditional R2, and the existing agent Docker build. Negative
cases include wrong age identity, corrupt remote bytes, lost upload ACK,
interrupted upload, immutable conflict, idempotency, missing/tampered
receipt, public-key conflict, traversal/symlink rejection, weak RSA-size
and complete lost-volume/receipt recovery. No live R2, GitHub secrets,
real age identity, mailserver, DNS or production volume is used.

A source CI success proves the designed *disposable workflow only*.
The separate operator-approved production escrow/recovery acceptance is
the hard stop before creating a real DKIM key or publishing its DNS.
