# 006 — Exact Path, 1-Based Line and Source Proof (PROPOSED patch only)
**Read directly from frozen Primary source SHA:** `6f3bc1e3aeb441956e1fd0f4d81558a6aba2945f`. These are excerpts of existing source unless marked **PROPOSAL**. No snippet in this document is applied.

## PROOF A — Original default and exact manual/automatic submit branches
File: `src/components/vcon/domain-form.tsx:136–138, 275–303`. Exact frozen code:
```tsx
  const [dnsConfirmed, setDnsConfirmed] = useState(false);
  const [autoDkim, setAutoDkim] = useState(true);
  const [dkimPublish, setDkimPublish] = useState(true);
```

```tsx
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFormError(null);
    setFieldErrors({});

    if (isCreate) {
      if (!dnsConfirmed && !autoDkim) {
        const msg =
          "Confirm that all DNS records have been reviewed before saving the domain.";
        setFieldErrors({ dnsConfirmed: msg });
        setFormError(msg);
        return;
      }
      if (autoDkim && !zoneId) {
        const msg = "Select a Cloudflare zone before automatic setup.";
        setFieldErrors({ zoneId: msg });
        setFormError(msg);
        return;
      }
      if (!onCreate) return;
      setPending(true);
      try {
        const result = await onCreate(autoDkim
          ? { name, dnsConfirmed: true, autoDkim: true, zoneId }
          : { name, dnsConfirmed });
        if (!result.ok) {
          setFormError(result.error);
          if (result.fieldErrors) setFieldErrors(result.fieldErrors);
```

**Proven:** Existing manual path is selected by `!autoDkim`; otherwise `zoneId` is mandatory. The new checkbox maps to this path rather than bypassing review, admin or DNS checks.

## PROOF B — Cloudflare selector and existing checkbox
File: `src/components/vcon/domain-form.tsx:634–643, 730–738`. Verbatim source excerpts:
```tsx
        {(isCreate ? autoDkim : dkimPublish) ? (
          <Panel data-testid="cloudflare-zone-panel">
            <PanelHeader>
              <SectionTitle>Cloudflare zone for this domain</SectionTitle>
            </PanelHeader>
            <PanelBody className="space-y-2 p-4">
              <FormField
                id="domain-cloudflare-zone"
                label="Select an active Cloudflare zone"
                hint="The selected zone is verified by the server and bound to this domain. Existing bindings cannot be silently changed."
```

```tsx
                    verification is required before enabling mail delivery.
                  </Label>
                </div>}
                <div className="flex items-start gap-2">
                  <Checkbox id="domain-dkim-auto" checked={autoDkim}
                    onChange={(event) => setAutoDkim(event.target.checked)} />
                  <Label htmlFor="domain-dkim-auto" className="font-normal">
                    Automatic setup: DKIM key, encrypted R2 escrow, Cloudflare DNS and routing verification (requires scoped Cloudflare token)
                  </Label>
```

**MD-01 PROPOSAL — NOT IMPLEMENTED:** Show the Manual Mode checkbox **inside an always-visible create-mode Cloudflare zone panel**. When manual is ON, hide/disable ONLY the zone selector, not its containing panel or the Manual Mode checkbox. Keep the original automatic checkbox meaning and synchronize it so the form cannot submit conflicting modes. When manual is OFF, original automatic zone validation remains.

Illustrative state logic (not frozen-source proof):
```tsx
const [manualMode, setManualMode] = useState(false);
const automaticMode = !manualMode && autoDkim;
// Keep mode selector panel mounted; never hide the manual checkbox.
// Keep review confirmation mandatory when automaticMode is false.
```

## PROOF C — Current server action only automatically orchestrates selected zone
File: `src/app/(workspace)/vcon/domains/actions.ts:41–69, 79–90`. Verbatim source excerpts:
```tsx
export async function createDomainAction(input: {
  readonly name: string;
  readonly dnsConfirmed: boolean;
  readonly autoDkim?: boolean;
  readonly zoneId?: string;
}): Promise<DomainActionResult<{ uuid: string; name: string }>> {
  const actor = await requireAdminUser();
  if (!env.databaseUrl) {
    return databaseUnavailableResult();
  }

  let zoneBinding: CloudflareZoneChoice | undefined;
  if (input.autoDkim === true) {
    try {
      const zone = await resolveSelectedCloudflareZone(input.name, input.zoneId ?? "");
      zoneBinding = { id: zone.id, name: zone.name };
    } catch (error) {
      const code = domainSetupErrorCode(error);
      return { ok: false, code: "validation", error: code,
        fieldErrors: { zoneId: code } };
    }
  }

  const requestHeaders = await headers();
  const result = await createDomain(
    getPrismaClient() as unknown as DomainPrismaClient,
    { name: input.name, dnsConfirmed: input.dnsConfirmed || input.autoDkim === true,
      ...(zoneBinding ? { cloudflareZone: zoneBinding } : {}) },
    {
```

```tsx
    revalidateDomainPaths(result.data.uuid);
    if (input.autoDkim === true) {
      try {
        const setup = await automateDomainSetup(result.data.name, {
          publish: true,
          zoneId: zoneBinding!.id,
          opendkimKeysRoot: env.opendkimKeysRoot,
          mailHostname: env.mailHostname,
          serverIp: env.serverIp,
        });
        const context = {
          actorId: actor.id,
```

**MD-02 PROPOSAL — NOT IMPLEMENTED:** Add a narrow admin-server-validated `manualDkim` intent. Reject contradictory manual + automatic flags or nonempty manual `zoneId`; after successful disabled-domain creation, reuse `automateDomainSetup(name, { publish:false, ... })`. On escrow failure keep saved domain disabled with guarded existing-domain retry, never report a completed DKIM key. No new privileged endpoint.

## PROOF D — Root-only receipt gate already supports manual publication off
File: `src/core/dns/domain-automation.ts:39–68`. Verbatim source:
```ts
  const zone = settings.publish ?
    await resolveSelectedCloudflareZone(domain, settings.zoneId ?? "") : null;
  try {
    await requestDkimProvision(domain);
  } catch (error) {
    if (!(error instanceof DkimProvisionError && error.code === "ESCROW_REQUIRED")) {
      throw error;
    }
    // Expected on first use: offline agent stages only the private key.
  }
  try {
    const receipt = await callBackupAgent("dkim.escrow", { domain });
    if (!["verified", "verified_existing"].includes(receipt.escrow ?? "")) {
      throw new DomainAutomationError("DKIM_R2_ESCROW_UNVERIFIED");
    }
  } catch (error) {
    if (error instanceof DomainAutomationError) throw error;
    if (error instanceof BackupAgentError) {
      throw new DomainAutomationError(error.code);
    }
    throw new DomainAutomationError("DKIM_R2_ESCROW_UNAVAILABLE");
  }
  // Publication is forbidden by the DKIM agent until the root-only R2
  // readback receipt exists and matches this exact unrotated key.
  const provision = await requestDkimProvision(domain);
  const publicRecord = await readOpenDkimRecord(domain, settings.opendkimKeysRoot);
  if (!publicRecord.available) throw new DomainAutomationError("DKIM_PUBLIC_KEY_UNAVAILABLE");
  validateDkimRsaRecord(publicRecord.value);
  if (!zone) return { provision, dns: "manual" };
  const result = await publishManagedDomainDns(domain, zone, {
```

**Proven:** `publish:false` does not resolve Cloudflare zone, but still needs successful encrypted root-only escrow before public record release. Do not weaken this gate.

## PROOF E — Bug: shared external mail-host included as zone owner
Files: `src/core/dns/records.ts:69–77, 130–148`. Verbatim source excerpts:
```ts
    },
    {
      type: addressType,
      category: "routing",
      host: mailHostname,
      cfHost: mailSubdomainHost,
      value: serverIp,
      priority: "-",
      copyable: true,
```

```ts
  for (const record of records) {
    const cleanValue = sanitizeZoneToken(record.value);
    const hostFqdn = ensureFqdn(record.host);

    if (record.type === "MX") {
      const priority = /^\d+$/.test(record.priority) ? record.priority : "10";
      lines.push(
        `${hostFqdn}\t300\tIN\tMX\t${priority}\t${ensureFqdn(cleanValue)}`,
      );
      continue;
    }

    if (record.type === "A" || record.type === "AAAA") {
      lines.push(`${hostFqdn}\t300\tIN\t${record.type}\t${cleanValue}`);
      continue;
    }

    if (!record.copyable) {
      lines.push(`; ${hostFqdn}\t300\tIN\tTXT\t(${cleanValue})`);
```

When the target zone is `mailiq.shop`, the expected mail server's `mail.anyinbox.cc` A record belongs to another authoritative zone. The current exporter writes that record into the target zone file; import into a different Cloudflare account can fail or be misleading. **Actual cross-account import failure has NOT yet been live observed.**

**MD-02 PROPOSED export-only filter — NOT IMPLEMENTED:**
```ts
const inZone = record.host === domain || record.host.endsWith("." + domain);
if ((record.type === "A" || record.type === "AAAA") && !inZone) {
  // Shared mail-host A/AAAA stays in its own authoritative zone.
  continue;
}
```

Do not remove shared mail-host A/AAAA from the on-screen expected routing records or public DNS routing verifier.

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
