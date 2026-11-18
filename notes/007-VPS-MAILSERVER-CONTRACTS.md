# 007 — VPS / Postfix / Dovecot / Maildir / Database Integration Contracts

**Frozen baseline:** `e28886e5e0f7a155cd64e23bc8ee8f6668d6699c`. **Status:** interface contract for future scope-approved work; NOT a deployer.

## Deployment mode boundary

| Mode | Exact tracked artifact | Actual availability |
|---|---|---|
| Development DB | `compose.yaml`: `postgres` and profile `postgres-test` | development only; password `local-development-only` |
| Production application | `docker-compose.yml`: `postgres`/`web`/`worker` | exists, does not contain SMTP/LMTP mailserver |
| Host mail services | `deployment/templates/postfix/*.cf.tpl` and `deployment/templates/dovecot/99-vibmail.conf.tpl` | templates only, not an installer |
| Host web/systemd | `deployment/templates/systemd/vibmail-*.service.tpl` and `deployment/templates/nginx/app.conf.tpl` | legacy paths, not applied by Docker |
| Coolify | special `SERVICE_PASSWORD_DB`, `SERVICE_BASE64_64_SECRET` env conventions | requires actual configured secrets and mailserver integration |

**Current supported feature boundary:** inbound Maildir reading/management; the published stack does not prove IMAP/SMTP submission or outbound mail. `src/core/mailserver/pg-adapter.ts:274–275` creates disabled mailbox password hashes; `deployment/templates/dovecot/99-vibmail.conf.tpl:1` sets `protocols = lmtp`. No extra outbound/IMAP scope without explicit approval.

## One authoritative database and filesystem

- Exactly one PostgreSQL with `public` and `mailserver` schemas, Prisma as ORM (`AGENTS.md:1–3`, `prisma/schema.prisma`). Never create another DB.
- Postfix virtual map tables/views: `mailserver.postfix_virtual_domains`, `mailserver.postfix_virtual_mailboxes`, `mailserver.postfix_virtual_aliases` (`prisma/migrations/20261115000000_mailserver_schema_and_roles/migration.sql:75–101`).
- Canonical relative mailbox `<domain>/<local>/Maildir/`; canonical absolute filesystem `/var/vmail/<domain>/<local>/Maildir/{new,cur,tmp}` (`src/core/mailboxes/paths.ts:133–160` and `src/core/mailboxes/provisioning.ts:126–160`).
- Maildir originals and attachment files stay on filesystem; runtime attachments `/var/lib/readbox/attachments` and media `/var/lib/readbox/media`. No deletion during tests.
- Docker web + worker run `nextjs` UID/GID 1001 (`Dockerfile:42–63,82`). Dovecot host template uses `vmail` (`deployment/templates/dovecot/99-vibmail.conf.tpl:6–18`); maildirs are created with `0700`. A tested exact UID/GID/ACL and mount-sharing contract is mandatory.
- Postfix virtual SQL access must use an actual least-privilege login account and network endpoint: `postfix_lookup NOLOGIN` in the migration alone is not sufficient.

### Source code proof — Postfix SQL network mismatch

`deployment/templates/postfix/pgsql-virtual-domains.cf.tpl:1–5`

```ini
user = {{POSTFIX_DB_USER}}
password = {{POSTFIX_DB_PASSWORD}}
hosts = 127.0.0.1
dbname = {{PG_DB_NAME}}
query = SELECT name FROM mailserver.postfix_virtual_domains WHERE name = LOWER('%s')
```

`docker-compose.yml:13–18`

```yaml
postgres:
  image: postgres:16.14-alpine
  restart: unless-stopped
  environment:
    POSTGRES_USER: ${POSTGRES_USER:-readbox}
    POSTGRES_PASSWORD: ${SERVICE_PASSWORD_DB:?Coolify auto-generates SERVICE_PASSWORD_DB}
```

The Postfix localhost SQL template cannot use the Compose-private PostgreSQL endpoint by default. Exposing PostgreSQL publicly is not authorized or an acceptable workaround; service addressing and credentials must be designed and verified.

## Mail transport, DNS, TLS, privacy and admin contracts

1. Public MX → SMTP port 25 Postfix → Dovecot LMTP → authoritative Maildir → ingestion worker → authenticated inbox. Every boundary has a positive, negative and retry/recovery check.
2. Internet port 25, IPv4/IPv6, PTR and firewall depend on the real VPS/provider; DNS previews are *advisory*, not published records (`src/core/dns/records.ts:45–109`).
3. OpenDKIM module only reads public-key text (`src/core/dns/opendkim.ts:52–66`); it does not run a signer or issue certificates. Web HTTPS and SMTP TLS are separate concerns.
4. Web `expose: 3000` is not SMTP; external mailserver listeners must not imply public database exposure.
5. Missing/stale worker heartbeat must not return a misleading production green. `/health/live` is web liveness only, `/health/ready` is not full SMTP/LMTP readiness.
6. Secure first-admin bootstrap from `scripts/auth/operator.ts` uses `src/core/auth/operator-bootstrap.ts` and must match inspector identity semantics in `src/core/setup/trusted-operations.ts`.
7. Backup/restore and updater must match **host** vs **Compose/Coolify** mode, DB, volume, mail/attachment UID and confidential secrets. Existing `scripts/ops/*.sh` are host/systemd-oriented.
8. `reference/MailStack/LICENSE` AGPL and `reference/MailStack/NOTICE.md` remain subject to separate reference license/branding obligations despite root MIT.

## Decisions which must not be silently expanded

- Incoming-only default vs additional SMTP submission/IMAP/outbound features. **Default = inbound-only**.
- Host Postfix/Dovecot + Docker web/worker vs fully containerized MTA. A phase must document one actually supported topology, not create mixed storage/port assumptions.
- Standalone Compose vs Coolify secret-generation/volume contract.
- Backup availability: permitted Postfix downtime is unresolved; no hidden service interruption.
- DNS control: preview/checking only unless DNS-provider mutation is separately requested.

**No live VPS changes, network routing, DNS edits, user-mail sends, production backup actions or release publication are authorized by this plan.** Final GO only under `006`.

## R-02 current implementation addendum (2026-11-17)

Frozen source contract above remains historically correct at baseline. New CI-tested changes at `e1efdbd0b0380a94152947f7be47eb17c5c8d70c`:

- `docker-compose.yml` web/worker have `user: "1001:1001"`, plus `MAILDIR_UID/GID=1001`. Existing data is **never** silently recursively chowned; ownership mismatch stops provisioning. Dovecot LMTP template placeholders `VMAIL_UID/GID` must be set to the same numeric identity in R-03 integration.
- `prisma/migrations/20261117010000_postfix_login_identity/migration.sql` adds a dedicated `readbox_postfix` LOGIN role with NO password initially; it inherits the existing `postfix_lookup` group. A profile-only `postfix-db-credential` service can set a separately managed SCRAM password without exposing PostgreSQL on host ports. Default Compose does not run this provisioning job.
- Postfix `pgsql-virtual-{domains,mailboxes,aliases}.cf.tpl` templates now use `readbox_postfix` and explicit `POSTFIX_DB_HOST/PORT` placeholders. **The renderer, Postfix service, and externally validated network attachment do not yet exist**; supplying the wrong network host still prevents delivery.
- Actual SQL role, positive/negative lookup and migration replay tests passed: https://github.com/JILLU-Games/ReadBox/actions/runs/44099280332.
- **Known residual:** `src/core/health/snapshot.ts` remains unchanged; complete expected migration-history parity is not part of its readiness gate and RB-P2-04 is OPEN until an explicitly approved bounded exception/deferral.

## R-02 post-approval readiness contract (2026-11-17)

- `src/core/health/snapshot.ts` enforces the checked-in Prisma migration history (the original seven migrations plus future checked-in migration directories) via R-02's existing `verifyMailserverMigrationParity()` SQL helper. The status is `not_ready` if expected history is absent/incomplete/unavailable.
- Only this migration readiness contract is CI verified; the earlier live SMTP/LMTP, actual mounted Dovecot and external DNS caveats remain unchanged. Evidence: https://github.com/JILLU-Games/ReadBox/actions/runs/44102834169.

## R-03 opt-in containerized Postfix/Dovecot topology (supersedes initial no-mailserver source state)

- Actual code SHA: `d0f3272ea298de012da83c6f01b588fa0513d1da`; disposable end-to-end SMTP→LMTP→Maildir CI https://github.com/JILLU-Games/ReadBox/actions/runs/44107205810 success. This replaces the baseline-only statement that no deployable MTA exists.
- `docker-compose.yml`: `postfix` and `dovecot` services only when `--profile mailserver`; no IMAP or SMTP submission, no outbound relay, no public PostgreSQL. `SMTP_BIND_ADDRESS` defaults to `127.0.0.1`, `SMTP_PUBLISHED_PORT` defaults to 25. Real external binding requires explicit approved VPS action and provider checks.
- `deployment/mailserver/postfix/`: Debian Postfix with `postfix-pgsql`, rendered read-only map credentials, persistent `readbox_postfix_queue`, opportunistic STARTTLS with pre-provisioned hostname-matching certificate. STARTUP FAILS without private TLS key/cert. SMTP refuses unknown/disabled recipient via SQL lookup and nonlocal relay via recipient restrictions.
- `deployment/mailserver/dovecot/`: inbound-only Dovecot LMTP listening on private bridge port 24 and writing Maildir as UID/GID 1001. No additional mail database. Shared `readbox_vmail` mount with web/worker.
- `deployment/mailserver/README.md`: beginner/operator staging instructions, TLS handoff, manual MX/A/AAAA/PTR and firewall checks, no DNS provider mutation, no DKIM signer (inbound-only boundary), no SMTP submission/IMAP.
- Historical earlier host-based templates and legacy references in the original audit remain **baseline evidence**, not a statement about current production Compose. Public/host TLS issuer and DNS and real VPS reachability are still unverified; **production remains NO-GO**.

## R-04 production bootstrap and health contract (2026-11-17)

- **No default administrator or credentials.** First deploy starts web/worker without silently creating a privileged user. A trusted operator may explicitly run, **after the PostgreSQL/web image is running and outside CI**:

  ```bash
  docker compose -f docker-compose.yml run --rm -it --no-deps web node --conditions=react-server --import tsx scripts/auth/operator.ts --bootstrap-production
  ```

  Only the private `postgres:5432` database in the app's Compose network is accepted; Docker environment, enabled auth, 32+ auth secret, interactive TTY and exact `--bootstrap-production` flag are mandatory. The transaction creates a superuser `admin_accounts` record with `passwordResetRequired=true` and an expiring one-time `admin_reset_tokens` entry; the operator must use the existing admin password-reset flow to set the real password. The token is displayed once to that operator, **never** committed to source or logs. Duplicate initialization is refused; old `users` and `administrator_profiles` are not silently rewritten.
- **App health** at `/health/ready` is `not_ready` until DB/migrations/storage and a healthy worker heartbeat succeed, regardless of old production `REQUIRE_INGESTION_READY=false`. `/health/live` reports process-only and remains web Docker healthcheck to avoid a worker dependency deadlock. Worker Docker healthcheck verifies process+application readiness.
- **Mail transport boundary:** `scope:"application"` and `mailTransport.status:"not_checked"` explicitly show the readiness endpoint does not verify Postfix, LMTP, DNS or external MX/TCP/25. Those are R-06 staging acceptance gates; no public port or SMTP configuration changed in R-04.
- **Verified:** disposable PostgreSQL bootstrap and health-negative CI https://github.com/JILLU-Games/ReadBox/actions/runs/44112634511; source SHA `88e57e2e81dc07a8f91b07f448df85e51d58e429`. **Not verified:** actual interactive VPS command, service uptime following real reboot, public TLS and mail delivery. No live actions performed.

## R-05 encrypted data/queue backup and restore (2026-11-17)

- New operator utility `deployment/operations/compose_recovery.py`, instructions `deployment/operations/README.md`. It operates from an authorized host on the existing named-volume Docker Compose project; it is **not a running network service** and does not modify the Postfix/Dovecot topology, DNS or UI. It takes a consistent PostgreSQL `pg_dump -Fc` (public + mailserver), GNU tar `--acls --xattrs --numeric-owner` snapshots of Maildir/attachments/media and, when a Postfix container exists, its queue volume. It excludes environment files, TLS private keys, DKIM private material and operator config. A separate approved secret manager is required to reconstruct configuration.
- Backup and restore explicitly quiesce Postfix/Dovecot/worker/web if active; **inbound SMTP downtime is expected and logged**, including on host-mode backup/upgrade. Each restore requires explicit human flags, authenticated `age` input, source project/database match, a separate encrypted rollback artifact and preflight checksum/archive path/type checks; post-DB-apply failure attempts automatic rollback. Only previously-running service containers are restarted; Postfix queue persists through maintenance.
- CI full proof https://github.com/JILLU-Games/ReadBox/actions/runs/44121121316, source SHA `a55ec82bb2f58804e910427c66ff6352cd5c14c6`: real disposable PostgreSQL schemas and Docker named volumes, encryption+integrity, UID/GID 1001 and POSIX ACL restoration, real queued file, and mandatory failure-after-DB-apply rollback marker passed. Host/systemd rollback and real VPS SMTP downtime were **not** executed.
- Remaining hard release gates: offsite encrypted artifact retention, restore-key custody, external DNS/TLS/public SMTP and real VPS/host backup restore and reboot; Nginx legacy template outside R-05 Scope Lock not edited. No production GO until explicit evidence.

## R-06 accepted code-vs-live public mail boundary (2026-11-17)

- R-06 read-only CI https://github.com/JILLU-Games/ReadBox/actions/runs/44127481624 (source SHA `807ca9f38adb02db2a8b73dc0901fce23ee5e63a`) verified isolated PostgreSQL migration/auth, production Docker images, loopback test-only Postfix SMTP STARTTLS → private Dovecot LMTP → actual shared Maildir, unknown recipient and outside relay rejection. R-06 bounded SMTP greeting probe is confined to `scripts/testing/` and changes only a throwaway copy of the R-03 smoke script; Postfix/Dovecot config, SQL schema and application source remain unchanged.
- The same CI replayed R-05 disposable age-encrypted PostgreSQL (both schemas) + Maildir/attachment/queue restore with numeric UID/GID/ACL and forced automatic rollback. An application `/health/ready` check still does **not** assert external SMTP transport readiness.
- New [staging runbook](../docs/PRODUCTION-ACCEPTANCE-RUNBOOK.md), [release governance](../docs/RELEASE-GOVERNANCE.md) and [license provenance](../docs/THIRD-PARTY-PROVENANCE.md) require independent observed public MX/A/AAAA/PTR, provider TCP/25, trusted mail/web TLS renewal, real incoming SMTP→LMTP→inbox attachment, mail queue/worker reboot recovery, actual offsite key/retention/restore and separate final release/legal approval.
- These live operations were **not authorized or run**; original seven findings remain OPEN. Host Nginx legacy template is outside R-06 Scope Lock, unchanged. CI-only readiness is NOT production GO. **6/6 implementation phases completed; final live release acceptance BLOCKED.**

## DKIM-01 — Future controlled VPS interface contract (2026-11-18)

- **Default Compose remains exactly postgres/web/worker**, optional mailserver remains Postfix/Dovecot; DKIM-01 agent is excluded unless operator expressly uses Compose profile `dkim`. The new agent creates no public port, mail routing rule, signer, IMAP or outbound SMTP.
- Agent: dedicated offline Python/OpenSSL container, UID 1001, no-network, read-only rootfs, cap-drop ALL. Mounts private volume `readbox_dkim_private` (exclusive), public existing `readbox_opendkim` (writer) and `readbox_dkim_ipc` (authenticated socket/token). Web receives public volume **read-only** and IPC **read-only**, never private volume.
- **One-time ownership preflight required:** existing named volumes may have been initialized by Web/root before optional profile activation. A separately approved, bounded root-only host volume-initialization step must verify directories and establish UID/GID 1001 access **without changing existing key contents**; fail closed on symlinks/conflicting keys. Do not silently start or elevate privileged Web.
- Cloudflare DNS-only Zone:Read + DNS:Edit token, zone ID and zone name are private environment inputs. Missing settings => manual TXT copy/export, no real operation until new permission; never reuse R2 credentials.
- Operator preflight: source/mirror SHA parity, clean Git main, no active maintenance lock/backup restore, current encrypted pre-update snapshot/identity custody, all five production Compose containers healthy, **existing DKIM public/secret inventory**, then isolated image/test verification.
- **Private escrow gate:** R05/BR04 encrypted backups do not include newly proposed `readbox_dkim_private` by default. Approve a separate isolated encrypted custody/recovery scope before creating real per-domain DKIM keys; do not assume R2 backups contain them.
- No VPS deployment, live key generation, real DNS, mailserver modification or user data operation occurred in DKIM-01 source phase. Approved rollout must use one human-controlled action per step, with sanitized evidence and no automatic destructive rollback.

## DKIM-02/FIX-01 — Host build evidence, unchanged interfaces (2026-11-18)

- Existing host's baseline `/opt/readbox` remained `69b7f4c91100dd30c83ab56b24c29a4a0a9384b1` during build-only verification. Operator used temporary branch checkout and disposable Docker build without running a service; image-level Python 6/6 tests passed with OpenSSL `3.5.9-r0`.
- Only OpenSSL key-size text parser and embedded test coverage changed; **no changes** to Docker Compose, default/opt-in service profile, privileged mounts, SMTP/LMTP Postfix/Dovecot, volumes, auth, Prisma, Backup/R2 or update bridge.
- Next authorized controlled rollout: independently check source/mirror target parity, clean VPS baseline and `Ready (17/17)`; queue **one** Admin Panel update, confirm encrypted pre-update backup and verified deployed SHA/healthy services, then run an isolated opt-in DKIM image build check. Never directly patch `/opt/readbox`, manually bypass updater or deploy on a failed gate.
- **Still blocked for real DKIM keys/DNS:** existing named-volume UID/GID ownership preflight and separately approved encrypted private-key escrow/recovery. Until then, do not activate production DKIM domain key creation, modify Cloudflare TXT records, rotate keys, enable signing/outbound mail or treat a record as DNS-verified.
- No production restore, R2 mutation, DNS change, tag or release in this FIX-01 source closure.

## DKIM-02/FIX-02 — Agent image runtime-user contract (2026-11-18)

- **Cause and fix:** earlier provisioner container attempted to run `python3 -B /usr/local/bin/dkim-agent.py` as `1001:1001` but got `[Errno 13] Permission denied`. The image now explicitly sets agent script mode `0644`, then tests reading/compiling it **after** `USER 1001:1001` in an isolated build. This does not grant UID 1001 write access to its script.
- **Build proof:** temporary cloned candidate at `51276afba843a5e94377c2e794ec05ed677b4a9d`, OpenSSL `3.5.9-r0`; Docker image stages `[5/6]` six embedded Python tests and `[6/6]` non-root read smoke passed with `DKIM02_FIX02_NONROOT_BUILD_PASS`.
- **Unchanged contracts:** DKIM isolation `network_mode: none`, dedicated private/public/IPC volumes, Web read-only mount, Postfix/Dovecot and existing mail storage, no signing/outbound SMTP, app/auth/Prisma, backup agent/update bridge and R2.
- **Next operator action (separate controlled rollout):** Admin Panel Check for Updates, exact source/mirror target and guarded preflight; human-approved one-time Install Update with encrypted pre-update backup, then one focused DKIM agent recreation/health check using the deployed fixed image. The previously unhealthy agent was stopped with restart disabled; never bypass updater or edit source directly on VPS.
- **Private-key escrow gate remains:** real per-domain key generation and DNS publication are forbidden until separate approved encrypted offsite private-key custody plus recovery proof. A successful agent image test is not evidence of live key signing/DNS or backup inclusion.
- No live update, volume mutation, backup restore, R2 mutation, Cloudflare DNS change, production DKIM key creation, tag or release in FIX-02 source closure.


## DKIM-03 — Controlled future host rollout and escrow contract (2026-11-18)

- Existing deployed DKIM02 FIX02 agent was last verified healthy at source baseline `d2faedcebd302f488c515daba57441f59ff3a687`. DKIM-03 source changes were **not** deployed to VPS in this phase, and the live private volume and public DNS remain untouched.
- Later controlled source deployment must use only the existing Admin Panel authenticated updater, verified exact source/mirror SHA and pre-update age backup. Note: the existing R05 backup still excludes DKIM private keys. Opt-in DKIM agent container must be separately recreated and health checked after approval, with existing private/IPC volume ownership preserved.
- Host escrow helper requires root, pinned backup-agent Python runtime, exact named DKIM private volume, existing safe age identity and recipient, protected configured R2 adapter, global maintenance lock and private-key file lock. Its only production entry points are `escrow DOMAIN` and `verify DOMAIN`; no production `recover` operation exists.
- First authorized Admin DKIM provision stages a private key only and deliberately returns an `ESCROW_REQUIRED` error; no public `mail.txt` or DNS write is possible without a root-published verified receipt. Host operator must then separately perform escrow and check the remote immutable ciphertext; second controlled provision call publishes the matching public key. Never retry requests blindly or manually bypass with a TXT until verification.
- R2 object namespace `readbox/dkim-escrow/v1/` is isolated from existing `readbox/managed/` backups; no DELETE, put-overwrite or arbitrary endpoint. Conditional PUT support and real remote readback still need **separately approved live acceptance**. Any mismatch or unsupported condition stops without public record.
- Independent offsite age identity/R2 credential custody and recovery verification are mandatory before a real DKIM domain key is created; neither was touched in this source CI. Postfix/Dovecot remain inbound-only and cannot sign outbound messages. No production restore, new DNS, tag, release or R2 mutation took place.
