import { NextRequest, NextResponse } from "next/server";
import { crossSiteRejection, targetRejection } from "@/lib/proxy-guard";

export const runtime = "nodejs";

/**
 * Pass-through to a DICOMweb server (QIDO-RS study/series/instance queries
 * and WADO-RS rendered images). Imaging facilities and PACS systems expose
 * this standard; Orthanc, dcm4chee, Google Healthcare API, and most vendor
 * neutral archives all speak it. Binary responses (rendered JPEG/PNG) are
 * streamed through unchanged.
 */
export async function GET(req: NextRequest) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const sp = req.nextUrl.searchParams;
  const base = sp.get("base");
  const path = sp.get("path") ?? "";
  const accept = sp.get("accept") ?? "application/dicom+json, application/json;q=0.9";
  if (!base) return NextResponse.json({ error: "base required" }, { status: 400 });

  let target: URL;
  try {
    target = new URL(`${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  const bad = targetRejection(target);
  if (bad) return bad;
  // forward any extra query params (limit, offset, includefield, etc.)
  sp.forEach((v, k) => {
    if (!["base", "path", "accept"].includes(k)) target.searchParams.append(k, v);
  });

  const headers: Record<string, string> = { Accept: accept };
  const auth = req.headers.get("authorization");
  if (auth) headers["Authorization"] = auth;

  try {
    const upstream = await fetch(target, { headers, cache: "no-store", redirect: "follow" });
    const ctype = upstream.headers.get("content-type") ?? "application/octet-stream";
    if (ctype.startsWith("image/") || ctype.includes("octet-stream") || ctype.includes("multipart")) {
      const buf = await upstream.arrayBuffer();
      return new NextResponse(buf, {
        status: upstream.status,
        headers: { "Content-Type": ctype, "Cache-Control": "private, max-age=3600" },
      });
    }
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "Content-Type": ctype, "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json({ error: `Upstream fetch failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
