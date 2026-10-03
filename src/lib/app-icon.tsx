import { ImageResponse } from "next/og";

/** Renders the app mark (teal tile + pulse line) as a PNG of the given size. */
export function appIcon(size: number, opts: { maskable?: boolean } = {}) {
  // Maskable icons need ~20% safe padding; Android crops them to a circle/squircle.
  const pad = opts.maskable ? size * 0.2 : 0;
  const inner = size - pad * 2;
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: "#0e7c86" }}>
        <svg width={inner} height={inner} viewBox="0 0 64 64">
          {!opts.maskable && <rect width="64" height="64" rx="14" fill="#0e7c86" />}
          <path d="M10 34h10l5-12 8 24 6-18 4 6h11" fill="none" stroke="#ffffff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="50" cy="16" r="4.5" fill="#ffffff" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
