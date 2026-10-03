"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Chat } from "@/components/Chat";
import { Composer, liveFrameAttachment } from "@/components/Composer";
import { CameraPanel, type CameraHandle } from "@/components/CameraPanel";
import { TriageBanner } from "@/components/TriageBanner";
import { RecordPanel } from "@/components/record/RecordPanel";
import { PersonSwitcher } from "@/components/PersonSwitcher";
import { plainText } from "@/components/Markdown";
import { activePerson, chatStore, initActivePerson, prefsStore, recordStore, STORAGE_ERROR_EVENT, useChat, usePrefs, type Attachment } from "@/lib/store";
import { clearConversation, clientOverrideHeaders, dismissTriage, sendMessage, stopStreaming, transcriptText } from "@/lib/chat-client";
import { SettingsDialog } from "@/components/SettingsDialog";
import { IntroDialog } from "@/components/IntroDialog";
import { PhoneDialog } from "@/components/PhoneDialog";
import { bus, type SendRequest } from "@/lib/bus";
import { speak, stopSpeaking, useSpeaking } from "@/lib/speech";
import { summarizeRecordForModel, uid, type TriageLevel } from "@/lib/record";

export default function Home() {
  const chat = useChat();
  const prefs = usePrefs();
  const speaking = useSpeaking();
  const cameraRef = useRef<CameraHandle>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [live, setLive] = useState(false);
  const [pending, setPending] = useState<Attachment[]>([]);
  const [draft, setDraft] = useState("");
  const [health, setHealth] = useState<{ hasCredentials: boolean; model: string } | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const savedThroughRef = useRef<string | undefined>(undefined);
  // On phones the record is a drawer that starts closed; on desktop it's a remembered side panel.
  const [drawerOpen, setDrawerOpen] = useState(false);

  const busy = chat.messages.some((m) => m.streaming);
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  useEffect(() => {
    initActivePerson();
    setMounted(true);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ hasCredentials: false, model: "" }));
  }, []);

  // theme
  useEffect(() => {
    const el = document.documentElement;
    if (prefs.theme === "system") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", prefs.theme);
  }, [prefs.theme]);

  const doSend = useCallback(
    async (req: SendRequest) => {
      // One exchange at a time: a panel button pressed mid-reply shouldn't start a second stream.
      if (chatStore.get().messages.some((m) => m.streaming)) return;
      stopSpeaking();
      setDrawerOpen(false);
      let attachments = [...(req.attachments ?? [])];
      if (live && cameraRef.current?.isOn()) {
        const frame = cameraRef.current.capture();
        if (frame) attachments.push(liveFrameAttachment(frame));
      }
      attachments = attachments.concat(pending.filter((p) => !attachments.some((a) => a.id === p.id)));
      setPending([]);
      const who = activePerson();
      const personNote = who.id === "me" ? undefined : `NOTE: This record belongs to "${who.name}", a family member of the person typing (a parent or caregiver is usually the one talking). Address the caregiver, refer to ${who.name} by name, and use ${who.name}'s profile (age etc.) for all judgments.`;
      const reply = await sendMessage({ text: req.text, attachments, extra: [personNote, req.extra].filter(Boolean).join("\n\n") || undefined });
      if (chatStore.get().voiceReplies && reply) speak(plainText(reply));
    },
    [live, pending],
  );

  useEffect(() => bus.onSend((req) => void doSend(req)), [doSend]);

  const showToast = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    setToast({ text, tone });
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), tone === "error" ? 8000 : 3500);
  }, []);

  // Browser storage full (or blocked): say so instead of silently not saving.
  useEffect(() => {
    let lastShown = 0;
    const onErr = (e: Event) => {
      if (Date.now() - lastShown < 15_000) return;
      lastShown = Date.now();
      const key = (e as CustomEvent<{ key: string }>).detail?.key ?? "";
      showToast(
        key.includes("record")
          ? "Your browser's storage is full, so recent changes to your record aren't saved. Back it up (Connections → Backup) and remove old imports."
          : "Browser storage is full; this conversation may not be saved. Start a new conversation to free space.",
        "error",
      );
    };
    window.addEventListener(STORAGE_ERROR_EVENT, onErr);
    return () => window.removeEventListener(STORAGE_ERROR_EVENT, onErr);
  }, [showToast]);

  /** Summarize the conversation into the record. Skips if nothing new since the last save. */
  const saveSessionNote = async (): Promise<boolean> => {
    const msgs = chatStore.get().messages;
    const lastId = msgs[msgs.length - 1]?.id;
    if (msgs.length < 2 || msgs.some((m) => m.streaming)) return false;
    if (savedThroughRef.current === lastId) {
      showToast("Already saved to your record");
      return true;
    }
    setSavingNote(true);
    const recordKey = recordStore.currentKey();
    try {
      const res = await fetch("/api/visit-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...clientOverrideHeaders() },
        body: JSON.stringify({ kind: "session", recordSummary: summarizeRecordForModel(recordStore.get()), transcript: transcriptText(40) }),
      });
      const data = (await res.json().catch(() => ({}))) as { summary?: string; followUps?: string[]; triage?: TriageLevel; error?: string };
      if (!res.ok || !data.summary) {
        showToast(data.error ?? "Couldn't save a note for this conversation.", "error");
        return false;
      }
      if (recordStore.currentKey() !== recordKey) return false; // person switched while waiting
      recordStore.set((r) => ({
        ...r,
        sessionNotes: [...r.sessionNotes, { id: uid(), ts: new Date().toISOString(), summary: data.summary + (data.followUps?.length ? ` Follow-ups: ${data.followUps.join("; ")}` : ""), triage: data.triage }],
      }));
      savedThroughRef.current = lastId;
      showToast("Saved a note to your record (Plan → Session notes)");
      return true;
    } catch {
      showToast("Couldn't reach the server to save a note.", "error");
      return false;
    } finally {
      setSavingNote(false);
    }
  };

  const newConversation = async () => {
    if (busy) stopStreaming();
    if (chat.messages.length >= 2) {
      const ok = await saveSessionNote();
      if (!ok && !window.confirm("The note couldn't be saved. Start a new conversation anyway? This one will be cleared.")) return;
    }
    savedThroughRef.current = undefined;
    clearConversation();
    stopSpeaking();
  };

  const sidebarOpen = isDesktop ? prefs.sidebarOpen : drawerOpen;
  const toggleRecord = () => (isDesktop ? prefsStore.set((p) => ({ ...p, sidebarOpen: !p.sidebarOpen })) : setDrawerOpen((o) => !o));

  return (
    <div className="flex h-dvh flex-col">
      <header className="no-print safe-top flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <div className="grid h-8 w-8 place-items-center rounded-xl bg-brand text-base font-bold text-brand-ink" aria-hidden>
          +
        </div>
        <div className="hidden min-w-0 sm:block">
          <div className="truncate text-sm font-semibold leading-tight">Hypochondriac</div>
          <div className="truncate text-[11px] text-ink-3">for whatever ails you</div>
        </div>
        <div className="ml-2">{mounted && <PersonSwitcher />}</div>
        <div className="ml-auto flex items-center gap-1">
          {chat.messages.length > 0 && (
            <>
              <HeaderButton onClick={() => void saveSessionNote()} title="Summarize this conversation into your record" disabled={savingNote || busy}>
                💾<span className="hidden sm:inline"> {savingNote ? "Saving…" : "Save note"}</span>
              </HeaderButton>
              <HeaderButton onClick={newConversation} title="Start a new conversation (saves a note first)">
                ✨<span className="hidden sm:inline"> New</span>
              </HeaderButton>
            </>
          )}
          <HeaderButton
            onClick={() => prefsStore.set((p) => ({ ...p, theme: p.theme === "dark" ? "light" : p.theme === "light" ? "system" : "dark" }))}
            title={`Theme: ${prefs.theme}`}
          >
            {prefs.theme === "dark" ? "🌙" : prefs.theme === "light" ? "☀️" : "🌗"}
          </HeaderButton>
          <HeaderButton onClick={() => setSettingsOpen(true)} title="Settings (API key, model, units)">
            ⚙️
          </HeaderButton>
          <HeaderButton onClick={() => setPhoneOpen(true)} title="Open on your phone">
            📱
          </HeaderButton>
          <HeaderButton onClick={toggleRecord} title="Toggle your record" active={sidebarOpen}>
            📂<span className="hidden sm:inline"> Record</span>
          </HeaderButton>
        </div>
      </header>
      {mounted && <IntroDialog />}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <PhoneDialog open={phoneOpen} onClose={() => setPhoneOpen(false)} />
      {toast && (
        <div
          role="status"
          className="no-print fixed left-1/2 top-16 z-[60] max-w-[92vw] -translate-x-1/2 rounded-xl border px-3 py-2 text-xs shadow-lg"
          style={{
            borderColor: toast.tone === "error" ? "var(--critical)" : "var(--border)",
            background: toast.tone === "error" ? "color-mix(in srgb, var(--critical) 12%, var(--surface))" : "var(--surface)",
          }}
        >
          {toast.tone === "error" ? "⚠️ " : "✓ "}
          {toast.text}
        </div>
      )}

      {mounted && health && !health.hasCredentials && !prefs.apiKey && (
        <div className="no-print flex flex-wrap items-center gap-2 border-b border-[var(--warning)]/60 bg-[var(--warning)]/15 px-4 py-2 text-xs text-ink">
          <span>
            <strong>Setup needed:</strong> no Anthropic API key yet. Paste yours in Settings, or put <code>ANTHROPIC_API_KEY</code> in <code>.env.local</code> and restart. Everything else (record, connections, imaging, devices) works without it.
          </span>
          <button onClick={() => setSettingsOpen(true)} className="rounded-lg bg-brand px-2.5 py-1 font-semibold text-brand-ink">
            ⚙️ Open Settings
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="no-print flex flex-col gap-2 px-3 pt-3 empty:hidden sm:px-4">
            {chat.triage && !chat.triage.dismissed && chat.triage.level !== "none" && <TriageBanner triage={chat.triage} onDismiss={dismissTriage} />}
            <CameraPanel
              ref={cameraRef}
              open={cameraOpen}
              onClose={() => {
                setCameraOpen(false);
                setLive(false);
              }}
              live={live}
              onToggleLive={setLive}
              busy={busy}
              onSnap={(d) => setPending((p) => [...p, { id: uid(), kind: "image", name: `photo-${new Date().toLocaleTimeString()}.jpg`, mediaType: "image/jpeg", data: d, origin: "camera" }])}
              onDescribeNow={(d) =>
                void doSend({
                  text: "What do you see here?",
                  attachments: [{ id: uid(), kind: "image", name: "live-frame.jpg", mediaType: "image/jpeg", data: d, origin: "live" }],
                })
              }
            />
          </div>
          <div className="min-h-0 flex-1">
            <Chat messages={mounted ? chat.messages : []} onStarter={(t) => void doSend({ text: t })} />
          </div>
          <div className="safe-bottom px-3 pb-3 pt-2 sm:px-4">
            <Composer
              onSend={(text, atts) => void doSend({ text, attachments: atts })}
              onStop={stopStreaming}
              busy={busy}
              pendingAttachments={pending}
              setPendingAttachments={(f) => setPending(f)}
              cameraOpen={cameraOpen}
              onToggleCamera={() => setCameraOpen((o) => !o)}
              handsFree={chat.handsFree}
              onToggleHandsFree={(v) => chatStore.set((c) => ({ ...c, handsFree: v, voiceReplies: v ? true : c.voiceReplies }))}
              voiceReplies={chat.voiceReplies}
              onToggleVoiceReplies={(v) => {
                chatStore.set((c) => ({ ...c, voiceReplies: v }));
                if (!v) stopSpeaking();
              }}
              speaking={speaking}
              onStopSpeaking={stopSpeaking}
              draft={draft}
              setDraft={setDraft}
            />
            {mounted && chat.usage.turns > 0 && (
              <div className="mx-auto mt-1 max-w-3xl text-right text-[10px] text-ink-3">
                {chat.usage.turns} turns · {(chat.usage.input / 1000).toFixed(1)}k in / {(chat.usage.output / 1000).toFixed(1)}k out
                {chat.usage.cacheRead ? ` · ${Math.round((chat.usage.cacheRead / Math.max(1, chat.usage.input)) * 100)}% cached` : ""}
                {` · ~$${estimateCost(chat.usage, prefs.model ?? health?.model).toFixed(2)}`}
                {health?.model ? ` · ${prefs.model ?? health.model}` : ""}
              </div>
            )}
          </div>
        </main>

        {/* Desktop sidebar */}
        {sidebarOpen && isDesktop && (
          <div className="no-print w-[380px] shrink-0 border-l border-border xl:w-[420px]">
            <RecordPanel />
          </div>
        )}
        {/* Mobile drawer */}
        {sidebarOpen && !isDesktop && mounted && (
          <div className="no-print fixed inset-0 z-30 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
            <div className="absolute inset-y-0 right-0 w-[min(92vw,420px)] shadow-2xl">
              <RecordPanel onClose={() => setDrawerOpen(false)} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Rough session cost from list prices ($/MTok): cache reads at ~10% of input. */
function estimateCost(u: { input: number; output: number; cacheRead: number }, model?: string): number {
  const price: Record<string, [number, number]> = {
    "claude-opus-5": [5, 25],
    "claude-opus-4-8": [5, 25],
    "claude-sonnet-5": [2, 10],
    "claude-sonnet-4-6": [3, 15],
    "claude-haiku-4-5": [1, 5],
    "claude-fable-5-1": [10, 50],
  };
  const [pin, pout] = price[model ?? "claude-opus-5"] ?? [5, 25];
  const uncached = Math.max(0, u.input - u.cacheRead);
  return (uncached * pin + u.cacheRead * pin * 0.1 + u.output * pout) / 1_000_000;
}

function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

function HeaderButton({ children, onClick, title, active, disabled }: { children: React.ReactNode; onClick: () => void; title: string; active?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-medium hover:bg-surface-2 disabled:opacity-50 sm:px-2.5 ${active ? "bg-brand-soft text-ink" : "text-ink-2"}`}
    >
      {children}
    </button>
  );
}
