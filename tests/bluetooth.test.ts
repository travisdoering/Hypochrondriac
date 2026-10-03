import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBloodPressure, parseGlucose, parseHeartRate, parsePulseOx, parseTemperature, parseWeight } from "../src/lib/bluetooth";

function dv(bytes: number[]) {
  return new DataView(new Uint8Array(bytes).buffer);
}
/** encode an IEEE-11073 SFLOAT with exponent 0 (integer mantissa) */
function sfloat(n: number): [number, number] {
  const v = n & 0x0fff;
  return [v & 0xff, (v >> 8) & 0x0f];
}

test("blood pressure: mmHg with pulse", () => {
  // flags: 0x04 = pulse present, units mmHg, no timestamp
  const bytes = [0x04, ...sfloat(128), ...sfloat(82), ...sfloat(97), ...sfloat(66)];
  const v = parseBloodPressure(dv(bytes));
  assert.deepEqual(v, { systolic: 128, diastolic: 82, heartRate: 66 });
});

test("blood pressure: kPa converts to mmHg", () => {
  // 17 kPa ≈ 127.5 mmHg, 11 kPa ≈ 82.5
  const bytes = [0x01, ...sfloat(17), ...sfloat(11), ...sfloat(13)];
  const v = parseBloodPressure(dv(bytes));
  assert.equal(v.systolic, 128);
  assert.equal(v.diastolic, 83);
});

test("pulse oximeter spot check", () => {
  const bytes = [0x00, ...sfloat(97), ...sfloat(72)];
  assert.deepEqual(parsePulseOx(dv(bytes)), { spo2: 97, heartRate: 72 });
});

test("heart rate 8-bit and 16-bit", () => {
  assert.deepEqual(parseHeartRate(dv([0x00, 68])), { heartRate: 68 });
  assert.deepEqual(parseHeartRate(dv([0x01, 0x2c, 0x01])), { heartRate: 300 });
});

test("thermometer celsius float32", () => {
  // FLOAT: mantissa 3720 exponent -2 -> 37.20
  const mantissa = 3720;
  const exp = 0xfe; // -2
  const raw = (exp << 24) | mantissa;
  const b = [0x00, raw & 0xff, (raw >> 8) & 0xff, (raw >> 16) & 0xff, (raw >>> 24) & 0xff];
  assert.deepEqual(parseTemperature(dv(b)), { tempC: 37.2 });
});

test("weight scale SI resolution 5 g", () => {
  // 72.5 kg / 0.005 = 14500
  const raw = 14500;
  assert.deepEqual(parseWeight(dv([0x00, raw & 0xff, raw >> 8])), { weightKg: 72.5 });
});

test("glucose record kg/L -> mg/dL", () => {
  // flags 0x02 = concentration present, kg/L. 0.00105 kg/L = 105 mg/dL -> SFLOAT mantissa 105 exponent -5
  const mantissa = 105;
  const exponent = -5 & 0x0f; // 0x0b
  const sf = (exponent << 12) | mantissa;
  const bytes = [0x02, 0x01, 0x00, /* base time 7 bytes */ 0xea, 0x07, 0x09, 0x01, 0x08, 0x00, 0x00, sf & 0xff, (sf >> 8) & 0xff, 0x00];
  const v = parseGlucose(dv(bytes));
  assert.equal(v.glucoseMgDl, 105);
});
