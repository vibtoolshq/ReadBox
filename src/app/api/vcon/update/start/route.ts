import { getAuthorizedAdminUser } from "@/core/auth/route-guards";
import { queueUpdateRequest } from "@/core/updates/service";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const admin = await getAuthorizedAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: { archive_url?: unknown; checksum_url?: unknown; target_sha?: unknown } = {};
  try {
    body = (await request.json()) as {
      archive_url?: unknown;
      checksum_url?: unknown;
      target_sha?: unknown;
    };
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rawActorId = admin.id as bigint | string | null | undefined;
  let actorId: bigint | null = null;
  if (typeof rawActorId === "bigint") {
    actorId = rawActorId;
  } else if (typeof rawActorId === "string" && /^\d+$/.test(rawActorId)) {
    try {
      actorId = BigInt(rawActorId);
    } catch {
      actorId = null;
    }
  }

  const result = await queueUpdateRequest(
    {
      archiveUrl: body.archive_url,
      checksumUrl: body.checksum_url,
      targetSha: body.target_sha,
    },
    {
      actorId,
      authSource: admin.authSource,
      actorUsername: admin.username,
      headers: request.headers,
    },
  );

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        code: result.code,
        ...(result.preflight ? { preflight: result.preflight } : {}),
      },
      {
        status: result.status,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  return NextResponse.json(result.payload, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
