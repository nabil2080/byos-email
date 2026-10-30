/**
 * RFC 5545 / RFC 5546 iCalendar (iTIP) Parser & Generator
 * Handles calendar invitations, RSVP replies, updates, and cancellations.
 */

export interface IcsOrganizer {
  name?: string;
  email: string;
}

export interface IcsAttendee {
  name?: string;
  email: string;
  role?: "REQ-PARTICIPANT" | "OPT-PARTICIPANT" | "NON-PARTICIPANT";
  partstat?: "NEEDS-ACTION" | "ACCEPTED" | "DECLINED" | "TENTATIVE";
  rsvp?: boolean;
}

export interface VTimeZoneSubComponent {
  type: "STANDARD" | "DAYLIGHT";
  dtstart?: Date;
  rrule?: string;
  tzoffsetfrom: number; // offset in minutes from UTC
  tzoffsetto: number;   // offset in minutes from UTC
  tzname?: string;
}

export interface VTimeZoneDef {
  tzid: string;
  subcomponents: VTimeZoneSubComponent[];
}

export interface ParsedIcsEvent {
  uid: string;
  sequence: number;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  startTime: Date;
  endTime: Date;
  isAllDay: boolean;
  isFloating?: boolean;
  timezone?: string;
  rrule?: string;
  recurrenceId?: string;
  exdates?: string[];
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  organizer?: IcsOrganizer;
  attendees: IcsAttendee[];
  method?: string; // e.g. "REQUEST", "REPLY", "CANCEL"
  reminders?: { minutesBefore: number; method?: "notification" | "email" }[];
}

export interface ParsedIcs {
  method?: string;
  events: ParsedIcsEvent[];
  isInvitation: boolean;
  timezones?: Record<string, VTimeZoneDef>;
}

export const MAX_ICS_SIZE = 512 * 1024; // 512 KB
export const MAX_EVENTS_COUNT = 100; // max 100 events per batch per Category 14 specification

/** Unescapes RFC 5545 text characters: \, -> ,, \; -> ;, \\ -> \, \n or \N -> \n, and strips non-printable control characters */
export function unescapeIcsText(str: string): string {
  if (!str) return "";
  const unescaped = str
    .replace(/\\([,;Nn\\])/g, (_, ch) => {
      if (ch === "n" || ch === "N") return "\n";
      return ch;
    });
  // Strip dangerous ASCII control characters (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F)
  return unescaped.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

/** Escapes text for RFC 5545 format: \, ;, \ and newlines */
export function escapeIcsText(str: string): string {
  if (!str) return "";
  return str
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Folds an iCalendar line at 75 octets per RFC 5545 Section 3.1 */
export function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let remaining = line;
  while (remaining.length > 75) {
    chunks.push(remaining.slice(0, 75));
    remaining = remaining.slice(75);
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks.join("\r\n ");
}

function ensureDate(d: Date | string | number): Date {
  if (d instanceof Date) return isNaN(d.getTime()) ? new Date() : d;
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** Formats a Date into UTC iCalendar timestamp: YYYYMMDDTHHMMSSZ */
export function formatIcsUtc(d: Date | string | number): string {
  const dateObj = ensureDate(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = dateObj.getUTCFullYear();
  const month = pad(dateObj.getUTCMonth() + 1);
  const day = pad(dateObj.getUTCDate());
  const hours = pad(dateObj.getUTCHours());
  const mins = pad(dateObj.getUTCMinutes());
  const secs = pad(dateObj.getUTCSeconds());
  return `${year}${month}${day}T${hours}${mins}${secs}Z`;
}

/** Formats a Date into all-day date: YYYYMMDD */
export function formatIcsDateOnly(d: Date | string | number): string {
  const dateObj = ensureDate(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dateObj.getUTCFullYear()}${pad(dateObj.getUTCMonth() + 1)}${pad(dateObj.getUTCDate())}`;
}

/** Parses RFC 5545 offset string (+HHMM, -HHMM, +HH:MM, -HH:MM) into minutes */
export function parseIcsOffset(val: string): number {
  if (!val) return 0;
  const clean = val.trim();
  const m = clean.match(/^([+-])(\d{1,2}):?(\d{2})?$/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  const h = parseInt(m[2], 10);
  const min = parseInt(m[3] || "0", 10);
  return sign * (h * 60 + min);
}

/** Formats integer minutes into RFC 5545 offset string: +HHMM or -HHMM */
export function formatIcsOffset(min: number): string {
  const sign = min < 0 ? "-" : "+";
  const abs = Math.abs(min);
  const h = String(Math.floor(abs / 60)).padStart(2, "0");
  const m = String(abs % 60).padStart(2, "0");
  return `${sign}${h}${m}`;
}

/**
 * Parses an RFC 5545 TRIGGER duration string into minutes before the event.
 * e.g. "-PT15M" -> 15, "-PT1H" -> 60, "-P1D" -> 1440, "PT0M" -> 0
 */
export function parseIcsTriggerMinutes(trigger: string): number {
  if (!trigger) return 0;
  const clean = trigger.trim();
  const match = clean.match(/^-?P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!match) return 0;
  const days = parseInt(match[1] || "0", 10);
  const hours = parseInt(match[2] || "0", 10);
  const mins = parseInt(match[3] || "0", 10);
  return days * 1440 + hours * 60 + mins;
}

/** Computes nth occurrence of Sunday in a given month (e.g. 1SU, 2SU, -1SU) */
export function getNthSunday(year: number, month: number, nth: number): number {
  if (nth === -1) {
    const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const lastDayOfWeek = new Date(Date.UTC(year, month, 0)).getUTCDay();
    return lastDayOfMonth - lastDayOfWeek;
  }
  const firstDayOfWeek = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const firstSun = 1 + ((7 - firstDayOfWeek) % 7);
  return firstSun + (nth - 1) * 7;
}

/** Converts a local date/time into a UTC Date object using IANA or VTIMEZONE definitions */
export function convertLocalToUtc(
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
  s: number,
  tzid?: string,
  timezones?: Record<string, VTimeZoneDef>
): Date {
  if (!tzid || tzid.toUpperCase() === "UTC" || tzid.toUpperCase() === "ETC/UTC") {
    return new Date(Date.UTC(y, m - 1, d, h, min, s));
  }

  const cleanTzid = tzid.trim();

  // 1. Try native Intl.DateTimeFormat (supports all standard IANA timezones)
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: cleanTzid });
    let guess = Date.UTC(y, m - 1, d, h, min, s);
    for (let iter = 0; iter < 4; iter++) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: cleanTzid,
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
        hour12: false,
      }).formatToParts(new Date(guess));
      const p: Record<string, number> = {};
      for (const part of parts) {
        if (part.type !== "literal") p[part.type] = parseInt(part.value, 10);
      }
      if (p.hour === 24) p.hour = 0;
      const localGuessMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
      const targetMs = Date.UTC(y, m - 1, d, h, min, s);
      const diff = targetMs - localGuessMs;
      guess += diff;
      if (diff === 0) break;
    }
    return new Date(guess);
  } catch {
    // Not a recognized IANA timezone, check parsed VTIMEZONE definitions
  }

  // 2. Check parsed VTIMEZONE definitions
  const tzDef = timezones ? timezones[cleanTzid] : undefined;
  if (tzDef && tzDef.subcomponents && tzDef.subcomponents.length > 0) {
    const std = tzDef.subcomponents.find((c) => c.type === "STANDARD");
    const dst = tzDef.subcomponents.find((c) => c.type === "DAYLIGHT");

    let offset = std ? std.tzoffsetto : tzDef.subcomponents[0].tzoffsetto;

    if (std && dst) {
      // Determine if local date (y, m, d) is inside Daylight Saving Time
      const isNorthern = dst.tzoffsetto > std.tzoffsetto;
      let inDst = false;

      if (isNorthern) {
        if (m >= 4 && m <= 10) {
          inDst = true;
        } else if (m === 3) {
          const transDay = getNthSunday(y, 3, 2);
          inDst = d > transDay || (d === transDay && h >= 2);
        } else if (m === 11) {
          const transDay = getNthSunday(y, 11, 1);
          inDst = d < transDay || (d === transDay && h < 2);
        }
      } else {
        // Southern hemisphere
        if (m >= 11 || m <= 3) {
          inDst = true;
        } else if (m === 10) {
          const transDay = getNthSunday(y, 10, 1);
          inDst = d > transDay || (d === transDay && h >= 2);
        } else if (m === 4) {
          const transDay = getNthSunday(y, 4, 1);
          inDst = d < transDay || (d === transDay && h < 3);
        }
      }
      offset = inDst ? dst.tzoffsetto : std.tzoffsetto;
    }

    return new Date(Date.UTC(y, m - 1, d, h, min, s) - offset * 60 * 1000);
  }

  // 3. Check if cleanTzid is an explicit offset (e.g. GMT+0500, +0300)
  const offsetM = cleanTzid.match(/(?:GMT|UTC)?([+-]\d{1,2}:?\d{2})/i);
  if (offsetM) {
    const off = parseIcsOffset(offsetM[1]);
    return new Date(Date.UTC(y, m - 1, d, h, min, s) - off * 60 * 1000);
  }

  // Fallback: treat as UTC
  return new Date(Date.UTC(y, m - 1, d, h, min, s));
}

/** Formats a Date object into a local RFC 5545 time string: YYYYMMDDTHHMMSS */
export function formatIcsLocalTime(d: Date | string | number, timezone?: string): string {
  const dateObj = ensureDate(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (!timezone || timezone.toUpperCase() === "UTC" || timezone.toUpperCase() === "ETC/UTC") {
    return `${dateObj.getUTCFullYear()}${pad(dateObj.getUTCMonth() + 1)}${pad(dateObj.getUTCDate())}T${pad(dateObj.getUTCHours())}${pad(dateObj.getUTCMinutes())}${pad(dateObj.getUTCSeconds())}`;
  }

  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone.trim(),
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    }).formatToParts(dateObj);
    const p: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== "literal") p[part.type] = String(part.value).padStart(2, "0");
    }
    if (p.hour === "24") p.hour = "00";
    return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`;
  } catch {
    return `${dateObj.getUTCFullYear()}${pad(dateObj.getUTCMonth() + 1)}${pad(dateObj.getUTCDate())}T${pad(dateObj.getUTCHours())}${pad(dateObj.getUTCMinutes())}${pad(dateObj.getUTCSeconds())}`;
  }
}

/** Generates an RFC 5545 VTIMEZONE component for a given timezone identifier */
export function generateVTimeZone(tzid: string): string[] {
  const cleanTzid = tzid.trim();
  let janOffset = 0;
  let julOffset = 0;
  let janName = cleanTzid;
  let julName = cleanTzid;
  let hasDst = false;

  const getOffsetMin = (date: Date, tz: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
      year: "numeric",
    }).formatToParts(date);
    const tzPart = parts.find((p) => p.type === "timeZoneName")?.value || "GMT";
    const m = tzPart.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
    if (!m) return 0;
    const sign = m[1] === "-" ? -1 : 1;
    const h = parseInt(m[2], 10);
    const min = parseInt(m[3] || "0", 10);
    return sign * (h * 60 + min);
  };

  const getName = (date: Date, tz: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "short",
      year: "numeric",
    }).formatToParts(date);
    return parts.find((p) => p.type === "timeZoneName")?.value || tz;
  };

  try {
    const jan = new Date(Date.UTC(2026, 0, 15));
    const jul = new Date(Date.UTC(2026, 6, 15));
    janOffset = getOffsetMin(jan, cleanTzid);
    julOffset = getOffsetMin(jul, cleanTzid);
    janName = getName(jan, cleanTzid);
    julName = getName(jul, cleanTzid);
    hasDst = janOffset !== julOffset;
  } catch {
    hasDst = false;
  }

  const lines: string[] = ["BEGIN:VTIMEZONE", `TZID:${cleanTzid}`];

  if (!hasDst) {
    lines.push("BEGIN:STANDARD");
    lines.push("DTSTART:19700101T000000");
    lines.push(`TZOFFSETFROM:${formatIcsOffset(janOffset)}`);
    lines.push(`TZOFFSETTO:${formatIcsOffset(janOffset)}`);
    lines.push(`TZNAME:${janName}`);
    lines.push("END:STANDARD");
  } else {
    const isSouthern = janOffset > julOffset;
    const stdOffset = isSouthern ? julOffset : janOffset;
    const stdName = isSouthern ? julName : janName;
    const dstOffset = isSouthern ? janOffset : julOffset;
    const dstName = isSouthern ? janName : julName;

    let dstStart = "19700308T020000";
    let dstRule = "FREQ=YEARLY;BYMONTH=3;BYDAY=2SU";
    let stdStart = "19701101T020000";
    let stdRule = "FREQ=YEARLY;BYMONTH=11;BYDAY=1SU";

    if (isSouthern) {
      dstStart = "19701004T020000";
      dstRule = "FREQ=YEARLY;BYMONTH=10;BYDAY=1SU";
      stdStart = "19700405T030000";
      stdRule = "FREQ=YEARLY;BYMONTH=4;BYDAY=1SU";
    } else if (
      cleanTzid.startsWith("Europe/") ||
      cleanTzid === "GB" ||
      cleanTzid === "WET" ||
      cleanTzid === "CET" ||
      cleanTzid === "EET"
    ) {
      dstStart = "19700329T010000";
      dstRule = "FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU";
      stdStart = "19701025T020000";
      stdRule = "FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU";
    }

    lines.push("BEGIN:DAYLIGHT");
    lines.push(`DTSTART:${dstStart}`);
    lines.push(`RRULE:${dstRule}`);
    lines.push(`TZOFFSETFROM:${formatIcsOffset(stdOffset)}`);
    lines.push(`TZOFFSETTO:${formatIcsOffset(dstOffset)}`);
    lines.push(`TZNAME:${dstName}`);
    lines.push("END:DAYLIGHT");

    lines.push("BEGIN:STANDARD");
    lines.push(`DTSTART:${stdStart}`);
    lines.push(`RRULE:${stdRule}`);
    lines.push(`TZOFFSETFROM:${formatIcsOffset(dstOffset)}`);
    lines.push(`TZOFFSETTO:${formatIcsOffset(stdOffset)}`);
    lines.push(`TZNAME:${stdName}`);
    lines.push("END:STANDARD");
  }

  lines.push("END:VTIMEZONE");
  return lines;
}

/** Parses an iCalendar date-time string into a JS Date object with timezone conversion */
export function parseIcsDate(
  val: string,
  tzid?: string,
  timezones?: Record<string, VTimeZoneDef>
): { date: Date; isAllDay: boolean; isFloating?: boolean; timezone?: string } {
  const clean = val.trim();
  // All day: YYYYMMDD (8 digits)
  if (/^\d{8}$/.test(clean)) {
    const y = parseInt(clean.slice(0, 4), 10);
    const m = parseInt(clean.slice(4, 6), 10) - 1;
    const d = parseInt(clean.slice(6, 8), 10);
    if (m < 0 || m > 11 || d < 1 || d > 31) {
      return { date: new Date(), isAllDay: true };
    }
    return { date: new Date(Date.UTC(y, m, d, 0, 0, 0)), isAllDay: true };
  }

  // UTC: YYYYMMDDTHHMMSSZ
  if (/^\d{8}T\d{6}Z$/i.test(clean)) {
    const y = parseInt(clean.slice(0, 4), 10);
    const m = parseInt(clean.slice(4, 6), 10) - 1;
    const d = parseInt(clean.slice(6, 8), 10);
    const hh = parseInt(clean.slice(9, 11), 10);
    const mm = parseInt(clean.slice(11, 13), 10);
    const ss = parseInt(clean.slice(13, 15), 10);
    if (m < 0 || m > 11 || d < 1 || d > 31 || hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 60) {
      return { date: new Date(), isAllDay: false, isFloating: false, timezone: "UTC" };
    }
    return { date: new Date(Date.UTC(y, m, d, hh, mm, ss)), isAllDay: false, isFloating: false, timezone: "UTC" };
  }

  // Local or TZ-qualified: YYYYMMDDTHHMMSS
  if (/^\d{8}T\d{6}$/i.test(clean)) {
    const y = parseInt(clean.slice(0, 4), 10);
    const m = parseInt(clean.slice(4, 6), 10);
    const d = parseInt(clean.slice(6, 8), 10);
    const hh = parseInt(clean.slice(9, 11), 10);
    const mm = parseInt(clean.slice(11, 13), 10);
    const ss = parseInt(clean.slice(13, 15), 10);
    if (m < 1 || m > 12 || d < 1 || d > 31 || hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 60) {
      return { date: new Date(), isAllDay: false };
    }

    if (tzid) {
      const utcDate = convertLocalToUtc(y, m, d, hh, mm, ss, tzid, timezones);
      return { date: utcDate, isAllDay: false, isFloating: false, timezone: tzid };
    }

    // Floating local time (no Z, no TZID)
    const floatingDate = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
    return { date: floatingDate, isAllDay: false, isFloating: true };
  }

  // ISO fallback
  const parsed = Date.parse(clean);
  if (!isNaN(parsed)) {
    return { date: new Date(parsed), isAllDay: false };
  }

  return { date: new Date(), isAllDay: false };
}

/** Strips 'mailto:' prefix case-insensitively and returns cleaned email */
export function cleanEmail(val: string): string {
  if (!val) return "";
  return val
    .replace(/^mailto:/i, "")
    .trim()
    .replace(/[<>\"']/g, "")
    .replace(/[\x00-\x1F\x7F]/g, "");
}

export const parseIcsText = (rawIcs: string): ParsedIcs => parseIcs(rawIcs);

/** Parses raw ICS content into a structured ParsedIcs representation */
export function parseIcs(rawIcs: string): ParsedIcs {
  if (!rawIcs || typeof rawIcs !== "string" || rawIcs.length > MAX_ICS_SIZE) {
    return { events: [], isInvitation: false };
  }

  // 1. Unfold lines (RFC 5545 section 3.1: CRLF followed by single space or tab)
  const unfolded = rawIcs.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  let rootMethod: string | undefined = undefined;
  const events: ParsedIcsEvent[] = [];

  let inVEvent = false;
  let currentEvent: Partial<ParsedIcsEvent> | null = null;

  let inVAlarm = false;
  let currentAlarm: { action?: string; minutesBefore?: number } | null = null;

  let inVTimeZone = false;
  let inVTimeSubComponent: "STANDARD" | "DAYLIGHT" | null = null;
  let currentTz: VTimeZoneDef | null = null;
  let currentSubComponent: VTimeZoneSubComponent | null = null;
  const timezones: Record<string, VTimeZoneDef> = {};

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const left = line.slice(0, colonIdx);
    const val = line.slice(colonIdx + 1);

    // Left may have params: e.g. ATTENDEE;CN=Bob;ROLE=REQ-PARTICIPANT
    const paramParts = left.split(";");
    const name = paramParts[0].toUpperCase().trim();
    const params: Record<string, string> = {};
    for (let i = 1; i < paramParts.length; i++) {
      const eqIdx = paramParts[i].indexOf("=");
      if (eqIdx !== -1) {
        const pKey = paramParts[i].slice(0, eqIdx).toUpperCase().trim();
        let pVal = paramParts[i].slice(eqIdx + 1).trim();
        if (pVal.startsWith('"') && pVal.endsWith('"')) {
          pVal = pVal.slice(1, -1);
        }
        params[pKey] = pVal;
      }
    }

    if (name === "BEGIN") {
      const component = val.toUpperCase().trim();
      if (component === "VEVENT" && events.length < MAX_EVENTS_COUNT) {
        inVEvent = true;
        currentEvent = {
          attendees: [],
          sequence: 0,
          status: "CONFIRMED",
        };
      } else if (component === "VTIMEZONE") {
        inVTimeZone = true;
        currentTz = { tzid: "", subcomponents: [] };
      } else if (inVTimeZone && (component === "STANDARD" || component === "DAYLIGHT")) {
        inVTimeSubComponent = component as "STANDARD" | "DAYLIGHT";
        currentSubComponent = {
          type: component as "STANDARD" | "DAYLIGHT",
          tzoffsetfrom: 0,
          tzoffsetto: 0,
        };
      } else if (component === "VALARM" && inVEvent && currentEvent) {
        inVAlarm = true;
        currentAlarm = { action: "DISPLAY", minutesBefore: 0 };
      }
    } else if (name === "END") {
      const component = val.toUpperCase().trim();
      if (component === "VALARM") {
        if (inVAlarm && currentAlarm && currentEvent) {
          if (!currentEvent.reminders) currentEvent.reminders = [];
          currentEvent.reminders.push({
            minutesBefore: currentAlarm.minutesBefore ?? 0,
            method: currentAlarm.action === "EMAIL" ? "email" : "notification",
          });
        }
        inVAlarm = false;
        currentAlarm = null;
      } else if (component === "VEVENT" && currentEvent) {
        // Complete current event
        if (!currentEvent.uid) {
          // Generate fallback UUID if missing in malformed payload
          currentEvent.uid = "ics-fallback-" + Math.random().toString(36).slice(2);
        }
        if (!currentEvent.summary) {
          currentEvent.summary = "(Untitled Event)";
        }
        if (!currentEvent.startTime) {
          currentEvent.startTime = new Date();
        }
        if (!currentEvent.endTime) {
          // Default duration: 1 hour
          currentEvent.endTime = new Date(currentEvent.startTime.getTime() + 60 * 60 * 1000);
        }
        if (currentEvent.endTime < currentEvent.startTime) {
          currentEvent.endTime = currentEvent.startTime;
        }

        events.push(currentEvent as ParsedIcsEvent);
        inVEvent = false;
        currentEvent = null;
      } else if (inVTimeZone && (component === "STANDARD" || component === "DAYLIGHT")) {
        if (currentTz && currentSubComponent) {
          currentTz.subcomponents.push(currentSubComponent);
        }
        currentSubComponent = null;
        inVTimeSubComponent = null;
      } else if (component === "VTIMEZONE") {
        if (currentTz && currentTz.tzid) {
          timezones[currentTz.tzid] = currentTz;
        }
        currentTz = null;
        inVTimeZone = false;
      }
    } else if (!inVEvent && !inVTimeZone && name === "METHOD") {
      if (!rootMethod) {
        rootMethod = val.toUpperCase().trim();
      }
    } else if (inVTimeZone) {
      if (inVTimeSubComponent && currentSubComponent) {
        switch (name) {
          case "TZOFFSETFROM":
            currentSubComponent.tzoffsetfrom = parseIcsOffset(val);
            break;
          case "TZOFFSETTO":
            currentSubComponent.tzoffsetto = parseIcsOffset(val);
            break;
          case "TZNAME":
            currentSubComponent.tzname = val.trim();
            break;
          case "DTSTART": {
            const { date } = parseIcsDate(val);
            currentSubComponent.dtstart = date;
            break;
          }
          case "RRULE":
            currentSubComponent.rrule = val.trim();
            break;
        }
      } else if (currentTz) {
        if (name === "TZID") {
          currentTz.tzid = val.trim();
        }
      }
    } else if (inVAlarm && currentAlarm) {
      if (name === "ACTION") {
        currentAlarm.action = val.toUpperCase().trim();
      } else if (name === "TRIGGER") {
        currentAlarm.minutesBefore = parseIcsTriggerMinutes(val);
      }
    } else if (inVEvent && currentEvent) {
      switch (name) {
        case "UID": {
          const cleanUid = val.trim().replace(/[\r\n\x00-\x1F\x7F]/g, "");
          if (!currentEvent.uid && cleanUid) {
            currentEvent.uid = cleanUid;
          }
          break;
        }
        case "SEQUENCE":
          currentEvent.sequence = Math.max(0, parseInt(val.trim(), 10) || 0);
          break;
        case "SUMMARY":
          currentEvent.summary = unescapeIcsText(val);
          break;
        case "DESCRIPTION":
          currentEvent.description = unescapeIcsText(val);
          break;
        case "LOCATION":
          currentEvent.location = unescapeIcsText(val);
          break;
        case "URL": {
          const cleanUrl = val.trim();
          if (/^https?:\/\//i.test(cleanUrl) || /^mailto:/i.test(cleanUrl)) {
            currentEvent.url = cleanUrl;
          }
          break;
        }
        case "RECURRENCE-ID":
          currentEvent.recurrenceId = val.trim();
          break;
        case "EXDATE": {
          const rawDates = val.split(",").map((s) => s.trim()).filter(Boolean);
          if (!currentEvent.exdates) currentEvent.exdates = [];
          const exTzid = params["TZID"] || currentEvent.timezone;
          for (const raw of rawDates) {
            const { date } = parseIcsDate(raw, exTzid, timezones);
            currentEvent.exdates.push(date.toISOString());
          }
          break;
        }
        case "STATUS": {
          const s = val.toUpperCase().trim();
          if (s === "CANCELLED" || s === "TENTATIVE" || s === "CONFIRMED") {
            currentEvent.status = s;
          }
          break;
        }
        case "DTSTART": {
          const { date, isAllDay, isFloating, timezone } = parseIcsDate(val, params["TZID"], timezones);
          currentEvent.startTime = date;
          currentEvent.isAllDay = isAllDay;
          currentEvent.isFloating = isFloating;
          if (timezone || params["TZID"]) currentEvent.timezone = timezone || params["TZID"];
          break;
        }
        case "DTEND": {
          const { date } = parseIcsDate(val, params["TZID"] || currentEvent.timezone, timezones);
          currentEvent.endTime = date;
          break;
        }
        case "RRULE":
          currentEvent.rrule = val.trim();
          break;
        case "ORGANIZER": {
          currentEvent.organizer = {
            name: params["CN"] || undefined,
            email: cleanEmail(val),
          };
          break;
        }
        case "ATTENDEE": {
          const rawPartstat = (params["PARTSTAT"] || "NEEDS-ACTION").toUpperCase();
          let partstat: "NEEDS-ACTION" | "ACCEPTED" | "DECLINED" | "TENTATIVE" = "NEEDS-ACTION";
          if (rawPartstat === "ACCEPTED" || rawPartstat === "DECLINED" || rawPartstat === "TENTATIVE") {
            partstat = rawPartstat;
          }

          const rawRole = (params["ROLE"] || "REQ-PARTICIPANT").toUpperCase();
          let role: "REQ-PARTICIPANT" | "OPT-PARTICIPANT" | "NON-PARTICIPANT" = "REQ-PARTICIPANT";
          if (rawRole === "OPT-PARTICIPANT" || rawRole === "NON-PARTICIPANT") {
            role = rawRole;
          }

          const rsvp = params["RSVP"] ? params["RSVP"].toUpperCase() === "TRUE" : undefined;

          currentEvent.attendees!.push({
            name: params["CN"] || undefined,
            email: cleanEmail(val),
            role,
            partstat,
            rsvp,
          });
          break;
        }
      }
    }
  }

  // Set method on events if not present individually
  for (const ev of events) {
    if (!ev.method && rootMethod) {
      ev.method = rootMethod;
    }
  }

  const isInvitation =
    rootMethod === "REQUEST" ||
    rootMethod === "REPLY" ||
    rootMethod === "CANCEL" ||
    events.some((e) => Boolean(e.organizer) && e.attendees.length > 0);

  return {
    method: rootMethod,
    events,
    isInvitation,
    timezones,
  };
}

/** Parameters to generate an RFC 5545 / RFC 5546 iCalendar string */
export interface IcsExceptionParams {
  recurrenceId: Date | string;
  isCancelled?: boolean;
  startTime: Date;
  endTime: Date;
  isAllDay?: boolean;
  isFloating?: boolean;
  timezone?: string;
  title?: string;
  description?: string;
  location?: string;
  meetingUrl?: string;
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
}

export interface GenerateIcsParams {
  uid: string;
  sequence?: number;
  method?: "REQUEST" | "REPLY" | "CANCEL" | "PUBLISH";
  title: string;
  description?: string;
  location?: string;
  meetingUrl?: string;
  startTime: Date;
  endTime: Date;
  isAllDay?: boolean;
  isFloating?: boolean;
  timezone?: string;
  rrule?: string;
  recurrenceId?: string | Date;
  exdates?: (Date | string)[];
  exceptions?: IcsExceptionParams[];
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  classification?: "PUBLIC" | "PRIVATE" | "CONFIDENTIAL";
  reminders?: { minutesBefore: number; method?: "notification" | "email" | string }[];
  attachments?: { url?: string; name?: string; contentType?: string }[];
  organizer?: IcsOrganizer;
  attendees?: IcsAttendee[];
}

/** Generates a compliant RFC 5545 / RFC 5546 iCalendar string */
export function generateIcs(params: GenerateIcsParams): string {
  const method = params.method || "REQUEST";
  const sequence = params.sequence ?? 0;
  const status = params.status || (method === "CANCEL" ? "CANCELLED" : "CONFIRMED");
  const nowUtc = formatIcsUtc(new Date());

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "PRODID:-//BYOS//BYOS Webmail Calendar//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
  ];

  if (params.timezone && params.timezone.toUpperCase() !== "UTC" && params.timezone.toUpperCase() !== "ETC/UTC") {
    lines.push(...generateVTimeZone(params.timezone));
  }

  lines.push("BEGIN:VEVENT");
  lines.push(`UID:${params.uid}`);
  lines.push(`SEQUENCE:${sequence}`);
  lines.push(`DTSTAMP:${nowUtc}`);

  if (params.recurrenceId) {
    const recIdStr =
      params.recurrenceId instanceof Date
        ? formatIcsUtc(params.recurrenceId)
        : params.recurrenceId.includes("T")
        ? params.recurrenceId.replace(/[-:]/g, "").replace(/\.\d{3}/, "")
        : params.recurrenceId;
    lines.push(`RECURRENCE-ID:${recIdStr}`);
  }

  if (params.isAllDay) {
    const endDate =
      params.endTime && params.endTime > params.startTime
        ? params.endTime
        : new Date(params.startTime.getTime() + 86400000);
    lines.push(`DTSTART;VALUE=DATE:${formatIcsDateOnly(params.startTime)}`);
    lines.push(`DTEND;VALUE=DATE:${formatIcsDateOnly(endDate)}`);
  } else if (params.isFloating) {
    lines.push(`DTSTART:${formatIcsLocalTime(params.startTime)}`);
    lines.push(`DTEND:${formatIcsLocalTime(params.endTime)}`);
  } else if (params.timezone && params.timezone.toUpperCase() !== "UTC" && params.timezone.toUpperCase() !== "ETC/UTC") {
    lines.push(`DTSTART;TZID=${params.timezone}:${formatIcsLocalTime(params.startTime, params.timezone)}`);
    lines.push(`DTEND;TZID=${params.timezone}:${formatIcsLocalTime(params.endTime, params.timezone)}`);
  } else {
    lines.push(`DTSTART:${formatIcsUtc(params.startTime)}`);
    lines.push(`DTEND:${formatIcsUtc(params.endTime)}`);
  }

  lines.push(`SUMMARY:${escapeIcsText(params.title)}`);

  if (params.description && params.description.trim()) {
    lines.push(`DESCRIPTION:${escapeIcsText(params.description.trim())}`);
  }

  if (params.location && params.location.trim()) {
    lines.push(`LOCATION:${escapeIcsText(params.location.trim())}`);
  }

  if (params.meetingUrl && params.meetingUrl.trim()) {
    lines.push(`URL:${params.meetingUrl.trim()}`);
  }

  if (params.classification) {
    lines.push(`CLASS:${params.classification.toUpperCase()}`);
  }

  if (params.attachments && params.attachments.length > 0) {
    for (const att of params.attachments) {
      if (att.url) {
        const fmt = att.contentType ? `;FMTTYPE=${att.contentType}` : "";
        lines.push(`ATTACH${fmt}:${att.url}`);
      }
    }
  }

  if (params.rrule && params.rrule.trim()) {
    lines.push(`RRULE:${params.rrule.trim()}`);
  }

  if (params.exdates && params.exdates.length > 0) {
    if (params.isAllDay) {
      const formattedExdates = params.exdates.map((d) =>
        formatIcsDateOnly(d instanceof Date ? d : new Date(d))
      );
      lines.push(`EXDATE;VALUE=DATE:${formattedExdates.join(",")}`);
    } else if (params.isFloating) {
      const formattedExdates = params.exdates.map((d) =>
        formatIcsLocalTime(d instanceof Date ? d : new Date(d))
      );
      lines.push(`EXDATE:${formattedExdates.join(",")}`);
    } else if (params.timezone && params.timezone.toUpperCase() !== "UTC" && params.timezone.toUpperCase() !== "ETC/UTC") {
      const formattedExdates = params.exdates.map((d) =>
        formatIcsLocalTime(d instanceof Date ? d : new Date(d), params.timezone)
      );
      lines.push(`EXDATE;TZID=${params.timezone}:${formattedExdates.join(",")}`);
    } else {
      const formattedExdates = params.exdates.map((d) =>
        formatIcsUtc(d instanceof Date ? d : new Date(d))
      );
      lines.push(`EXDATE:${formattedExdates.join(",")}`);
    }
  }

  // Organizer
  if (params.organizer && params.organizer.email) {
    const orgCn = params.organizer.name ? `;CN="${escapeIcsText(params.organizer.name)}"` : "";
    lines.push(`ORGANIZER${orgCn}:mailto:${cleanEmail(params.organizer.email)}`);
  }

  // Attendees
  if (params.attendees && params.attendees.length > 0) {
    for (const att of params.attendees) {
      const cn = att.name ? `;CN="${escapeIcsText(att.name)}"` : "";
      const role = att.role ? `;ROLE=${att.role}` : ";ROLE=REQ-PARTICIPANT";
      const partstat = att.partstat ? `;PARTSTAT=${att.partstat}` : ";PARTSTAT=NEEDS-ACTION";
      const rsvp = att.rsvp !== undefined ? `;RSVP=${att.rsvp ? "TRUE" : "FALSE"}` : ";RSVP=TRUE";
      lines.push(`ATTENDEE${cn}${role}${partstat}${rsvp}:mailto:${cleanEmail(att.email)}`);
    }
  }

  // Reminders / Alarms
  if (params.reminders && params.reminders.length > 0) {
    for (const rem of params.reminders) {
      if (rem.minutesBefore >= 0) {
        const action = rem.method === "email" ? "EMAIL" : "DISPLAY";
        lines.push(
          "BEGIN:VALARM",
          `ACTION:${action}`,
          `DESCRIPTION:${escapeIcsText(params.title)}`,
          `TRIGGER:-PT${rem.minutesBefore}M`,
          "END:VALARM"
        );
      }
    }
  }

  lines.push(`STATUS:${status}`);
  lines.push("END:VEVENT");

  // Detached recurrence exceptions
  if (params.exceptions && params.exceptions.length > 0) {
    for (const exc of params.exceptions) {
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${params.uid}`);
      lines.push(`SEQUENCE:${sequence}`);
      lines.push(`DTSTAMP:${nowUtc}`);
      const recDate = exc.recurrenceId instanceof Date ? exc.recurrenceId : new Date(exc.recurrenceId);
      const excTz = exc.timezone || params.timezone;
      const isExcFloating = exc.isFloating ?? params.isFloating;

      if (exc.isAllDay || params.isAllDay) {
        lines.push(`RECURRENCE-ID;VALUE=DATE:${formatIcsDateOnly(recDate)}`);
        lines.push(`DTSTART;VALUE=DATE:${formatIcsDateOnly(exc.startTime)}`);
        lines.push(`DTEND;VALUE=DATE:${formatIcsDateOnly(exc.endTime)}`);
      } else if (isExcFloating) {
        lines.push(`RECURRENCE-ID:${formatIcsLocalTime(recDate)}`);
        lines.push(`DTSTART:${formatIcsLocalTime(exc.startTime)}`);
        lines.push(`DTEND:${formatIcsLocalTime(exc.endTime)}`);
      } else if (excTz && excTz.toUpperCase() !== "UTC" && excTz.toUpperCase() !== "ETC/UTC") {
        lines.push(`RECURRENCE-ID;TZID=${excTz}:${formatIcsLocalTime(recDate, excTz)}`);
        lines.push(`DTSTART;TZID=${excTz}:${formatIcsLocalTime(exc.startTime, excTz)}`);
        lines.push(`DTEND;TZID=${excTz}:${formatIcsLocalTime(exc.endTime, excTz)}`);
      } else {
        lines.push(`RECURRENCE-ID:${formatIcsUtc(recDate)}`);
        lines.push(`DTSTART:${formatIcsUtc(exc.startTime)}`);
        lines.push(`DTEND:${formatIcsUtc(exc.endTime)}`);
      }

      const excTitle = exc.title || params.title;
      lines.push(`SUMMARY:${escapeIcsText(excTitle)}`);

      const excDesc = exc.description !== undefined ? exc.description : params.description;
      if (excDesc && excDesc.trim()) {
        lines.push(`DESCRIPTION:${escapeIcsText(excDesc.trim())}`);
      }

      const excLoc = exc.location !== undefined ? exc.location : params.location;
      if (excLoc && excLoc.trim()) {
        lines.push(`LOCATION:${escapeIcsText(excLoc.trim())}`);
      }

      const excUrl = exc.meetingUrl !== undefined ? exc.meetingUrl : params.meetingUrl;
      if (excUrl && excUrl.trim()) {
        lines.push(`URL:${excUrl.trim()}`);
      }

      if (params.organizer && params.organizer.email) {
        const orgCn = params.organizer.name ? `;CN="${escapeIcsText(params.organizer.name)}"` : "";
        lines.push(`ORGANIZER${orgCn}:mailto:${cleanEmail(params.organizer.email)}`);
      }

      const excStatus = exc.status || (exc.isCancelled ? "CANCELLED" : "CONFIRMED");
      lines.push(`STATUS:${excStatus}`);
      lines.push("END:VEVENT");
    }
  }

  lines.push("END:VCALENDAR");

  // Fold lines exceeding 75 characters
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/** Generates an RFC 5546 iTIP RSVP Reply message */
export function generateRsvpReplyIcs(params: {
  uid: string;
  sequence?: number;
  recurrenceId?: string | Date;
  title: string;
  startTime: Date;
  endTime: Date;
  isAllDay?: boolean;
  isFloating?: boolean;
  timezone?: string;
  organizer: IcsOrganizer;
  responder: {
    name?: string;
    email: string;
    status: "ACCEPTED" | "TENTATIVE" | "DECLINED";
  };
}): string {
  const sequence = params.sequence ?? 0;
  const nowUtc = formatIcsUtc(new Date());

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "PRODID:-//BYOS//BYOS Webmail Calendar//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REPLY",
  ];

  if (params.timezone && params.timezone.toUpperCase() !== "UTC" && params.timezone.toUpperCase() !== "ETC/UTC") {
    lines.push(...generateVTimeZone(params.timezone));
  }

  lines.push("BEGIN:VEVENT");
  lines.push(`UID:${params.uid}`);
  lines.push(`SEQUENCE:${sequence}`);
  lines.push(`DTSTAMP:${nowUtc}`);

  if (params.recurrenceId) {
    const recIdStr =
      params.recurrenceId instanceof Date
        ? formatIcsUtc(params.recurrenceId)
        : params.recurrenceId.includes("T")
        ? params.recurrenceId.replace(/[-:]/g, "").replace(/\.\d{3}/, "")
        : params.recurrenceId;
    lines.push(`RECURRENCE-ID:${recIdStr}`);
  }

  if (params.isAllDay) {
    const endDate =
      params.endTime && params.endTime > params.startTime
        ? params.endTime
        : new Date(params.startTime.getTime() + 86400000);
    lines.push(`DTSTART;VALUE=DATE:${formatIcsDateOnly(params.startTime)}`);
    lines.push(`DTEND;VALUE=DATE:${formatIcsDateOnly(endDate)}`);
  } else if (params.isFloating) {
    lines.push(`DTSTART:${formatIcsLocalTime(params.startTime)}`);
    lines.push(`DTEND:${formatIcsLocalTime(params.endTime)}`);
  } else if (params.timezone && params.timezone.toUpperCase() !== "UTC" && params.timezone.toUpperCase() !== "ETC/UTC") {
    lines.push(`DTSTART;TZID=${params.timezone}:${formatIcsLocalTime(params.startTime, params.timezone)}`);
    lines.push(`DTEND;TZID=${params.timezone}:${formatIcsLocalTime(params.endTime, params.timezone)}`);
  } else {
    lines.push(`DTSTART:${formatIcsUtc(params.startTime)}`);
    lines.push(`DTEND:${formatIcsUtc(params.endTime)}`);
  }

  lines.push(`SUMMARY:${escapeIcsText(params.title)}`);

  const orgCn = params.organizer.name ? `;CN="${escapeIcsText(params.organizer.name)}"` : "";
  lines.push(`ORGANIZER${orgCn}:mailto:${cleanEmail(params.organizer.email)}`);

  const respCn = params.responder.name ? `;CN="${escapeIcsText(params.responder.name)}"` : "";
  lines.push(`ATTENDEE${respCn};PARTSTAT=${params.responder.status}:mailto:${cleanEmail(params.responder.email)}`);

  lines.push(`STATUS:${params.responder.status === "DECLINED" ? "CANCELLED" : "CONFIRMED"}`);
  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");

  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/**
 * Distinguishes three classes of rejection returned by verifyInvitationAuthenticity:
 *
 * isInvalidInput — The incoming event violates BYOS validation policy (e.g. missing
 *   UID, or a SEQUENCE value rejected as unsupported by BYOS). RFC 5545 defines
 *   SEQUENCE as a signed integer, but RFC 5546 §3.5 states the initial value is zero
 *   and updates must monotonically increment. BYOS additionally rejects any incoming
 *   SEQUENCE that is negative because no conformant organizer produces such values and
 *   accepting them would bypass the stale-update guard.
 *
 * isStale — A valid SEQUENCE was supplied but it is numerically lower than the sequence
 *   already persisted for the matching UID, so this is an older revision arriving after
 *   a newer one has been processed.
 *
 * isOrganizerMismatch — The incoming update claims a different organizer than the one
 *   recorded for the existing event with the same UID.
 *
 * isDuplicate — The incoming revision has the same sequence as the persisted event AND
 *   the proposed RSVP status is identical to the already-stored status, so re-applying
 *   it would produce no change and should not trigger a reply email.
 */
export interface AuthenticityCheckResult {
  valid: boolean;
  reason?: string;
  /** True when the incoming event is rejected under BYOS validation policy (e.g. negative SEQUENCE). */
  isInvalidInput?: boolean;
  /** True when the incoming revision is older than the stored event — a genuine stale delivery. */
  isStale?: boolean;
  isOrganizerMismatch?: boolean;
  isDuplicate?: boolean;
}

/**
 * Validates an incoming invitation against an existing stored event.
 *
 * Note on method semantics (RFC 5546):
 *   REQUEST  — Organizer sends to attendees; sequence increments on significant changes.
 *   CANCEL   — Organizer sends; sequence increments above latest REQUEST.
 *   REPLY    — Attendee sends back to organizer; attendee must NOT increment the
 *              organizer's sequence. The sequence in a REPLY is the organizer's original
 *              sequence echoed back — callers must NOT apply the stale check to REPLY
 *              messages as if the attendee were the sequencing authority.
 *
 * The proposedRsvp argument is only meaningful for REQUEST / CANCEL handling. Pass
 * undefined when processing a REPLY from an attendee.
 */
export function verifyInvitationAuthenticity(
  incoming: ParsedIcsEvent,
  existingDetails?: {
    uid?: string;
    sequence?: number;
    organizer?: IcsOrganizer;
    myRsvpStatus?: string;
  } | null,
  proposedRsvp?: string
): AuthenticityCheckResult {
  if (!incoming.uid || !incoming.uid.trim()) {
    return { valid: false, isInvalidInput: true, reason: "Invitation missing required UID property" };
  }

  // BYOS policy: reject incoming SEQUENCE values below zero.
  // RFC 5545 defines SEQUENCE as a signed integer, but RFC 5546 §3.5 requires
  // organizers to start at zero and only increment. No conformant iTIP implementation
  // produces negative sequences; accepting them would undermine the stale-revision guard.
  const incomingSeqRaw = incoming.sequence !== undefined ? incoming.sequence : 0;
  if (incomingSeqRaw < 0) {
    return {
      valid: false,
      isInvalidInput: true,
      reason: `Rejected by BYOS policy: SEQUENCE ${incomingSeqRaw} is below zero. Conformant organizers start at 0 and only increment.`,
    };
  }

  if (existingDetails && existingDetails.uid === incoming.uid) {
    // 1. Organizer verification: incoming update MUST originate from the same organizer
    if (existingDetails.organizer?.email && incoming.organizer?.email) {
      const existingOrg = cleanEmail(existingDetails.organizer.email).toLowerCase();
      const incomingOrg = cleanEmail(incoming.organizer.email).toLowerCase();
      if (existingOrg !== incomingOrg) {
        return {
          valid: false,
          isOrganizerMismatch: true,
          reason: `Organizer mismatch: incoming organizer (${incomingOrg}) does not match existing organizer (${existingOrg})`,
        };
      }
    }

    // 2. Genuine stale-update check: incoming sequence is numerically lower than the stored sequence.
    const existingSeq = existingDetails.sequence !== undefined ? existingDetails.sequence : 0;
    const incomingSeq = incoming.sequence !== undefined ? incoming.sequence : 0;
    if (incomingSeq < existingSeq) {
      return {
        valid: false,
        isStale: true,
        reason: `Stale update: incoming revision v${incomingSeq} is older than stored revision v${existingSeq}`,
      };
    }

    // 3. Duplicate check: same revision already processed with the same RSVP response.
    // Does not apply to REPLY method (attendee echoes organizer sequence, not their own).
    if (
      proposedRsvp &&
      incomingSeq === existingSeq &&
      existingDetails.myRsvpStatus?.toLowerCase() === proposedRsvp.toLowerCase()
    ) {
      return {
        valid: true,
        isDuplicate: true,
        reason: `Duplicate delivery: revision v${incomingSeq} already processed with response '${proposedRsvp}'`,
      };
    }
  }

  return { valid: true };
}

export interface GroupedSeriesEvents {
  master: ParsedIcsEvent;
  exceptions: ParsedIcsEvent[];
  cancelledRecurrenceIds: string[];
}

/**
 * Groups raw parsed ICS events into master series and detached exceptions by UID.
 */
export function groupSeriesEvents(events: ParsedIcsEvent[]): {
  singleEvents: ParsedIcsEvent[];
  series: GroupedSeriesEvents[];
} {
  const masterMap = new Map<string, ParsedIcsEvent>();
  const exceptionsMap = new Map<string, ParsedIcsEvent[]>();
  const singleEvents: ParsedIcsEvent[] = [];

  for (const ev of events) {
    if (ev.recurrenceId) {
      const list = exceptionsMap.get(ev.uid) || [];
      list.push(ev);
      exceptionsMap.set(ev.uid, list);
    } else if (ev.rrule) {
      masterMap.set(ev.uid, ev);
    } else {
      singleEvents.push(ev);
    }
  }

  const series: GroupedSeriesEvents[] = [];
  for (const [uid, master] of masterMap.entries()) {
    const rawExceptions = exceptionsMap.get(uid) || [];
    const exceptions: ParsedIcsEvent[] = [];
    const cancelledRecurrenceIds: string[] = [];

    if (master.exdates) {
      for (const ex of master.exdates) {
        cancelledRecurrenceIds.push(ex);
      }
    }

    for (const exc of rawExceptions) {
      if (exc.status === "CANCELLED") {
        if (exc.recurrenceId) {
          cancelledRecurrenceIds.push(exc.recurrenceId);
        }
      } else {
        exceptions.push(exc);
      }
    }

    series.push({
      master,
      exceptions,
      cancelledRecurrenceIds,
    });
  }

  return { singleEvents, series };
}
