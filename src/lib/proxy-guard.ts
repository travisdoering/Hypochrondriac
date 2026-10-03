import { NextResponse, type NextRequest } from "next/server";

/**
 * Guards for the FHIR / DICOMweb pass-through proxies so a deployed copy of
 * the app can't be used as an open proxy by other websites or to reach
 * private network addresses.
 */

const DEV = process.env.NODE_ENV === "development";

/** Reject browser requests that come from another site. Non-browser clients (no headers) pass. */
export function crossSiteRejection(req: NextRequest): NextResponse | null {
  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site") return NextResponse.json({ error: "cross-site requests are not allowed" }, { status: 403 });
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const o = new URL(origin);
      const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
      if (host && o.host !== host) return NextResponse.json({ error: "cross-origin requests are not allowed" }, { status: 403 });
    } catch {
      return NextResponse.json({ error: "bad origin" }, { status: 403 });
    }
  }
  return null;
}

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

export function isPrivateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (h === "metadata.google.internal" || h === "169.254.169.254") return true;
  if (PRIVATE_V4.some((r) => r.test(h))) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  return false;
}

/**
 * Validate an outbound target. https only; plain http and private addresses
 * are allowed only while running the dev server (for a local Orthanc/HAPI).
 */
export function targetRejection(target: URL): NextResponse | null {
  const localDev = DEV && /^(localhost|127\.0\.0\.1)$/.test(target.hostname);
  if (target.protocol !== "https:" && !(target.protocol === "http:" && localDev)) {
    return NextResponse.json({ error: DEV ? "only https (or http://localhost) targets allowed" : "only https targets allowed" }, { status: 400 });
  }
  if (!localDev && isPrivateHost(target.hostname)) {
    return NextResponse.json({ error: "private network addresses are not allowed" }, { status: 400 });
  }
  if (target.username || target.password) return NextResponse.json({ error: "credentials in URL not allowed" }, { status: 400 });
  return null;
}
