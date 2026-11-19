# 007 — Verification, Security, Live Acceptance and Rollback Gates
**Feature plan:** MD-01 -> MD-02 -> MD-03 (0/3 started). **Release:** NO-GO under `notes/006` regardless of MD results.

## MD-01 one CI / one patch audit
1. Source SHA freeze and exact diff allowlist; assert changed paths confined to MD-01 files. Non-code notes are append-only.
2. Focused isolated React UI tests: manual ON no zone/token dependency, DNS-review confirmation required, auto OFF existing zone gate unchanged, edit existing bound zone immutable.
3. Typecheck of touched UI; prove no change to form layout outside zone/manual section; no endpoint/DNS/VPS/credential calls.
4. One CI run URL with tested SHA. If failure, minimal in-scope correction and at most one focused failing-case recheck. Failed tests => BLOCKED, not PASS.
5. Commit; primary and dedicated backup-branch non-force exact sync only as explicitly approved and only after evidence. Preserve backup mains.

## MD-02 one CI / one patch audit
1. Offline fixtures only: fake Cloudflare fetch refuses accidental manual publishing, fake escrow succeeds/fails; no real R2/network.
2. Acceptance: correct create modes, no zone in manual request, contradictory flags refuse; saved disabled on escrow failure; public DKIM unexposed before escrow; same private key on retry.
3. Export acceptance: output only `mailiq.shop.`, `mail._domainkey.mailiq.shop.`, `_dmarc.mailiq.shop.`, MX target `mail.anyinbox.cc.` (as DATA not record owner); explicitly no `mail.anyinbox.cc. IN A` in `mailiq.shop` zone; legal DKIM chunks <=255; existing auto DNS inspection unchanged.
4. Verify all existing Cloudflare automatic zone/security tests pass using focused selection (not a full project test loop). Reject leaked secrets/private PEM and forbidden provider updates/deletes.
5. One run URL, one diff audit, date/SHA negative evidence, commit and permitted sync; release remains NO-GO.

## MD-03 bounded live operator acceptance (different CF account)
**Separate explicit approval** required with named domain, Cloudflare account ownership, old-record inventory and rollback policy. Operator, not agent, owns import.
1. Read-only preflight: intended empty/test zone delegation/status and existing DNS; if live mail uses old MX, STOP until approved migration.
2. Add domain in ReadBox Manual Mode; initially disabled; wait for verified R2 escrow/public DKIM key; download current generated zone after public key ready.
3. Inspect file before upload: no out-of-zone A/AAAA, no duplicated/conflicting MX/SPF/DMARC; import ONLY intended records via other account's Cloudflare UI; proxy for mail host must be DNS-only where applicable.
4. ReadBox Inspect all DNS -> required routing verified and five-record match; persist verification, then activate. One test mailbox and single approved external Gmail-origin message. Record timestamp, screenshot/result, no credentials.
5. If a step fails: STOP; do not re-add same domain, rekey, mass-import, delete or overwrite. Keep disabled; use existing repair/diagnostics. Roll back **only proven new records** after separately approved operator review. Do not remove any pre-existing DNS records.
6. Before claiming 3/3, add exact evidence to MD ledger and append root `notes/003–006`. Full production release remains independent R06 gate NO-GO until explicitly reviewed.

## Permanent safety invariants
- No read/write to production private key/age identity/R2 object by a doc-only or source-CI workflow.
- No database schema, migrations, mailserver, existing customer domain/mailbox, auth, unrelated UI, Docker/VPS/TLS/release change.
- No automatic cross-account Cloudflare login/API scope. Missing zone in Manual Mode is NOT permission to disable R2 verification or route-gated activation.
- No newly generated domain should become Active merely because a zone file was downloaded. MX and shared mail-host A/AAAA must actually resolve.

## Rollback by phase
- MD-01: revert its UI-only commit (without rewriting history); existing checkbox/manual path remains.
- MD-02: revert source-only manual action/export patch; existing disabled domains and private escrow material are immutable and remain; no rollback that deletes escrow/R2 data.
- MD-03: suspend/disable only the approved test domain if necessary, preserve mail/backup evidence, do not edit preexisting Cloudflare records without separately approved change plan.

## Release gate reconciliation
The seven original open findings and all 17 formal live gates in `notes/001`/`notes/006` are outside this feature's authority. New real evidence is supplemental, never automatic release GO. Mirror/source ref parity is checked separately; do not force-update backup `main` or bypass system updater security.
