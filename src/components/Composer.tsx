"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Attachment } from "@/lib/store";
import { fileToAttachment, requestBudgetChars } from "@/lib/chat-client";
import { useSpeechRecognition } from "@/lib/speech";
import { uid } from "@/lib/record";

export interface ComposerProps {
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  busy: boolean;
  pendingAttachments: Attachment[];
  setPendingAttachments: (f: (a: Attachment[]) => Attachment[]) => void;
  cameraOpen: boolean;
  onToggleCamera: () => void;
  handsFree: boolean;
  onToggleHandsFree: (v: boolean) => void;
  voiceReplies: boolean;
  onToggleVoiceReplies: (v: boolean) => void;
  speaking: boolean;
  onStopSpeaking: () => void;
  /** external text injection (starter prompts) */
  draft: string;
  setDraft: (s: string) => void;
}

export function Composer(p: ComposerProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [interim, setInterim] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  const send = useCallback(
    (text: string) => {
      const t = text.trim();
      if ((!t && p.pendingAttachments.length === 0) || p.busy) return;
      p.onSend(t, p.pendingAttachments);
      p.setDraft("");
      setInterim("");
    },
    [p],
  );

  const sr = useSpeechRecognition({
    onFinal: (text) => {
      if (p.handsFree) send((p.draft ? p.draft + " " : "") + text);
      else p.setDraft((p.draft ? p.draft + " " : "") + text);
    },
    onInterim: setInterim,
    silenceMs: p.handsFree ? 1400 : undefined,
  });

  // Hands-free loop: listen while idle and not speaking.
  useEffect(() => {
    if (!p.handsFree) {
      if (sr.listening) sr.stop();
      return;
    }
    if (!p.busy && !p.speaking && !sr.listening) sr.start();
    if ((p.busy || p.speaking) && sr.listening) sr.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.handsFree, p.busy, p.speaking, sr.listening]);

  // autosize
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [p.draft, interim]);

  const addFiles = async (files: FileList | File[]) => {
    setAttachError(null);
    // Keep one message's attachments within what a single request can carry.
    const budget = requestBudgetChars();
    let used = p.pendingAttachments.reduce((n, a) => n + (a.kind === "text" ? 0 : a.data.length), 0);
    for (const f of Array.from(files)) {
      try {
        const a = await fileToAttachment(f);
        const size = a.kind === "text" ? 0 : a.data.length;
        if (used + size > budget) {
          setAttachError(`"${f.name}" won't fit in this message with the other attachments. Send these first, then attach it in the next message.`);
          continue;
        }
        used += size;
        p.setPendingAttachments((prev) => [...prev, a]);
      } catch (e) {
        setAttachError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items).filter((i) => i.kind === "file");
    if (items.length) {
      e.preventDefault();
      void addFiles(items.map((i) => i.getAsFile()!).filter(Boolean));
    }
  };

  const shownText = p.handsFree && interim ? interim : p.draft + (interim && !p.handsFree ? (p.draft ? " " : "") + interim : "");

  return (
    <div
      className={`no-print mx-auto w-full max-w-3xl ${dragOver ? "ring-2 ring-brand" : ""} rounded-2xl`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
      }}
    >
      {p.pendingAttachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2 px-1">
          {p.pendingAttachments.map((a) => (
            <div key={a.id} className="group relative">
              {a.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.data} alt={a.name} className="h-16 w-16 rounded-lg border border-border object-cover" />
              ) : (
                <div className="flex h-16 max-w-[160px] items-center gap-1.5 rounded-lg border border-border bg-surface px-2 text-xs text-ink-2">
                  <span>{a.kind === "pdf" ? "📄" : "📎"}</span>
                  <span className="truncate">{a.name}</span>
                </div>
              )}
              <button
                onClick={() => p.setPendingAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-ink text-[10px] text-bg"
                aria-label={`Remove ${a.name}`}
              >
                ✕
              </button>
              {a.origin === "live" && <span className="absolute bottom-0 left-0 rounded-tr bg-black/60 px-1 text-[9px] text-white">live</span>}
            </div>
          ))}
        </div>
      )}
      {(attachError || sr.error) && <div className="mb-2 px-1 text-xs text-[var(--critical)]">{attachError ?? sr.error}</div>}

      <div className="flex items-end gap-1.5 rounded-2xl border border-border bg-surface p-1.5 shadow-sm focus-within:border-brand">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.txt,.csv,.json,.hl7,.xml,.html,text/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <IconButton title="Attach a photo, PDF report, or file" onClick={() => fileRef.current?.click()}>
          📎
        </IconButton>
        <IconButton title={p.cameraOpen ? "Close camera" : "Open camera"} onClick={p.onToggleCamera} active={p.cameraOpen}>
          📷
        </IconButton>
        <textarea
          ref={taRef}
          value={shownText}
          onChange={(e) => {
            setInterim("");
            p.setDraft(e.target.value);
          }}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(shownText);
            }
          }}
          rows={1}
          placeholder={sr.listening ? "Listening..." : p.handsFree ? "Hands-free: just talk" : "What's going on?"}
          className="max-h-[200px] min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-ink outline-none placeholder:text-ink-3"
        />
        {sr.supported && (
          <IconButton
            title={sr.listening ? "Stop listening" : "Speak"}
            onClick={() => (sr.listening ? sr.stop() : sr.start())}
            active={sr.listening}
            className={sr.listening ? "recording !bg-[var(--critical)] !text-white" : ""}
          >
            🎙️
          </IconButton>
        )}
        {p.busy ? (
          <button onClick={p.onStop} className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-bg" title="Stop">
            ■
          </button>
        ) : (
          <button
            onClick={() => send(shownText)}
            disabled={!shownText.trim() && p.pendingAttachments.length === 0}
            className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-brand-ink disabled:opacity-40"
            title="Send"
          >
            ➤
          </button>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-ink-3">
        {sr.supported ? (
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={p.handsFree} onChange={(e) => p.onToggleHandsFree(e.target.checked)} className="h-3.5 w-3.5" />
            Hands-free conversation
          </label>
        ) : (
          <span>Voice input needs Chrome, Edge, or Safari.</span>
        )}
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={p.voiceReplies} onChange={(e) => p.onToggleVoiceReplies(e.target.checked)} className="h-3.5 w-3.5" />
          Read replies aloud
        </label>
        {p.speaking && (
          <button onClick={p.onStopSpeaking} className="rounded border border-border px-1.5 py-0.5 hover:bg-surface-2">
            🔇 stop talking
          </button>
        )}
        <span className="ml-auto hidden sm:inline">Enter to send · Shift+Enter for a new line · drop or paste images & PDFs</span>
      </div>
    </div>
  );
}

function IconButton({
  children,
  title,
  onClick,
  active,
  className = "",
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg hover:bg-surface-2 ${active ? "bg-brand-soft" : ""} ${className}`}
    >
      {children}
    </button>
  );
}

export function liveFrameAttachment(dataUrl: string): Attachment {
  return { id: uid(), kind: "image", name: `camera-${new Date().toLocaleTimeString()}.jpg`, mediaType: "image/jpeg", data: dataUrl, origin: "live" };
}
