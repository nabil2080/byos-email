/**
 * BYOS Calendar - Category 14: Import, Export and Synchronization
 * RFC 5545 iCalendar Import & Export Engine
 * 
 * PRIVACY GUARANTEE:
 * Import parsing and payload preparation occur exclusively client-side in memory.
 * Export serializes client-side decrypted events directly into an RFC 5545 text/calendar
 * stream for local download. Plaintext is never transmitted to unauthenticated servers.
 */

import { UserCalendar, CalendarEventItem, createCalendarEvent, updateCalendarEvent } from "../api";
import { DecryptedEventRecord } from "../components/calendar/CalendarSidebar";
import {
  parseIcs,
  ParsedIcs,
  ParsedIcsEvent,
  formatIcsUtc,
  formatIcsDateOnly,
  formatIcsLocalTime,
  generateVTimeZone,
  escapeIcsText,
  foldIcsLine,
  MAX_ICS_SIZE,
  MAX_EVENTS_COUNT,
} from "./calendarIcs";
import { encryptCalendarEventPayload, CalendarEventPlaintext } from "../calendar_crypto";

export interface IcsValidationResult {
  valid: boolean;
  error?: string;
  eventCount?: number;
  calendarName?: string;
}

export interface ImportOptions {
  mailboxId: string;
  mailboxKey: Uint8Array;
  targetCalendarId: string;
  duplicateMode: "update_duplicates" | "skip_duplicates";
  existingEvents?: DecryptedEventRecord[];
  wasmCore?: any;
  createEventFn?: (mailboxId: string, event: any) => Promise<any>;
  updateEventFn?: (mailboxId: string, eventId: string, event: any) => Promise<any>;
}

export interface ImportSummary {
  total: number;
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/**
 * Validates untrusted ICS payload before processing.
 * Enforces file size limit, RFC 5545 calendar boundaries, and max event count.
 */
export function validateIcsPayload(rawText: string): IcsValidationResult {
  if (!rawText || typeof rawText !== "string") {
    return { valid: false, error: "The provided calendar file is empty." };
  }

  // Size limit check (512 KB)
  const byteLength = new TextEncoder().encode(rawText).length;
  if (byteLength > MAX_ICS_SIZE) {
    return {
      valid: false,
      error: `File size (${(byteLength / 1024).toFixed(1)} KB) exceeds the maximum allowed limit of ${MAX_ICS_SIZE / 1024} KB.`,
    };
  }

  // Structure check
  const upper = rawText.toUpperCase();
  if (!upper.includes("BEGIN:VCALENDAR") || !upper.includes("END:VCALENDAR")) {
    return {
      valid: false,
      error: "Invalid file format: Missing BEGIN:VCALENDAR or END:VCALENDAR markers.",
    };
  }

  // Count VEVENT components
  const eventMatches = upper.match(/BEGIN:VEVENT/g);
  const count = eventMatches ? eventMatches.length : 0;
  if (count === 0) {
    return {
      valid: false,
      error: "No VEVENT calendar events found in this file.",
      eventCount: 0,
    };
  }

  if (count > MAX_EVENTS_COUNT) {
    return {
      valid: false,
      error: `File contains ${count} events, which exceeds the limit of ${MAX_EVENTS_COUNT} events per import batch.`,
      eventCount: count,
    };
  }

  // Extract optional calendar title
  let calendarName: string | undefined;
  const nameMatch = rawText.match(/X-WR-CALNAME:(.+)/i);
  if (nameMatch && nameMatch[1]) {
    calendarName = nameMatch[1].trim();
  }

  return { valid: true, eventCount: count, calendarName };
}

/**
 * Exports a calendar and its decrypted events to an RFC 5545 compliant iCalendar string.
 */
export function exportCalendarToIcs(
  calendar: UserCalendar,
  events: DecryptedEventRecord[],
  defaultTimeZone = "UTC"
): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "PRODID:-//BYOS//BYOS Calendar Exporter v1.0//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendar.name)}`,
  ];

  if (calendar.color) {
    lines.push(`X-APPLE-CALENDAR-COLOR:${calendar.color}`);
  }

  // Collect distinct timezones
  const tzSet = new Set<string>();
  if (defaultTimeZone && defaultTimeZone.toUpperCase() !== "UTC" && defaultTimeZone.toUpperCase() !== "ETC/UTC") {
    tzSet.add(defaultTimeZone);
  }

  for (const ev of events) {
    const evTz = ev.details?.timezone;
    if (evTz && evTz.toUpperCase() !== "UTC" && evTz.toUpperCase() !== "ETC/UTC") {
      tzSet.add(evTz);
    }
  }

  // Add VTIMEZONE definitions
  for (const tzid of tzSet) {
    lines.push(...generateVTimeZone(tzid));
  }

  const nowUtc = formatIcsUtc(new Date());

  // Filter events belonging to this calendar
  const calEvents = events.filter((e) => e.calendarId === calendar.id && !e.isOccurrence);

  for (const ev of calEvents) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${ev.id}`);
    lines.push(`DTSTAMP:${nowUtc}`);

    const details = ev.details || ({ title: "Untitled Event", timezone: defaultTimeZone } as any);
    const tz = details.timezone || defaultTimeZone;
    const start = ev.startTime || new Date();
    const end = ev.endTime || start;

    if (ev.isAllDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatIcsDateOnly(start)}`);
      lines.push(`DTEND;VALUE=DATE:${formatIcsDateOnly(end)}`);
    } else if (tz && tz.toUpperCase() !== "UTC" && tz.toUpperCase() !== "ETC/UTC") {
      lines.push(`DTSTART;TZID=${tz}:${formatIcsLocalTime(start, tz)}`);
      lines.push(`DTEND;TZID=${tz}:${formatIcsLocalTime(end, tz)}`);
    } else {
      lines.push(`DTSTART:${formatIcsUtc(start)}`);
      lines.push(`DTEND:${formatIcsUtc(end)}`);
    }

    lines.push(`SUMMARY:${escapeIcsText(details.title || "Untitled Event")}`);

    if (details.description && details.description.trim()) {
      lines.push(`DESCRIPTION:${escapeIcsText(details.description.trim())}`);
    }

    if (details.location && details.location.trim()) {
      lines.push(`LOCATION:${escapeIcsText(details.location.trim())}`);
    }

    if (details.meetingUrl && details.meetingUrl.trim()) {
      lines.push(`URL:${details.meetingUrl.trim()}`);
    }

    if (ev.rrule) {
      lines.push(`RRULE:${ev.rrule.toUpperCase()}`);
    }

    if (details.visibility) {
      const clsMap: Record<string, string> = {
        public: "PUBLIC",
        private: "PRIVATE",
        confidential: "CONFIDENTIAL",
      };
      if (clsMap[details.visibility]) {
        lines.push(`CLASS:${clsMap[details.visibility]}`);
      }
    }

    const statusMap: Record<string, string> = {
      confirmed: "CONFIRMED",
      tentative: "TENTATIVE",
      cancelled: "CANCELLED",
    };
    if (ev.status && statusMap[ev.status.toLowerCase()]) {
      lines.push(`STATUS:${statusMap[ev.status.toLowerCase()]}`);
    }

    // Reminders
    if (details.reminders && details.reminders.length > 0) {
      for (const r of details.reminders) {
        if (r.minutesBefore >= 0) {
          lines.push("BEGIN:VALARM");
          lines.push("ACTION:DISPLAY");
          lines.push(`DESCRIPTION:${escapeIcsText(details.title || "Reminder")}`);
          lines.push(`TRIGGER:-PT${r.minutesBefore}M`);
          lines.push("END:VALARM");
        }
      }
    }

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return lines.map((l) => foldIcsLine(l)).join("\r\n");
}

/**
 * Triggers a browser download of an ICS file.
 */
export function downloadIcsFile(filename: string, icsContent: string): void {
  if (typeof window === "undefined" || !document) return;
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
}

/**
 * Imports parsed iCalendar events into a target calendar with client-side encryption
 * and duplicate detection.
 */
export async function importIcsToCalendar(
  rawIcs: string,
  options: ImportOptions
): Promise<ImportSummary> {
  const validation = validateIcsPayload(rawIcs);
  if (!validation.valid) {
    throw new Error(validation.error || "Invalid ICS payload");
  }

  const parsed = parseIcs(rawIcs);
  const existingList = options.existingEvents || [];

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Load wasm crypto module if not provided
  let wasm = options.wasmCore;
  if (!wasm && typeof window !== "undefined") {
    try {
      wasm = await import("../generated/crypto-core/byos_crypto_core.js");
    } catch {}
  }

  for (const ev of parsed.events) {
    try {
      // Find duplicate by UID or exact title + startTime match in target calendar
      const matchedExisting = existingList.find((ex) => {
        if (ex.calendarId !== options.targetCalendarId) return false;
        if (ex.id === ev.uid || ex.baseEventId === ev.uid) return true;
        return (
          ex.details.title?.trim().toLowerCase() === ev.summary?.trim().toLowerCase() &&
          Math.abs(ex.startTime.getTime() - ev.startTime.getTime()) < 1000
        );
      });

      if (matchedExisting) {
        if (options.duplicateMode === "skip_duplicates") {
          skipped++;
          continue;
        }
      }

      // Prepare plaintext payload
      const payload: CalendarEventPlaintext = {
        title: ev.summary || "Untitled Event",
        description: ev.description || "",
        location: ev.location || "",
        meetingUrl: ev.url || "",
        timezone: ev.timezone || "UTC",
        eventType: "default",
        visibility: "default",
        reminders: ev.reminders?.map((r) => ({
          minutesBefore: r.minutesBefore,
          method: r.method || "notification",
        })) || [],
      };

      if (!wasm) {
        throw new Error("WASM crypto module unavailable for calendar encryption");
      }

      const encryptedPayload = encryptCalendarEventPayload(
        wasm,
        options.mailboxKey,
        options.mailboxId,
        payload
      );

      const statusVal = ev.status === "CANCELLED" ? "cancelled" : "confirmed";

      const createFn = options.createEventFn || createCalendarEvent;
      const updateFn = options.updateEventFn || updateCalendarEvent;

      if (matchedExisting && options.duplicateMode === "update_duplicates") {
        await updateFn(options.mailboxId, matchedExisting.id, {
          calendar_id: options.targetCalendarId,
          start_time: ev.startTime.toISOString(),
          end_time: ev.endTime.toISOString(),
          is_all_day: ev.isAllDay,
          rrule: ev.rrule,
          status: statusVal,
          encrypted_payload: encryptedPayload,
        });
        updated++;
      } else {
        await createFn(options.mailboxId, {
          calendar_id: options.targetCalendarId,
          start_time: ev.startTime.toISOString(),
          end_time: ev.endTime.toISOString(),
          is_all_day: ev.isAllDay,
          rrule: ev.rrule,
          status: statusVal,
          encrypted_payload: encryptedPayload,
        });
        imported++;
      }
    } catch (err: any) {
      console.warn(`[calendarImportExport] Failed to import event '${ev.summary}':`, err);
      errors.push(`${ev.summary || "Event"}: ${err?.message || "Unknown error"}`);
    }
  }

  return {
    total: parsed.events.length,
    imported,
    updated,
    skipped,
    errors,
  };
}
