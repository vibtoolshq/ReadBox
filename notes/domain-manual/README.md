# ReadBox — Manual Cloudflare Account Domain Onboarding: planning index
**Status: DOCUMENTATION PLANNED / MD-01..MD-03 NOT IMPLEMENTED.**
**Inspected immutable source:** `vibtoolshq/ReadBox@6f3bc1e3aeb441956e1fd0f4d81558a6aba2945f` (2026-11-19).
This supplement does NOT supersede authoritative `notes/000–006`, `AGENTS.md`, the original 32 finding IDs, or the 17 formal R-06 release gates.

| Order | Document | Purpose |
|---|---|---|
| 000 | [Baseline freeze](000-BASELINE-FREEZE.md) | Exact refs/tree, live evidence limits and preservation contract |
| 001 | [Forensic audit](001-FORENSIC-AUDIT-AND-PRODUCTION-GAPS.md) | Confirmed defects, inferred risks, original release blockers |
| 002 | [Three-phase roadmap](002-PHASE-ROADMAP-AND-SCOPE-LOCK.md) | Phase-by-phase exact allowlists and verification gates |
| 003 | [Progress ledger](003-PHASE-PROGRESS-AND-CHANGE-LOG.md) | 0/3 implemented; closure template for SHA, tests and remaining work |
| 004 | [Error handling](004-ERROR-HANDLING-INVENTORY.md) | Current fail-closed behavior plus missing manual-mode tests |
| 005 | [Actual-working matrix](005-ACTUAL-WORKING-FEATURE-TRACKER.md) | Source-present vs operator-observed vs independently verified |
| 006 | [Exact code proof / patch reference](006-EXACT-PATCH-REFERENCES-AND-CODE-PROOF.md) | Verified paths/lines and explicitly **proposed**, unapplied snippets |
| 007 | [Acceptance and rollback](007-VERIFICATION-AND-ROLLBACK-GATES.md) | One focused CI per phase, manual import safety and stop conditions |

**Design decision:** Keep both modes. Automatic mode requires a server-side scoped token and active selected Cloudflare zone. Manual Mode checkbox beside the zone selector removes the *Cloudflare-selection requirement only*; it never removes authenticated admin/verified R2 escrow/DNS-routing gates. Export and import are NOT automated API writes to another Cloudflare account.

**Important:** Existing Add Domain already supports manual opt-out by unticking `Automatic setup`. This plan improves discoverability, key readiness and export correctness. It does not claim the manual workflow is currently absent.

**Execution:** This documentation-only branch is a proposal. After review, separately authorize MD-01. No app code, VPS, DNS provider, keys, DB, container, release, tag or mailbox has been modified by this documentation.
