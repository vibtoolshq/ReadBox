import { readOpenDkimRecord } from "@/core/dns/opendkim";
import { createNodeDnsLookup } from "@/core/dns/resolver";
import { validateDomain } from "@/core/mailboxes/validators";
import { createHmac, createPublicKey, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import "server-only";

const SOCK = "/run/readbox-dkim/agent.sock";
const TOKEN = "/run/readbox-dkim/access.token";
const API = "https://api.cloudflare.com/client/v4";
const KEY_PATTERN = /^v=DKIM1; k=rsa; p=([A-Za-z0-9+/=]+)$/;

export class DkimProvisionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "DkimProvisionError";
  }
}

export interface DkimStatus {
  readonly key: "ready" | "missing" | "invalid";
  readonly dns: "verified" | "missing" | "unavailable";
  readonly publishing: "configured" | "manual";
  readonly signing: "inactive";
  readonly record: string | null;
  readonly host: string;
}

export interface PublishResult {
  readonly status: "created" | "existing" | "manual";
}

export function validateDkimRsaRecord(record: string): void {
  const match = KEY_PATTERN.exec(record);
  if (!match) throw new DkimProvisionError("INVALID_PUBLIC_KEY");
  try {
    const der = Buffer.from(match[1], "base64");
    if (der.length < 200 || der.toString("base64") !== match[1]) {
      throw new Error("Bad DER");
    }
    const key = createPublicKey({ key: der, format: "der", type: "pkcs1" });
    if (key.asymmetricKeyType !== "rsa" ||
        (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
      throw new Error("Weak RSA");
    }
  } catch {
    throw new DkimProvisionError("INVALID_PUBLIC_KEY");
  }
}

export async function requestDkimProvision(domainInput: string): Promise<"created" | "existing"> {
  const domain = validateDomain(domainInput);
  let token: string;
  try {
    token = (await readFile(TOKEN, "utf8")).trim();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Bad token");
  } catch {
    throw new DkimProvisionError("DKIM_AGENT_NOT_INSTALLED");
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", Buffer.from(token, "hex"))
    .update(String(timestamp) + "." + nonce + "." + domain).digest("hex");
  const body = JSON.stringify({
    action: "provision", domain, timestamp, nonce, signature,
  }) + "\n";
  const response = await new Promise<string>((resolve, reject) => {
    let result = "";
    const client = createConnection({ path: SOCK });
    client.setTimeout(9000);
    client.on("connect", () => client.write(body));
    client.on("data", (chunk: Buffer) => {
      result += chunk.toString("utf8");
      if (result.length > 4096) {
        client.destroy(new Error("DKIM_AGENT_RESPONSE_TOO_LARGE"));
      } else if (result.includes("\n")) {
        client.end();
        resolve(result.trim());
      }
    });
    client.on("error", reject);
    client.on("timeout", () => client.destroy(new Error("DKIM_AGENT_TIMEOUT")));
    client.on("close", () => {
      if (!result.includes("\n")) reject(new Error("DKIM_AGENT_DISCONNECTED"));
    });
  }).catch(() => {
    throw new DkimProvisionError("DKIM_AGENT_UNAVAILABLE");
  });
  let parsed: unknown;
  try { parsed = JSON.parse(response); } catch {
    throw new DkimProvisionError("DKIM_AGENT_INVALID_REPLY");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new DkimProvisionError("DKIM_AGENT_INVALID_REPLY");
  }
  const data = parsed as { ok?: boolean; state?: string; code?: string };
  if (!data.ok) {
    const allowed = ["INVALID_DOMAIN", "PUBLIC_WITHOUT_PRIVATE",
      "PUBLIC_KEY_CONFLICT", "INVALID_PUBLIC_RECORD", "INVALID_PRIVATE_KEY",
      "UNSAFE_PATH", "UNSAFE_DIRECTORY", "KEY_OPERATION_FAILED"];
    throw new DkimProvisionError(allowed.includes(data.code ?? "") ?
      data.code! : "DKIM_AGENT_REFUSED");
  }
  if (data.state !== "existing" && data.state !== "created") {
    throw new DkimProvisionError("DKIM_AGENT_INVALID_REPLY");
  }
  return data.state;
}

interface CloudflareOptions {
  readonly token?: string;
  readonly zoneId?: string;
  readonly zoneName?: string;
  readonly fetchImpl?: typeof fetch;
}

function config(options: CloudflareOptions) {
  const token = options.token ?? process.env.READBOX_CF_DNS_TOKEN ?? "";
  const zoneId = options.zoneId ?? process.env.READBOX_CF_DNS_ZONE_ID ?? "";
  const zoneName = options.zoneName ?? process.env.READBOX_CF_DNS_ZONE_NAME ?? "";
  if (!token || !zoneId || !zoneName) return null;
  if (!/^[a-f0-9]{32}$/i.test(zoneId) ||
      !/^[a-z0-9.-]{3,253}$/.test(zoneName)) {
    throw new DkimProvisionError("INVALID_CLOUDFLARE_CONFIGURATION");
  }
  return { token, zoneId, zoneName: validateDomain(zoneName) };
}

export async function publishDkimCloudflare(
  domainInput: string,
  record: string,
  options: CloudflareOptions = {},
): Promise<PublishResult> {
  const domain = validateDomain(domainInput);
  validateDkimRsaRecord(record);
  const settings = config(options);
  if (!settings) return { status: "manual" };
  if (domain !== settings.zoneName &&
      !domain.endsWith("." + settings.zoneName)) {
    throw new DkimProvisionError("DOMAIN_OUTSIDE_CONFIGURED_ZONE");
  }
  const { token, zoneId, zoneName } = settings;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  async function request(path: string, method: "GET" | "POST", body?: string) {
    let response: Response;
    try {
      response = await fetchImpl(API + "/zones/" + zoneId + path, {
        method, headers, ...(body ? { body } : {}),
        signal: AbortSignal.timeout(8000), cache: "no-store",
      });
    } catch {
      throw new DkimProvisionError("CLOUDFLARE_UNAVAILABLE");
    }
    if (!response.ok) throw new DkimProvisionError("CLOUDFLARE_REQUEST_FAILED");
    const data = (await response.json()) as {
      success?: boolean; result?: unknown; result_info?: { total_count?: number };
    };
    if (!data?.success) throw new DkimProvisionError("CLOUDFLARE_REQUEST_FAILED");
    return data;
  }
  const zone = await request("", "GET");
  const actualZone = zone.result as { name?: string } | null;
  if (actualZone?.name !== zoneName) {
    throw new DkimProvisionError("CLOUDFLARE_ZONE_MISMATCH");
  }
  const fqdn = "mail._domainkey." + domain;
  const list = await request(
    "/dns_records?type=TXT&name=" + encodeURIComponent(fqdn) + "&per_page=100", "GET");
  const records = list.result;
  if (!Array.isArray(records) || (list.result_info?.total_count ?? records.length) > 100) {
    throw new DkimProvisionError("CLOUDFLARE_RECORD_CONFLICT");
  }
  if (records.length > 0) {
    if (records.length === 1 &&
        records[0]?.type === "TXT" && records[0]?.name === fqdn &&
        records[0]?.content === record) return { status: "existing" };
    throw new DkimProvisionError("CLOUDFLARE_RECORD_CONFLICT");
  }
  await request("/dns_records", "POST", JSON.stringify({
    type: "TXT", name: fqdn, content: record, ttl: 300,
  }));
  return { status: "created" };
}

export async function getDkimStatus(domainInput: string, keysRoot: string): Promise<DkimStatus> {
  const domain = validateDomain(domainInput);
  const record = await readOpenDkimRecord(domain, keysRoot);
  const host = "mail._domainkey." + domain;
  let key: DkimStatus["key"] = record.available ? "ready" : "missing";
  if (record.available) {
    try { validateDkimRsaRecord(record.value); } catch { key = "invalid"; }
  }
  let dns: DkimStatus["dns"] = "missing";
  if (key === "ready") {
    try {
      const actual = await createNodeDnsLookup(3).resolve(host, "TXT");
      dns = actual.includes(record.value) ? "verified" : "missing";
    } catch {
      dns = "unavailable";
    }
  }
  return {
    key,
    dns, publishing: config({}) ? "configured" : "manual",
    signing: "inactive",
    record: record.available ? record.value : null,
    host,
  };
}

export async function provisionDkimForDomain(
  domainInput: string, keysRoot: string, publish: boolean,
): Promise<{ provision: "created" | "existing"; dns: PublishResult["status"] }> {
  const domain = validateDomain(domainInput);
  const provision = await requestDkimProvision(domain);
  const record = await readOpenDkimRecord(domain, keysRoot);
  if (!record.available) throw new DkimProvisionError("PUBLIC_RECORD_UNAVAILABLE");
  validateDkimRsaRecord(record.value);
  const dns = publish ?
    (await publishDkimCloudflare(domain, record.value)).status : "manual";
  return { provision, dns };
}
