/** Build an iCalendar (.ics) file so care-plan items and goals land on a real calendar. */

export interface IcsEvent {
  uid: string;
  title: string;
  description?: string;
  start: Date;
  durationMinutes?: number;
  allDay?: boolean;
  alarmMinutesBefore?: number;
  rrule?: string; // e.g. FREQ=DAILY
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function fmtUtc(d: Date) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}
function fmtDate(d: Date) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
function esc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

export function buildIcs(events: IcsEvent[], calName = "Hypochondriac"): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Hypochondriac//Health companion//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${esc(calName)}`];
  const now = fmtUtc(new Date());
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}@hypochondriac`, `DTSTAMP:${now}`, `SUMMARY:${esc(e.title)}`);
    if (e.allDay) {
      const end = new Date(e.start);
      end.setDate(end.getDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${fmtDate(e.start)}`, `DTEND;VALUE=DATE:${fmtDate(end)}`);
    } else {
      const end = new Date(e.start.getTime() + (e.durationMinutes ?? 30) * 60_000);
      lines.push(`DTSTART:${fmtUtc(e.start)}`, `DTEND:${fmtUtc(end)}`);
    }
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.rrule) lines.push(`RRULE:${e.rrule}`);
    if (e.alarmMinutesBefore != null) {
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.title)}`, `TRIGGER:-PT${e.alarmMinutesBefore}M`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  // RFC 5545 line folding
  return lines.map((l) => fold(l)).join("\r\n") + "\r\n";
}

function fold(line: string): string {
  const out: string[] = [];
  let s = line;
  while (s.length > 73) {
    out.push(s.slice(0, 73));
    s = " " + s.slice(73);
  }
  out.push(s);
  return out.join("\r\n");
}

export function downloadIcs(filename: string, ics: string) {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
