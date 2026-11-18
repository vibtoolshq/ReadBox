# 006 — Verification, Regression, Production Release & Rollback Gates

**Frozen baseline:** `e28886e5e0f7a155cd64e23bc8ee8f6668d6699c`. **Release status: NO-GO.** All future mail/VPS/restore gates are **NOT RUN** at freeze.

## Historic test evidence — do not confuse with production proof

| Gate | Historic result | GitHub Actions evidence | Does not prove |
|---|---|---|---|
| `npm ci` | PASS after FA-M01 lockfile correction | https://github.com/JILLU-Games/ReadBox/actions/runs/44080430558 | Docker runtime |
| `npm run db:validate` | PASS | Same run | live database migration |
| `npm run lint`, `npm run typecheck` | PASS | Same run | server security |
| `npm run test:unit` | 167 PASS | Same run | SMTP/LMTP delivery |
| `npm run test:ui` | 70 PASS | Same run | real inbound mail |
| `npm run build` | PASS | Same run | Docker image start |
| `npm run test:postgres` | NOT EXECUTED in that CI | Separate `package.json` script | live PostgreSQL |
| Production Docker image boot | NOT VERIFIED | no completed evidence in inspected runner | production readiness |

## Exactly one focused CI verification per approved phase

- **R-01:** production Compose selection, missing secret and password-URL negative cases, lockfile CI build, npm security audit and image provenance.
- **R-02:** disposable PostgreSQL migration replay, role/virtual map positive + negative SQL tests, Maildir delivery/app UID/ACL checks.
- **R-03:** disposable Postfix/Dovecot syntax, SMTP receipt and LMTP Maildir delivery, unknown recipient rejection, DNS/TLS contract.
- **R-04:** clean DB bootstrap, correct administrator identity check, unavailable/stale worker and failing DB/storage readiness, auth negatives, normal recovery.
- **R-05:** isolated backup/restore/rollback, data and ACL integrity, secrets handling, upgrades and downtime/availability evidence.
- **R-06:** consolidated source/mirror CI plus separately authorized live staging VPS acceptance, real DNS/port/TLS/SMTP/LMTP/mailbox, rollback and license/security review.

### Example checks, NOT executed in this documentation phase

```bash
npm ci
npm run db:validate
npm run lint
npm run typecheck
npm run test:unit
npm run test:ui
npm run build

# Explicit production file; do NOT use implicit compose.yaml development config.
docker compose -f docker-compose.yml config
docker compose -f docker-compose.yml build web worker

# Only with an isolated, disposable PostgreSQL test target:
npm run test:postgres
```

The target SHA, sanitized log, positive/negative result and command exit code must be recorded. A successful Compose parse is not proof of a running mailserver. Tests against production user data are forbidden.

## R-06 formal release GO gates

| Gate | Exact required evidence | Current |
|---|---|---|
| RG-01 | 32 audit IDs reconciled; zero open P0; all residual P1/P2 assessed | OPEN |
| RG-02 | Source and target same release SHA/tree; version and immutable image digest | NOT RUN |
| RG-03 | CI build, all tests, dependency audit at **actual release SHA** | NOT RUN |
| RG-04 | No dev Compose/default password; correct secure environment on chosen VPS/Coolify | NOT RUN |
| RG-05 | Running web/worker containers, fresh PostgreSQL migrations, persisted volumes and healthy restart | NOT RUN |
| RG-06 | Single PostgreSQL and actual Postfix SQL login + views, no unauthorized DB access | NOT RUN |
| RG-07 | Postfix TCP/25/SMTP and Dovecot LMTP routing work with canonical Maildir and UID/GID | NOT RUN |
| RG-08 | Actual public MX/A/AAAA/PTR + provider port 25 + host firewall checked externally | NOT RUN |
| RG-09 | Trusted web/mail TLS, certificate renewal and applicable DKIM operation | NOT RUN |
| RG-10 | External inbound mail accepted → Maildir original → worker indexed → inbox displayed → attachment accessible | NOT RUN |
| RG-11 | Unknown/disabled recipient rejection, MIME limits and no accepted-but-lost messages | NOT RUN |
| RG-12 | First-admin safe bootstrap, unauthorized route rejection and reset-token expiry | NOT RUN |
| RG-13 | Worker/DB/storage outages fail closed; recover without duplication or mail loss | NOT RUN |
| RG-14 | Backup confidentiality, restored DB/Maildir/attachments, hashes, ownership/ACL, rollback and downtime evidence | NOT RUN |
| RG-15 | Observability, logs/redaction, capacity, storage limits, alert/runbook and security checks | NOT RUN |
| RG-16 | MIT root vs AGPL reference license provenance and current advisories reviewed | NOT RUN |
| RG-17 | Final CI/job, live staging logs, release approver and explicit GO/NO-GO | NOT RUN |

**NO-GO triggers:** any open P0, broken secrets/migrations, SMTP/LMTP not working, no real DNS/port evidence, unsafe Maildir permissions, missed incoming mail, untested restore, false worker readiness or source-target mismatch. `NOT RUN` and `SKIPPED` never count as PASS. No production release unless all mandatory gates have objective evidence.

## Standard evidence and rollback records

```text
Gate ID / Phase / tested exact SHA:
Git tree and Docker image digest:
CI or staging environment (no raw credentials):
Test input incl. negative case:
Expected vs actual result:
Exit code/HTTP/SMTP reply and sanitized logs/artifact URL:
Maildir file ID and message/attachment integrity if applicable:
Reboot/restore/rollback and uptime result:
PASS / FAIL / SKIPPED / NOT RUN:
Author and timestamp:
```

Rollback contracts: no modifications to applied migrations; backup before changing data; retained original Maildir; only reversible image/config changes; retain database compatibility; no destructive release tests against production. A failed phase stays blocked—never silently release or auto-publish.

## R-01 completed focused release-foundation gate — 2026-11-17

- Full app regression (167 unit + 70 UI tests, typecheck/lint, Prisma validate, Next build): https://github.com/JILLU-Games/ReadBox/actions/runs/44092311120. Its final Docker smoke found the raw-percent credential encoding bug, so that whole workflow run is not labeled PASS.
- Final corrected Docker/Compose/runtime smoke, immutable base digest and moderate-level production npm audit: https://github.com/JILLU-Games/ReadBox/actions/runs/44093204590 — **SUCCESS**. Targeted Dockerfile and test correction only after app regression.
- Source code SHA: `113663cdabacf1460af5b06a334d99ab3db833c2`. R-01 finding outcomes: CI VERIFIED CLOSED; remaining R-02 to R-06 and external VPS SMTP/LMTP tests NOT RUN. Full mailserver **NO-GO**.

## R-02 focused database and Maildir CI — passed; formal release/phase gate remains blocked

- Code SHA `e1efdbd0b0380a94152947f7be47eb17c5c8d70c`; CI https://github.com/JILLU-Games/ReadBox/actions/runs/44099280332 **SUCCESS**. npm clean install, Prisma schema validation, TS, existing backend tests, new R-02 tests, production Compose topology validation and one disposable PostgreSQL 16 database.
- Positive: seven additive migrations applied once and second run no-op; dedicated Postfix login role SCRAM auth; virtual domain/mailbox/alias lookup; UID/GID delivery identity and strict Maildir permissions.
- Negative: unknown and disabled mailbox, deny password hash table field and public app users and writes, wrong UID/GID, missing/unfinished migration manifest fixture.
- Scope audit: **12 maintenance-branch changed paths** including temporary CI workflow; published code excludes the workflow. All executable code changes inside R-02 allowlist, no changed UI/auth/old migrations.
- **Not tested:** SMTP to LMTP, actual Dovecot mount, host mail routing and public port 25. `RB-P2-04` remains OPEN because `/health/ready` is unchanged; no production GO or formal R-02 CLOSED claim.

## R-02 final authorized readiness closure gate — 2026-11-17

- **Scope exception:** `RB-P2-04` only; `src/core/health/snapshot.ts` and two health-focused test files permitted, no unrelated runtime or UI changes.
- **Verified CI:** https://github.com/JILLU-Games/ReadBox/actions/runs/44102834169 — npm clean install, Prisma schema validation, TypeScript, 10/10 health tests, 3/3 existing R-02 tests, Next.js production build and exact allowed-path audit all PASS.
- **Previously verified:** https://github.com/JILLU-Games/ReadBox/actions/runs/44099280332 — disposable PostgreSQL migration repeat, positive/negative SQL lookups, least privilege and Maildir UID/GID checks.
- **Source code SHA:** `b6ab76119a31f9bf4e81b3990a5fcc6d802a6892`. **Result:** R-02 CI VERIFIED CLOSED; total complete phases **2/6**, remaining **4/6**. **Release status:** still NO-GO because production SMTP/LMTP, external DNS/TLS, VPS deployment and disaster recovery not verified.

## R-03 CI SMTP/LMTP acceptance — 2026-11-17

- **CI SUCCESS:** https://github.com/JILLU-Games/ReadBox/actions/runs/44107205810. Verified branch source patch SHA `d0f3272ea298de012da83c6f01b588fa0513d1da` (published main excludes temporary CI workflow). App Prisma validate, TypeScript, existing backend tests, new mailserver + DNS contracts passed. Disposable Docker PostgreSQL+web+worker+Postfix+Dovecot built and booted, SQL credential setup executed, Postfix/Dovecot configs linted; SMTP STARTTLS + accepted valid recipient → LMTP → persisted Maildir original. Unknown recipient and outside-domain relay rejected; startup without TLS certificate rejected; code diff audited against R-03 exact allowlist.
- **R-03 implementation:** CI VERIFIED CLOSED. Four owned findings resolved at CI contract level. Public/trusted TLS/DKIM applicability (`RB-P1-09`) and public port/DNS/VPS routing (`RB-P1-10`) **remain OPEN** for final R-06 live staging and legal provider authorization. CI's ephemeral self-signed cert and loopback SMTP are NOT public mailserver proof.
- **Still NOT RUN:** external MX/A/AAAA/PTR, real public TCP/25, provider firewall/IPv6, real trusted TLS cert renewal, SMTP queue recovery across outages, production backup/restore. All R-06 release gates still NO-GO until separately evidenced. Phase count **3/6**, findings CI verified **15/32**, **17 OPEN**.

## R-04 first-admin, heartbeat and fail-closed app health gate (2026-11-17)

- **Focused CI SUCCESS:** https://github.com/JILLU-Games/ReadBox/actions/runs/44112634511. Source code SHA `88e57e2e81dc07a8f91b07f448df85e51d58e429`. One clean disposable PostgreSQL 16 with Prisma migrations; `admin_accounts` created exactly once with forced-reset token, duplicate rejected, no user/admin-profile created, setup inspector verified the same table.
- Prisma validate, TypeScript, existing full backend unit tests and **70/70 UI tests**, Next build, health/error negative tests, recovery, worker process/readiness contract and strict allowed-path audit PASS.
- **Negative cases:** CLI guard rejects noninteractive/incorrect Docker auth or PostgreSQL targets, duplicate bootstrap rejects without data loss, missing/stale/future/degraded/failed worker heartbeat, unavailable DB, missing/symlink/unreadable Maildir and recovery; returned health is `not_ready`, not green.
- **Separation:** web Docker healthcheck remains `/health/live` (needed before worker startup); worker healthcheck tests `/health/ready`; response says app only, SMTP/LMTP not checked. Do not promote green web liveness to mailserver GO.
- **Excluded:** production operator TTY invocation on a real VPS, SMTP/LMTP external connectivity, actual retention recovery, backups, public TLS/port 25/DNS, release/tag. R-04 six CI contract findings closed, total **4/6 phases**, **21/32 CI verified**, **11 OPEN**. Full production still **NO-GO**.

## R-05 disposable encrypted backup/restore/rollback + host safety gates — 2026-11-17

- **GitHub Actions SUCCESS:** https://github.com/JILLU-Games/ReadBox/actions/runs/44121121316. Tested maintenance-branch SHA `fe25bcd5cdf9dfa3b3ee288c53cc3624197fe82e` (includes one-time CI workflow); published source code SHA `a55ec82bb2f58804e910427c66ff6352cd5c14c6` excludes the temporary workflow. Prisma validation, TypeScript, backend unit tests, UI **70/70**, Next.js production build, Bash/Python syntax, update/host contract tests, and exact **14-path** maintenance Scope Lock audit passed.
- **Real disposable CI scope (NOT a VPS):** PostgreSQL 16 in Docker Compose with public + mailserver schemas and dummy web/worker/Postfix/Dovecot process containers mounting named volumes; encrypted age X25519 private-key recovery; no configuration/credential export, 0600 artifact mode, SHA-256 manifest, Maildir/attachment/media/queue parity, numeric UID/GID 1001, a real POSIX ACL. In a mandatory downtime window active writers stopped and only previously running services restarted.
- **Recovery failure proof:** `R05_PROVEN_POST_DATABASE_APPLY_AUTOMATIC_ROLLBACK_PASS` confirms the forced failure was injected after a successful PostgreSQL restore and the automatic rollback succeeded. Verified DB + Maildir restored to the **pre-failed-restore state**; deliberately modified ciphertext was rejected with zero DB mutation. This proves a scoped disposable rollback case, **not** arbitrary disk failure or host power-loss recovery.
- **Host/static only:** systemd templates and host backup/restore/upgrader syntax plus confidentiality/ownership contract, not a live host upgrade or SMTP maintenance. No actual offsite encryption rotation, retention, backup transport, private-key escrow or VPS disaster recovery; no DNS/TLS/public SMTP. Open finding `RB-P2-01` (legacy Nginx outside allowlist), `RB-P2-07` (offsite/key/host live acceptance) remain. Next R-06 requires external tests and any necessary explicit scope exceptions.
- **Updated project:** 5/6 implementation phases CI CLOSED, 25 original findings CI verified, 7 OPEN; production release **NO-GO**.

## R-06 consolidated source CI and formal production NO-GO (2026-11-17)

- **Focused CI SUCCESS:** https://github.com/JILLU-Games/ReadBox/actions/runs/44127481624; source implementation SHA `807ca9f38adb02db2a8b73dc0901fce23ee5e63a`. The branch test passed clean npm/Prisma validation, all existing backend/auth & **70/70 UI** tests, Next.js production build, **production npm dependency audit**, allowed-code lint, guarded ephemeral PostgreSQL 16.14 migration/auth integration, disposable production web/worker/Postfix/Dovecot Docker build and true test STARTTLS→private LMTP→Maildir plus unknown/nonlocal relay rejections, age encrypted named-volume backup/restore/queue and UID/GID/ACL parity, forced post-DB-apply rollback and encrypted tamper rejection, 17-gate/license provenance negatives and exact 11-file changed-path audit.
- **Intentionally NOT a passing complete RG-03/full-tree lint:** two pre-existing unused catch-binding ESLint errors remain at `src/core/setup/trusted-operations.ts:366,386`. The R-06 job excludes only that unchanged source file from overall lint and separately fails if its documented two violations change or new errors arise. Do not count all-source lint as clean or waive these without separate scope approval.
- **Machine decision:** `R06_17_GATE_RECONCILIATION_PASS`, `R06_LICENSE_PROVENANCE_CONTRACT_PASS`, `R06_FINDINGS_OPEN=7`, `R06_LIVE_GATE_PASS_CLAIMS=0/17`, **`R06_PRODUCTION_NO_GO`**. R-06 workflow is read-only with no release/deploy/tag/publish permissions. The sanitised report is a **CI evidence artifact** and is not external staging proof.
- **RG-01–RG-17 formal release gates** remain NOT RUN / OPEN as independent live production acceptance; CI-only subsystems are evidence for narrow components, never for external DNS/TLS/public 25, real inbox attachment integrity, staging reboot/outage, offsite retention/restore or human legal/security review. `RB-P0-06`, `RB-P1-16`, `RB-P2-08` R-06 originals stay OPEN; overall 7/32 original OPEN. No staging authorization existed, thus final R-06 *full* release exit gate has **NOT** been satisfied although code/governance implementation is verified.
- **Implementation status:** 6/6 phases code/CI implementation done; **production release NO-GO**. Separate user approval is required for any live staging network/mail/VPS action and a separate later approval for tag/release. Legacy Nginx path and old lint source changes cannot be silently performed under R-06 Scope Lock.

## QIS-01 optional self-hosted onboarding verification (2026-11-17)

- **Successful GitHub CI:** https://github.com/JILLU-Games/ReadBox/actions/runs/44139227363, code SHA `2833f1f1e1be76d501cdd3fa2210d0c1084d9b47`. Exact 16-file approved Scope Lock and final `QIS01_RELEASE_REMAINS_NO_GO_PASS` markers. QIS-01 is an additive installer/onboarding patch, NOT completion of any open R-06 live acceptance gate.
- **Automated tests performed in disposable CI:** npm clean install/Prisma validation, source lint excluding **exactly the 2 pre-existing R-04 errors** with strict baseline assertion, TS typecheck, full existing backend/auth/unit regression, new React UI onboarding tests, Next.js production build, shell script syntax and source contract, real PostgreSQL 16 ephemeral migration and **concurrent admin-once with existing password reset**. Installer generated private 0600 `.env`, persisted only the activation hash/expiry, rerun preserved the exact bytes, and booted real disposable Compose PostgreSQL/web/worker and private SQL role. No plaintext code was uploaded as artifact.
- **Negative checks:** invalid activation code, wrong host/origin, non-HTTPS, expired or too-future token, disabled auth/non-Compose context, concurrent admin attempts and reset replay. No new second admin; existing auth/migrations/worker/mailserver unchanged. Existing `scripts/install/readbox-update.sh` contains fail-closed backup and history validation, but its **full update/rollback runtime remains untested** on a live VPS.
- **Formal external gates:** `RG-01` through `RG-17` still not accepted as independent live staging evidence. The original `RB-P0-06, RB-P1-09, RB-P1-10, RB-P1-16, RB-P2-01, RB-P2-07, RB-P2-08` remain OPEN. HTTPS reverse proxy, cert, public DNS, inbound TCP/25, real email delivery, offsite recovery and release require new separate approval. **PRODUCTION NO-GO.**

## R-06/QIS-01 CI compatibility verification — 2026-11-18

- **Successful focused CI (source):** https://github.com/JILLU-Games/ReadBox/actions/runs/44147873597; tested executable SHA `c27b30f587f37bc590a483e0bea263f2ac08d0e7`; all job steps SUCCESS, with no tag/release/deploy permission.
- **Prior failure confirmed:** https://github.com/JILLU-Games/ReadBox/actions/runs/44140465798 at `4467636a1300fd45b85b35cf556fdb106faa0ec9`; exact-scope checker used `R05..HEAD` after authorized QIS-01 patch. Full app/integration/recovery steps had succeeded; failure was a historical CI range mismatch.
- **Separated immutable Git range proofs:** `c3f9dd4..807ca9f` exact 11 R-06 implementation files; `807ca9f..fa774bd` exact 8 R-06 closure files; `fa774bd..2833f1f` exact 16 QIS-01 files; `2833f1f..4467636` exact 3 QIS-01 closure files. CI enforces full SHAs, ancestry, exact sets and whitespace audit, not a cross-phase moving HEAD allowlist.
- **Observed CI markers:** `R06_HISTORICAL_IMPLEMENTATION_SCOPE_PASS 11`; `R06_HISTORICAL_NOTES_SCOPE_PASS 8`; `QIS01_APPROVED_IMPLEMENTATION_SCOPE_PASS 16`; `QIS01_APPROVED_NOTES_SCOPE_PASS 3`; `R06_QIS01_IMMUTABLE_SCOPE_AUDITS_PASS`; `R06_PRODUCTION_NO_GO`; `R06_FINDINGS_OPEN=7`; `R06_LIVE_GATE_PASS_CLAIMS=0/17`; `R06_ALL_CI_CONTRACTS_PASS_PRODUCTION_NO_GO`.
- **Audit and boundaries:** Code change only `.github/workflows/r06-production-readiness.yml`; closure notes limited to 003 and 006. Existing source/UI/auth/migrations/mailserver/install/update code and old R-04 exact two-lint-error baseline unchanged. No real staging/production VPS, trusted public TLS/DNS, Internet TCP/25, inbox attachment delivery, offsite restoration, license signoff, Git tag or release. Original **7 findings OPEN**, formal **0/17 live gates PASS**, **PRODUCTION NO-GO**. Source/mirror exact closeout SHA must be compared after fast-forward.

## DKIM-01 — Source, CI and live deployment gates (2026-11-18)

| Gate | Result / evidence |
|---|---|
| Frozen main source/mirror/local SHA | `ea14efa5b5571b0ed1e00e211e07a7862f2b6a0f` at entry |
| Candidate source/mirror tree equality | `3f6dc44bc96a0fa595fba0362012e5214a7b53fe` PASS |
| Exact approved implementation patch | **13/13 approved paths**, no Prisma/SMTP/auth/backup/updater source changes |
| DKIM unit/mocked Cloudflare/zone-export tests | **6/6 PASS** (no real provider calls) |
| One final corrected disposable R06 run | [#44273197408](https://github.com/JILLU-Games/ReadBox/actions/runs/44273197408) **SUCCESS** |
| Default app/UI/build, dependency audit, database and SMTP/LMTP | PASS in R06 |
| Encrypted recovery/rollback and historic immutable release NO-GO | PASS in R06 |
| Opt-in isolated DKIM image build/embedded Python tests | **NOT RUN by default R06**; mandatory isolated check before VPS activation |
| Production secret/volume ownership and encrypted private key escrow | **NOT RUN / NOT COVERED** |
| Real Cloudflare DNS create/verification | **NOT RUN**; requires distinct operator approval |
| Production outbound signing | NOT IMPLEMENTED; inbound-only preserved |
| Release tag/v1.0.0 production GO | **NO-GO** (historical 17 live acceptance gates remain separate) |

CI candidate was amended only after focused failures: default create-domain payload, TypeScript test extensions, and default Compose service count. Only the final corrected candidate is counted as PASS. Final notes-only closure does not itself exercise live agent behavior. Verify source, mirror and local final main SHA/tree non-force before phase close.

## DKIM-02/FIX-01 — Source acceptance and rollout boundary (2026-11-18)

| Gate | Evidence | Result |
|---|---|---|
| Frozen source/mirror/local main | `69b7f4c91100dd30c83ab56b24c29a4a0a9384b1` | PASS at entry |
| Code Scope Lock | only `deployment/dkim/agent.py`, `deployment/dkim/test_agent.py` | PASS |
| Candidate source/mirror exact tree | `c973d0db780939a5049d2366540b81e5f589738d` | PASS |
| Focused R06 read-only app/UI/security/SMTP/recovery CI | [Run #44280725129](https://github.com/JILLU-Games/ReadBox/actions/runs/44280725129) mirror `5820255216293a7ad54b2ffe6e43c7dda8d62e37` | **SUCCESS** |
| True disposable opt-in DKIM Docker image build | operator's exact candidate SHA/tree checkout, Alpine OpenSSL 3.5.9-r0 | **PASS** |
| Embedded Python regression | `Ran 6 tests`, `OK`, `DKIM02_FIX01_DISPOSABLE_BUILD_PASS` | **PASS** |
| Key protection / 1024-bit rejection / public conflicts | disposable tests | PASS |
| Notes closure exact approved scope | `notes/003–007` only | PREPARED |
| Final source/mirror/local main SHA/tree equality | verify after non-force publication | PENDING FINAL REF CHECK |
| Live source deployment + new host image build | separate Admin Panel approval/action | **NOT RUN** |
| Private-key escrow / key provision / real Cloudflare DNS | outside FIX-01 | **NOT RUN** |
| Stable production release `v1.0.0` | formal R06 governance | **NO-GO** |

The isolated image build was carried out in a temporary checkout on the VPS host; it did not update `/opt/readbox`, start the DKIM service or create a real domain key. Build-only verification must not be represented as live DNS/signing evidence.

## DKIM-02/FIX-02 — Focused verification and phase gates (2026-11-18)

| Gate | Evidence | Result |
|---|---|---|
| Frozen main baseline | `ebb2e2bddd0ef26671b283a4f71bc4d35bb32dbd` source/mirror/local | PASS |
| Exact code Scope Lock | only `deployment/dkim/Dockerfile` changed | PASS |
| Source/mirror code tree | `d34e6b539e7ba3aae3a2f03f8046a5f2821dcfcf` | PASS |
| Single disposable no-cache Docker build | temporary exact SHA checkout, `docker build --no-cache --progress=plain` | **PASS** |
| Embedded Python tests | `Ran 6 tests`, `OK` | **6/6 PASS** |
| Non-root UID1001 readable/compile smoke | final image `RUN python3 -B -c ... compile(p.read_bytes(), ...)` stage `[6/6]` | **PASS** |
| Explicit disposable completion marker | `DKIM02_FIX02_NONROOT_BUILD_PASS` | **PASS** |
| Documentation Scope Lock | only `notes/003–007` after code patch | PREPARED |
| Git main source/mirror/local sync | verify exact SHA/tree after non-force promotion | PENDING FINAL REF CHECK |
| Live VPS updated image and container healthy | separate approved Admin Panel rollout | **NOT RUN** |
| Production DKIM keys, encrypted escrow/recovery and DNS publication | excluded | **NOT RUN** |
| Tags, releases, stable production readiness | excluded; existing production release NO-GO | **NO ACTION** |

Build-only PASS does not establish a running healthy provisioner or recovered private keys. Stopped unhealthy provisioner was not restarted in this FIX-02 source phase.


## DKIM-03 — Focused CI and source-gate record (2026-11-18)

| Gate | Evidence | Result |
|---|---|---|
| Frozen source/mirror/local main | `d2faedcebd302f488c515daba57441f59ff3a687` | PASS |
| Candidate identical code tree | `4cccc52ea7d92bdaf4a06b27fc15a8039aae8036` | PASS |
| GitHub original focused CI | [#44293943849](https://github.com/JILLU-Games/ReadBox/actions/runs/44293943849) | FAIL: receipt Python SyntaxError |
| Minimal one-file repair | corrected receipt `try`/mode under umask 077 | APPLIED |
| One necessary focused CI recheck | [#44294483799](https://github.com/JILLU-Games/ReadBox/actions/runs/44294483799) exact tested mirror `bac871825fee87dda6a3bf74915832bee6ca4c5a` | **SUCCESS** |
| Disposable real age + mocked immutable R2 cases | wrong identity, tamper, lost ACK, interruption, conflict, idempotency, complete original-volume loss | **11/11 PASS** |
| Agent Docker RSA/receipt/public conflict tests | fresh Docker build + no-root read smoke | **8/8 PASS** |
| Exact production Scope Lock | seven approved code/doc paths plus `notes/003–007` | PASS at tested candidate; audit final notes diff at closure |
| Final Git main parity and clean local | verify non-force exact SHA/tree | PENDING final ref check |
| Real production R2, private identity escrow and host-loss verification | separate operator approval/host proof | **NOT RUN** |
| Live DKIM key generation, TXT DNS, VPS deployment | explicitly excluded | **NOT RUN** |
| Tag, stable release, production GO | excluded | **NO-GO** |

No second optional CI loop: after the syntax defect, only the necessary single focused recheck was performed. Notes-only closure does not create runtime proof. Fail closed on an unsupported R2 conditional PUT or missing independent identity custody.
