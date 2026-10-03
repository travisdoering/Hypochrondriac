"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * "Open on your phone": a QR code for the current app. On a deployed site it
 * encodes the site URL. In local dev it swaps localhost for the computer's
 * Wi-Fi address so a phone on the same network can open it.
 */
export function PhoneDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [urls, setUrls] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const [svg, setSvg] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [isLocal, setIsLocal] = useState(false);

  useEffect(() => {
    if (!open) return;
    const { protocol, hostname, port } = window.location;
    const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
    setIsLocal(local);
    if (!local) {
      setUrls([window.location.origin]);
      return;
    }
    fetch("/api/lan")
      .then((r) => r.json())
      .then((d: { addresses: { address: string }[] }) => {
        const list = d.addresses.map((a) => `${protocol}//${a.address}${port ? `:${port}` : ""}`);
        setUrls(list.length ? list : []);
        setSelected(0);
      })
      .catch(() => setUrls([]));
  }, [open]);

  useEffect(() => {
    const url = urls[selected];
    if (!url) {
      setSvg("");
      return;
    }
    QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0f1412", light: "#ffffff" } })
      .then(setSvg)
      .catch(() => setSvg(""));
  }, [urls, selected]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const url = urls[selected];
  const insecure = url?.startsWith("http://");

  return (
    <div className="no-print fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Open on your phone">
      <div className="max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-border bg-surface p-5 text-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Open on your phone</h2>
          <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close">
            ✕
          </button>
        </div>

        {url ? (
          <>
            <p className="text-ink-2">Point your phone&apos;s camera at this code.</p>
            <div className="mx-auto my-3 w-56 rounded-xl border border-border bg-white p-2" dangerouslySetInnerHTML={{ __html: svg }} aria-label={`QR code for ${url}`} role="img" />
            <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5">
              <code className="min-w-0 flex-1 truncate text-xs">{url}</code>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  } catch {
                    /* ignore */
                  }
                }}
                className="shrink-0 rounded border border-border px-2 py-0.5 text-xs hover:bg-surface"
              >
                {copied ? "✓" : "Copy"}
              </button>
            </div>
            {urls.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {urls.map((u, i) => (
                  <button key={u} onClick={() => setSelected(i)} className={`rounded-full border px-2 py-0.5 text-[11px] ${i === selected ? "border-brand bg-brand-soft" : "border-border"}`}>
                    {u.replace(/^https?:\/\//, "")}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-ink-2">
            {isLocal ? "Couldn't find this computer's Wi-Fi address. Make sure it's connected to the same network as your phone." : "Loading..."}
          </p>
        )}

        <div className="mt-4 space-y-2 text-xs text-ink-2">
          <p>
            <strong className="text-ink">Install it like an app:</strong> on iPhone tap Share → <em>Add to Home Screen</em>. On Android tap ⋮ → <em>Install app</em>.
          </p>
          {isLocal && (
            <p>
              <strong className="text-ink">Same Wi-Fi only.</strong> Your phone must be on the same network as this computer. If it won&apos;t load, allow Node.js through Windows Firewall for private networks.
            </p>
          )}
          {insecure && (
            <p className="rounded-lg border border-[var(--warning)]/60 bg-[var(--warning)]/10 p-2">
              Phones only allow the camera and microphone on secure (https) pages. Over plain Wi-Fi you can chat, read reports and use the record. For voice and camera on your phone, run <code>npm run dev:phone</code> (https) or use a deployed copy.
            </p>
          )}
          <p>Your record lives in each browser separately: your phone starts with an empty record. Use Connections → Backup on one device and Import on the other to move it.</p>
        </div>
      </div>
    </div>
  );
}
