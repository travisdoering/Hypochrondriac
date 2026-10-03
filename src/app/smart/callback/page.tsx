"use client";

import { useEffect, useState } from "react";
import { completeSmartLaunch } from "@/lib/fhir";
import { prefsStore } from "@/lib/store";

export default function SmartCallbackPage() {
  const [status, setStatus] = useState("Finishing sign-in with your patient portal...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const code = sp.get("code");
    const state = sp.get("state");
    const err = sp.get("error");
    if (err) {
      setError(`${err}: ${sp.get("error_description") ?? ""}`);
      return;
    }
    if (!code || !state) {
      setError("Missing authorization code.");
      return;
    }
    completeSmartLaunch(code, state)
      .then(() => {
        setStatus("Connected. Taking you back...");
        prefsStore.set((p) => ({ ...p, sidebarOpen: true, sidebarTab: "connections" }));
        window.location.replace("/");
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="max-w-md rounded-2xl border border-border bg-surface p-6 text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-brand text-xl text-brand-ink">+</div>
        {error ? (
          <>
            <h1 className="text-lg font-semibold">Couldn&apos;t connect</h1>
            <p className="mt-2 text-sm text-ink-2">{error}</p>
            <a href="/" className="mt-4 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-ink">
              Back to Hypochondriac
            </a>
          </>
        ) : (
          <p className="text-sm text-ink-2">{status}</p>
        )}
      </div>
    </main>
  );
}
