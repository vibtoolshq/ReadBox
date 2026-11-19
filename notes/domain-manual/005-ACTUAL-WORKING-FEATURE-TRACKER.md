# 005 — Actual Working vs Proposed Manual Domain Features
As-of 2026-11-19. **Evidence types must not be collapsed:** SOURCE PRESENT; DISPOSABLE CI; OPERATOR-OBSERVED LIVE; INDEPENDENT ACCEPTED; NOT IMPLEMENTED; NOT TESTED.

| Capability | Truth at frozen SHA / operator report | Evidence |
|---|---|---|
| One token, per-domain selected active CF zone | **SOURCE PRESENT + OPERATOR-OBSERVED LIVE** | `domain-form.tsx`, `cloudflare-auto.ts`; screenshots of `mailiq.shop`, `softlo.com`, `mailvib.com` |
| Automatic new domain + MX/SPF/DKIM/DMARC provider publish | **SOURCE PRESENT + OPERATOR-OBSERVED LIVE** | ReadBox/Cloudflare screenshots, first-domain 5/5 matching |
| Root DKIM RSA private key + escrow receipt gated public key | **SOURCE PRESENT; operator-observed public key/DNS success** | `domain-automation.ts` and `deployment/dkim/escrow.py`; NOT a fresh independent R2 recovery readback |
| Public Gmail -> Postfix -> inbox (3 new domains) | **OPERATOR-OBSERVED LIVE PASS (three simple messages)** | screenshots: mailiq.shop, softlo.com, mailvib.com; sender/subject/body match |
| Existing `anyinbox.cc` and three original mailboxes | **OPERATOR-OBSERVED unchanged/active** | Admin domain screenshots; NOT a full no-regression sweep |
| Manual creation without CF zone | **SOURCE PRESENT** (uncheck original automatic checkbox) | `domain-form.tsx:275–303, 695–740`; not live-tested in other account |
| Saved-domain escrow-only DKIM provision | **SOURCE PRESENT** via Publish unchecked | `domain-form.tsx:208–246`, `domain-automation.ts:39–68`; not yet live-tested as cross-account workflow |
| Download BIND-style Cloudflare zone file | **SOURCE PRESENT** | `dns-records-panel.tsx` + `records.ts`; out-of-zone shared A bug remains |
| New nearby Manual Mode checkbox | **NOT IMPLEMENTED** | MD-01 |
| One-click manual DKIM/escrow readiness on initial save | **NOT IMPLEMENTED** | MD-02 |
| Safe file omits external shared mail-host A/AAAA | **NOT IMPLEMENTED** | MD-02 |
| Other-account import with full real incoming mail | **NOT TESTED** | MD-03 |
| DKIM signing / outbound SMTP relay | **NOT IMPLEMENTED / INBOUND-ONLY** | `docs/DOMAIN-AUTOMATION.md` |
| Full independent offsite restore, attachment/outage/TLS/PTR and 17 R06 gates | **NOT ACCEPTED** | `notes/001` / `notes/006`, release NO-GO |

## Phase record
- MD-00: planning documents created; **no functional behavior added**.
- MD-01: NOT STARTED; when implemented, update checkbox/zone behavior with exact CI proof.
- MD-02: NOT STARTED; when implemented, update manual escrow/export behavior with exact CI proof.
- MD-03: NOT STARTED; only after operator-owned real import, mailbox test and independent evidence mark its bounded gate complete.

## Honest release reporting
Three successful mailbox screenshots establish the working inbound path **for those domains/messages**, not offsite recovery, long-run queue stability, security review or blanket approval of future Cloudflare imports. The pre-existing source release remains **NO-GO** until original 7 open findings and all RG-01..RG-17 are independently resolved and manually approved.
