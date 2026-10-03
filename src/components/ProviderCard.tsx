"use client";

import type { Provider } from "@/lib/nppes";

export function ProviderCard({ p, onAddToPlan }: { p: Provider; onAddToPlan?: (p: Provider) => void }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-ink">
            {p.name}
            {p.credential ? <span className="font-normal text-ink-2">, {p.credential}</span> : null}
          </div>
          <div className="text-xs text-ink-2">{p.specialty}</div>
        </div>
        <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">{p.type === "organization" ? "facility" : "clinician"}</span>
      </div>
      <div className="mt-2 text-ink-2">
        {p.address && <div>{p.address}</div>}
        <div>
          {[p.city, p.state].filter(Boolean).join(", ")} {p.postalCode}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {p.phone && (
          <a href={`tel:${p.phone.replace(/\D/g, "")}`} className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-brand-ink">
            📞 {p.phone}
          </a>
        )}
        <a href={p.mapsUrl} target="_blank" rel="noreferrer noopener" className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-2">
          🗺️ Map
        </a>
        <a href={`https://npiregistry.cms.hhs.gov/provider-view/${p.npi}`} target="_blank" rel="noreferrer noopener" className="rounded-lg border border-border px-2.5 py-1 text-xs text-ink-2 hover:bg-surface-2">
          NPI {p.npi}
        </a>
        {onAddToPlan && (
          <button onClick={() => onAddToPlan(p)} className="rounded-lg border border-border px-2.5 py-1 text-xs text-ink-2 hover:bg-surface-2">
            + Add to plan
          </button>
        )}
      </div>
    </div>
  );
}
