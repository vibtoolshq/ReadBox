import { env } from "@/config/env";
import { getAuthorizedAdminUser } from "@/core/auth/route-guards";
import { getPrismaClient } from "@/core/database/client";
import { getDomainByUuid } from "@/core/domains/service";
import {
  DkimProvisionError,
  getDkimStatus,
  provisionDkimForDomain,
} from "@/core/dns/dkim-provision";
import { isValidUuid } from "@/core/mailboxes/validators";
import { NextRequest, NextResponse } from "next/server";

async function authorizedDomain(uuid: string) {
  const user = await getAuthorizedAdminUser();
  if (!user || !isValidUuid(uuid) || !env.databaseUrl) return null;
  return getDomainByUuid(getPrismaClient(), uuid);
}

const noStore = { "Cache-Control": "no-store" };

export async function GET(
  _request: NextRequest,
  context: { readonly params: Promise<{ uuid: string }> },
) {
  const { uuid } = await context.params;
  const domain = await authorizedDomain(uuid);
  if (!domain) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const status = await getDkimStatus(domain.name, env.opendkimKeysRoot);
    return NextResponse.json(status, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "DKIM status is unavailable." },
      { status: 503, headers: noStore });
  }
}

export async function POST(
  request: NextRequest,
  context: { readonly params: Promise<{ uuid: string }> },
) {
  const { uuid } = await context.params;
  const domain = await authorizedDomain(uuid);
  if (!domain) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin ||
      request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Cross-origin DKIM changes are refused." },
      { status: 403, headers: noStore });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "Expected JSON request." },
      { status: 415, headers: noStore });
  }
  let data: unknown;
  try { data = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      Object.keys(data).some((key) => key !== "publish") ||
      typeof (data as { publish?: unknown }).publish !== "boolean") {
    return NextResponse.json({ error: "Invalid DKIM operation." },
      { status: 400, headers: noStore });
  }
  try {
    const result = await provisionDkimForDomain(
      domain.name, env.opendkimKeysRoot,
      (data as { publish: boolean }).publish,
    );
    return NextResponse.json({ ok: true, ...result }, { headers: noStore });
  } catch (error) {
    const code = error instanceof DkimProvisionError ? error.code : "DKIM_UNAVAILABLE";
    // Fail closed, surface sanitized code; never return keys, tokens or file paths.
    return NextResponse.json({ ok: false, code },
      { status: code.includes("CONFLICT") ? 409 : 503, headers: noStore });
  }
}
