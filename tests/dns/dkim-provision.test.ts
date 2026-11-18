import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { buildExpectedDnsRecords, buildCloudflareZoneFile } from "../../src/core/dns/records";
import test from "node:test";
import {
  DkimProvisionError,
  publishDkimCloudflare,
  validateDkimRsaRecord,
} from "../../src/core/dns/dkim-provision";

const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = publicKey.export({ type: "pkcs1", format: "der" }).toString("base64");
const record = "v=DKIM1; k=rsa; p=" + key;
const zoneId = "a".repeat(32);
const zoneName = "example.test";
const domain = "sub.example.test";
const fqdn = "mail._domainkey." + domain;

function response(result: unknown) {
  return new Response(JSON.stringify({ success: true, result }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}

test("DKIM-01 requires real RSA-2048 DER public key; never accepts fake TXT", () => {
  assert.doesNotThrow(() => validateDkimRsaRecord(record));
  assert.throws(() => validateDkimRsaRecord("v=DKIM1; k=rsa; p=FAKE==="),
    (error) => error instanceof DkimProvisionError && error.code === "INVALID_PUBLIC_KEY");
  const weak = generateKeyPairSync("rsa", { modulusLength: 1024 });
  assert.throws(() => validateDkimRsaRecord("v=DKIM1; k=rsa; p=" +
    weak.publicKey.export({ type: "pkcs1", format: "der" }).toString("base64")));
});

test("DKIM-01 missing zone-scoped token returns manual-only, zero network calls", async () => {
  let calls = 0;
  const out = await publishDkimCloudflare(domain, record, {
    token: "", zoneId: "", zoneName: "",
    fetchImpl: (async () => { calls++; throw new Error("unexpected outbound"); }) as typeof fetch,
  });
  assert.equal(out.status, "manual");
  assert.equal(calls, 0);
});

test("DKIM-01 only creates one exact DKIM TXT record in approved Cloudflare zone", async () => {
  const calls: { url: string; method: string; body: string | null }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET",
      body: (init?.body as string) ?? null });
    if (calls.length === 1) return response({ name: zoneName });
    if (calls.length === 2) return response([]);
    return response({ id: "new-id" });
  }) as typeof fetch;
  const out = await publishDkimCloudflare(domain, record, {
    token: "test-secret", zoneId, zoneName, fetchImpl,
  });
  assert.equal(out.status, "created");
  assert.equal(calls.length, 3);
  assert.equal(calls[2].method, "POST");
  const payload = JSON.parse(calls[2].body!);
  assert.deepEqual(payload, { type: "TXT", name: fqdn, content: record, ttl: 300 });
  assert.ok(calls.every((c) => c.url.startsWith(
    "https://api.cloudflare.com/client/v4/zones/" + zoneId)));
});

test("DKIM-01 identical existing record is idempotent, no POST", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return calls === 1 ? response({ name: zoneName }) :
      response([{ type: "TXT", name: fqdn, content: record }]);
  }) as typeof fetch;
  const result = await publishDkimCloudflare(domain, record, {
    token: "test", zoneId, zoneName, fetchImpl,
  });
  assert.equal(result.status, "existing");
  assert.equal(calls, 2);
});

test("DKIM-01 conflicts and wrong-zone cases refuse mutations", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(init?.method ?? "GET");
    return calls.length === 1 ? response({ name: zoneName }) :
      response([{ type: "TXT", name: fqdn, content: "v=DKIM1; p=OTHER" }]);
  }) as typeof fetch;
  await assert.rejects(publishDkimCloudflare(domain, record,
    { token: "test", zoneId, zoneName, fetchImpl }),
    (error) => error instanceof DkimProvisionError && error.code === "CLOUDFLARE_RECORD_CONFLICT");
  assert.deepEqual(calls, ["GET", "GET"]);
  await assert.rejects(publishDkimCloudflare("other.test", record,
    { token: "test", zoneId, zoneName, fetchImpl }),
    (error) => error instanceof DkimProvisionError && error.code === "DOMAIN_OUTSIDE_CONFIGURED_ZONE");
  assert.deepEqual(calls, ["GET", "GET"]);
});

test("DKIM-01 Cloudflare BIND zone export splits 2048-bit RSA TXT to legal segments", () => {
  const records = buildExpectedDnsRecords(domain, {
    mailHostname: "mail." + domain,
    serverIp: "203.0.113.22",
    dkim: { copyable: true, value: record },
  });
  const zone = buildCloudflareZoneFile(domain, records);
  const txtLine = zone.split("\n").find((line) =>
    line.includes("mail._domainkey.") && line.includes("\tIN\tTXT\t("));
  assert.ok(txtLine);
  const parts = Array.from(txtLine.matchAll(/"([^"]+)"/g), (m) => m[1]);
  assert.ok(parts.length >= 2);
  assert.ok(parts.every((part) => Buffer.byteLength(part) <= 255));
  assert.equal(parts.join(""), record);
});
