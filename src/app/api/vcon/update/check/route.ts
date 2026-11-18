import { getAuthorizedAdminUser } from "@/core/auth/route-guards";
import { checkLatestRelease } from "@/core/updates/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await getAuthorizedAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await checkLatestRelease();
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: result.code,
        error: result.error,
      },
      {
        status: result.status,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      latest_version: result.latest_version,
      mode: result.mode,
      target_sha: result.target_sha,
      current_sha: result.current_sha,
      release_notes: result.release_notes,
      archive_url: result.archive_url,
      checksum_url: result.checksum_url,
      published_at: result.published_at,
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
