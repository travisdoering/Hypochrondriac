import { NextRequest, NextResponse } from "next/server";
import { searchProviders } from "@/lib/nppes";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const result = await searchProviders({
      specialty: sp.get("specialty") ?? undefined,
      postal_code: sp.get("postal_code") ?? undefined,
      city: sp.get("city") ?? undefined,
      state: sp.get("state") ?? undefined,
      first_name: sp.get("first_name") ?? undefined,
      last_name: sp.get("last_name") ?? undefined,
      organization_name: sp.get("organization_name") ?? undefined,
      organization: sp.get("organization") === "true",
      limit: sp.get("limit") ? Number(sp.get("limit")) : 12,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
