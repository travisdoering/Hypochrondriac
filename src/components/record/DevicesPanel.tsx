"use client";

import { useEffect, useRef, useState } from "react";
import { DEVICE_SPECS, bluetoothSupported, connectDevice, describeReading, type DeviceSession, type Reading } from "@/lib/bluetooth";
import { recordStore } from "@/lib/store";
import { uid } from "@/lib/record";
import { bus } from "@/lib/bus";

/**
 * Connect a Bluetooth cuff / meter / oximeter / thermometer / scale and log
 * readings straight into the journal. Each reading also offers a one-tap
 * "ask about this" so the assistant can react to it in context.
 */
export function DevicesPanel() {
  const [open, setOpen] = useState(false);
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [session, setSession] = useState<DeviceSession | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const sessionRef = useRef<DeviceSession | null>(null);

  useEffect(() => setSupported(bluetoothSupported()), []);
  useEffect(() => () => sessionRef.current?.disconnect(), []);

  const connect = async (kind: (typeof DEVICE_SPECS)[number]["kind"]) => {
    const spec = DEVICE_SPECS.find((s) => s.kind === kind)!;
    sessionRef.current?.disconnect();
    setStatus(null);
    try {
      const s = await connectDevice(
        spec,
        (r) => {
          setReadings((prev) => [r, ...prev].slice(0, 20));
          recordStore.set((rec) => ({
            ...rec,
            journal: [
              ...rec.journal,
              { id: uid(), ts: r.ts, source: "user", symptoms: [], tags: ["device", spec.kind], notes: `${spec.label}${r.deviceName ? ` (${r.deviceName})` : ""} reading`, vitals: r.vitals },
            ],
          }));
        },
        setStatus,
      );
      sessionRef.current = s;
      setSession(s);
    } catch (e) {
      const msg = (e as Error).message;
      setStatus(/cancel/i.test(msg) ? "Cancelled." : msg);
    }
  };

  const disconnect = () => {
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    setSession(null);
    setStatus("Disconnected.");
  };

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="rounded-xl border border-dashed border-border px-3 py-2 text-left text-ink-2 hover:border-brand hover:text-ink">
        📡 Connect a device (BP cuff, glucose meter, pulse ox, thermometer, scale)
      </button>
    );

  return (
    <section className="rounded-xl border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Devices</h3>
        <button onClick={() => setOpen(false)} className="text-xs text-ink-3">
          close
        </button>
      </div>
      {!supported ? (
        <p className="text-xs text-ink-2">
          Bluetooth devices need Chrome or Edge on desktop or Android (Web Bluetooth). You can still type readings in the quick check-in, or import a CSV export from your device&apos;s app under Connections.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            {DEVICE_SPECS.map((d) => (
              <button
                key={d.kind}
                onClick={() => connect(d.kind)}
                disabled={!!session}
                className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs hover:bg-surface-2 disabled:opacity-50 ${session?.spec.kind === d.kind ? "border-brand bg-brand-soft" : "border-border"}`}
              >
                <span aria-hidden>{d.icon}</span>
                {d.label}
              </button>
            ))}
          </div>
          {session && (
            <div className="mt-2 flex items-center justify-between rounded-lg bg-brand-soft/60 px-2 py-1.5 text-xs">
              <span>
                <span className="recording mr-1.5 inline-block h-2 w-2 rounded-full bg-brand" />
                {session.spec.label}
                {session.device.name ? ` · ${session.device.name}` : ""}
              </span>
              <button onClick={disconnect} className="rounded border border-border px-1.5 py-0.5 hover:bg-surface">
                disconnect
              </button>
            </div>
          )}
          {status && <div className="mt-2 text-xs text-ink-2">{status}</div>}
          {readings.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {readings.map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-2 rounded-lg border border-border px-2 py-1 text-xs">
                  <span>
                    <span className="font-semibold">{describeReading(r)}</span>
                    <span className="text-ink-3"> · {new Date(r.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                  </span>
                  <button
                    onClick={() =>
                      bus.send({
                        text: `My ${DEVICE_SPECS.find((d) => d.kind === r.kind)?.label.toLowerCase()} just read ${describeReading(r)}. What do you make of that given my history?`,
                        extra: "This reading came from a connected Bluetooth device and has already been logged to the journal - do not log it again.",
                      })
                    }
                    className="rounded border border-border px-1.5 py-0.5 hover:bg-surface-2"
                  >
                    ask
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-ink-3">Works with cuffs, meters, oximeters, thermometers and scales that use the standard Bluetooth health profiles (Omron, A&amp;D, Beurer, iHealth, Contour, many others).</p>
        </>
      )}
    </section>
  );
}
