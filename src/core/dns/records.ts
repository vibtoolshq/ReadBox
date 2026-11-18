export type DnsRecordCategory = "routing" | "deliverability";
export type DnsRecordType = "MX" | "A" | "AAAA" | "TXT";

export interface ExpectedDnsRecord {
  readonly type: DnsRecordType;
  readonly category: DnsRecordCategory;
  readonly host: string;
  readonly cfHost: string;
  readonly value: string;
  readonly priority: string;
  readonly copyable: boolean;
}

export interface DnsRecordsConfig {
  readonly mailHostname: string;
  readonly serverIp: string;
  readonly dkim?: {
    readonly copyable: boolean;
    readonly value: string;
  };
}

const DEFAULT_UNAVAILABLE_DKIM =
  "DKIM public key is not provisioned for this domain.";

function normalizeDnsHost(value: string): string {
  return value.trim().replace(/\.+$/, "").toLowerCase();
}

function resolveCloudflareMailSubdomainHost(
  domain: string,
  mailHostname: string,
): string {
  if (mailHostname === domain) {
    return "@";
  }
  const suffix = `.${domain}`;
  if (mailHostname.endsWith(suffix)) {
    const relative = mailHostname.slice(0, -suffix.length);
    if (relative) return relative;
  }
  return mailHostname.split(".")[0] || "mail";
}

export function buildExpectedDnsRecords(
  rawDomain: string,
  config: DnsRecordsConfig,
): readonly ExpectedDnsRecord[] {
  const domain = normalizeDnsHost(rawDomain);
  const mailHostname = normalizeDnsHost(config.mailHostname);
  const serverIp = config.serverIp.trim();
  const addressType: "A" | "AAAA" = serverIp.includes(":") ? "AAAA" : "A";
  const mailSubdomainHost = resolveCloudflareMailSubdomainHost(
    domain,
    mailHostname,
  );
  const dkimValue = config.dkim?.value || DEFAULT_UNAVAILABLE_DKIM;
  const dkimCopyable = config.dkim?.copyable === true;

  return [
    {
      type: "MX",
      category: "routing",
      host: domain,
      cfHost: "@",
      value: mailHostname,
      priority: "10",
      copyable: true,
    },
    {
      type: addressType,
      category: "routing",
      host: mailHostname,
      cfHost: mailSubdomainHost,
      value: serverIp,
      priority: "-",
      copyable: true,
    },
    {
      type: "TXT",
      category: "deliverability",
      host: domain,
      cfHost: "@",
      value: `v=spf1 a:${mailHostname} -all`,
      priority: "-",
      copyable: true,
    },
    {
      type: "TXT",
      category: "deliverability",
      host: `mail._domainkey.${domain}`,
      cfHost: "mail._domainkey",
      value: dkimValue,
      priority: "-",
      copyable: dkimCopyable,
    },
    {
      type: "TXT",
      category: "deliverability",
      host: `_dmarc.${domain}`,
      cfHost: "_dmarc",
      value: `v=DMARC1; p=none; rua=mailto:postmaster@${domain}`,
      priority: "-",
      copyable: true,
    },
  ];
}

function sanitizeZoneToken(value: string): string {
  return value.replace(/[\r\n]/g, "").trim();
}

function ensureFqdn(host: string): string {
  const clean = sanitizeZoneToken(host).replace(/\.+$/, "");
  return `${clean}.`;
}

export function buildCloudflareZoneFile(
  rawDomain: string,
  records: readonly ExpectedDnsRecord[],
): string {
  const domain = normalizeDnsHost(rawDomain);
  const lines: string[] = [
    `; Cloudflare DNS Zone Export for ${domain}`,
    `$ORIGIN ${domain}.`,
    "$TTL 300",
    "",
  ];

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
      continue;
    }

    // DKIM RSA-2048 TXT must use <=255-octet character-string segments.
    // DNS concatenates these segments to recover the original public key.
    if (record.host.includes("._domainkey.") && cleanValue.startsWith("v=DKIM1;")) {
      const chunks = cleanValue.match(/.{1,240}/g) ?? [];
      lines.push(hostFqdn + "\t300\tIN\tTXT\t( " +
        chunks.map((chunk) => JSON.stringify(chunk)).join(" ") + " )");
      continue;
    }
    const escapedTxt = cleanValue.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    lines.push(`${hostFqdn}\t300\tIN\tTXT\t"${escapedTxt}"`);
  }

  return `${lines.join("\n")}\n`;
}
