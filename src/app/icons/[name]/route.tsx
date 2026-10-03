import { appIcon } from "@/lib/app-icon";

/**
 * PNG icons for the web app manifest (Android "Install app" needs PNGs).
 *   /icons/192  /icons/512  /icons/maskable-512
 */
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const maskable = name.startsWith("maskable-");
  const size = Number(name.replace("maskable-", "").replace(/\.png$/, ""));
  if (![192, 512].includes(size)) return new Response("not found", { status: 404 });
  const res = appIcon(size, { maskable });
  res.headers.set("Cache-Control", "public, max-age=604800, immutable");
  return res;
}
