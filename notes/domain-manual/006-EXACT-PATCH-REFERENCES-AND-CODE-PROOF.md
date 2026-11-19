# 006 — Exact Path, 1-Based Line and Source Proof (PROPOSED patch only)
**Read directly from frozen Primary source SHA:** `6f3bc1e3aeb441956e1fd0f4d81558a6aba2945f`. These are excerpts of existing source unless marked **PROPOSAL**. No snippet in this document is applied.

## PROOF A — Existing default/automatic-only zone gate
File: `src/components/vcon/domain-form.tsx:133–138, 275–303`
```tsx
const [dnsConfirmed, setDnsConfirmed] = useState(false);
const [autoDkim, setAutoDkim] = useState(true);
const [dkimPublish, setDkimPublish] = useState(true);

// handleSubmit / isCreate:
if (!dnsConfirmed && !autoDkim) {
  const msg = "Confirm that all DNS records have been reviewed before saving the domain.";
}
if (autoDkim && !zoneId) {
  const msg = "Select a Cloudflare zone before automatic setup.";
}
const result = await onCreate(autoDkim
  ? { name, dnsConfirmed: true, autoDkim: true, zoneId }
  : { name, dnsConfirmed });
```
**Fact:** Manual opt-out already exists. The user-requested checkbox must map to that existing manual path, not bypass authorization.

## PROOF B — Form zone panel and existing manual option
File: `src/components/vcon/domain-form.tsx:629–660, 694–737`
```tsx
{(isCreate ? autoDkim : dkimPublish) ? (
  <Panel data-testid="cloudflare-zone-panel">
    // Select an active Cloudflare zone...
  </Panel>
) : null}
// Create form already renders Checkbox id="domain-dkim-auto":
// "Automatic setup: DKIM key, encrypted R2 escrow, Cloudflare DNS ..."
// Manual DNS-review checkbox exists when !autoDkim.
```
**MD-01 PROPOSED** minimal wiring (illustrative, not final diff):
```tsx
const [manualMode, setManualMode] = useState(false);
const automaticMode = !manualMode && autoDkim;
// Place "Manual Mode — another Cloudflare account" next to zone selector.
// When manualMode: no zone requirement; require dnsConfirmed;
// submit original manual payload; keep existing zone binding immutable.
// When !manualMode: preserve existing auto default and zone ID validation.
```
Implementation must avoid contradictory checkbox states and retain tests.

## PROOF C — Server action today only performs automatic orchestration
File: `src/app/(workspace)/vcon/domains/actions.ts:41–119`
```tsx
if (input.autoDkim === true) {
  const zone = await resolveSelectedCloudflareZone(input.name, input.zoneId ?? "");
  zoneBinding = { id: zone.id, name: zone.name };
}
// createDomain persists new disabled row
if (result.ok) {
  if (input.autoDkim === true) {
    const setup = await automateDomainSetup(result.data.name, {
      publish: true,
      zoneId: zoneBinding!.id,
      opendkimKeysRoot: env.opendkimKeysRoot,
      mailHostname: env.mailHostname,
      serverIp: env.serverIp,
    });
  }
}
```
**MD-02 PROPOSAL:** Add a narrow server-validated `manualDkim` intent; reject manual + auto combination and manual + nonempty `zoneId`; after successful disabled domain create, call existing `automateDomainSetup(name, { publish:false, ... })`. On escrow refusal return disabled saved-domain error and point to existing `Provision / Repair DKIM`; do not promise public key until receipt. No new privileged endpoint.

## PROOF D — Reuse escrow-only path rather than rotating keys
File: `src/core/dns/domain-automation.ts:39–68`
```ts
const zone = settings.publish ?
  await resolveSelectedCloudflareZone(domain, settings.zoneId ?? "") : null;
try {
  await requestDkimProvision(domain);
} catch (error) {
  if (!(error instanceof DkimProvisionError && error.code === "ESCROW_REQUIRED")) {
    throw error;
  }
}
const receipt = await callBackupAgent("dkim.escrow", { domain });
// ... verified/verified_existing receipt required ...
const provision = await requestDkimProvision(domain);
const publicRecord = await readOpenDkimRecord(domain, settings.opendkimKeysRoot);
if (!zone) return { provision, dns: "manual" };
```
**Fact:** Existing escrow-only contract needs no Cloudflare zone or token, but still requires R2 encryption/receipt. Never relax this safety gate.

## PROOF E — Shared host is outside target zone but exporter writes it anyway
File: `src/core/dns/records.ts:60–77, 118–165`
```ts
return [
  { type: "MX", host: domain, cfHost: "@", value: mailHostname,
    category: "routing", priority: "10", copyable: true },
  { type: addressType, host: mailHostname, cfHost: mailSubdomainHost,
    value: serverIp, category: "routing", priority: "-", copyable: true },
  // SPF / DKIM / DMARC ...
];
// buildCloudflareZoneFile:
for (const record of records) {
  const hostFqdn = ensureFqdn(record.host);
  if (record.type === "A" || record.type === "AAAA") {
    lines.push(hostFqdn + "\t300\tIN\t" + record.type + "\t" + cleanValue);
    continue;
  }
}
```
With input domain `mailiq.shop` and shared host `mail.anyinbox.cc`, export contains a record owned by a different authoritative DNS zone. **MD-02 PROPOSED** export-only guard:
```ts
const inZone = record.host === domain ||
  record.host.endsWith("." + domain);
if ((record.type === "A" || record.type === "AAAA") && !inZone) {
  // External shared mail-host is configured in its own authoritative zone.
  continue;
}
```
Do NOT remove shared A/AAAA from `buildExpectedDnsRecords` or its public routing verifier.

## PROOF F — Export and DKIM placeholder
`src/components/vcon/dns-records-panel.tsx:38–58` invokes `buildCloudflareZoneFile(domainName, records)` for Download. `src/core/dns/records.ts:24–28, 53–58, 145–161` uses `DKIM public key is not provisioned for this domain.` before escrow and comments uncopyable TXT on export. **MD-02 PROPOSED:** make missing public DKIM status conspicuous and prevent claiming a complete zone export until escrow provision has succeeded. Keep RFC-compliant segmented DKIM TXT, preserving the 240-character chunking.

## PROOF G — Authorization and activation must remain
- `src/app/api/vcon/domains/[uuid]/dkim/route.ts:62–102`: admin, Origin, JSON and explicit `publish`. Manual `publish:false` requires no `zoneId` and uses existing verified escrow code.
- `src/core/domains/service.ts:397–407, 634–648`: no active domain without persisted verified routing.
- `src/core/dns/cloudflare-auto.ts:157–213, 267–295`: idempotent non-overwrite/strict zone ID; untouched by this plan.
- `.github/workflows/domain-auto01-ci.yml`: existing CI has fixed historical diff baseline/required paths, so new **MD-only disposable CI** is needed; do not weaken old audit contracts.

## Exact proposed test references
- Existing: `tests/ui/domain-zone-selection.test.tsx`; `tests/dns/domain-automation.test.ts`, `tests/dns/domain-zone-selection.test.ts`, `tests/dns/r03-advisory-contract.test.ts`; `tests/admin/phase3-domains-mailboxes.test.ts`.
- New (MD-01): `tests/ui/domain-manual-mode.test.tsx`, `.github/workflows/domain-manual-ci.yml`.
- No exact source line number may be asserted against a future SHA without checking again. This file's line anchors refer ONLY to frozen source SHA.
