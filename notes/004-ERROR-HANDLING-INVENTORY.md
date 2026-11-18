# 004 — Error Handling Inventory (Present, Missing, Future Test)

**Code evidence baseline:** `e28886e5e0f7a155cd64e23bc8ee8f6668d6699c`. **Historical starting status was OPEN; R-01–R-06 CI implementation is now verified, but R-06 live acceptance is NOT RUN and production recovery gates remain OPEN.** Static source presence does not prove error handling survives a live VPS outage. Every future test belongs to the six phase Scope Locks in `002`; UI/layout changes are forbidden outside explicit approval.

## A. Existing error handling actually implemented in source

| Error ID | Existing behavior | Exact code path / line(s) | Evidence classification |
|---|---|---|---|
| EH-E01 | Production PostgreSQL missing/malformed connection fails closed instead of using dev mock | `src/core/database/client.ts:66–113` | CODE PRESENT; live unverified |
| EH-E02 | Mailbox concurrent provisioning lock reports `ELOCKED` and safe filesystem errors | `src/core/mailboxes/provisioning.ts:31–101` | CODE PRESENT; live unverified |
| EH-E03 | Unsafe/symlink Maildir paths refused; partial directory creation rolled back | `src/core/mailboxes/provisioning.ts:106–184`, `src/core/mailboxes/paths.ts:37–124` | CODE PRESENT |
| EH-E04 | Mailbox SQL/DB creation catch and remote/maildir cleanup attempts | `src/core/mailboxes/service.ts:447–665` | CODE PRESENT; partial rollback is not transactional proof |
| EH-E05 | Domain create failure cleanup and structured error response | `src/core/domains/service.ts:183–310` | CODE PRESENT |
| EH-E06 | DNS resolution timeout/unavailable reported without false DNS success | `src/core/dns/resolver.ts:62–116,150–225` | CODE PRESENT |
| EH-E07 | Missing/unsafe source files and Maildir path confinement | `src/core/ingestion/service.ts:123–310` | CODE PRESENT |
| EH-E08 | Worker degraded/lock-busy conditions and heartbeat | `src/workers/ingestion.ts:151–208`, `scripts/mail/ingest.ts` | CODE PRESENT; health policy gap remains |
| EH-E09 | DB/storage readiness returns structured state and HTTP 503 when not-ready | `src/core/health/snapshot.ts:25–180`; `src/app/health/ready/route.ts:8–15` | CODE PRESENT; SMTP gate absent |
| EH-E10 | Database migration retry and nonzero abort | `entrypoint.sh:19–41` | CODE PRESENT; no live migration evidence |
| EH-E11 | Initial operator/bootstrap guarded and reset tokens persisted/validated | `scripts/auth/operator.ts:39–140`; `src/core/auth/password-reset.ts:108–209` | CODE PRESENT; first-admin setup gap remains |
| EH-E12 | Host backup/restore checksum, archive/path preflight | `scripts/ops/restore.sh:1–44`; `scripts/ops/backup.sh:124–175` | CODE PRESENT; Compose restore unverified |
| EH-E13 | Container in-app updater returns blocked/orchestrator-managed state | `src/core/updates/service.ts:433–481` | CODE PRESENT; expected limitation |

### Verbatim proof from frozen code

**`src/core/database/client.ts:79–87`**
```ts
if (!runtimeEnv.databaseUrl) {
  if (isProduction) {
    logger.error("database_configuration_missing_in_production");
    throw new DatabaseConfigurationError(
      "DATABASE_URL must be configured when running in production.",
    );
  }
```

**`src/core/mailboxes/provisioning.ts:81–90`**
```ts
} catch (error) {
  const code = (error as { code?: string })?.code;
  if (code === "ELOCKED") {
    throw new ProvisioningError(
      "lock",
      "Mailbox provisioning is already in progress for this address; try again.",
    );
  }
```

**`src/app/health/ready/route.ts:8–15`**
```ts
export async function GET() {
  const snapshot = await getReadinessSnapshot();
  logger.info("health_ready", { status: snapshot.status });
  return NextResponse.json(snapshot, {
    status: snapshot.status === "ready" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
```

## B. Missing/uncertain production error contracts — future requirements

| Error ID | Owner | Failure/negative case not validated or not handled completely | Required production response | Source audit IDs | State |
|---|---|---|---|---|---|
| EH-M01 | R-01 | Dev Compose selected / demo password accidentally used | explicit prod selection and fail startup | RB-P0-01, RB-P1-01 | CI VERIFIED; live unverified |
| EH-M02 | R-01 | Missing/short secret and DB URL reserved-character corruption | clear, redacted refusal; valid URL encoding | RB-P1-01, RB-P2-03 | CI VERIFIED; live unverified |
| EH-M03 | R-01 | Reproducible production install fails/advisories unresolved | abort release; capture npm audit and lockfile evidence | RB-P1-14, RB-P1-15 | CI VERIFIED; live unverified |
| EH-M04 | R-02 | SQL role no-login, DB endpoint not reachable, permission denied | safe lookup rejection; one DB only; no leakage | RB-P0-03, RB-P1-08 | CI VERIFIED contract; external Postfix/VPS unverified |
| EH-M05 | R-02 | Maildir access denied due to differing UID/GID/ACL | no silent accepted-but-lost mail; no broad chmod | RB-P0-04 | CI VERIFIED identity; external Dovecot unverified |
| EH-M06 | R-02 | Missing/partial/out-of-order applied migrations | not-ready/abort, no destructive fallback | RB-P2-04 | CI VERIFIED CLOSED; live VPS unverified |
| EH-M07 | R-03 | SMTP daemon or LMTP socket missing/down | observable failed/queued/deferred delivery, mail preserved | RB-P0-02, RB-P0-05 | CI POSITIVE SMTP/LMTP PASS; LMTP-outage recovery still UNVERIFIED |
| EH-M08 | R-03 | Invalid/disabled recipient, bad alias, oversized MIME | proper SMTP reject/policy behavior, no silent loss | RB-P0-06 | CI unknown recipient and nonlocal relay REJECT PASS; alias/oversize not verified |
| EH-M09 | R-03 | Incorrect MX/port 25/TLS/certificate/DKIM | truthful distinct failure vs advisory status | RB-P1-09, RB-P1-10 | CI STARTTLS/missing-cert PASS; public MX/PTR/trusted TLS still OPEN |
| EH-M10 | R-04 | Duplicate bootstrap, missing operator, wrong admin table | secure one-time flow and consistent success verification | RB-P1-03, RB-P1-04 | CI VERIFIED; interactive VPS CLI not exercised |
| EH-M11 | R-04 | Worker absent/stale/stuck, Maildir unreadable | not-ready with bounded recovery and no duplicates | RB-P1-05, RB-P1-06, RB-P1-07, RB-P2-10 | CI VERIFIED health-negative/recovery; live outage untested |
| EH-M12 | R-05 | Partial backup, disk full, outage, unsafe restore ownership | fail and preserve prior state; checksum/ACL/data proof | RB-P1-11, RB-P1-12, RB-P1-13 | CI VERIFIED Compose data/ACL/rollback and explicit downtime; host/VPS untested |
| EH-M13 | R-05 | Secrets leaked into archive, updater crash or rollback failure | protect config and stop safely; observable result | RB-P2-02, RB-P2-07 | CI encrypted/no-plaintext and rollback tests pass; offsite retention/key custody OPEN |
| EH-M14 | R-06 | Real SMTP accepted but message never appears in web inbox | production NO-GO; capture mail queue, LMTP, Maildir and worker trace | RB-P0-06, RB-P1-16 | OPEN |
| EH-M15 | R-06 | VPS restarts/storage outage/DB fail/restore are untested | NO-GO until negative and recovery evidence exists | RB-P1-16 | OPEN |

### One focused test record per error case

```text
EH-ID:
Owner phase:
Exact input / failure injection:
Expected safe behavior:
Observed response / exit / sanitized log:
Impact on messages, attachments and DB:
Recovery/rollback:
CI job & tested SHA:
PASS / FAIL / SKIPPED / NOT RUN:
```

**Current state:** Existing handlers are code-level facts; all EH-M entries remain OPEN. No error-handling functionality or UI was implemented during this planning-only task.

## Error-handling closure tracker

| Phase | Existing handlers re-tested | New negative tests verified | Evidence URL / SHA | Status |
|---|---|---|---|---|
| R-01 | Startup/lockfile guards | Short credentials, reserved-character password, missing secrets, audit | https://github.com/JILLU-Games/ReadBox/actions/runs/44093204590 | CI VERIFIED |
| R-02 | PG lookup, Maildir identity and complete health migration parity | invalid/disabled mailbox, UID mismatch, missing/unfinished/failed migration ledger, broken bundle and query errors | https://github.com/JILLU-Games/ReadBox/actions/runs/44102834169 | VERIFIED CLOSED (CI) |
| R-03 | Postfix SMTP and private Dovecot LMTP | unknown RCPT/relay reject, STARTTLS, Maildir delivery, missing TLS | https://github.com/JILLU-Games/ReadBox/actions/runs/44107205810 | CI IMPLEMENTATION VERIFIED; external release gates OPEN |
| R-04 | First admin/operator identity + worker/readiness | reject duplicate, unsafe CLI, stale/future/missing worker, broken DB/storage; recovery | https://github.com/JILLU-Games/ReadBox/actions/runs/44112634511 | CI VERIFIED CLOSED; live VPS unverified |
| R-05 | Disposable encrypted PostgreSQL/Maildir/queue recovery and updater contract | post-DB apply rollback, tamper/ACL/UID checks, no plaintext env; runtime downtime explicit | https://github.com/JILLU-Games/ReadBox/actions/runs/44121121316 | CI IMPLEMENTATION VERIFIED; external offsite/host safety OPEN |
| R-06 | Consolidated isolated Docker/PostgreSQL/SMTP/LMTP/backup and 17-gate release reviewer | 32 finding states, 17 missing staging gates, forged all-PASS/wrong SHA, root license separation | https://github.com/JILLU-Games/ReadBox/actions/runs/44127481624 | CI gate implementation PASS; LIVE ACCEPTANCE OPEN |

## R-01 error handling patch proof

- EH-M01/EH-M02/EH-M03 verified by selected Compose service checks, short/missing secret rejection, reserved-character password round-trip, lockfile and production dependency audit: https://github.com/JILLU-Games/ReadBox/actions/runs/44093204590.
- A runtime password bug involving `%` escaping was found and corrected in Dockerfile before the successful run. Other mailserver and VPS error cases remain OPEN.

## R-02 error-handling evidence (2026-11-17)

- `EH-M04`: dedicated non-superuser LOGIN role can SELECT only authorized mailserver views; attempted password hash, app user and SQL writes rejected on disposable PostgreSQL. Host-installed Postfix is not yet connected.
- `EH-M05`: application delivery identity checked against UID/GID 1001; mismatch fails before provisioning and no automatic chown/permission widening is performed. Actual Dovecot LMTP filesystem access is not yet tested.
- `EH-M06`: migration manifest checker detects missing and unfinished rows in targeted tests; Prisma migrate deploy re-run is idempotent. `/health/ready` does not yet invoke this checker due explicit R-02 file Scope Lock; release gate remains OPEN.
- Proof: https://github.com/JILLU-Games/ReadBox/actions/runs/44099280332. Source commit `e1efdbd0b0380a94152947f7be47eb17c5c8d70c`. App UI/error messages and authentication unchanged.

## R-02 final EH-M06 negative outcomes (authorized closure)

- Existing expected-history helper is now invoked by `getReadinessSnapshot`, and `checks.migrations.ok` fails closed when any required migration is missing or unfinished, a failure row exists, migration directory/file is missing/unsafe, SQL query fails, or Prisma raw-query interface is absent.
- A complete matching history remains `ready` if all independent storage, DB/config and heartbeat requirements are also satisfied. No external user-visible error strings, login behavior or UI modified.
- **CI evidence:** https://github.com/JILLU-Games/ReadBox/actions/runs/44102834169. Code SHA: `b6ab76119a31f9bf4e81b3990a5fcc6d802a6892`. **Formal R-02:** CI VERIFIED CLOSED; SMTP/LMTP and actual VPS remain unverified.

## R-03 mailserver error handling verified vs remaining (2026-11-17)

- Actual Docker Postfix+LMTP delivery was verified from local SMTP port to the shared 1001-owned Maildir. Postfix denied unknown local RCPT and nonlocal relay, while missing TLS certificate prevented startup: https://github.com/JILLU-Games/ReadBox/actions/runs/44107205810.
- No SMTP AUTH/submission ports or IMAP service were enabled. One-shot SQL credential profile remains optional; default app-only Compose stays unaffected.
- Still **unverified** on real VPS: LMTP-down/queue replay and long outage recovery (`R-04/R-06`), bad-alias/oversized MIME acceptance policy, externally trusted/renewed certificate, public MX/PTR/firewall/provider port 25 and IPv6. Keep these cases OPEN in final acceptance; no false claims of comprehensive outage handling.

## R-04 first-admin and worker readiness error contract (2026-11-17)

- `EH-M10`: production operator CLI requires explicit `--bootstrap-production`, Docker runtime, interactive terminal, private PostgreSQL, enabled authentication and strong secret; bootstraps only dedicated `admin_accounts` with forced reset. Duplicate admin/legacy superuser is blocked, and setup inspector checks the same active superuser table. Real disposable database proof: https://github.com/JILLU-Games/ReadBox/actions/runs/44112634511.
- `EH-M11`: production readiness fails closed if ingestion heartbeat unknown, absent, stale, degraded, running, future-dated, or query fails; missing/symlinked/unreadable mail-storage path and DB fail return `not_ready`; healthy environment recovers. Initial ingestion worker exception writes a best-effort degraded heartbeat before rethrow. Docker worker health now checks both running process and full application readiness, while web liveness stays separate to prevent cyclic dependency.
- The JSON response explicitly shows `scope:"application"` and `checks.mailTransport.status:"not_checked"`; this is **not proof of live Postfix SMTP/LMTP**. No production operator terminal action, real outage replay or external network evidence was run.
- Tested executable-code SHA `88e57e2e81dc07a8f91b07f448df85e51d58e429`, focused CI https://github.com/JILLU-Games/ReadBox/actions/runs/44112634511. UI/auth policy and unrelated error surfaces unchanged. Existing original baseline examples in earlier sections remain historical facts, not current-state claims.

## R-05 encrypted recovery and updater negative error handling (2026-11-17)

- Exact verified executable-code SHA `a55ec82bb2f58804e910427c66ff6352cd5c14c6`, final successful CI https://github.com/JILLU-Games/ReadBox/actions/runs/44121121316. The Compose recovery program fails before mutation if input has an unknown target project/database, wrong encrypted identity, unauthenticated ciphertext, a symlink/traversal/special archive entry, or mismatched SHA-256 hashes. Decrypted staging stays private; no plaintext env/TLS secrets are included in output. Backup output and pre-restore rollback artifacts are encrypted with `age` and mode 0600.
- The system quiesces active Postfix/Dovecot/worker/web in a declared **SMTP downtime maintenance window**; only services previously running are restarted. A separate encrypted rollback snapshot is required before restoring any PostgreSQL data or named volume. CI injected a failure **after database apply** and explicitly required both the `R05_CI_FAILPOINT_AFTER_DATABASE_APPLY` and `R05_AUTOMATIC_ROLLBACK_PASS` markers, then compared restored pre-error public/mailserver rows and Maildir files. Tampered encrypted input failed without modifying the disposable DB.
- Both schema SQL rows, Maildir, attachments, media, Postfix queued content, numeric UID/GID 1001 and a real POSIX ACL were verified in disposable Compose. Host scripts exclude plaintext configuration, retain archived numeric ownership, and attempt upgrade rollback. Host-mode rollback behavior was **not run live**; no claim of full disk failure/sudden power-loss resilience.
- `RB-P2-01` still OPEN because legacy Nginx path changes fall outside R-05 allowed files. `RB-P2-07` still OPEN because verified encrypted local export alone does not demonstrate offsite retention/restore and secret-key custody. These require separately authorized future acceptance; production remains **NO-GO**.

## R-06 final release acceptance error and negative gate inventory (2026-11-17)

- **Successful focused CI:** https://github.com/JILLU-Games/ReadBox/actions/runs/44127481624; code SHA `807ca9f38adb02db2a8b73dc0901fce23ee5e63a`. Full app/unit/UI CI, production npm audit, strict disposable PostgreSQL migrations, Docker web/worker/Postfix/Dovecot test STARTTLS→LMTP→Maildir and unknown/nonlocal rejection, encrypted volume/queue backup→restore→automatic rollback and no-auto-release source gate passed.
- `EH-M14` and `EH-M15` remain **OPEN for LIVE acceptance**: no independent external sender-to-real-authenticated-inbox/attachment proof, no real public TCP/25/MX/PTR/renewing TLS or VPS storage/DB/LMTP outage replay/reboot. The existing R-03/R-05 unit/disposable failure scenarios are not substitutes.
- New negative governance checks refused forged 17/17 PASS with unresolved original findings, duplicate/missing RG IDs, wrong SHA, unsafe userinfo/token links, future observations, missing observers and falsely claimed release permission. Current real report `R06_PRODUCTION_NO_GO` with seven original findings OPEN and **zero of 17 live gate PASS claims**. A complete document may be only `MANUAL_RELEASE_REVIEW_REQUIRED`, never an automatic publication.
- Two pre-existing out-of-scope R-04 full-tree lint findings at `src/core/setup/trusted-operations.ts:366,386` remain; a strict lint-baseline negative gate proves exactly these two, while linting all other repository code. Do not infer full lint clean or waive them.
- Release/deploy/DNS/source code mutation impossible through R-06 workflow; `permissions: contents: read`. R-06 live acceptance **blocked** pending separate user approval. 6/6 implementation scopes CI verified, original 7 OPEN, production NO-GO.

## DKIM-01 — Explicit negative/failure handling (2026-11-18)

- Unconfigured isolated DKIM agent/socket/token => sanitized `DKIM_AGENT_NOT_INSTALLED`/`DKIM_AGENT_UNAVAILABLE`; no key creation through Web and no privileged/container Docker access.
- Invalid/weak RSA public key => `INVALID_PUBLIC_KEY`; public record without private identity, existing mismatched keypair, unsafe/symlink path => fail closed, **never overwrite, delete, rotate, or synthesize a private key for an existing public-only identity**.
- Agent requests are single action `provision`, validated domain only, bounded message, SO_PEERCRED UID 1001, HMAC-SHA256 token, timestamp/nonce/replay guard and bounded socket read time. Per-domain key creation serializes with a locked root and uses atomic no-replace hard links.
- Missing optional Cloudflare token/zone configuration => manual copy/export. Malformed zone, unrelated domain, wrong zone name, multiple/conflicting records, failed provider API => refuse DNS mutation. Only explicit DKIM TXT create is permitted, never PATCH/PUT/DELETE MX/SPF/DMARC.
- Existing domain is never deleted/recreated if opt-in DKIM provisioning fails after domain creation; operator gets an actionable follow-up. Status distinguishes public key, DNS publication and **inactive** signing.
- **Not yet proven:** live shared-volume ownership under an existing named-volume installation, the opt-in agent image Python tests, real network DNS propagation, pre-existing DNS record races and private-key escrow recovery. Preserve all failures for operator review, do not retry or force repair keys.

## DKIM-02/FIX-01 — RSA key-header bug and safe failure contract (2026-11-18)

- **Observed failure:** disposable image build with OpenSSL 3.x failed `test_key_generation_is_idempotent_and_private_not_public` and `test_conflicting_public_never_replaced` with `INVALID_PRIVATE_KEY`; the underlying RSA-2048 key could be valid but the key-size text parser rejected the comma/prime-count suffix.
- **Fix:** anchored regex accepts exactly legacy `Private-Key: (2048 bit)` and OpenSSL 3 `Private-Key: (2048 bit, 2 primes)`-style headers. Invalid or malformed headers continue fail closed. The existing `int(bits.group(1)) < 2048` rejection remains in place.
- **Regression:** embedded tests check both 2048-bit formats, explicitly reject 1024-bit legacy/v3, refuse malformed suffix and preserve original public-only conflict, conflicting public key, symlink/path and idempotency tests.
- **Disposable validation:** Python test suite **6/6 OK** during isolated Docker image build; no retry of production image build or production container activation was used to establish PASS. Real public-DNS record, key escrow, Cloudflare writes, volume ownership and SMTP signing are outside FIX-01.
- **Residual operator gates:** source candidate must be promoted via existing human-approved Admin Panel updater before a *separate* DKIM image build on the deployed SHA; any error must halt, without direct code patch in VPS, forcing Git, restoring production data or rotating/generating production keys.

## DKIM-02/FIX-02 — Agent startup permission denial (2026-11-18)

- **Runtime symptom:** `restarting/unhealthy`, exit code `2`, repeated `[Errno 13] Permission denied` opening `/usr/local/bin/dkim-agent.py` from the UID 1001 provisioner.
- **Cause:** Docker image `COPY` did not explicitly guarantee non-root readable mode; root-owned build-time tests succeeded but normal runtime process could not read the entrypoint script.
- **Fail-closed fix:** set only the image copy's agent script mode to `0644` (non-writable by UID 1001) and build-fail if UID 1001 cannot read and Python-compile that script. No blanket `chmod 777`, no privilege escalation, no agent network access, no runtime Docker socket or volume-permission workaround.
- **Reproduction/acceptance:** prior container log captured exact permission denial. Isolated uncached Docker build passed six existing agent regression tests and non-root smoke check with `DKIM02_FIX02_NONROOT_BUILD_PASS`.
- **Unverified until separate controlled rollout:** new production host image, container `healthy` state, IPC token/socket runtime startup. Do not infer live health from build success and do not generate a production DKIM key or publish DNS while encrypted private-key escrow remains missing.


## DKIM-03 — Fail-closed escrow and recovery inventory (2026-11-18)

- **No receipt/tampered receipt:** root ownership, mode 0644, bound domain, private PEM SHA256, RSA public DER SHA256, ciphertext SHA256, fixed immutable R2 key and verified marker are checked before agent can publish `mail.txt`. No receipt means new private material stays staged without public TXT; a mismatch blocks publication.
- **Unsafe files/paths:** symlinked private key or receipt, invalid domain/traversal, missing identity, unsafe private-key mode, RSA size below 2048 and public-key conflict are rejected. Private key never leaves the host in plaintext via R2 or application API.
- **Offsite conflict:** fixed `IfNoneMatch: *` conditional R2 write, immutable object path per domain/PEM hash; any existing mismatched remote bytes, digest, metadata or decrypt result rejects without overwrite or delete. Full streamed bounded remote GET SHA256 readback is required before receipt publication. Missing/rejected conditional write fails closed.
- **Crash/retry:** lost PUT ACK is accepted only after a complete matching GET/readback; crashed-after-upload/before-receipt resumes using identical remote ciphertext rather than re-encrypting a new blob. Interrupted upload never publishes a receipt.
- **Recovery:** only CI-disposable fresh directory; after deleting original fixture volume/receipt, recover from encrypted object + independent age identity, validate private digest and RSA public fingerprint, write mode 0600 without overwrite. Live recovery API/CLI is intentionally absent.
- **Observed CI failure:** initial #44293943849 hit `SyntaxError` in an orphaned inner `try` at receipt writer. Single minimal in-scope repair committed, along with deterministic `chmod 0644` so UID1001 can read even if host umask is 077. Required recheck #44294483799 SUCCESS.
- **Residual security boundary:** offline receipt reflects host-root verified R2 state when written; the non-networked DKIM agent does not independently query R2. A compromised trusted host or malicious writable DKIM private volume is outside the receipt-only threat model. Age identity and protected R2 credential recovery were **not** proven on a lost real VPS.
