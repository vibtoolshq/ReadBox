# DKIM-01 — Secure public DNS provisioning (source-only)

## Boundary
ReadBox currently uses incoming-only Postfix → Dovecot LMTP. DKIM-01 provisions
RSA-2048 keys and public TXT DNS; it **does not sign or send email**. Frozen
baseline: ea14efa5b5571b0ed1e00e211e07a7862f2b6a0f.

## Isolation
- Opt-in profile `dkim` enables the non-networked `dkim-provisioner`;
  default Compose/mailserver services remain exactly unchanged. The agent is
  installed later only with explicit VPS approval and private-key custody.
- Non-networked `dkim-provisioner`: Python/OpenSSL, UID/GID 1001,
  read-only rootfs, no Linux capabilities/privileges, no ports, no Docker socket.
- The **private** `readbox_dkim_private` volume is mounted only into
  this service, never web, worker, Postfix or Dovecot. Keys are 0600.
- Existing `readbox_opendkim` volume holds **public** `mail.txt` only;
  Web now mounts it read-only. The new `readbox_dkim_ipc` volume holds an
  authenticated Unix socket, with a per-install token, timestamp, nonce,
  peer UID and HMAC checks. Web has no direct private-key access.
- Existing matching keypair is not overwritten or rotated. Public-only,
  malformed or mismatched keys are **fail-closed conflicts**. Missing public
  TXT may be regenerated only from the same existing private key.
- The source test Docker image runs disposable unit tests only and never
  generates an actual production domain key.

## Admin workflow
- New domain: explicit opt-in provisioning **after** successful domain create.
  Failed DKIM setup never rolls back/repeats domain creation.
- Existing domain: `Provision / Repair DKIM` action; repair means
  preserve old private material, never rotate.
- Only saved domains and authorized admins may use the bounded GET/POST
  `/api/vcon/domains/[uuid]/dkim` endpoints; JSON same-origin POST
  accepts only one boolean `publish`. No untrusted file paths or
  domain overrides.
- Independent status: key ready/missing/invalid; DNS verified/missing/error;
  Cloudflare publishing configured/manual; signing always inactive.
- DNS:verified in the domain header is **routing MX + A/AAAA**, not DKIM.

## Optional Cloudflare zone-scoped DNS API
Store only in the private operator environment, NEVER in source/CI:

    READBOX_CF_DNS_TOKEN=<zone-scoped token>
    READBOX_CF_DNS_ZONE_ID=<32-hex Cloudflare zone ID>
    READBOX_CF_DNS_ZONE_NAME=example.com

Token requires Zone:Read and DNS:Edit, limited to the given zone.
The server validates exact zone identity and domain membership, reads the
existing `mail._domainkey.<domain>` TXT, writes ONLY that TXT if
missing, and returns success on an exact match. Conflicts, multiple records
and unknown zone fail closed. No other DNS record is modified/deleted.
No token => manual TXT copy/zone-file export fallback; R2 API keys are not
DNS credentials. DNS propagation is never assumed immediate.

## Existing contracts preserved
No SMTP submission, IMAP, outgoing relay, signer, Prisma migration, auth
policy, unrelated UI, Postfix/Dovecot routing, Backup/R2 code, host updater
or production secret changes.

**Independent private-key backup gap:** R05 encrypted backup does NOT
currently include the new `readbox_dkim_private` volume. A separately
approved encrypted key-escrow/restore contract is necessary before relying
on this for persistent production signing. Do not store these private keys
in the web container or expose them through R2 or public APIs.

Source CI, mocked Cloudflare responses and disposable test keys are **not**
live production key creation or DNS publication. Real Cloudflare mutation
and VPS installation need separate operator approval. v1.0.0 remains NO-GO.

## Focused tests
- `node --conditions=react-server --import tsx --test tests/dns/dkim-provision.test.ts`
- The isolated Dockerfile runs `deployment/dkim/test_agent.py` as a
  disposable build-only test and then deletes the test script.
- Existing R06 CI checks the surrounding app/UI, Compose images and
  unchanged formal release NO-GO gate.
