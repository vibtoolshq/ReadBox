# 001 — Manual Account Forensic Audit and Production Gaps
**Source evidence:** Primary SHA `6f3bc1e3aeb441956e1fd0f4d81558a6aba2945f`. Lines are 1-based at that immutable SHA; full snippets in [006](006-EXACT-PATCH-REFERENCES-AND-CODE-PROOF.md).

## Confirmed, exact manual-onboarding findings
| ID | Severity | Actual code / observation | Consequence | Remedy / phase |
|---|---|---|---|---|
| **MD-F01** | UX | `src/components/vcon/domain-form.tsx:137` defaults `autoDkim=true`; lines 289–303 demand selected `zoneId` for automatic path. Manual opt-out exists at lines 694–740 but is below preview | Operators believe every domain needs same-account zone/token | MD-01: explicit Manual Mode checkbox beside zone selector; original auto default unchanged |
| **MD-F02** | functional export | `src/core/dns/records.ts:60–77` emits shared `mail.anyinbox.cc` A; `:118–165` exports ALL records including out-of-zone A as FQDN | BIND-format zone import into another domain zone can reject out-of-zone owner; importing it is not necessary | MD-02: omit out-of-zone A/AAAA in downloaded zone only; preserve UI's separate shared mail-host expectation |
| **MD-F03** | incomplete export guard | `src/core/dns/records.ts:24–28, 53–58, 146–160` DKIM may be unavailable; exporter produces a commented placeholder for non-copyable record | Download before provisioning is NOT complete DKIM setup | MD-02: clear status/export guard; require public record readiness before calling export complete |
| **MD-F04** | UX flow | `domain-form.tsx:208–246` supports `publish:false` for saved domain, but `:275–308` manual create only saves disabled domain | Manual flow needs separate Provision/Repair then download; easy to miss | MD-01 document present steps; MD-02 optional one-click escrow/public-key readiness on manual create, reusing existing safe orchestration |
| **MD-F05** | trust boundary | `src/app/(workspace)/vcon/domains/actions.ts:41–92` validates zone only when `autoDkim=true`; current API has no explicit mutually-exclusive manual flag | New checkbox needs authoritative server-side mode contract, not cosmetic bypass | MD-02: reject contradictory manual/auto/zone requests; no Cloudflare write on manual |
| **MD-F06** | wording | `src/core/dns/records.ts:31–43` may display Cloudflare name `mail` for a shared mail hostname outside a new zone | Misleading manual import instruction; can accidentally create wrong-zone `mail` record | MD-02: indicate that shared external A/AAAA must be verified in its original authoritative zone |
| **MD-F07** | operational reliability | Operator-confirmed root-only escrow blocked while old PuTTY `flock` holder remained | Paused one domain setup, not ongoing unresolved defect; released and 3 domains subsequently received mail | Document retry/lock ownership; no unrelated backup-lock code change in MD phases |

**No evidence that token-free manual Add Domain is actually disabled:** source proves manual opt-out already works. This is a discoverability/quick workflow and export safety improvement, not an authorization bug.

## Existing safeguards to preserve
- `src/core/dns/domain-automation.ts:39–68`: manual `publish:false` skips provider-zone resolution, but still verifies root-only encrypted escrow receipt before exposing public DKIM key; does not publish remote DNS.
- `src/app/api/vcon/domains/[uuid]/dkim/route.ts:62–102`: admin, same-origin and strict POST body; zone only bound when publishing.
- `src/core/domains/service.ts:397–407, 634–648`: active domain must have routing `verified`.
- `src/core/dns/cloudflare-auto.ts:157–213`: additive/idempotent guarded automatic Cloudflare path; must not be loosened in manual work.
- `src/components/vcon/dns-records-panel.tsx:38–57`: existing Download Cloudflare zone control.

## Wider production release findings (DO NOT redefine status)
Authoritative `notes/001-PRODUCTION-RELEASE-BLOCKERS.md` keeps **seven OPEN** original release findings:
`RB-P0-06` independent SMTP-to-inbox acceptance, `RB-P1-09` DKIM signing/TLS/external DNS, `RB-P1-10` production port/DNS evidence, `RB-P1-16` production/failure-recovery integration, `RB-P2-01` legacy path/template, `RB-P2-07` independent offsite restore proof, `RB-P2-08` historical source/license provenance.

Three successful user-observed incoming test messages improve live evidence for narrowly tested domains; they do not automatically close these findings, approve full staging/recovery, guarantee outbound DKIM signing or establish formal release GO. Record individual acceptance only through existing `notes/006` gates with independent evidence.

## Non-goals / risk decisions
- No support for multiple persisted Cloudflare tokens/accounts in this patch. Manual Mode is deliberately **token-free**, import via user's other account.
- No automated login to another Cloudflare account, no registrar delegation, no unsolicited modification of its zone.
- Avoid mass-import into nonempty zones; import can conflict with existing MX/SPF/DMARC and change actual mail routing. Exact conflicts are operator decisions.
- No root website A/AAAA creation in manual file, no same-zone mail host fabrication, no implicit enable before MX + shared mail host check.
- No extra release phases, large UI redesign or source/mirror force sync.
