# 003 — Manual Domain Phase Progress & Change Log
## Current ledger — 2026-11-19
| Item | Status | Proof |
|---|---|---|
| MD-00 planning / source forensic report | DOCUMENTED (source-only; not an implementation) | Baseline `6f3bc1e3aeb441956e1fd0f4d81558a6aba2945f`, [001](001-FORENSIC-AUDIT-AND-PRODUCTION-GAPS.md), [006](006-EXACT-PATCH-REFERENCES-AND-CODE-PROOF.md) |
| MD-01 UI checkbox / manual opt-out | **NOT STARTED** | No code or CI |
| MD-02 manual DKIM readiness / safe export | **NOT STARTED** | No code or CI |
| MD-03 cross-account live acceptance | **NOT STARTED** | No operator acceptance |
| MD phases completed | **0 of 3** | MD-00 is not counted |
| MD phases remaining | **3 of 3** | Next **MD-01** |
| Original source R-01..R-06 | **6/6 CI complete (historical)** | `notes/002` |
| Full production release | **NO-GO** | `notes/001` seven OPEN; `notes/006` 17 formal gates |

## Scope/preservation ledger
- Planning adds notes only under `notes/domain-manual/**` on a documentation branch; no app code, VCon UI, endpoint, Prisma, public DNS, VPS or production mailbox change.
- Existing three-domain user-observed successful mail receipt is recorded in 000/005 as past operator observation; not a new live test here.
- Source SHA and documentation commit SHA are distinct. Freeze each code phase against current Primary HEAD; never report plan-only SHA as tested code.
- Do not count a phase as complete until exact changed paths + security review + one focused CI/operational result + source/mirror dedicated branch parity are all documented; a blocked mirror makes closure PARTIAL.

## Mandatory per-phase append template
### MD-XX — [date, implementation state: NOT STARTED / BLOCKED / CI PASS / LIVE PASS]
- Pre-edit source SHA / tree:
- Changed paths (exact; compare to MD-XX allowlist):
- Intended change vs actual code behavior:
- Existing features/UI/auth/DB/mailserver unchanged evidence:
- Negative cases and error contracts:
- One focused CI run URL + exact tested SHA + outcome (or operator live test, with consent/evidence):
- One exact patch/security audit and secret/unsafe-DNS-write check:
- Production artifacts touched: NONE unless separately authorized
- Primary main SHA / dedicated backup A/B SHA exact readback:
- Full release status (default NO-GO; formal 17 gates not inferred):
- MD complete / remaining count and NEXT phase:
- Blockers, rollback, stop reason if any:

**Do not replace or rewrite root `notes/003-PHASE-PROGRESS-AND-CHANGE-LOG.md`.** At phase closure add a dated appendix there, as required by `AGENTS.md`; keep this supplementary MD ledger in sync.
