# 004 — Manual-Domain Error Handling Inventory
Source SHA `6f3bc1e3aeb441956e1fd0f4d81558a6aba2945f`. Full cross-project historical error inventory remains authoritative at `notes/004-ERROR-HANDLING-INVENTORY.md`; this is the MD-specific delta.

## EXISTING implemented fail-closed contracts
| Contract | Code proof | Current result |
|---|---|---|
| No selected zone in automatic mode | `src/components/vcon/domain-form.tsx:289–294` | UI rejects submit |
| Missing/foreign/inactive Cloudflare zone | `src/core/dns/cloudflare-auto.ts:267–295` | Server refuses publishing before creating keys |
| Malformed/failed Cloudflare response and 401/403 | `src/core/dns/cloudflare-auto.ts:43–73` | Sanitized provider refusal |
| Existing conflicting DNS | `src/core/dns/cloudflare-auto.ts:157–213` | No overwrite/delete; stop |
| Unknown/out-of-domain auto zone | `src/core/dns/cloudflare-auto.ts:165–169, 267–295` | Fail closed |
| DKIM before private escrow | `src/core/dns/domain-automation.ts:42–65`, `deployment/dkim/agent.py` | Public TXT withheld until verified receipt |
| R2 escrow unavailable/lock busy | `domain-automation.ts:50–59`, `deployment/backup-agent/agent.py` | Refuses setup; saved domain remains disabled; operator observed one incident |
| No public DKIM key | `domain-automation.ts:63–66`; `records.ts:24–28, 145–161` | Preview/export must not call placeholder a usable DKIM record |
| Cross-origin forged DKIM mutation | `src/app/api/vcon/domains/[uuid]/dkim/route.ts:23–36, 62–80` | 403/400/415 before automation |
| Activation before verified routing | `src/core/domains/service.ts:397–407, 634–642` | Refused |
| UI manual saved-domain retry | `src/components/vcon/domain-form.tsx:208–248` | `publish:false` route available without Cloudflare DNS write |

## PROPOSED MD-only contracts (NOT IMPLEMENTED)
| ID | Trigger | Target result | Phase / focused negative |
|---|---|---|---|
| MD-E01 | Manual Mode ON with no Cloudflare zone/token | Allow manual domain save; no provider API calls; review acknowledgement required | MD-01/MD-02 |
| MD-E02 | Manual + auto flags simultaneously or forged nonempty `zoneId` | Reject contradictory payload without DNS write or changing current binding | MD-02 |
| MD-E03 | R2 escrow unavailable/locked during manual create | Keep domain disabled; sanitized `DKIM_ESCROW_*` or `DKIM_R2_ESCROW_UNAVAILABLE`; show one guarded retry on saved domain; no fake success | MD-02 |
| MD-E04 | DKIM public key missing when exporting | Do not claim all DNS complete; guide escrow-only Provision/Repair then re-preview/export | MD-02 |
| MD-E05 | Shared external A/AAAA in zone export | Skip out-of-zone owner; explain original authoritative zone still must resolve | MD-02 |
| MD-E06 | Existing MX/SPF/DMARC/DKIM conflict at external Cloudflare import | No automated override; user must decide before import; stop if uncertain | MD-03 |
| MD-E07 | Manual import succeeds but DNS routing stale | Keep disabled; ReadBox inspect/recheck; no forced activation | MD-03 |
| MD-E08 | Current CF token account inaccessible | Manual mode must not depend on API zone-list availability; auto mode still reports fail-closed token error | MD-01/MD-02 |
| MD-E09 | Repeated Add after DB save with escrow error | Existing domain conflict; never duplicate/rotate; direct to saved-domain retry | MD-02 |
| MD-E10 | Zone-file import includes another domain's A | Target zone preview must make out-of-zone omission explicit; no wrong-zone synthetic `mail` host | MD-02/03 |

## Operational R2/lock lesson
On 2026-11-19 the user observed `DKIM_ESCROW_REFUSED` and a global lock left held by a detached old Bash process. The process was verified by PID/fdinfo before being signaled, after which `GLOBAL_BACKUP_LOCK=AVAILABLE`. This is historical operator evidence, not approval to kill unknown processes. Never delete the lock file, rotate a key, or restart services as a first response. Read-only lock-holder detection is the default; any live intervention requires a separate approved plan.

## Logging/redaction
- Log only stable error codes and status (pending/verified/disabled). Never log Cloudflare API token, R2 access key, age identity, private DKIM PEM, raw HTML email bodies or mailbox passwords.
- UI distinguishes **validation, retryable escrow/provider outage, immutable DNS conflict, DNS propagation pending, manual import pending**. No raw backend exception display.
- Each future phase append exact focused negative result, run URL, SHA and stop conditions. Do not mark a proposed error handler as already implemented.
