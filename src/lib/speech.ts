"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* Web Speech API typings are not in lib.dom for all browsers. */
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onstart: (() => void) | null;
}
type SRCtor = new () => SpeechRecognitionLike;

function getSR(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechRecognition(opts: {
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
  /** in hands-free mode, a pause ends the utterance and triggers onFinal */
  silenceMs?: number;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const bufRef = useRef("");
  const timerRef = useRef<number | null>(null);
  const wantRef = useRef(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => setSupported(!!getSR()), []);

  const flush = useCallback(() => {
    const t = bufRef.current.trim();
    bufRef.current = "";
    optsRef.current.onInterim?.("");
    if (t) optsRef.current.onFinal(t);
  }, []);

  const stop = useCallback(() => {
    wantRef.current = false;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    recRef.current?.stop();
    setListening(false);
    flush();
  }, [flush]);

  const start = useCallback(() => {
    const SR = getSR();
    if (!SR) return;
    setError(null);
    wantRef.current = true;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    rec.maxAlternatives = 1;
    rec.onstart = () => setListening(true);
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) bufRef.current += (bufRef.current ? " " : "") + r[0].transcript.trim();
        else interim += r[0].transcript;
      }
      optsRef.current.onInterim?.((bufRef.current + " " + interim).trim());
      if (timerRef.current) window.clearTimeout(timerRef.current);
      const silence = optsRef.current.silenceMs;
      if (silence && bufRef.current) {
        timerRef.current = window.setTimeout(() => flush(), silence);
      }
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      setError(e.error === "not-allowed" ? "Microphone permission was denied." : `Speech error: ${e.error}`);
      wantRef.current = false;
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      // Chrome ends sessions after ~60s or on silence; restart if still wanted.
      if (wantRef.current) {
        try {
          rec.start();
        } catch {
          /* ignore */
        }
      }
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      /* already started */
    }
  }, [flush]);

  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, error, start, stop };
}

// ---- Text to speech ---------------------------------------------------------

let currentUtterance: SpeechSynthesisUtterance | null = null;

export function speak(text: string, opts: { onEnd?: () => void; rate?: number } = {}) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  if (!text.trim()) {
    opts.onEnd?.();
    return;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.rate = opts.rate ?? 1.02;
  u.pitch = 1;
  const voices = window.speechSynthesis.getVoices();
  const preferred =
    voices.find((v) => /en[-_]US/i.test(v.lang) && /natural|neural|premium|enhanced|samantha|aria|jenny/i.test(v.name)) ??
    voices.find((v) => /^en/i.test(v.lang) && v.default) ??
    voices.find((v) => /^en/i.test(v.lang));
  if (preferred) u.voice = preferred;
  u.onend = () => {
    if (currentUtterance === u) currentUtterance = null;
    opts.onEnd?.();
  };
  u.onerror = () => {
    if (currentUtterance === u) currentUtterance = null;
    opts.onEnd?.();
  };
  currentUtterance = u;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  currentUtterance = null;
}

export function useSpeaking(): boolean {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const id = window.setInterval(() => setSpeaking(window.speechSynthesis.speaking), 250);
    return () => window.clearInterval(id);
  }, []);
  return speaking;
}
