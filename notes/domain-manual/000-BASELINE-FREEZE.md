# 000 — Immutable Baseline Freeze / Manual DNS planning
Date: 2026-11-19. Freeze is an **inspected immutable commit**, not a claim that an unprotected Git branch cannot change.

| Item | Exact state |
|---|---|
| Authoritative source | `vibtoolshq/ReadBox`, `main` |
| Inspected source commit | `6f3bc1e3aeb441956e1fd0f4d81558a6aba2945f` |
| Inspected Git tree | `f82b07b6e0770850edd3431f041d5162848d442a` |
| Source ancestry | Parent `4d0b124af57c8d407bf609540b8b8b7a69a479b5` |
| Backup A `JILLU-Games/ReadBox` main | `952516a2cac27649824bf14329f511eae6ae9294` (not equal to source) |
| Backup B `MdNurnobi-Dev/ReadBox` main | `511a77380ef8d41061164abb966cbe960b6d02a8` (not equal to source) |
| Both dedicated `backup/dns-final-primary-20261119` refs | Both `6f3bc1e3aeb441956e1fd0f4d81558a6aba2945f`; exact SHA match |
| Report-only PR branch | Documents under `notes/domain-manual/**`; never overwrite backup main |
| Operator's last VPS source report | `/opt/readbox` at same inspected SHA (user-supplied PuTTY evidence; not revalidated during this planning run) |

## Authority and history
- `AGENTS.md` and `notes/000-BASELINE-FREEZE.md` control all update phases. `notes/001` retains 32 findings (25 CI-contract verified, 7 release findings OPEN); source phases R-01..R-06 = 6/6 CI-complete; independent production release remains **NO-GO**.
- Historical NEXT-01..NEXT-04 readiness gates remain separate and are not reset or automatically closed by this supplement. Previous NEXT-01 dedicated backup branch parity and NEXT-02 Primary R06 CI were reported completed; NEXT-03 has operator-observed live DNS/mail evidence. NEXT-04 independent, comprehensive release acceptance is not complete.
- Do NOT change existing source/mirror main just to satisfy outdated updater parity. That is separate policy work, not a manual-mode patch.

## Bounded operator-observed LIVE evidence (not a new independent certification)
1. `mailiq.shop`, `softlo.com` and `mailvib.com` displayed **Active + DNS verified**; Cloudflare DNS/ReadBox inspection showed 5/5 matched for the first domain.
2. Each of those three domains received one Gmail-origin test message in its ReadBox mailbox; sender, subject, body were visible in screenshots. Evidence is limited to these messages and timestamps, NOT a comprehensive SMTP/LMTP recovery, TLS-renewal, PTR, attachments or outage test.
3. One DKIM escrow refusal occurred while the global backup lock was held by an abandoned PuTTY Bash FD; operator released the old holder. Subsequent public DKIM records and DNS verification worked. Independent encrypted offsite escrow readback/restore was not separately accepted.
4. Other Cloudflare accounts without the server token did **not** appear in active zone selector, correctly by design.

## Protected invariants
- Exactly one PostgreSQL DB + Prisma schema/migrations; no changes to auth, users, mailboxes, Maildir, attachments, Postfix, Dovecot, worker, license, Docker Compose, firewall, HTTPS/TLS, installer/updater, backup-agent, root private DKIM keys, age identity, R2 secrets or existing DNS records.
- Automatic provider DNS writes remain zone-ID validated, additive, conflict-refusing and without deletes/overwrites.
- Manual import is an operator-owned action at a different Cloudflare account; this plan never obtains its token or logs sensitive credentials.
- Signing service/outbound SMTP are **not** delivered by this plan; ReadBox remains inbound-only.
- Freeze new implementation phase against actual current Primary HEAD again and stop for user approval if changed.

## Documentation-only boundary
The plan branch may add **only** `notes/domain-manual/{README,000,001,002,003,004,005,006,007}*.md`. No actual code patch, CI/deployment, production runtime action, source/mirror push to main, tag or release is authorized here.
