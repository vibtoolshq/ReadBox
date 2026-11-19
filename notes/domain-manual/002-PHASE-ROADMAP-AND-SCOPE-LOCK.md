# 002 — Exactly THREE Manual Domain Onboarding Phases
**Baseline:** `6f3bc1e3aeb441956e1fd0f4d81558a6aba2945f`; new MD track is separate from historical R-01..R-06 and NEXT-01..04. **MD-00 documents only; MD-01..03 = 0/3 implemented.**

## Global contract (all MD phases)
- Re-read authoritative Primary HEAD, `AGENTS.md` and this roadmap before editing. Never silently expand an allowlist.
- Preserve all unrelated UI, routes, auth, one PostgreSQL, Prisma schema/migrations, mailbox data, mailserver, Docker, worker, updater, backup/R2 private material and existing Cloudflare DNS.
- At most **one focused disposable CI per code phase + one exact changed-path/security audit**; only minimal scoped failure recheck. No repetitive test loops.
- After success append (do not rewrite history) to `notes/003-PHASE-PROGRESS-AND-CHANGE-LOG.md`, `004-ERROR-HANDLING-INVENTORY.md`, `005-ACTUAL-IMPLEMENTATION-TRACKER.md` and `006-VERIFICATION-AND-RELEASE-GATES.md`, plus relevant `notes/domain-manual/**`; include SHA, run URL, negative cases, unchanged contracts, remaining phases.
- Only user approval starts MD-01 / MD-02 / MD-03; docs-only planning is **NOT** implementation authorization. For source sync require source/backup **dedicated branch** parity to exact post-phase commit with fast-forward only; backup mains remain untouched. Never falsely claim sync.
- No VPS deployment, live DNS import, R2 mutation, key rotation, restore, secret exposure, tag or release during MD-01 and MD-02.

## MD-01 — Explicit checkbox beside Cloudflare zone; keep legacy manual path
**Goal:** Show **Manual Mode (other Cloudflare account)** directly in Cloudflare Zone panel. The panel and Manual Mode checkbox remain visible at all times in create mode; ON hides/disables only the zone selector and disables automatic provider setup, while preserving the review checkbox; Save creates disabled domain via **existing** manual contract. OFF retains existing selected-zone automatic setup and auto default. The saved-domain `Provision / Repair DKIM` with Publish unchecked remains the documented manual completion step until MD-02.

**EXACT source allowlist (contract sections only):**
- `src/components/vcon/domain-form.tsx` — local mode state, checkbox, zone panel, submit validation/payload, contextual help; no other sections.
- `tests/ui/domain-zone-selection.test.tsx` — existing zone and manual opt-out regression.
- `tests/ui/domain-manual-mode.test.tsx` **NEW**, only if necessary for isolated UI cases.
- `.github/workflows/domain-manual-ci.yml` **NEW** read-only disposable focused UI runner; no live provider/secrets. (Old `domain-auto01-ci.yml` hardcodes historical diff and cannot be reused unmodified.)
- Append-only closure sections of `notes/{003-PHASE-PROGRESS-AND-CHANGE-LOG,004-ERROR-HANDLING-INVENTORY,005-ACTUAL-IMPLEMENTATION-TRACKER,006-VERIFICATION-AND-RELEASE-GATES}.md` and `notes/domain-manual/{002,003,004,005,007}*.md`.

**DENY:** `src/app/(workspace)/vcon/domains/actions.ts`, `src/core/dns/**`, `src/core/domains/service.ts`, APIs, Cloudflare token/backend, mailserver, DB, other components, old workflows. If UI requires backend changes, STOP and move them to MD-02 with separate approval.

**Focused acceptance:** manual ON -> no zone required, review confirmation still required, creation disabled/no DNS provider calls; manual OFF -> exact prior automatic zone validation; edit-existing binding stays immutable; UI no unrelated changes. One focused CI + changed-path audit. **Exit:** MD-01 1/3, then seek MD-02 authorization.

## MD-02 — Complete manual DKIM readiness + safe cross-zone DNS export
**Goal:** After manual Add Domain, try reusing `automateDomainSetup(publish:false)` to stage non-rotating DKIM private key, verify encrypted R2 escrow and release public TXT; persist disabled domain if escrow unavailable; safe, repeatable `Provision / Repair` remains. Downloaded zone file contains only names inside target zone (MX/SPF/DKIM/DMARC), not external shared `mail.anyinbox.cc` A/AAAA. Provide clear note that shared host A/AAAA is maintained separately; do not promise successful import into arbitrary existing zones.

**EXACT source allowlist:**
- `src/app/(workspace)/vcon/domains/actions.ts` — create payload parser/validation and manual-only `publish:false` orchestration/message, no auto path relaxation.
- `src/components/vcon/domain-form.tsx` — manual flag submission and export readiness/help text only.
- `src/components/vcon/dns-records-panel.tsx` — export availability/explicit warning, no unrelated table redesign.
- `src/core/dns/records.ts` — **zone-file export filter only**; preserve `buildExpectedDnsRecords` routing record list for on-screen inspection and `cloudflare-auto` contracts. If changing `cfHost` label is needed, confine to external-host manual copy label with focused test.
- `tests/dns/domain-automation.test.ts` and `tests/dns/r03-advisory-contract.test.ts` — exact negative and import/export contract tests.
- `tests/admin/phase3-domains-mailboxes.test.ts` — manual create contract tests only.
- `tests/ui/domain-manual-mode.test.tsx` or `tests/ui/domain-zone-selection.test.tsx` — manual UX and file readiness cases.
- `.github/workflows/domain-manual-ci.yml` — update only focused test selection/allowlist for this phase.
- Append-only `notes/003–006` canonical filenames above, and related `notes/domain-manual/{002,003,004,005,006,007}*.md`.

**DENY:** `src/core/dns/domain-automation.ts`, `src/core/dns/cloudflare-auto.ts`, DKIM agent/escrow helper, `src/core/domains/service.ts`, DB schema, auth, mailserver, R2 code, other UI, other workflows. If essential, STOP for exact scope exception.

**Focused acceptance:** manual request with no zone and no token -> admin-created disabled row + valid public TXT only after verified R2 escrow, zero Cloudflare API calls; two-mode conflict and forged foreign zone -> reject; escrow unavailable -> disabled, error actionable, zero public key release; retry existing domain -> same key; downloaded file excludes external shared host A/AAAA, contains valid DKIM (split TXT segments <=255) only when ready; importable standard zone format; automatic mode behaves unchanged. One CI + diff/security audit. **Exit:** MD-02 2/3, seek explicitly scoped live MD-03 approval.

## MD-03 — Controlled cross-account operational acceptance (NO source edits)
**Goal:** One **operator-selected disposable/empty** domain in a second Cloudflare account. No token added to ReadBox; use Manual Mode, ensure escrow public record ready, export and manually import only consented records, inspect authoritative DNS then activate, create a test mailbox and send one approved external message. Check no accidental creation in primary CF account.

**ALLOW:** Read-only zone/import preflight, user-owned manual DNS import to one named zone after explicit approval, public resolver/ReadBox verify, a single approved test mailbox/message, sanitized evidence in `notes/domain-manual/{003,005,007}*.md` and append-only root `notes/003–006`. One bounded operational verification.
**DENY:** Any other domain/zone, bulk import, deletion/overwrite without confirmation, registrar changes, raw tokens/keys, existing user mailbox data, prod restore, VPS restart, code edits, tag/release. If target zone has conflicting MX/SPF/etc, STOP.
**Exit:** MD-03 3/3 only on real checked live evidence, otherwise BLOCKED with cause. This is a feature acceptance, **not** automatic release GO; R06 17 gates and seven original findings remain separately governed.

## Phase approval prompt, MD-01 (copy/paste)
> ReadBox MD-01 implement করো। Frozen Primary baseline `6f3bc1e3aeb441956e1fd0f4d81558a6aba2945f` recheck করে শুধু `notes/domain-manual/002`-এর MD-01 exact allowlist মেনে Cloudflare zone panel-এ Manual Mode checkbox, existing manual opt-out mapping এবং focused UI regression implement করো। One disposable CI, exact patch/security audit, append-only phase notes; Git commit ও non-force approved dedicated backup-branch sync করো, mismatch হলে BLOCKED জানাও। Existing backend/auth/Prisma/mailserver/DNS/DKIM/R2/other UI unchanged; no VPS/live DNS/secrets/tag/release।
