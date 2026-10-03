"use client";

/**
 * Web Bluetooth readers for standard Bluetooth SIG health profiles. Works in
 * Chrome / Edge on desktop and Android (not Safari / iOS). Each reader
 * connects, subscribes to the measurement characteristic, parses the
 * standard packet, and hands back vitals the app can log.
 *
 *  - Blood Pressure (0x1810 / measurement 0x2A35)
 *  - Glucose        (0x1808 / measurement 0x2A18, RACP 0x2A52)
 *  - Pulse Oximeter (0x1822 / spot-check 0x2A5E, continuous 0x2A5F)
 *  - Health Thermometer (0x1809 / temperature 0x2A1C)
 *  - Weight Scale   (0x181D / weight 0x2A9D)
 *  - Heart Rate     (0x180D / measurement 0x2A37)
 */

import type { Vitals } from "./record";

export type DeviceKind = "bp" | "glucose" | "spo2" | "thermometer" | "scale" | "heart-rate";

export interface DeviceSpec {
  kind: DeviceKind;
  label: string;
  icon: string;
  service: number;
  characteristics: number[];
  indicate?: boolean;
}

export const DEVICE_SPECS: DeviceSpec[] = [
  { kind: "bp", label: "Blood pressure cuff", icon: "🩸", service: 0x1810, characteristics: [0x2a35], indicate: true },
  { kind: "glucose", label: "Glucose meter", icon: "🍬", service: 0x1808, characteristics: [0x2a18] },
  { kind: "spo2", label: "Pulse oximeter", icon: "💨", service: 0x1822, characteristics: [0x2a5e, 0x2a5f] },
  { kind: "thermometer", label: "Thermometer", icon: "🌡️", service: 0x1809, characteristics: [0x2a1c], indicate: true },
  { kind: "scale", label: "Weight scale", icon: "⚖️", service: 0x181d, characteristics: [0x2a9d], indicate: true },
  { kind: "heart-rate", label: "Heart-rate monitor", icon: "❤️", service: 0x180d, characteristics: [0x2a37] },
];

export interface Reading {
  kind: DeviceKind;
  vitals: Vitals;
  ts: string;
  deviceName?: string;
  raw?: string;
}

export function bluetoothSupported(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

// ---- IEEE-11073 16-bit SFLOAT & 32-bit FLOAT -------------------------------
function sfloat(dv: DataView, off: number): number {
  const raw = dv.getUint16(off, true);
  if (raw === 0x07ff || raw === 0x0800 || raw === 0x07fe || raw === 0x0802 || raw === 0x0801) return NaN;
  let mantissa = raw & 0x0fff;
  let exponent = raw >> 12;
  if (exponent >= 0x0008) exponent = -((0x000f + 1) - exponent);
  if (mantissa >= 0x0800) mantissa = -((0x0fff + 1) - mantissa);
  return mantissa * Math.pow(10, exponent);
}
function float32(dv: DataView, off: number): number {
  const raw = dv.getUint32(off, true);
  let mantissa = raw & 0x00ffffff;
  const exponent = (raw >> 24) & 0xff;
  const exp = exponent > 127 ? exponent - 256 : exponent;
  if (mantissa >= 0x800000) mantissa = -((0xffffff + 1) - mantissa);
  return mantissa * Math.pow(10, exp);
}
function r1(n: number) {
  return Math.round(n * 10) / 10;
}

// ---- Parsers ---------------------------------------------------------------
export function parseBloodPressure(dv: DataView): Vitals {
  const flags = dv.getUint8(0);
  const kpa = (flags & 0x01) !== 0;
  let off = 1;
  let sys = sfloat(dv, off);
  let dia = sfloat(dv, off + 2);
  off += 6; // sys, dia, MAP
  if (kpa) {
    sys *= 7.50062;
    dia *= 7.50062;
  }
  if (flags & 0x02) off += 7; // timestamp
  const v: Vitals = { systolic: Math.round(sys), diastolic: Math.round(dia) };
  if (flags & 0x04) {
    const hr = sfloat(dv, off);
    if (!Number.isNaN(hr)) v.heartRate = Math.round(hr);
  }
  return v;
}

export function parseGlucose(dv: DataView): Vitals {
  const flags = dv.getUint8(0);
  let off = 3; // flags + seq number
  off += 7; // base time
  if (flags & 0x01) off += 2; // time offset
  const v: Vitals = {};
  if (flags & 0x02) {
    const conc = sfloat(dv, off);
    const molL = (flags & 0x04) !== 0;
    // kg/L -> mg/dL : *100000 ; mol/L -> mg/dL : *18016 (approx, glucose MW 180.16)
    v.glucoseMgDl = Math.round(molL ? conc * 18016 : conc * 100000);
  }
  return v;
}

export function parsePulseOx(dv: DataView): Vitals {
  // Spot-check (0x2A5E) and continuous (0x2A5F) both start: flags(1), SpO2 SFLOAT, PR SFLOAT
  const spo2 = sfloat(dv, 1);
  const pr = sfloat(dv, 3);
  const v: Vitals = {};
  if (!Number.isNaN(spo2)) v.spo2 = Math.round(spo2);
  if (!Number.isNaN(pr)) v.heartRate = Math.round(pr);
  return v;
}

export function parseTemperature(dv: DataView): Vitals {
  const flags = dv.getUint8(0);
  const f = (flags & 0x01) !== 0;
  const t = float32(dv, 1);
  return { tempC: r1(f ? ((t - 32) * 5) / 9 : t) };
}

export function parseWeight(dv: DataView): Vitals {
  const flags = dv.getUint8(0);
  const imperial = (flags & 0x01) !== 0;
  const raw = dv.getUint16(1, true);
  const kg = imperial ? raw * 0.01 * 0.4536 : raw * 0.005;
  return { weightKg: r1(kg) };
}

export function parseHeartRate(dv: DataView): Vitals {
  const flags = dv.getUint8(0);
  const hr = flags & 0x01 ? dv.getUint16(1, true) : dv.getUint8(1);
  return { heartRate: hr };
}

/** Bluetooth SIG "Date Time": uint16 year, then month, day, hours, minutes, seconds (7 bytes). */
function dateTimeAt(dv: DataView, off: number): Date | undefined {
  if (dv.byteLength < off + 7) return undefined;
  const year = dv.getUint16(off, true);
  const month = dv.getUint8(off + 2);
  const day = dv.getUint8(off + 3);
  if (!year || !month || !day) return undefined; // "unknown" encodings
  const d = new Date(year, month - 1, day, dv.getUint8(off + 4), dv.getUint8(off + 5), dv.getUint8(off + 6));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** The measurement's own timestamp when the device includes one (BP cuffs, glucose meters). */
export function readingTime(kind: DeviceKind, dv: DataView): Date | undefined {
  try {
    const flags = dv.getUint8(0);
    if (kind === "bp" && flags & 0x02) return dateTimeAt(dv, 7);
    if (kind === "glucose") {
      const base = dateTimeAt(dv, 3);
      if (base && flags & 0x01 && dv.byteLength >= 12) return new Date(base.getTime() + dv.getInt16(10, true) * 60_000);
      return base;
    }
    if (kind === "thermometer" && flags & 0x02) return dateTimeAt(dv, 5);
    if (kind === "scale" && flags & 0x02) return dateTimeAt(dv, 3);
  } catch {
    /* malformed packet */
  }
  return undefined;
}

/** Devices that stream continuously (about once a second) rather than per measurement. */
export const CONTINUOUS_KINDS: ReadonlySet<DeviceKind> = new Set(["heart-rate", "spo2"]);

const PARSERS: Record<DeviceKind, (dv: DataView) => Vitals> = {
  bp: parseBloodPressure,
  glucose: parseGlucose,
  spo2: parsePulseOx,
  thermometer: parseTemperature,
  scale: parseWeight,
  "heart-rate": parseHeartRate,
};

// ---- Connection ------------------------------------------------------------
/* Minimal Web Bluetooth typings (lib.dom lacks them in some TS configs). */
interface BTCharacteristic extends EventTarget {
  value: DataView | null;
  startNotifications(): Promise<BTCharacteristic>;
  stopNotifications(): Promise<BTCharacteristic>;
  writeValue(v: BufferSource): Promise<void>;
  properties: { notify: boolean; indicate: boolean };
}
interface BTService {
  getCharacteristic(uuid: number | string): Promise<BTCharacteristic>;
}
interface BTServer {
  connected: boolean;
  connect(): Promise<BTServer>;
  disconnect(): void;
  getPrimaryService(uuid: number | string): Promise<BTService>;
}
interface BTDevice extends EventTarget {
  name?: string;
  gatt?: BTServer;
}
interface BTNav {
  requestDevice(opts: { filters: { services: number[] }[]; optionalServices?: number[] }): Promise<BTDevice>;
}

export interface DeviceSession {
  device: BTDevice;
  spec: DeviceSpec;
  disconnect: () => void;
}

export async function connectDevice(spec: DeviceSpec, onReading: (r: Reading) => void, onStatus?: (s: string) => void): Promise<DeviceSession> {
  if (!bluetoothSupported()) throw new Error("Web Bluetooth isn't available in this browser. Use Chrome or Edge on desktop or Android.");
  const bt = (navigator as unknown as { bluetooth: BTNav }).bluetooth;
  onStatus?.("Choose your device in the browser prompt...");
  const device = await bt.requestDevice({ filters: [{ services: [spec.service] }], optionalServices: [0x180a, 0x180f] });
  onStatus?.(`Connecting to ${device.name ?? "device"}...`);
  const server = await device.gatt!.connect();
  const service = await server.getPrimaryService(spec.service);
  const chars: BTCharacteristic[] = [];
  for (const c of spec.characteristics) {
    try {
      chars.push(await service.getCharacteristic(c));
    } catch {
      /* optional characteristic not present */
    }
  }
  if (!chars.length) throw new Error("Device connected but has no measurement characteristic.");
  const parse = PARSERS[spec.kind];
  const handler = (ev: Event) => {
    const ch = ev.target as BTCharacteristic;
    if (!ch.value) return;
    try {
      const vitals = parse(ch.value);
      if (Object.keys(vitals).length) {
        // Stored readings replayed by cuffs/meters carry their own timestamp; use it.
        const when = readingTime(spec.kind, ch.value) ?? new Date();
        onReading({ kind: spec.kind, vitals, ts: when.toISOString(), deviceName: device.name, raw: hex(ch.value) });
      }
    } catch (e) {
      onStatus?.(`Could not parse a packet: ${(e as Error).message}`);
    }
  };
  for (const ch of chars) {
    ch.addEventListener("characteristicvaluechanged", handler);
    await ch.startNotifications();
  }
  // Glucose meters: ask for all stored records via Record Access Control Point.
  if (spec.kind === "glucose") {
    try {
      const racp = await service.getCharacteristic(0x2a52);
      await racp.startNotifications();
      await racp.writeValue(new Uint8Array([0x01, 0x01])); // report all records
      onStatus?.("Requested stored readings from the meter...");
    } catch {
      onStatus?.("Connected. Take a reading to see it here.");
    }
  } else {
    onStatus?.(`Connected to ${device.name ?? "device"}. Take a measurement.`);
  }
  const disconnect = () => {
    for (const ch of chars) {
      ch.removeEventListener("characteristicvaluechanged", handler);
      ch.stopNotifications().catch(() => {});
    }
    if (server.connected) server.disconnect();
  };
  device.addEventListener("gattserverdisconnected", () => onStatus?.("Device disconnected."));
  return { device, spec, disconnect };
}

function hex(dv: DataView): string {
  let s = "";
  for (let i = 0; i < dv.byteLength; i++) s += dv.getUint8(i).toString(16).padStart(2, "0");
  return s;
}

export function describeReading(r: Reading): string {
  const v = r.vitals;
  const parts: string[] = [];
  if (v.systolic && v.diastolic) parts.push(`BP ${v.systolic}/${v.diastolic}`);
  if (v.heartRate) parts.push(`HR ${v.heartRate}`);
  if (v.glucoseMgDl) parts.push(`glucose ${v.glucoseMgDl} mg/dL`);
  if (v.spo2) parts.push(`SpO₂ ${v.spo2}%`);
  if (v.tempC) parts.push(`temp ${v.tempC}°C`);
  if (v.weightKg) parts.push(`weight ${v.weightKg} kg`);
  return parts.join(", ");
}
