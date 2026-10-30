// RFC 5545 Recurrence Engine for BYOS Calendar
// Handles standard iCalendar RRULE expansions: FREQ (DAILY, WEEKLY, MONTHLY, YEARLY),
// INTERVAL, BYDAY, COUNT, and UNTIL, with full support for detached exceptions and cancellations.

export interface ParsedRRule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  byDay?: string[]; // e.g. ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
  count?: number;
  until?: Date;
}

const DAY_MAP: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

export function parseRRule(rruleStr: string): ParsedRRule | null {
  if (!rruleStr || !rruleStr.trim()) return null;
  const parts = rruleStr.trim().replace(/^RRULE:/i, "").split(";");
  let freq: ParsedRRule["freq"] | null = null;
  let interval = 1;
  let byDay: string[] | undefined = undefined;
  let count: number | undefined = undefined;
  let until: Date | undefined = undefined;

  for (const part of parts) {
    const [key, val] = part.split("=");
    if (!key || !val) continue;
    const upperKey = key.toUpperCase().trim();
    const upperVal = val.toUpperCase().trim();

    switch (upperKey) {
      case "FREQ":
        if (["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(upperVal)) {
          freq = upperVal as ParsedRRule["freq"];
        }
        break;
      case "INTERVAL":
        const parsedInt = parseInt(upperVal, 10);
        if (!isNaN(parsedInt) && parsedInt > 0) {
          interval = parsedInt;
        }
        break;
      case "BYDAY":
        byDay = upperVal.split(",").map((s) => s.trim());
        break;
      case "COUNT":
        const parsedCount = parseInt(upperVal, 10);
        if (!isNaN(parsedCount) && parsedCount > 0) {
          count = parsedCount;
        }
        break;
      case "UNTIL":
        // Format YYYYMMDDTHHMMSSZ or YYYYMMDD
        const year = parseInt(val.slice(0, 4), 10);
        const month = parseInt(val.slice(4, 6), 10) - 1;
        const day = parseInt(val.slice(6, 8), 10);
        if (val.includes("T")) {
          const hour = parseInt(val.slice(9, 11), 10) || 0;
          const min = parseInt(val.slice(11, 13), 10) || 0;
          const sec = parseInt(val.slice(13, 15), 10) || 0;
          until = new Date(Date.UTC(year, month, day, hour, min, sec));
        } else {
          until = new Date(Date.UTC(year, month, day, 23, 59, 59));
        }
        break;
    }
  }

  if (!freq) return null;
  return { freq, interval, byDay, count, until };
}

export function buildRRuleString(rule: ParsedRRule): string {
  const parts: string[] = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) {
    parts.push(`INTERVAL=${rule.interval}`);
  }
  if (rule.byDay && rule.byDay.length > 0) {
    parts.push(`BYDAY=${rule.byDay.join(",")}`);
  }
  if (rule.count !== undefined && rule.count > 0) {
    parts.push(`COUNT=${rule.count}`);
  } else if (rule.until) {
    const pad = (n: number) => String(n).padStart(2, "0");
    const u = rule.until;
    const untilStr = `${u.getUTCFullYear()}${pad(u.getUTCMonth() + 1)}${pad(u.getUTCDate())}T${pad(
      u.getUTCHours()
    )}${pad(u.getUTCMinutes())}${pad(u.getUTCSeconds())}Z`;
    parts.push(`UNTIL=${untilStr}`);
  }
  return parts.join(";");
}

export interface EventExceptionInput {
  id: string;
  parentEventId?: string;
  recurrenceId: string; // ISO string e.g. "2026-10-20T10:00:00.000Z" or iCal "20261020T100000Z"
  isCancelled: boolean;
  startTime: Date;
  endTime: Date;
  isAllDay?: boolean;
  status?: string;
  payload?: any;
}

export interface ExpandedEventOccurrence {
  id: string; // e.g. baseId or baseId_occurrenceTimestamp or exception.id
  baseEventId: string;
  recurrenceId?: string;
  startTime: Date;
  endTime: Date;
  isOccurrence: boolean;
  occurrenceIndex: number;
  isException?: boolean;
  isCancelled?: boolean;
  exceptionId?: string;
  status?: string;
  payload?: any;
}

/**
 * Normalizes an iCalendar or ISO recurrence timestamp string to canonical UTC ISO string.
 */
export function normalizeRecurrenceId(val: string | Date | number): string {
  if (val instanceof Date) {
    return val.toISOString();
  }
  if (typeof val === "number") {
    return new Date(val).toISOString();
  }
  const clean = String(val).trim();
  if (!clean) return "";

  // iCal date-time UTC: YYYYMMDDTHHMMSSZ
  if (/^\d{8}T\d{6}Z$/i.test(clean)) {
    const y = parseInt(clean.slice(0, 4), 10);
    const m = parseInt(clean.slice(4, 6), 10) - 1;
    const d = parseInt(clean.slice(6, 8), 10);
    const hh = parseInt(clean.slice(9, 11), 10);
    const mm = parseInt(clean.slice(11, 13), 10);
    const ss = parseInt(clean.slice(13, 15), 10);
    return new Date(Date.UTC(y, m, d, hh, mm, ss)).toISOString();
  }

  // iCal local date-time (floating or local): YYYYMMDDTHHMMSS
  if (/^\d{8}T\d{6}$/i.test(clean)) {
    const y = parseInt(clean.slice(0, 4), 10);
    const m = parseInt(clean.slice(4, 6), 10) - 1;
    const d = parseInt(clean.slice(6, 8), 10);
    const hh = parseInt(clean.slice(9, 11), 10);
    const mm = parseInt(clean.slice(11, 13), 10);
    const ss = parseInt(clean.slice(13, 15), 10);
    return new Date(Date.UTC(y, m, d, hh, mm, ss)).toISOString();
  }

  // iCal date-only: YYYYMMDD
  if (/^\d{8}$/.test(clean)) {
    const y = parseInt(clean.slice(0, 4), 10);
    const m = parseInt(clean.slice(4, 6), 10) - 1;
    const d = parseInt(clean.slice(6, 8), 10);
    return new Date(Date.UTC(y, m, d, 0, 0, 0)).toISOString();
  }

  const parsed = Date.parse(clean);
  if (!isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }
  return clean;
}

/**
 * Expands a recurring event within the specified time window.
 * Accounts for detached exceptions (modified occurrences and cancellations).
 * Returns an array of occurrence dates (preserving event duration or exception adjustments).
 */
export function expandEventOccurrences(
  baseId: string,
  eventStart: Date,
  eventEnd: Date,
  rruleStr: string,
  windowStart: Date,
  windowEnd: Date,
  maxOccurrences: number = 200,
  exceptions: EventExceptionInput[] = [],
  exdates: (Date | string)[] = []
): ExpandedEventOccurrence[] {
  const rule = parseRRule(rruleStr);
  const durationMs = eventEnd.getTime() - eventStart.getTime();

  // If no recurrence rule, return base event if it overlaps the window
  if (!rule) {
    if (eventEnd >= windowStart && eventStart <= windowEnd) {
      return [
        {
          id: baseId,
          baseEventId: baseId,
          recurrenceId: eventStart.toISOString(),
          startTime: eventStart,
          endTime: eventEnd,
          isOccurrence: false,
          occurrenceIndex: 0,
        },
      ];
    }
    return [];
  }

  // Build lookup index for exceptions by normalized recurrenceId
  const exceptionMap = new Map<string, EventExceptionInput>();
  for (const exc of exceptions) {
    if (exc && exc.recurrenceId) {
      const norm = normalizeRecurrenceId(exc.recurrenceId);
      exceptionMap.set(norm, exc);
    }
  }

  // Also index any explicit RFC 5545 EXDATEs as cancellations
  for (const ex of exdates) {
    if (ex) {
      const norm = normalizeRecurrenceId(ex);
      if (norm && !exceptionMap.has(norm)) {
        exceptionMap.set(norm, {
          id: `exdate-${norm}`,
          recurrenceId: norm,
          isCancelled: true,
          startTime: new Date(norm),
          endTime: new Date(norm),
        });
      }
    }
  }

  const matchedExceptionIds = new Set<string>();
  const occurrences: ExpandedEventOccurrence[] = [];
  let index = 0;

  // For weekly recurrence with specific BYDAY (e.g. MO, WE, FR)
  if (rule.freq === "WEEKLY" && rule.byDay && rule.byDay.length > 0) {
    const targetDays = new Set(rule.byDay.map((d) => DAY_MAP[d]).filter((d) => d !== undefined));
    const interval = Math.max(1, rule.interval || 1);

    // Align to Sunday of eventStart's week
    const startSunday = new Date(eventStart);
    startSunday.setHours(0, 0, 0, 0);
    startSunday.setDate(startSunday.getDate() - startSunday.getDay());

    let weekOffset = 0;
    while (occurrences.length < maxOccurrences) {
      if (rule.count && index >= rule.count) break;
      const currentWeekSunday = new Date(startSunday);
      currentWeekSunday.setDate(startSunday.getDate() + weekOffset * 7);

      if (rule.until && currentWeekSunday > rule.until) break;
      if (currentWeekSunday > windowEnd) break;

      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        if (rule.count && index >= rule.count) break;

        const currentDay = new Date(currentWeekSunday);
        currentDay.setDate(currentWeekSunday.getDate() + dayOffset);
        currentDay.setHours(
          eventStart.getHours(),
          eventStart.getMinutes(),
          eventStart.getSeconds(),
          eventStart.getMilliseconds()
        );

        if (rule.until && currentDay > rule.until) break;
        if (currentDay > windowEnd) break;

        if (targetDays.has(currentDay.getDay()) && currentDay >= eventStart) {
          const occStart = new Date(currentDay);
          const occEnd = new Date(occStart.getTime() + durationMs);
          const recId = occStart.toISOString();
          const normRecId = normalizeRecurrenceId(recId);
          const exc = exceptionMap.get(normRecId);

          if (exc) {
            matchedExceptionIds.add(exc.id);
            if (!exc.isCancelled) {
              const excStart = new Date(exc.startTime);
              const excEnd = new Date(exc.endTime);
              if (excEnd >= windowStart && excStart <= windowEnd) {
                occurrences.push({
                  id: exc.id || `${baseId}_${recId}`,
                  baseEventId: baseId,
                  recurrenceId: recId,
                  startTime: excStart,
                  endTime: excEnd,
                  isOccurrence: true,
                  occurrenceIndex: index,
                  isException: true,
                  exceptionId: exc.id,
                  status: exc.status,
                  payload: exc.payload,
                });
              }
            }
            // If cancelled, suppressed
          } else {
            if (occEnd >= windowStart && occStart <= windowEnd) {
              occurrences.push({
                id: index === 0 ? baseId : `${baseId}_${occStart.getTime()}`,
                baseEventId: baseId,
                recurrenceId: recId,
                startTime: occStart,
                endTime: occEnd,
                isOccurrence: index > 0,
                occurrenceIndex: index,
              });
            }
          }
          index++;
        }
      }

      weekOffset += interval;
    }
  } else {
    // Standard step-based recurrence (DAILY, WEEKLY, MONTHLY, YEARLY)
    const origYear = eventStart.getFullYear();
    const origMonth = eventStart.getMonth();
    const origDate = eventStart.getDate();
    const origHours = eventStart.getHours();
    const origMins = eventStart.getMinutes();
    const origSecs = eventStart.getSeconds();
    const origMs = eventStart.getMilliseconds();

    let stepIndex = 0;
    while (occurrences.length < maxOccurrences) {
      if (rule.count && index >= rule.count) break;

      let currentStart: Date;
      if (rule.freq === "DAILY") {
        currentStart = new Date(eventStart.getTime() + stepIndex * rule.interval * 24 * 60 * 60 * 1000);
      } else if (rule.freq === "WEEKLY") {
        currentStart = new Date(eventStart.getTime() + stepIndex * rule.interval * 7 * 24 * 60 * 60 * 1000);
      } else if (rule.freq === "MONTHLY") {
        const totalMonths = origMonth + stepIndex * rule.interval;
        const targetYear = origYear + Math.floor(totalMonths / 12);
        const targetMonth = ((totalMonths % 12) + 12) % 12;
        const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
        const targetDay = Math.min(origDate, daysInMonth);
        currentStart = new Date(targetYear, targetMonth, targetDay, origHours, origMins, origSecs, origMs);
      } else {
        // YEARLY
        const targetYear = origYear + stepIndex * rule.interval;
        const daysInMonth = new Date(targetYear, origMonth + 1, 0).getDate();
        const targetDay = Math.min(origDate, daysInMonth);
        currentStart = new Date(targetYear, origMonth, targetDay, origHours, origMins, origSecs, origMs);
      }

      stepIndex++;

      if (rule.until && currentStart > rule.until) break;
      if (currentStart > windowEnd) break;

      const occStart = new Date(currentStart);
      const occEnd = new Date(occStart.getTime() + durationMs);
      const recId = occStart.toISOString();
      const normRecId = normalizeRecurrenceId(recId);
      const exc = exceptionMap.get(normRecId);

      if (exc) {
        matchedExceptionIds.add(exc.id);
        if (!exc.isCancelled) {
          const excStart = new Date(exc.startTime);
          const excEnd = new Date(exc.endTime);
          if (excEnd >= windowStart && excStart <= windowEnd) {
            occurrences.push({
              id: exc.id || `${baseId}_${recId}`,
              baseEventId: baseId,
              recurrenceId: recId,
              startTime: excStart,
              endTime: excEnd,
              isOccurrence: true,
              occurrenceIndex: index,
              isException: true,
              exceptionId: exc.id,
              status: exc.status,
              payload: exc.payload,
            });
          }
        }
        // If cancelled, suppressed
      } else {
        if (occEnd >= windowStart && occStart <= windowEnd) {
          occurrences.push({
            id: index === 0 ? baseId : `${baseId}_${occStart.getTime()}`,
            baseEventId: baseId,
            recurrenceId: recId,
            startTime: occStart,
            endTime: occEnd,
            isOccurrence: index > 0,
            occurrenceIndex: index,
          });
        }
      }

      index++;
    }
  }

  // Include any unmatched modified exceptions that were rescheduled into the visible window
  for (const exc of exceptions) {
    if (!matchedExceptionIds.has(exc.id) && !exc.isCancelled) {
      const excStart = new Date(exc.startTime);
      const excEnd = new Date(exc.endTime);
      if (excEnd >= windowStart && excStart <= windowEnd) {
        occurrences.push({
          id: exc.id,
          baseEventId: baseId,
          recurrenceId: exc.recurrenceId,
          startTime: excStart,
          endTime: excEnd,
          isOccurrence: true,
          occurrenceIndex: -1,
          isException: true,
          exceptionId: exc.id,
          status: exc.status,
          payload: exc.payload,
        });
      }
    }
  }

  // Sort chronologically
  occurrences.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  return occurrences;
}
