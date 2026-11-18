# 005 — Actual Feature Implementation and Verified Working Tracker

**Frozen baseline:** `e28886e5e0f7a155cd64e23bc8ee8f6668d6699c`. **Implementation phases:** 6/6 CI IMPLEMENTATION VERIFIED; no remaining implementation phase. R-06 live staging/production acceptance NOT RUN, 7 original findings OPEN. **Release:** NO-GO.

## Terminology — critical distinction

- **CODE PRESENT**: exact implementation/source or configuration file exists; may have unit tests but not necessarily live.
- **CI VERIFIED**: inspected GitHub job demonstrated the stated subset at a specific tested SHA.
- **LIVE VERIFIED**: worked on a real configured staging/production VPS with mailserver and observed outcomes (**none granted** at baseline).
- **NOT DEPLOYED**: code template may exist but the published runtime Compose stack does not provision the service.
- **PLANNED**: not implemented. Never mark a proposed update as a current working feature.

## A. Currently present application code and evidence

| Feature ID | Feature / functionality actually in source | Exact path(s) | Verified level | Live VPS |
|---|---|---|---|---|
| F-01 | Next.js app routes, landing, user inbox and admin console | `src/app/page.tsx`, `src/app/(workspace)/users/**`, `src/app/(workspace)/vcon/**` | CODE PRESENT; build & 70 UI tests CI VERIFIED | UNVERIFIED |
| F-02 | Auth, route authorization, local account/reset/operator CLI | `src/auth.ts`, `src/core/auth/**`, `scripts/auth/operator.ts` | R-04 initial admin/CLI guard CI VERIFIED; existing login/auth policy unchanged | LIVE VPS UNVERIFIED |
| F-03 | PostgreSQL Prisma data client + migrations | `src/core/database/client.ts`, `prisma/schema.prisma`, `prisma/migrations/**` | CODE PRESENT; static Prisma validate CI VERIFIED | LIVE MIGRATION NOT VERIFIED |
| F-04 | Domains and managed mailbox provisioning | `src/core/domains/service.ts`, `src/core/mailboxes/service.ts` | CODE PRESENT; tests include admin contract | external SQL + Maildir unverified |
| F-05 | Single PostgreSQL mailserver schema + virtual map adapter | `src/core/mailserver/pg-adapter.ts`, `prisma/migrations/20261115000000_mailserver_schema_and_roles/migration.sql` | CODE PRESENT; adapter tests | external Postfix NOT DEPLOYED |
| F-06 | Filesystem path confinement, mailbox locks, Maildir tree | `src/core/mailboxes/paths.ts`, `src/core/mailboxes/provisioning.ts` | CODE PRESENT | vmail/nextjs identity unverified |
| F-07 | Incoming Maildir ingestion, MIME, attachment storage and counters | `src/workers/ingestion.ts`, `src/core/ingestion/**`, `scripts/mail/ingest.ts` | CODE PRESENT; unit tests | SMTP-to-inbox UNVERIFIED |
| F-08 | DNS suggestion/verification and DKIM public-key record reading | `src/core/dns/records.ts`, `src/core/dns/resolver.ts`, `src/core/dns/opendkim.ts` | CODE PRESENT | DNS publication and signer NOT DEPLOYED |
| F-09 | Admin operations/audit/retention/settings and user workspace | `src/core/operations/service.ts`, `src/core/audit/**`, `src/core/settings/**` | CODE PRESENT; subset CI tested | UNVERIFIED |
| F-10 | Health/readiness JSON endpoints and worker heartbeat logic | `src/core/health/snapshot.ts`, `src/app/health/live/route.ts`, `src/app/health/ready/route.ts` | R-04 production heartbeat/DB/storage negative cases CI VERIFIED | SMTP/LMTP readiness still unverified |
| F-11 | Multi-stage production app Dockerfile and Compose definition | `Dockerfile`, `docker-compose.yml`, `entrypoint.sh` | CONFIG PRESENT; npm build passed, not image boot | UNVERIFIED |
| F-12 | Compose recovery and host update/backup/restore scripts | `deployment/operations/**`, `scripts/ops/**`, `scripts/updater/**`, `deployment/templates/systemd/**` | R-05 disposable PostgreSQL+named-volume encrypted restore/rollback CI VERIFIED; host scripts syntax/static only | REAL VPS/HOST UNVERIFIED |
| F-13 | Independent Postfix/Dovecot/LMTP mailserver binaries | `docker-compose.yml` now has opt-in Postfix+Dovecot `mailserver` profile | CI DOCKER VERIFIED; NOT VPS DEPLOYED | NO |
| F-14 | SMTP submission/IMAP email-client services | `src/core/mailserver/pg-adapter.ts:274–275` disables password login; Dovecot template LMTP-only | NOT IN CURRENT PRODUCT PROOF | NO |

## B. Existing inspected CI run

**Source GitHub Actions:** https://github.com/JILLU-Games/ReadBox/actions/runs/44080430558

- `npm ci`: PASS (after fixed lockfile).
- `npm run db:validate`: PASS.
- `npm run lint` and `npm run typecheck`: PASS.
- `npm run test:unit`: 167 PASS, 0 failed.
- `npm run test:ui`: 70 PASS, 0 failed.
- `npm run build`: PASS.
- **Not established by this run:** production Docker image startup; `npm run test:postgres` with live disposable DB; real mail acceptance, Postfix/Dovecot, DNS/TLS, external reachability, reboot/restore; zero current dependency security advisories.

## C. Features or contract outcomes not proven before release

| Phase | Exact expected improvement (NOT YET WORKING-PROVEN) | State | Proof URL/commit when completed |
|---|---|---|---|
| R-01 | Production vs development Compose, secrets, reproducible Docker/dependency image, correct README | CI VERIFIED | https://github.com/JILLU-Games/ReadBox/actions/runs/44093204590 |
| R-02 | Working Postfix lookup/login role, schema parity, cross-UID Maildir permissions | VERIFIED CLOSED (CI; authorized health exception) | https://github.com/JILLU-Games/ReadBox/actions/runs/44102834169 |
| R-03 | Operating SMTP→LMTP inbound mail flow, correct DNS/TLS/mailserver integration | CI VERIFIED in disposable Docker; public SMTP/DNS/TLS unverified | https://github.com/JILLU-Games/ReadBox/actions/runs/44107205810 |
| R-04 | First-admin startup, trustworthy worker heartbeat, fail-closed readiness | CI VERIFIED CLOSED | https://github.com/JILLU-Games/ReadBox/actions/runs/44112634511 |
| R-05 | Encrypted Compose volume and PostgreSQL backup→restore→rollback; host updater boundary | CI IMPLEMENTATION VERIFIED, 2 findings OPEN | https://github.com/JILLU-Games/ReadBox/actions/runs/44121121316 |
| R-06 | Read-only final consolidated CI and 17-gate human approval; actual public inbound/inbox and disaster recovery staging | CI IMPLEMENTATION VERIFIED; 3 owned live findings OPEN | https://github.com/JILLU-Games/ReadBox/actions/runs/44127481624 |

## Per-phase actual-working append record (only after real verification)

```text
Phase:
Finding IDs:
What code was changed (exact paths):
What actually worked in CI (tested SHA/run URL):
What actually worked on VPS (timestamp/domain anonymized/log proof):
Negative cases and user-visible features that remained unchanged:
Remaining unverified / future improvements:
Source and mirrored SHA:
```

**No future features are marked complete.** The tracker must not be updated from code review alone to claim live production functionality.

## R-01 code-level working features (CI verified, NOT live VPS)

- Docker build uses immutable Node digest and one package-lock resolution. `prisma`, `tsx`, `dotenv` are available in runtime. App CI: https://github.com/JILLU-Games/ReadBox/actions/runs/44092311120.
- Default Compose defines `postgres`, `web`, `worker`; opt-in `compose.dev.yaml` preserves the development database setup.
- Docker entrypoint safely encodes arbitrary DB password symbols and fails on short DB/auth credentials. Docker and production npm audit CI: https://github.com/JILLU-Games/ReadBox/actions/runs/44093204590.
- Actual production VPS Postfix/Dovecot, mail receipt, real PostgreSQL migrations and disaster recovery: **NOT VERIFIED**. Existing UI, routes, auth behavior and messages unchanged.

## R-02 actual working delta (isolated CI only)

- **PostgreSQL 16:** seven Prisma migrations applied to disposable DB, and repeat `migrate deploy` succeeded without changes. New migration `prisma/migrations/20261117010000_postfix_login_identity/migration.sql` creates the restricted `readbox_postfix` LOGIN principal, inheriting the original `postfix_lookup` read-only group.
- **Virtual lookups:** enabled domain/mailbox/alias SQL views returned the expected values; disabled domain, unknown mailbox and unauthorized table writes/password-hash/user SELECT were rejected. Tests used the real PostgreSQL server in CI, not a mock.
- **Maildir:** `docker-compose.yml` pins web/worker runtime UID/GID 1001; Dovecot template now accepts matching numeric values; `src/core/mailboxes/provisioning.ts` refuses unexpected directory owners without chowning existing data.
- **Migration parity:** `src/core/mailserver/pg-adapter.ts` exposes a checked manifest verifier; unit tests cover successful, missing and unfinished migrations. The application `/health/ready` is **NOT** connected to this checker, so `RB-P2-04` remains OPEN and R-02 phase closure is BLOCKED under Scope Lock.
- **Proof:** https://github.com/JILLU-Games/ReadBox/actions/runs/44099280332. Code SHA: `e1efdbd0b0380a94152947f7be47eb17c5c8d70c`.
- **Not verified:** real Postfix/Dovecot installed or running, external mail delivery, DB provisioning one-shot profile invocation in a deployed stack, public DNS/TLS, VPS mounts and backups. No change to app UI/routes/auth/features.

## R-02 final verified working delta (2026-11-17)

- `getReadinessSnapshot()` now uses `verifyMailserverMigrationParity()` from the existing R-02 PG adapter, enumerating expected checked-in migrations at runtime with a mandatory seven-migration baseline. `checks.migrations.ok` is `false` for missing/unfinished history and query errors; `/health/ready` continues returning HTTP 503 on `not_ready` without editing its route.
- Positive and negative health tests and Next production build pass: https://github.com/JILLU-Games/ReadBox/actions/runs/44102834169; original disposable PostgreSQL/role/UID contract proof preserved in 009.
- This **does not install Postfix/Dovecot**; real mailbox reception and public VPS health remain unverified. Other features, UI/auth, routes, historical migrations and existing mailbox data unchanged.
- R-02 completed CI-wise; R-03, R-04, R-05, R-06 not started.

## R-03 actual working contract (CI only, not production VPS)

- Production Compose now **optionally** starts `postfix` and `dovecot` through `--profile mailserver`; default web, worker and PostgreSQL remain as before. The Postfix queue is persistently volume-backed, Dovecot writes to the existing Maildir volume as numeric UID/GID 1001. Postfix SQL queries use the same PostgreSQL role from R-02.
- Verified real disposable-runner behavior: SMTP STARTTLS, valid `support@r03.example.test` delivery to Maildir, unknown mailbox RCPT reject, nonlocal relay reject, missing TLS refusal, Postfix and Dovecot config lint. Evidence https://github.com/JILLU-Games/ReadBox/actions/runs/44107205810; code commit `d0f3272ea298de012da83c6f01b588fa0513d1da`.
- `deployment/mailserver/README.md` documents private certificate handoff and DNS/MX/PTR as manual provider/VPS responsibilities. No DKIM signing daemon is included (inbound-only); previews remain advisory.
- NOT LIVE VERIFIED: public TCP/25, MX/PTR, production cert/renewal, sender reputation, automatic DNS provisioning, IMAP/SMTP submission/outbound, actual user inbox on VPS, backup/restore. **Existing UI/auth/routes/business source unchanged.**

## R-04 actual working implementation delta (2026-11-17)

- **New code-level flow:** `bootstrapInitialAdminAccount` creates one real `admin_accounts` admin with a random unusable password, `passwordResetRequired=true`, hashed expiring `admin_reset_tokens`; concurrent bootstrap guarded by transaction advisory lock. Existing legacy user bootstrap implementation remains unchanged for compatibility, but the operator's `bootstrap` action uses the correct admin-table flow.
- **Explicit production operator path:** `scripts/auth/operator.ts --bootstrap-production` requires private-container interactive operation and never auto-runs on normal app startup. Clean disposable PostgreSQL once+duplicate+inspector parity verified at https://github.com/JILLU-Games/ReadBox/actions/runs/44112634511; interactive VPS terminal session not tested.
- **Application readiness:** production always requires a fresh, healthy ingestion heartbeat; DB, migrations and writable/readable storage must pass; stale/future/degraded/unavailable states fail closed. Existing `/health/live` remains process liveness, worker health additionally queries `/health/ready`. No new public route, no login policy change.
- **Transport honesty:** `scope: application` and `mailTransport: not_checked` indicate SMTP/LMTP receipt is not verified by a 200 application readiness. Existing R-03 public DNS/TLS/VPS uncertainties remain.
- **Evidence:** https://github.com/JILLU-Games/ReadBox/actions/runs/44112634511; SHA `88e57e2e81dc07a8f91b07f448df85e51d58e429`. No production/mailbox data modified, no live VPS tested. Next R-05/R-06 still OPEN.

## R-05 actual working recovery contract (CI only)

- **Published code:** `a55ec82bb2f58804e910427c66ff6352cd5c14c6`. **Full focused CI:** https://github.com/JILLU-Games/ReadBox/actions/runs/44121121316. The new `deployment/operations/compose_recovery.py` tool stopped **active** writer containers, dumped the real disposable PostgreSQL 16 database (public + mailserver schemas), captured the web Maildir/attachments/media volume mounts and a Postfix queue volume, and wrote an `age` public-key encrypted 0600 archive with SHA-256 manifest. Configuration files and plaintext credentials were deliberately excluded.
- Verified in same disposable Compose CI: the restore returned pre-mutation SQL rows, Maildir/attachment/media/queue bytes, numeric UID/GID 1001 and a named-volume POSIX ACL. A deliberate failure **after database apply** forced encrypted pre-restore rollback, which recovered the modified pre-state. Tampered ciphertext was rejected before service changes. Previously-running containers restarted; this is a downtime maintenance process, **not online backup**.
- `scripts/ops/backup.sh`, `restore.sh`, host `upgrade.sh` and systemd template paths were corrected for secret exclusion, numeric owner+ACL, explicit downtime and rollback handling. **Only static and syntax CI proof exists for these host/systemd paths, not actual host upgrade or VPS restore.** The privileged updater worker normalizes obsolete release repo alias; in-app Docker self-update stays blocked and requires orchestrator-managed image deploy.
- **Not yet working-proven:** offsite transport/retention, encryption private-key custody/recovery, actual VPS systemd/Compose restore, zero-downtime SMTP, real public MX/LMTP, service recovery after a power failure; original RB-P2-01 legacy Nginx path outside this Scope Lock. UI/auth/routes/schema/mailserver engine unchanged.
- **Phase count 5/6**, verified findings **25/32**, remaining **7**. Full production **NO-GO**.

## R-06 actual working implementation vs external readiness (2026-11-17)

- **Actual source code:** `807ca9f38adb02db2a8b73dc0901fce23ee5e63a` with `.github/workflows/r06-production-readiness.yml` (source-only, contents read, no release/tag), `scripts/testing/r06-release-gate.mjs`, `r06-ephemeral-postgres.sh`, `r06-smtp-rehearsal.sh`, `r06-verify-lint-baseline.mjs` and `tests/integration/r06-release-gate.test.mjs`; dedicated docs on staging, release/GO governance and MIT/AGPL provenance. README/SECURITY carry explicit NO-GO warning.
- **CI actually worked:** https://github.com/JILLU-Games/ReadBox/actions/runs/44127481624: complete existing auth/unit/UI regression and build, production npm audit, disposable tmpfs PostgreSQL 16.14 auth/migration replay (verified target guard), real disposable production Docker web/worker/Postfix/Dovecot build+startup, localhost test STARTTLS→LMTP→Maildir delivery plus SMTP negatives, age encrypted PostgreSQL/Maildir/queue backup→restore with UID 1001/ACL and injected automatic rollback. 32 finding/17 formal gate metadata and strict no-go evidence tests PASS. Exact 11-source-path Scope Lock audit PASS.
- **Limits explicitly OPEN:** no real Internet MX/A/PTR/certificate or public port 25, no live SMTP→LMTP→actual authenticated inbox+attachment success, no real VPS/storage/reboot, no actual offsite retained encrypted restore, no final license distribution review, no user approval to publish. All 7 original findings remain OPEN; `RG-01..RG-17` external staging evidence not provided.
- **Lint debt:** full-tree ESLint has exactly two earlier R-04 unused catch bindings; source excluded narrowly from R-06 lint and checked by separate strict two-error inventory. The full lint gate remains unmet, not presented as clean.
- **Phase implementation:** 6/6 CI complete, **production GO/NO-GO = NO-GO**. No user/app/auth/mailserver data/UX changes. Next step is separate live staging authorization and, if needed, a narrow scope exception—not another default implementation phase.

## DKIM-01 — Feature state and precise test boundary (2026-11-18)

| Capability | Status |
|---|---|
| Isolated no-network RSA-2048 keypair implementation | SOURCE PRESENT; optional Docker profile not live-tested |
| Private key storage separate from Web, public-only record mount | SOURCE PRESENT; Docker Compose/patch audit PASS |
| Existing/new domain admin control, explicit opt-in | UI/source integrated; R06 UI regression PASS |
| Zone-scoped Cloudflare DKIM TXT create/reconcile | SOURCE PRESENT; mocked tests PASS, **real API NOT RUN** |
| Missing token manual TXT / zone export | SOURCE PRESENT; focused Node test PASS |
| Duplicate requests/invalid public/foreign zone/conflict fail closed | Focused mock/negative tests PASS; live gates pending |
| Independent key/public DNS/signing-status UI | SOURCE PRESENT; signer explicitly inactive |
| Default Postfix/Dovecot service topology | Unchanged by `profiles: ["dkim"]`; R06 SMTP/LMTP PASS |
| Private DKIM key encrypted backup/escrow/restore | **NOT IMPLEMENTED**; requires separate approved scope |
| Live VPS deployment, Cloudflare write, real signing or outbound SMTP | **NOT RUN / NOT ENABLED** |

Implementation is DKIM DNS *preparation*, not outbound DKIM signing. Exact CI candidate tree `3f6dc44bc96a0fa595fba0362012e5214a7b53fe`; R06 [#44273197408](https://github.com/JILLU-Games/ReadBox/actions/runs/44273197408) SUCCESS; local DKIM Node six focused cases PASS. The opt-in agent image build and its embedded Python unit tests are **not** part of the default CI run and must be verified in isolated deployment readiness.

## DKIM-02/FIX-01 — Feature delta (2026-11-18)

| Item | State |
|---|---|
| OpenSSL 3.x comma/prime-count RSA-size text compatibility | **IMPLEMENTED** in `deployment/dkim/agent.py` |
| Legacy OpenSSL RSA-size header compatibility | **PRESERVED** |
| RSA-2048 lower bound / malformed key rejection | **PRESERVED; TESTED** |
| Idempotent key creation / never overwrite existing private or public conflict | **UNCHANGED; disposable test PASS** |
| Embedded Python key-agent test suite | **6/6 PASS** in disposable Docker image build |
| Existing application, UI, auth, Prisma, Compose and mailserver | **UNCHANGED** |
| R06 read-only regression at mirror candidate | **SUCCESS**, [#44280725129](https://github.com/JILLU-Games/ReadBox/actions/runs/44280725129) |
| Live key escrow, production DKIM key generation, provider DNS write | **NOT RUN / NOT APPROVED BY FIX-01** |
| New feature source deploy to existing VPS via Admin Panel | **SEPARATE CONTROLLED ROLLOUT PENDING** |

Frozen baseline `69b7f4c91100dd30c83ab56b24c29a4a0a9384b1`; tested implementation tree `c973d0db780939a5049d2366540b81e5f589738d`. Only the two approved Python files changed before documentation closure. DKIM signing/outbound SMTP remain disabled.

## DKIM-02/FIX-02 — Implementation status (2026-11-18)

| Item | State |
|---|---|
| Non-root-readable `/usr/local/bin/dkim-agent.py` at mode `0644` | **IMPLEMENTED** in `deployment/dkim/Dockerfile` |
| Build-time user `1001:1001` Python read/compile smoke test | **IMPLEMENTED; PASS** |
| Existing agent Python regression suite | **6/6 PASS** in single disposable uncached Docker build |
| Existing `agent.py`, tests, Docker Compose and mailserver | **UNCHANGED** |
| Existing UI/auth/Prisma, backup/R2, secrets and volumes | **UNCHANGED** |
| Test output marker | `DKIM02_FIX02_NONROOT_BUILD_PASS` |
| Live VPS deployment of FIX-02 and healthy-agent assertion | **NOT RUN — separate controlled update** |
| Encrypted private-key escrow/recovery and domain DKIM generation/DNS | **NOT RUN — safety gate remains** |

Frozen baseline `ebb2e2bddd0ef26671b283a4f71bc4d35bb32dbd`; code tree `d34e6b539e7ba3aae3a2f03f8046a5f2821dcfcf`. This is a runtime image permission compatibility fix, not outbound signing or DNS publishing.


## DKIM-03 — Implemented versus not-run features (2026-11-18)

| Contract | State |
|---|---|
| Offline DKIM key staging without public TXT before escrow | **IMPLEMENTED / disposable agent tests PASS** |
| Per-domain root-issued SHA/fingerprint-bound immutable R2 receipt gate | **IMPLEMENTED / negative tests PASS** |
| Host-only existing age recipient/identity plus protected R2 credentials reuse | **IMPLEMENTED; no real credentials accessed in CI** |
| Fixed `readbox/dkim-escrow/v1/<domain>/<private SHA256>.age` immutable object | **IMPLEMENTED; mocked R2 verified** |
| Local age decrypt + bounded remote ciphertext readback + public RSA fingerprint | **11/11 disposable escrow tests PASS** |
| Lost upload ACK, interrupted upload, existing object conflict, crash-before-receipt | **PASS in mocked R2 cases** |
| New disposable volume recovery after original key/receipt deletion | **PASS; no production restore path** |
| Existing agent Docker RSA regression and non-root smoke | **8/8 tests + Docker build PASS** |
| Existing R05/BR04 managed backups, UI/auth/Prisma/mailserver/Compose | **UNCHANGED** |
| Real Cloudflare R2 API conditional PUT/GET and independent age-key custody | **NOT RUN; requires separately authorized operator acceptance** |
| VPS DKIM03 source deploy / live key / real DNS / outbound signer | **NOT RUN** |

Exact verified tested code tree: `4cccc52ea7d92bdaf4a06b27fc15a8039aae8036`.
Final notes-only closure commits change documentation, not the tested code or frozen release gate.
