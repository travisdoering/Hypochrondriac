"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface CameraHandle {
  /** Capture the current frame as a JPEG data URL (null if camera off). */
  capture: () => string | null;
  isOn: () => boolean;
}

/**
 * Live camera. Two uses:
 *  - Snap: take a still and attach it to the next message.
 *  - Live: while on, every message you send carries the current frame, and
 *    "Describe now" sends a frame immediately. That is the "show me" flow for
 *    a rash, a wound, a swollen joint, a pill bottle, a glucose meter...
 */
export const CameraPanel = forwardRef<
  CameraHandle,
  {
    open: boolean;
    onClose: () => void;
    onSnap: (dataUrl: string) => void;
    onDescribeNow: (dataUrl: string) => void;
    live: boolean;
    onToggleLive: (v: boolean) => void;
    busy?: boolean;
  }
>(function CameraPanel({ open, onClose, onSnap, onDescribeNow, live, onToggleLive, busy }, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState(false);
  const [torch, setTorch] = useState(false);
  const [canTorch, setCanTorch] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  const start = useCallback(async () => {
    stop();
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      const track = stream.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
      setCanTorch(!!caps.torch);
      setReady(true);
    } catch (e) {
      setError(
        (e as Error).name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access in your browser and try again."
          : (e as Error).name === "NotFoundError"
            ? "No camera found on this device."
            : `Could not start camera: ${(e as Error).message}`,
      );
    }
  }, [facing, stop]);

  useEffect(() => {
    if (open) void start();
    else stop();
    return stop;
  }, [open, start, stop]);

  useEffect(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !canTorch) return;
    track.applyConstraints({ advanced: [{ torch } as MediaTrackConstraintSet] }).catch(() => {});
  }, [torch, canTorch]);

  const capture = useCallback((): string | null => {
    const v = videoRef.current;
    if (!v || !ready || v.videoWidth === 0) return null;
    const max = 1280;
    const scale = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    const ctx = c.getContext("2d")!;
    if (facing === "user") {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  }, [ready, facing]);

  useImperativeHandle(ref, () => ({ capture, isOn: () => open && ready }), [capture, open, ready]);

  if (!open) return null;

  const doSnap = () => {
    const d = capture();
    if (!d) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    onSnap(d);
  };

  return (
    <div className="no-print mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-black shadow-lg">
      <div className="relative aspect-video w-full bg-black">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} playsInline muted className={`h-full w-full object-contain ${facing === "user" ? "-scale-x-100" : ""}`} />
        {flash && <div className="absolute inset-0 bg-white/80" />}
        {live && (
          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">
            <span className="recording inline-block h-2.5 w-2.5 rounded-full bg-[var(--critical)]" />
            LIVE - frames attach to each message
          </div>
        )}
        {!ready && !error && <div className="absolute inset-0 grid place-items-center text-sm text-white/80">Starting camera...</div>}
        {error && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white">{error}</div>}
        <div className="absolute right-3 top-3 flex gap-2">
          {canTorch && (
            <button onClick={() => setTorch((t) => !t)} className="rounded-full bg-black/60 px-3 py-1 text-xs text-white hover:bg-black/80" title="Flashlight">
              {torch ? "🔦 on" : "🔦"}
            </button>
          )}
          <button
            onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
            className="rounded-full bg-black/60 px-3 py-1 text-xs text-white hover:bg-black/80"
            title="Flip camera"
          >
            🔄 flip
          </button>
          <button onClick={onClose} className="rounded-full bg-black/60 px-3 py-1 text-xs text-white hover:bg-black/80" aria-label="Close camera">
            ✕
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 bg-surface px-3 py-2 text-sm">
        <button onClick={doSnap} disabled={!ready} className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-brand-ink disabled:opacity-50">
          📷 Snap &amp; attach
        </button>
        <button
          onClick={() => {
            const d = capture();
            if (d) onDescribeNow(d);
          }}
          disabled={!ready || busy}
          className="rounded-lg border border-border px-3 py-1.5 font-semibold text-ink hover:bg-surface-2 disabled:opacity-50"
        >
          👁️ What do you see?
        </button>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-ink-2">
          <input type="checkbox" checked={live} onChange={(e) => onToggleLive(e.target.checked)} className="h-4 w-4" />
          Live mode
        </label>
      </div>
      <p className="bg-surface px-3 pb-2 text-xs text-ink-3">
        Tips: good light, fill the frame, hold a coin or ruler next to a mole or rash for scale, and take one close and one from a step back.
      </p>
    </div>
  );
});
