"use client";

import { prefsStore, usePrefs } from "@/lib/store";

/** One-time welcome: what this is, what it isn't, and where things live. */
export function IntroDialog() {
  const prefs = usePrefs();
  if (prefs.seenIntro) return null;
  const close = () => prefsStore.set((p) => ({ ...p, seenIntro: true }));
  return (
    <div className="no-print fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Welcome">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <div className="mb-3 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-brand text-xl text-brand-ink">+</div>
          <div>
            <h2 className="text-lg font-semibold leading-tight">Hypochondriac</h2>
            <div className="text-xs text-ink-3">for whatever ails you</div>
          </div>
        </div>
        <p className="text-sm text-ink-2">
          One conversation that listens like a journal, pushes like a coach, reasons like a diagnostician, and sits with you like a therapist. It translates lab and imaging reports, tells you straight how urgent something is, and finds the right clinician nearby.
        </p>
        <ul className="mt-3 grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
          <li className="rounded-lg border border-border px-2.5 py-2">🎙️ Talk hands-free, or type</li>
          <li className="rounded-lg border border-border px-2.5 py-2">📷 Show a rash, a wound, a pill, a meter</li>
          <li className="rounded-lg border border-border px-2.5 py-2">🧪 Drop in lab PDFs and imaging reports</li>
          <li className="rounded-lg border border-border px-2.5 py-2">🔗 Connect your patient portal &amp; imaging</li>
          <li className="rounded-lg border border-border px-2.5 py-2">📡 Pair a BP cuff, glucose meter, oximeter</li>
          <li className="rounded-lg border border-border px-2.5 py-2">🗒️ Walk into appointments prepared</li>
        </ul>
        <div className="mt-4 rounded-lg border border-[var(--critical)]/40 bg-[var(--critical)]/10 p-3 text-sm">
          <strong>Not a doctor.</strong> This is a companion, not a diagnosis. If something feels like an emergency, call <a href="tel:911" className="font-semibold underline">911</a>. If you&apos;re in crisis, call or text <a href="tel:988" className="font-semibold underline">988</a>. Everything you enter stays in this browser.
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={close} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-ink">
            Let&apos;s go
          </button>
        </div>
      </div>
    </div>
  );
}
