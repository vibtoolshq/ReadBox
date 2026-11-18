# 003 — Phase Progress & Immutable Change Log

**Frozen baseline:** `e28886e5e0f7a155cd64e23bc8ee8f6668d6699c` · **Log initialized:** 2026-11-17 · **R-01 through R-06 IMPLEMENTATION VERIFIED (CI); 6/6 implementation scopes done, final live acceptance BLOCKED.**

## Scoreboard

| Metric | Actual value |
|---|---|
| Total ordered phases | **6** |
| Completed / verified | **6/6 (CI implementation only)** |
| In progress | **0 implementation phases; live acceptance not authorized** |
| Remaining | **0/6 implementation phases; external acceptance gates OPEN** |
| Blocked | **R-06 live staging/release acceptance NOT RUN; production NO-GO** |
| Original forensic findings | **32** |
| Findings verified closed | **25 (CI contract; not live VPS)** |
| Findings OPEN | **7** |
| Next implementation phase | **None (exactly 6/6 implemented); separate staging approval and scope exceptions needed** |
| Final release | **NO-GO** |

## Ordered phase ledger — no results invented

| Phase | Findings | Next feature/bugfix scope | State | CI evidence URL | Source SHA | Mirror SHA |
|---|---:|---|---|---|---|---|
| R-01 | 7 | Production/dev Compose selection; standalone/Coolify secrets; URL-safe DB auth; reproducible image/deps and advisory audit; accurate quick-start documentation. | VERIFIED CLOSED (CI) | https://github.com/JILLU-Games/ReadBox/actions/runs/44093204590 | `113663cdabacf1460af5b06a334d99ab3db833c2` | mirror verification pending |
| R-02 | 4 | Single-DB virtual SQL routing with least privilege, migration parity, Maildir owner/UID/GID/ACL consistency. | VERIFIED CLOSED (CI; RB-P2-04 exception) | https://github.com/JILLU-Games/ReadBox/actions/runs/44102834169 | `b6ab76119a31f9bf4e81b3990a5fcc6d802a6892` | final ref equality to be verified on mirror |
| R-03 | 6 | Supported Postfix/Dovecot installation/integration, port and socket contract, documented DNS/TLS/DKIM boundaries; inbound-only vs other capabilities explicit. | CI IMPLEMENTATION VERIFIED CLOSED; public TLS/port gates OPEN | https://github.com/JILLU-Games/ReadBox/actions/runs/44107205810 | `d0f3272ea298de012da83c6f01b588fa0513d1da` | final mirror SHA to confirm |
| R-04 | 6 | First admin setup, consistent user/admin source, worker heartbeat and readiness gates, actionable errors for outages and recovery. | CI VERIFIED CLOSED | https://github.com/JILLU-Games/ReadBox/actions/runs/44112634511 | `88e57e2e81dc07a8f91b07f448df85e51d58e429` | final mirror SHA verification pending |
| R-05 | 6 | Container-aware and host-aware backup/restore, secret protection, downtime consistency, UID/ACL restore, updater repo correctness and rollback. | CI IMPLEMENTATION VERIFIED CLOSED; 2 owned findings OPEN | https://github.com/JILLU-Games/ReadBox/actions/runs/44121121316 | `a55ec82bb2f58804e910427c66ff6352cd5c14c6` | final mirror SHA pending |
| R-06 | 3 | Final GitHub CI and separately approved staging VPS evidence: real inbound mail, DNS/TLS, runtime integration, negative tests, backup/restore, licensing and formal GO/NO-GO. | CI IMPLEMENTATION VERIFIED; live acceptance BLOCKED, 3 owned findings OPEN | https://github.com/JILLU-Games/ReadBox/actions/runs/44127481624 | `807ca9f38adb02db2a8b73dc0901fce23ee5e63a` | final mirror SHA pending |

## Scope Lock enforcement on every phase

- Record original baseline/current HEAD and compare **all changed paths** with `002` allowlist; deny unrelated changes even if convenient.
- Keep **existing UI/UX, layout, pages, auth rules, business feature behavior, mail data, user accounts and previous migrations** unchanged outside approved findings.
- For shared files, list changed line/range and reason; avoid wide refactors.
- One focused CI run per phase on its actual candidate SHA; do not reuse a prior run or claim future validations passed.
- On an approved phase close: update this log, error handling inventory `004`, actual working features `005` and release gates `006`. Record exact tested/pushed SHA and matching mirror SHA.
- A blocked or failed phase stays OPEN, with blockers; do not automatically start the next.

## Append-only phase completion template

Copy this after a **separately authorized** R-XX implementation; never fill it before testing:

```markdown
### R-XX — [Title] — [YYYY-MM-DD HH:mm Asia/Dhaka]
- State: NOT STARTED / IN PROGRESS / BLOCKED / VERIFIED CLOSED
- Start baseline and current parent SHA:
- Finding IDs closed/remaining:
- Exact allowed paths and changed file list:
- Changed behavior (verified; not anticipated):
- Existing UI/UX/auth/features preserved (test/proof):
- Negative/error handling checks (004 IDs):
- Actual working feature delta (005 IDs):
- One focused CI run URL/job/tested SHA and pass/fail:
- Production/live evidence vs only CI:
- Data/migration compatibility and rollback evidence:
- Source commit/push SHA:
- Target fast-forward and identical tree SHA:
- Completed: N/6; remaining: 6-N; next phase:
- Release verdict and open blockers:
```

## Date-stamped record

**2026-11-17 — Planning/docs only:** the source/target baseline was reconciled, all 32 existing forensic issues assigned to exactly six phases, and this initial progress ledger created. **No bugfix, app behavior change, runtime test, live installation, commit for an implementation phase, or release GO has occurred.**

### R-01 — Deployment foundation — 2026-11-17

- **State:** VERIFIED CLOSED (CI); **completed:** 1/6; **remaining:** 5; **next:** R-02.
- **Code SHA:** `113663cdabacf1460af5b06a334d99ab3db833c2`. **Findings:** RB-P0-01, RB-P1-01, RB-P1-02, RB-P1-14, RB-P1-15, RB-P2-03, RB-P2-09.
- **Implemented:** production Compose made default by renaming dev file; safe DB password URL encoding including `%`, `@`, `#`; auth/database secret length guards; single lockfile Docker runtime and immutable Node base digest; Next.js 16.4.5, fast-uri 3.1.9; correct README and user-requested AGENTS.md workflow policy.
- **Proof:** https://github.com/JILLU-Games/ReadBox/actions/runs/44093204590 (focused corrected Docker/runtime, current production npm audit) and https://github.com/JILLU-Games/ReadBox/actions/runs/44092311120 (full original app regression pass). Last correction altered only Dockerfile encoding, its targeted contract test, temporary CI workflow.
- **Preserved:** all `src/`, application UI/UX/layout, user/business logic, existing migrations, Postfix/Dovecot files and data. **Live VPS and SMTP:** NOT RUN; production NO-GO.
- **Mirror:** final SHA equality verified separately after the documentation commit; no release/tag deployed.

### R-02 — Single PostgreSQL / Maildir identity — 2026-11-17

- **Status:** Implemented and focused CI PASS; formal phase closure BLOCKED by `RB-P2-04` because `src/core/health/snapshot.ts` is not R-02 allowlisted. Completed/closed phases remain **1/6**; **5 remain** including R-02.
- **Code commit:** `e1efdbd0b0380a94152947f7be47eb17c5c8d70c`. **Verified CI:** https://github.com/JILLU-Games/ReadBox/actions/runs/44099280332. Seven migrations applied twice (second no-op), virtual domain/mailbox/alias responses, invalid/disabled negatives, insufficient privilege negatives, unit/schema and Maildir POSIX checks.
- **Fixed/verified contract:** `RB-P0-03`, `RB-P0-04` and `RB-P1-08` at isolated CI level. Migration parity helper also verified, but the production readiness endpoint still does NOT enforce missing expected migrations (`RB-P2-04 OPEN`).
- **Unchanged:** existing `src/app/`, `src/components/`, auth, UI/UX, original Prisma migrations, mailbox data and unrelated app code. No VPS or external Postfix/Dovecot test.
- **Next decision:** authorize precise health-readiness scope exception or explicitly reassign `RB-P2-04` to R-04 before satisfying R-03 prerequisite. **Overall production NO-GO.**

### R-02 final closure — explicit readiness exception — 2026-11-17

- **Final status:** VERIFIED CLOSED (CI); **completed 2/6, remaining 4**; next phase **R-03** only after separate authorization.
- **Last code SHA:** `b6ab76119a31f9bf4e81b3990a5fcc6d802a6892`. **Focused CI:** https://github.com/JILLU-Games/ReadBox/actions/runs/44102834169. Existing R-02 SQL/database CI: https://github.com/JILLU-Games/ReadBox/actions/runs/44099280332.
- **New actual fix:** `src/core/health/snapshot.ts` now validates complete expected Prisma migration history using the existing R-02 helper; pinned seven existing migrations and auto-discovers later checked-in migrations. Missing, unfinished or query-error history returns `not_ready`.
- **Changes permitted by explicit user exception:** only health snapshot plus `tests/admin/phase6-settings-update-health.test.ts` and new `tests/admin/r02-readiness-parity.test.ts`; no UI, auth, app routes, other backend behavior or migration edits. Focused branch audit PASS.
- **Progress:** R-01 7 and R-02 4 findings CI verified = **11/32**; **21** other audit findings OPEN. Live VPS, SMTP/LMTP, DNS/TLS, backup/restore and release not tested. **Production NO-GO**.
- **Final exact mirror:** verify source and target `main` ref/tree SHAs after committing this note; CI run alone is not mirror proof.

### R-03 — Inbound Postfix SMTP → Dovecot LMTP → Maildir — 2026-11-17

- **State:** CI implementation VERIFIED CLOSED. **Completed phases:** 3/6; **remaining:** 3; **next:** R-04 only after separate approval. **Production release:** NO-GO.
- **Tested code commit:** `d0f3272ea298de012da83c6f01b588fa0513d1da`; **one completed focused CI:** https://github.com/JILLU-Games/ReadBox/actions/runs/44107205810. Previous run failed only new static test regex escaping and was corrected without app feature changes.
- **Proven in disposable CI:** fresh PostgreSQL+web/worker runtime, restricted SQL role provision, opt-in Postfix/Dovecot build/start, Postfix/Dovecot lint, SMTP STARTTLS, nonlocal relay reject, invalid local recipient reject, correct delivery to a Maildir file on UID/GID 1001, missing TLS material startup rejection, persisted Postfix queue and exact 13-branch-path audit.
- **R-03 findings:** `RB-P0-02`, `RB-P0-05`, `RB-P2-05`, `RB-P2-06` CI verified; `RB-P1-09`, `RB-P1-10` still OPEN for trusted public TLS, DNS/MX/PTR/port 25/provider/firewall/IPv6 real VPS validation in R-06. **Overall 15/32 CI verified; 17 OPEN.**
- **No out-of-scope changes:** no `src/**`, UI/UX/routes, auth/business logic, database schema/migration, mail data or public DNS mutations. No live VPS or production release. Temporary CI workflow excluded from published source main.
- **Mirror:** final exact source/target SHA and tree equality recorded by git ref verification after docs commit.

### R-04 — First admin/operator parity and fail-closed app/worker readiness — 2026-11-17

- **Status:** CI VERIFIED CLOSED. **Completed:** 4/6; **remaining:** 2 (R-05, R-06); **next:** R-05 only after user approval. **Production release:** NO-GO.
- **Tested code SHA:** `88e57e2e81dc07a8f91b07f448df85e51d58e429`. **Successful focused CI:** https://github.com/JILLU-Games/ReadBox/actions/runs/44112634511. Previous necessary retries addressed CI-only mock UI environment and a 1-ms future heartbeat fixture; the final CI reran successfully without any UI feature edits.
- **Implemented:** manual production-only one-time `admin_accounts` bootstrap with random unusable password and forced reset-token activation; duplicate/admin identity rejection; setup inspector counts the same active superuser source; initially failed ingestion records a degraded heartbeat before exit; app snapshot requires production heartbeat even when env toggles false; unavailable DB, missing/symlink storage, stale/degraded/unknown/future heartbeat fail closed; worker Docker healthcheck validates full application readiness; web liveness separated to avoid deadlock; mailTransport remains explicitly unverified.
- **Proof:** all schema/type/backend tests, UI **70/70**, Next build and real isolated PostgreSQL bootstrap-once/duplicate/inspection and 11-branch-path audit PASS. No production interactive operator CLI, actual SMTP/LMTP outage recovery, VPS or release executed.
- **Scope unchanged:** no login UI/layout/colors, auth credential policy, app routing, unrelated feature, Prisma migrations/schema, Postfix/Dovecot templates or user mail data modification. Temporary CI workflow excluded from published code.
- **Original findings:** R-04's six CI-closed => 21/32 CI verified; 11 other findings remain OPEN, including R-03 external TLS/DNS/VPS gates. Mirror target fast-forward exact final SHA/tree verification after notes commit.

### R-05 — encrypted Compose PostgreSQL/Maildir snapshot, restore, and automatic rollback — 2026-11-17

- **State:** CI IMPLEMENTATION VERIFIED CLOSED; **5/6 phases completed**, **1 remaining (R-06)**. **Production release:** NO-GO. **Code commit:** `a55ec82bb2f58804e910427c66ff6352cd5c14c6`; **focused CI:** https://github.com/JILLU-Games/ReadBox/actions/runs/44121121316.
- **Tested against disposable Compose containers:** PostgreSQL 16 (both `public` and `mailserver` schemas), web/worker and Postfix/Dovecot stand-ins sharing named Maildir/attachments/media/queue volumes. Age public-key encrypted artifact mode 0600, no plaintext config, snapshot manifest SHA-256, restoration of DB+Maildir+attachment+media+Postfix queued file and numeric UID/GID 1001 plus real POSIX ACL. Post-database-apply failure injection triggered **R05_PROVEN_POST_DATABASE_APPLY_AUTOMATIC_ROLLBACK_PASS** and confirmed DB+Maildir prestate; ciphertext tampering refused before mutation. Previously running services restarted; SMTP downtime during backup explicitly disclosed.
- **Existing regressions:** Prisma validation, TypeScript, backend/unit contracts, UI **70/70**, Next.js build, Bash/Python syntax, static operations tests PASS. Exact 14-path branch Scope Lock audit PASS; 13 published paths within R-05 allowlist, temporary CI workflow excluded.
- **CLI and user-facing UI:** no route, UI, auth, schema, Maildir data or Postfix/Dovecot runtime change; production update repo canonicalized while explicit dev test overrides preserved. Host/systemd rollback/upgrade logic was syntax/static verified only, not run on VPS.
- **Findings:** CI-verified `RB-P1-11`, `RB-P1-12`, `RB-P1-13`, `RB-P2-02`; **OPEN** `RB-P2-01` (legacy Nginx and template filenames outside scope), `RB-P2-07` (real offsite retention/rotation/key custody and live VPS/host restore). Project **25/32 verified, 7 OPEN**; public DNS/TLS/SMTP and real release still NO-GO.

### R-06 — Final consolidated read-only CI / production GO-NO-GO — 2026-11-17

- **State:** All **6/6 implementation scopes** are CI verified; R-06 mandatory **live staging acceptance remains BLOCKED/NOT RUN** pending independent user approval. **Original findings:** 25/32 CI verified, **7 OPEN** including R-06-owned `RB-P0-06`, `RB-P1-16`, `RB-P2-08`; **17/17 live staging release gate checks not accepted**, formal **NO-GO**.
- **Tested source SHA:** `807ca9f38adb02db2a8b73dc0901fce23ee5e63a`; **successful focused CI:** https://github.com/JILLU-Games/ReadBox/actions/runs/44127481624. Clean npm install, Prisma validate, full backend/70 UI regression, Next build, production npm audit, guarded ephemeral PostgreSQL 16 auth/migrations, disposable production web/worker/Postfix/Dovecot startup, loopback STARTTLS→LMTP→Maildir and reject tests, age encrypted backup/restored UID/ACL and post-DB-apply forced rollback, strict provenance/17-gate negatives and 11-path Scope Lock audit PASS. One bounded SMTP greet startup readiness wrapper was added in R-06 allowed scripts; R-03 mailserver source unmodified.
- **Lint debt:** exactly two pre-existing R-04 unused `catch (err)` violations at `src/core/setup/trusted-operations.ts:366,386`; source excluded **only** from final R-06 lint invocation and validated by strict baseline, no app source edit. **Full-tree lint is not clean.** A prior CI test attempt failed on newly added JS globals; new R-06 code fixed. Another attempt showed a disposable SMTP greeting startup race; bounded startup probe fixed without modifying R-03.
- **Documentation:** release governance, staged acceptance runbook, MIT-vs-AGPL provenance inventory, README/Security warnings, R-06 release gate/negative scripts. Workflow is **read-only with no deploy/tag/release**, and produced expected `R06_PRODUCTION_NO_GO`, `R06_FINDINGS_OPEN=7`, `R06_LIVE_GATE_PASS_CLAIMS=0/17` markers.
- **Preserved:** src UI/UX/auth, migrations, mailserver/SMTP engine, historic LICENSE/NOTICE, actual Maildir/DB data, public DNS/VPS untouched. **No production GO.** Next action is separate explicit authorization for staging acceptance, not an automatic seventh phase.

## QIS-01 — Auto Quick Installer & Browser-first Admin (2026-11-17)

- **Status:** CI IMPLEMENTATION VERIFIED, **not a seventh R-phase**, no live VPS install or production release. **Tested source SHA:** `2833f1f1e1be76d501cdd3fa2210d0c1084d9b47`; **focused disposable GitHub CI:** https://github.com/JILLU-Games/ReadBox/actions/runs/44139227363; **Scope Lock:** exact 16 allowed source/config/tests/docs paths. Repo original 6/6 implementation phases and their 32 findings remain unchanged.
- **Actually tested:** fresh private `.env` mode 0600 with independent strong PostgreSQL, auth and Postfix credentials; 256-bit owner code printed only to a private disposable operator output, verified 43 characters with only SHA-256 hash and one-hour expiry persisted. Repeat installer preserved secrets **byte-for-byte**. Real disposable Compose PostgreSQL 16, web and worker booted, Prisma migrations initialized and private Postfix SQL lookup role configured without starting the public SMTP/mailserver profile.
- **Actual disposable PostgreSQL:** two concurrent browser-helper admin bootstrap requests created **exactly one active privileged `AdminAccount`**, not a legacy `User` identity; wrong/expired code and unsafe origins denied. Existing 15-minute admin reset token hashed in DB, password activation completed once, replay rejected, no second privileged account. New browser form UI test passed, existing auth, UI and Next build remained green.
- **Update behavior:** `scripts/install/readbox-update.sh` adds approved-remote/fast-forward and encrypted-backup preflight plus no-destructive-migration-rollback policy. The update script was **syntax/source-contract tested only**; no live upgrades, external/offsite backups or real migration rollback were executed.
- **Existing source preserved:** `scripts/auth/operator.ts`, `src/core/auth/**`, Prisma schema/migrations, Postfix/Dovecot runtime, existing UI/UX/navigation, customer Maildir/DB data. The only existing Compose change is passing hashed setup token/expiry into the web container; no public SMTP, HTTPS, DNS or reverse-proxy provisioning.
- **Existing release position unchanged:** original **25/32 findings CI-verified, 7 OPEN**, R-04 historical two lint errors still recorded; `R06_PRODUCTION_NO_GO` verified in QIS CI. **No VPS access, Git tag/release or deployment performed.**

### R-06/QIS-01 CI compatibility reconciliation — 2026-11-18 (Asia/Dhaka)

- **State:** Focused source GitHub Actions CI VERIFIED; original **6/6 implementation phases** unchanged, QIS-01 remains a separately approved additive patch, **25/32 original findings CI verified, seven OPEN, 0/17 independent live staging gates PASS, production NO-GO**.
- **Starting main SHA:** `4467636a1300fd45b85b35cf556fdb106faa0ec9`. Earlier main CI https://github.com/JILLU-Games/ReadBox/actions/runs/44140465798 failed *only* the R-06 Scope Lock step: it compared the historical R-05 baseline with a moving HEAD and misclassified already-approved QIS-01 paths. Its prior app, PostgreSQL, Docker SMTP/LMTP and recovery stages passed.
- **Only executable patch:** `.github/workflows/r06-production-readiness.yml`; source test commit `c27b30f587f37bc590a483e0bea263f2ac08d0e7`. The workflow now verifies the fixed historical R-06 implementation (11 paths) and R-06 notes closure (8 paths) independently of the approved QIS-01 implementation (16 paths) and QIS-01 notes closure (3 paths). Exact path sets, immutable commit ancestry and `git diff --check` all remain enforced; the mutable cross-phase diff is removed, **not** the scope guards.
- **One focused successful source CI:** https://github.com/JILLU-Games/ReadBox/actions/runs/44147873597 on the test SHA above. Existing app/UI/auth/build, dependency audit, guarded PostgreSQL, loopback SMTP→LMTP→Maildir, encrypted backup/restore/rollback, four immutable path audits and release NO-GO gate all PASS. Exact markers: `R06_QIS01_IMMUTABLE_SCOPE_AUDITS_PASS`, `R06_ALL_CI_CONTRACTS_PASS_PRODUCTION_NO_GO`, `R06_FINDINGS_OPEN=7`, `R06_LIVE_GATE_PASS_CLAIMS=0/17`.
- **Scope preservation:** The tested code patch changed only the R-06 workflow. This dated closeout updates only notes/003 and notes/006. No UI/UX/auth/Prisma/database/mailserver/installer/updater, historical audit, user data, release/tag, DNS, VPS or public SMTP mutation. Two historical R-04 full-tree ESLint violations remain explicitly tracked and unchanged.
- **Sync requirement:** fast-forward source and mirror to the identical closeout commit SHA; verify both refs and the exact 3-file aggregate patch independently before claiming synchronization. CI evidence is on the executable patch parent; documentation-only closeout does not replace a live staging test.

## DKIM-01 — Secure Automatic DKIM DNS Provisioning (2026-11-18)

- **Separate approved feature Scope Lock** after the AU-02 frozen source/mirror/local baseline `ea14efa5b5571b0ed1e00e211e07a7862f2b6a0f`; this does not reopen the original R01–R06 historical scopes.
- Isolated RSA-2048 public DNS provisioner with private-only named volume, public read-only Web mount, authenticated Unix HMAC bridge, admin-only domain provisioning endpoint, optional Cloudflare zone-scoped DKIM TXT writer, manual fallback, and independent status display; signer remains inactive because mailserver is inbound-only.
- Exactly **13 approved implementation paths** changed. Source branch tip `016b28764351874261ed50aed34bff4faa111241` and mirror PR candidate `8c4fa678fdb6fa5bbb68ed91676dc3f22b4bf852` have identical tree `3f6dc44bc96a0fa595fba0362012e5214a7b53fe`.
- Corrected focused disposable [R06 run #44273197408](https://github.com/JILLU-Games/ReadBox/actions/runs/44273197408) **SUCCESS**: app/UI/build, dependency security, ephemeral PostgreSQL, existing default Docker/SMTP/LMTP, encrypted recovery/rollback and immutable NO-GO gates. Independent local DKIM Node negative tests **6/6 PASS**.
- Initial CI found and scoped corrections to legacy UI payload, extensionless test imports and opt-in Docker profile. Default Compose service topology is unchanged. DKIM agent Dockerfile includes disposable Python tests on profile-specific image build; the default R06 workflow does **not** exercise that optional image.
- **Live DKIM key generation, Cloudflare DNS, private-key escrow and VPS rollout all NOT RUN.** No user keys, mail database or volumes were mutated. Source-only success is not stable release approval; `v1.0.0` remains NO-GO.

## DKIM-02/FIX-01 — OpenSSL RSA header compatibility (2026-11-18)

- **Frozen main baseline:** `69b7f4c91100dd30c83ab56b24c29a4a0a9384b1`; existing production host was previously updated to this SHA by the approved guarded Admin Panel rollout; DKIM profile and live domain keys remained unactivated.
- Production-VPS **disposable image-build rehearsal** at baseline first revealed `INVALID_PRIVATE_KEY` in two of four embedded Python tests. OpenSSL 3.x emits `Private-Key: (2048 bit, 2 primes)` while the original parser accepted only `Private-Key: (2048 bit)`.
- **Exact approved fix:** `deployment/dkim/agent.py` modifies only the RSA key-size header regex; `deployment/dkim/test_agent.py` adds legacy/v3 header, weak-key (1024-bit), and malformed-header regressions. RSA minimum 2048 bits, no-replace keys, idempotency and conflicts remain unchanged.
- Source-only tested candidate `06c1460781b079794aa12c133a0171f601c33e99`, mirror candidate `5820255216293a7ad54b2ffe6e43c7dda8d62e37`, identical Git tree `c973d0db780939a5049d2366540b81e5f589738d`.
- [Read-only R06 run #44280725129](https://github.com/JILLU-Games/ReadBox/actions/runs/44280725129) **SUCCESS** at exact mirror candidate; app/UI, security advisories, PostgreSQL, default Docker SMTP/LMTP, recovery and release NO-GO gates passed.
- **Independent build-only proof:** operator cloned the exact candidate SHA/tree to a temporary `/tmp/readbox-dkim-fix01.*` checkout and ran `docker build --no-cache` for the opt-in provisioner image. Alpine OpenSSL `3.5.9-r0`, Python **6/6 tests PASS**, `DKIM02_FIX01_DISPOSABLE_BUILD_PASS`. The build's temporary Docker tag/source checkout were scheduled for trap cleanup. This was **not** an app deployment, production DKIM key generation or DNS operation.
- Closure documentation changes exactly `notes/003–007` after PASS. Final source/mirror/local `main` SHA/tree require exact non-force parity confirmation. No tag or release.

## DKIM-02/FIX-02 — Non-root agent script permission (2026-11-18)

- **Frozen source/mirror/local `main` baseline:** `ebb2e2bddd0ef26671b283a4f71bc4d35bb32dbd`. Under controlled DKIM-02 rollout, the operator stopped only the unhealthy DKIM provisioner container (`docker update --restart=no`; `docker stop`); no production domain key or Cloudflare DNS write occurred.
- **Observed runtime failure:** `readbox-dkim-provisioner-1` reported `restarting/unhealthy`, exit code `2`, and `python3: can't open file '/usr/local/bin/dkim-agent.py': [Errno 13] Permission denied`. Build-time root-run Python tests did not exercise non-root read access.
- **Exact approved Dockerfile-only code patch:** after `COPY`, set `/usr/local/bin/dkim-agent.py` to `0644` and run a build-time `USER 1001:1001` read/compile smoke check. Agent.py, Docker Compose, permissions of domain volumes, app, mailserver and backup logic are unchanged.
- **Source candidate:** `51276afba843a5e94377c2e794ec05ed677b4a9d`; **mirror candidate:** `3c25d0c308f5028c2eb4b8b93e0f563019618a8a`; **identical code tree:** `d34e6b539e7ba3aae3a2f03f8046a5f2821dcfcf`.
- **One focused disposable build-only test** on the VPS host using a temporary checkout verified exact source candidate SHA, `docker build --no-cache --progress=plain`, OpenSSL `3.5.9-r0`, **6/6 embedded Python tests PASS**, and the image-stage non-root read/compile command **PASS**. Output ended `DKIM02_FIX02_NONROOT_BUILD_PASS`; temporary checkout and test image cleanup were registered via shell EXIT trap.
- **Documentation closure:** notes `003–007` only, following successful focused test and one-file exact patch audit. Final non-force source/mirror/local main SHA/tree parity must be confirmed after publication. No Admin Panel update, DKIM activation, live key generation, Cloudflare DNS change, tag or release in FIX-02.


## DKIM-03 — Age/R2 private-key escrow and fail-closed provision gate (2026-11-18)

- **Frozen source/mirror/local main:** `d2faedcebd302f488c515daba57441f59ff3a687`; source implementation candidate `cca9543253f0f97292d824c56a90c35be10b6aae`, tested repair candidate `c6ee9fd183553cce6e0c6836b66ddbf209ca214d`. Mirror tested candidate `bac871825fee87dda6a3bf74915832bee6ca4c5a`; exact tested source/mirror Git tree `4cccc52ea7d92bdaf4a06b27fc15a8039aae8036`.
- Scope: only `deployment/dkim/{agent.py,escrow.py,test_agent.py,test_escrow.py}`, `scripts/testing/dkim03-escrow-rehearsal.sh`, `.github/workflows/dkim03-ci.yml`, `docs/DKIM-ESCROW.md`, and documentation-only `notes/003–007`. Existing R05/BR04/backup/R2 implementation, Docker Compose, app/UI/auth/Prisma and mailserver untouched.
- Offline provisioner now stages private keys but refuses public `mail.txt` while no valid root-issued per-domain `escrow.json` receipt exists. Existing private keys/public conflicts remain protected. Admin UI may report a sanitized unavailable status at the first staging request; a later authorized host escrow action must run before retry.
- Root-only host escrow helper uses existing age recipient/identity plus existing protected R2 adapter credentials; conditional-creates immutable domain-specific `readbox/dkim-escrow/v1/` objects. It decrypt-checks local ciphertext, checks complete remote readback and RSA fingerprints, safely resumes lost ACK/crash before receipt; no arbitrary key overwrite, object DELETE or production restore.
- Initial focused [CI #44293943849](https://github.com/JILLU-Games/ReadBox/actions/runs/44293943849) **FAILED** on receipt writer Python SyntaxError; a single scoped repair fixed nested `try` and added explicit readable receipt mode under restrictive host umask. **One necessary focused recheck** [CI #44294483799](https://github.com/JILLU-Games/ReadBox/actions/runs/44294483799) **SUCCESS**: 11 real-age/mock-R2 escrow cases, 8 Docker-embedded agent cases, non-root build smoke and exact Scope Lock PASS.
- **Not performed:** VPS update, live DKIM key generation, actual Cloudflare R2 object write, DNS publishing, host-loss production recovery, production restore, tag or release. Independent offsite custody/recovery of age identity and R2 credentials remains required before real key provisioning; formal stable release stays NO-GO.
