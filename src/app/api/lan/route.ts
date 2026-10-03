import { NextResponse } from "next/server";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dev-only helper: the computer's addresses on the local network, so the
 * "Open on your phone" QR code can point at http://192.168.x.x:PORT instead
 * of localhost. Virtual adapters (WSL, Hyper-V, Docker, VPN) are skipped.
 */
export async function GET(req: Request) {
  // Only useful (and only answered) when the app is being run on this computer.
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (process.env.NODE_ENV !== "development" && !local) return NextResponse.json({ addresses: [] });
  const skip = /vethernet|wsl|hyper-v|virtual|vmware|vbox|docker|loopback|bluetooth|tailscale|zerotier|utun|tun|tap/i;
  const out: { name: string; address: string }[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (skip.test(name)) continue;
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      if (a.address.startsWith("169.254.")) continue; // link-local, no DHCP
      out.push({ name, address: a.address });
    }
  }
  // Prefer typical home/office ranges first.
  out.sort((a, b) => rank(a.address) - rank(b.address));
  return NextResponse.json({ addresses: out });
}

function rank(ip: string) {
  if (ip.startsWith("192.168.")) return 0;
  if (ip.startsWith("10.")) return 1;
  return 2;
}
