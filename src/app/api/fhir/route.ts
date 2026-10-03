import { NextRequest, NextResponse } from "next/server";
import { crossSiteRejection, targetRejection } from "@/lib/proxy-guard";

export const runtime = "nodejs";

/**
 * CORS-free pass-through to a FHIR R4 server (patient-access API, sandbox,
 * or SMART token endpoint). The browser owns the access token and sends it
 * as a normal Authorization header; this route forwards it and nothing is
 * stored. Only https targets are allowed (plus http://localhost for local
 * HAPI/Orthanc installs).
 */
export async function GET(req: NextRequest) {
  return proxy(req);
}
export async function POST(req: NextRequest) {
  return proxy(req);
}

async function proxy(req: NextRequest) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const sp = req.nextUrl.searchParams;
  const base = sp.get("base");
  const path = sp.get("path") ?? "";
  if (!base) return NextResponse.json({ error: "base required" }, { status: 400 });
  let target: URL;
  try {
    target = new URL(path.startsWith("http") ? path : `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  const bad = targetRejection(target);
  if (bad) return bad;

  const headers: Record<string, string> = {
    Accept: req.headers.get("x-accept") ?? "application/fhir+json, application/json;q=0.9",
  };
  const auth = req.headers.get("authorization");
  if (auth) headers["Authorization"] = auth;
  const ct = req.headers.get("content-type");
  if (ct) headers["Content-Type"] = ct;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === "POST" ? await req.text() : undefined,
      cache: "no-store",
      redirect: "follow",
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: `Upstream fetch failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
