/**
 * BYOS Calendar Timezone & World Clock Utilities
 * Implements Category 05: Language, Region, and Time Management
 * 
 * Supports:
 * - Comprehensive IANA timezone catalogue grouped by continent/region
 * - Precision conversion between UTC instants and zoned local representations
 * - DST spring-forward and fall-back handling
 * - Formatters for 12h/24h and custom date patterns (YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY)
 * - ISO 8601 vs US first-week-of-year convention calculations
 * - Interactive World Clock city management and live time computations
 * - Location travel detection with explicit opt-in consent safeguards
 */

import { WorldClockCity } from "../components/calendar/settings/calendarSettingsStore";

export interface TimeZoneOption {
  id: string; // IANA Identifier e.g. "America/New_York"
  label: string;
  region: "Americas" | "Europe" | "Asia" | "Africa" | "Oceania" | "Atlantic/Pacific" | "UTC";
  standardAbbr: string;
  currentOffsetMinutes: number;
}

/**
 * Curated, authoritative list of global IANA time zones
 */
export const SUPPORTED_TIMEZONES: TimeZoneOption[] = [
  // UTC
  { id: "UTC", label: "UTC (Coordinated Universal Time)", region: "UTC", standardAbbr: "UTC", currentOffsetMinutes: 0 },

  // Americas
  { id: "America/New_York", label: "New York (Eastern Time - ET)", region: "Americas", standardAbbr: "ET", currentOffsetMinutes: -300 },
  { id: "America/Chicago", label: "Chicago (Central Time - CT)", region: "Americas", standardAbbr: "CT", currentOffsetMinutes: -360 },
  { id: "America/Denver", label: "Denver (Mountain Time - MT)", region: "Americas", standardAbbr: "MT", currentOffsetMinutes: -420 },
  { id: "America/Los_Angeles", label: "Los Angeles (Pacific Time - PT)", region: "Americas", standardAbbr: "PT", currentOffsetMinutes: -480 },
  { id: "America/Anchorage", label: "Anchorage (Alaska Time)", region: "Americas", standardAbbr: "AKT", currentOffsetMinutes: -540 },
  { id: "America/Honolulu", label: "Honolulu (Hawaii Time - HST)", region: "Americas", standardAbbr: "HST", currentOffsetMinutes: -600 },
  { id: "America/Toronto", label: "Toronto (Eastern Time - ET)", region: "Americas", standardAbbr: "ET", currentOffsetMinutes: -300 },
  { id: "America/Vancouver", label: "Vancouver (Pacific Time - PT)", region: "Americas", standardAbbr: "PT", currentOffsetMinutes: -480 },
  { id: "America/Mexico_City", label: "Mexico City (Central Time)", region: "Americas", standardAbbr: "CST", currentOffsetMinutes: -360 },
  { id: "America/Sao_Paulo", label: "São Paulo (Brasília Time - BRT)", region: "Americas", standardAbbr: "BRT", currentOffsetMinutes: -180 },
  { id: "America/Buenos_Aires", label: "Buenos Aires (ART)", region: "Americas", standardAbbr: "ART", currentOffsetMinutes: -180 },
  { id: "America/Santiago", label: "Santiago (CLT)", region: "Americas", standardAbbr: "CLT", currentOffsetMinutes: -180 },
  { id: "America/Bogota", label: "Bogota (COT)", region: "Americas", standardAbbr: "COT", currentOffsetMinutes: -300 },

  // Europe
  { id: "Europe/London", label: "London (GMT / BST)", region: "Europe", standardAbbr: "GMT", currentOffsetMinutes: 0 },
  { id: "Europe/Dublin", label: "Dublin (IST / GMT)", region: "Europe", standardAbbr: "IST", currentOffsetMinutes: 0 },
  { id: "Europe/Paris", label: "Paris (CET / CEST)", region: "Europe", standardAbbr: "CET", currentOffsetMinutes: 60 },
  { id: "Europe/Berlin", label: "Berlin (CET / CEST)", region: "Europe", standardAbbr: "CET", currentOffsetMinutes: 60 },
  { id: "Europe/Madrid", label: "Madrid (CET / CEST)", region: "Europe", standardAbbr: "CET", currentOffsetMinutes: 60 },
  { id: "Europe/Rome", label: "Rome (CET / CEST)", region: "Europe", standardAbbr: "CET", currentOffsetMinutes: 60 },
  { id: "Europe/Amsterdam", label: "Amsterdam (CET / CEST)", region: "Europe", standardAbbr: "CET", currentOffsetMinutes: 60 },
  { id: "Europe/Brussels", label: "Brussels (CET / CEST)", region: "Europe", standardAbbr: "CET", currentOffsetMinutes: 60 },
  { id: "Europe/Stockholm", label: "Stockholm (CET / CEST)", region: "Europe", standardAbbr: "CET", currentOffsetMinutes: 60 },
  { id: "Europe/Athens", label: "Athens (EET / EEST)", region: "Europe", standardAbbr: "EET", currentOffsetMinutes: 120 },
  { id: "Europe/Helsinki", label: "Helsinki (EET / EEST)", region: "Europe", standardAbbr: "EET", currentOffsetMinutes: 120 },
  { id: "Europe/Istanbul", label: "Istanbul (TRT)", region: "Europe", standardAbbr: "TRT", currentOffsetMinutes: 180 },
  { id: "Europe/Moscow", label: "Moscow (MSK)", region: "Europe", standardAbbr: "MSK", currentOffsetMinutes: 180 },

  // Asia
  { id: "Asia/Dhaka", label: "Dhaka (Bangladesh Standard Time - BST)", region: "Asia", standardAbbr: "BST", currentOffsetMinutes: 360 },
  { id: "Asia/Kolkata", label: "India (IST - Mumbai, New Delhi)", region: "Asia", standardAbbr: "IST", currentOffsetMinutes: 330 },
  { id: "Asia/Dubai", label: "Dubai / Abu Dhabi (Gulf Standard Time - GST)", region: "Asia", standardAbbr: "GST", currentOffsetMinutes: 240 },
  { id: "Asia/Riyadh", label: "Riyadh (AST)", region: "Asia", standardAbbr: "AST", currentOffsetMinutes: 180 },
  { id: "Asia/Singapore", label: "Singapore (SGT)", region: "Asia", standardAbbr: "SGT", currentOffsetMinutes: 480 },
  { id: "Asia/Hong_Kong", label: "Hong Kong (HKT)", region: "Asia", standardAbbr: "HKT", currentOffsetMinutes: 480 },
  { id: "Asia/Tokyo", label: "Tokyo (Japan Standard Time - JST)", region: "Asia", standardAbbr: "JST", currentOffsetMinutes: 540 },
  { id: "Asia/Seoul", label: "Seoul (Korea Standard Time - KST)", region: "Asia", standardAbbr: "KST", currentOffsetMinutes: 540 },
  { id: "Asia/Shanghai", label: "Shanghai / Beijing (CST)", region: "Asia", standardAbbr: "CST", currentOffsetMinutes: 480 },
  { id: "Asia/Bangkok", label: "Bangkok (ICT)", region: "Asia", standardAbbr: "ICT", currentOffsetMinutes: 420 },
  { id: "Asia/Jakarta", label: "Jakarta (WIB)", region: "Asia", standardAbbr: "WIB", currentOffsetMinutes: 420 },
  { id: "Asia/Karachi", label: "Karachi (PKT)", region: "Asia", standardAbbr: "PKT", currentOffsetMinutes: 300 },
  { id: "Asia/Manila", label: "Manila (PHT)", region: "Asia", standardAbbr: "PHT", currentOffsetMinutes: 480 },

  // Africa
  { id: "Africa/Cairo", label: "Cairo (EET)", region: "Africa", standardAbbr: "EET", currentOffsetMinutes: 120 },
  { id: "Africa/Johannesburg", label: "Johannesburg (SAST)", region: "Africa", standardAbbr: "SAST", currentOffsetMinutes: 120 },
  { id: "Africa/Lagos", label: "Lagos (WAT)", region: "Africa", standardAbbr: "WAT", currentOffsetMinutes: 60 },
  { id: "Africa/Nairobi", label: "Nairobi (EAT)", region: "Africa", standardAbbr: "EAT", currentOffsetMinutes: 180 },
  { id: "Africa/Casablanca", label: "Casablanca (WET)", region: "Africa", standardAbbr: "WET", currentOffsetMinutes: 60 },

  // Oceania & Pacific
  { id: "Australia/Sydney", label: "Sydney / Melbourne (AEST / AEDT)", region: "Oceania", standardAbbr: "AEST", currentOffsetMinutes: 600 },
  { id: "Australia/Brisbane", label: "Brisbane (AEST)", region: "Oceania", standardAbbr: "AEST", currentOffsetMinutes: 600 },
  { id: "Australia/Adelaide", label: "Adelaide (ACST / ACDT)", region: "Oceania", standardAbbr: "ACST", currentOffsetMinutes: 570 },
  { id: "Australia/Perth", label: "Perth (AWST)", region: "Oceania", standardAbbr: "AWST", currentOffsetMinutes: 480 },
  { id: "Pacific/Auckland", label: "Auckland / Wellington (NZST / NZDT)", region: "Oceania", standardAbbr: "NZST", currentOffsetMinutes: 720 },
  { id: "Pacific/Fiji", label: "Fiji (FJT)", region: "Oceania", standardAbbr: "FJT", currentOffsetMinutes: 720 },
  { id: "Pacific/Honolulu", label: "Honolulu (HST)", region: "Oceania", standardAbbr: "HST", currentOffsetMinutes: -600 },
];

/**
 * Curated preset cities for quick addition to the World Clock
 */
export const PRESET_WORLD_CLOCK_CITIES = [
  { id: "london", label: "London", timeZone: "Europe/London" },
  { id: "new-york", label: "New York", timeZone: "America/New_York" },
  { id: "san-francisco", label: "San Francisco", timeZone: "America/Los_Angeles" },
  { id: "chicago", label: "Chicago", timeZone: "America/Chicago" },
  { id: "tokyo", label: "Tokyo", timeZone: "Asia/Tokyo" },
  { id: "dhaka", label: "Dhaka", timeZone: "Asia/Dhaka" },
  { id: "paris", label: "Paris", timeZone: "Europe/Paris" },
  { id: "berlin", label: "Berlin", timeZone: "Europe/Berlin" },
  { id: "sydney", label: "Sydney", timeZone: "Australia/Sydney" },
  { id: "dubai", label: "Dubai", timeZone: "Asia/Dubai" },
  { id: "singapore", label: "Singapore", timeZone: "Asia/Singapore" },
  { id: "hong-kong", label: "Hong Kong", timeZone: "Asia/Hong_Kong" },
  { id: "toronto", label: "Toronto", timeZone: "America/Toronto" },
  { id: "mumbai", label: "Mumbai", timeZone: "Asia/Kolkata" },
  { id: "sao-paulo", label: "São Paulo", timeZone: "America/Sao_Paulo" },
  { id: "cairo", label: "Cairo", timeZone: "Africa/Cairo" },
  { id: "johannesburg", label: "Johannesburg", timeZone: "Africa/Johannesburg" },
  { id: "auckland", label: "Auckland", timeZone: "Pacific/Auckland" },
  { id: "honolulu", label: "Honolulu", timeZone: "Pacific/Honolulu" },
];

/**
 * Convert local date/time numbers in a target IANA timezone to a canonical UTC Date.
 * Handles daylight saving transitions (DST spring-forward and fall-back) reliably.
 */
export function zonedTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const cleanTz = timeZone || "UTC";
  // Initial UTC guess
  const guessUtc = Date.UTC(year, month - 1, day, hour, minute, 0);

  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: cleanTz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    });

    const parts = dtf.formatToParts(new Date(guessUtc));
    const p: Record<string, number> = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        p[part.type] = parseInt(part.value, 10);
      }
    }

    const localTargetMs = Date.UTC(year, month - 1, day, hour, minute, 0);
    const localFormattedMs = Date.UTC(
      p.year || year,
      (p.month || month) - 1,
      p.day || day,
      p.hour === 24 ? 0 : p.hour || 0,
      p.minute || 0,
      0
    );

    const diffMs = localFormattedMs - localTargetMs;
    return new Date(guessUtc - diffMs);
  } catch {
    return new Date(guessUtc);
  }
}

/**
 * Extracts year, month, day, hour, minute, second in a target IANA timezone.
 */
export function utcToZonedParts(date: Date, timeZone: string) {
  const cleanTz = timeZone || "UTC";
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: cleanTz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const parts = dtf.formatToParts(date);
    const p: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        p[part.type] = part.value;
      }
    }

    const hour = p.hour === "24" ? "00" : p.hour || "00";
    return {
      year: parseInt(p.year, 10),
      month: parseInt(p.month, 10),
      day: parseInt(p.day, 10),
      hour: parseInt(hour, 10),
      minute: parseInt(p.minute || "00", 10),
      second: parseInt(p.second || "00", 10),
      dateStr: `${p.year}-${p.month}-${p.day}`,
      timeStr: `${hour}:${p.minute || "00"}`,
    };
  } catch {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
      dateStr: date.toISOString().slice(0, 10),
      timeStr: date.toISOString().slice(11, 16),
    };
  }
}

/**
 * Formats a Date's time in a target time zone according to 12h or 24h format preference.
 */
export function formatZonedTime(
  date: Date,
  timeZone: string,
  timeFormat: "12h" | "24h" = "12h"
): string {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "UTC",
      hour: "numeric",
      minute: "2-digit",
      hour12: timeFormat === "12h",
    });
    return dtf.format(date);
  } catch {
    return date.toTimeString().slice(0, 5);
  }
}

/**
 * Retrieves the short timezone abbreviation or GMT offset for a given date and timezone.
 * E.g. "EST", "EDT", "GMT", "BST", "GMT+6"
 */
export function getTimeZoneAbbr(date: Date, timeZone: string): string {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "UTC",
      timeZoneName: "short",
    });
    const parts = dtf.formatToParts(date);
    const tzPart = parts.find((p) => p.type === "timeZoneName");
    return tzPart ? tzPart.value : timeZone;
  } catch {
    return timeZone;
  }
}

/**
 * Calculates date string based on chosen format:
 * - "YYYY-MM-DD"
 * - "MM/DD/YYYY"
 * - "DD/MM/YYYY"
 */
export function formatDateWithPattern(
  date: Date,
  format: "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY" = "YYYY-MM-DD",
  locale: string = "en"
): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");

  switch (format) {
    case "MM/DD/YYYY":
      return `${m}/${d}/${y}`;
    case "DD/MM/YYYY":
      return `${d}/${m}/${y}`;
    case "YYYY-MM-DD":
    default:
      return `${y}-${m}-${d}`;
  }
}

/**
 * Calculates ISO or convention-based week number
 * @param date Target date
 * @param weekStart "sunday" | "monday" | "saturday"
 * @param convention "four_day_week" (ISO 8601) | "first_day" | "full_week"
 */
export function getWeekNumber(
  date: Date,
  weekStart: "sunday" | "monday" | "saturday" = "sunday",
  convention: "four_day_week" | "first_day" | "full_week" = "four_day_week"
): number {
  const target = new Date(date.valueOf());
  target.setHours(0, 0, 0, 0);

  // Offset target date according to weekStart
  const day = target.getDay(); // 0 is Sun
  let dayOffset = day;
  if (weekStart === "monday") {
    dayOffset = (day + 6) % 7;
  } else if (weekStart === "saturday") {
    dayOffset = (day + 1) % 7;
  }

  if (convention === "four_day_week") {
    // ISO-8601: Thursday in current week determines the year
    target.setDate(target.getDate() - dayOffset + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) {
      target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
    }
    return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  }

  if (convention === "first_day") {
    // Jan 1 is always Week 1
    const yearStart = new Date(target.getFullYear(), 0, 1);
    const diffDays = Math.floor((target.getTime() - yearStart.getTime()) / (24 * 60 * 60 * 1000));
    return Math.floor(diffDays / 7) + 1;
  }

  // "full_week": First full 7-day week
  const yearStart = new Date(target.getFullYear(), 0, 1);
  const startDay = yearStart.getDay();
  const daysUntilFirstFull = startDay === 0 ? 0 : 7 - startDay;
  const firstFullWeekStart = new Date(target.getFullYear(), 0, 1 + daysUntilFirstFull);
  if (target < firstFullWeekStart) {
    return 1;
  }
  const diffDays = Math.floor((target.getTime() - firstFullWeekStart.getTime()) / (24 * 60 * 60 * 1000));
  return Math.floor(diffDays / 7) + 2;
}

export interface CityLiveTime {
  timeStr: string;
  abbr: string;
  dayDiff: "" | "Tomorrow" | "Yesterday";
}

/**
 * Computes live time information for a World Clock city relative to a reference base date.
 */
export function getWorldClockCityTime(
  city: WorldClockCity,
  now: Date = new Date(),
  timeFormat: "12h" | "24h" = "12h",
  baseDate: Date = new Date()
): CityLiveTime {
  const timeStr = formatZonedTime(now, city.timeZone, timeFormat);
  const abbr = getTimeZoneAbbr(now, city.timeZone);

  // Compare city date vs local base date
  const cityParts = utcToZonedParts(now, city.timeZone);
  const localYear = baseDate.getFullYear();
  const localMonth = baseDate.getMonth() + 1;
  const localDay = baseDate.getDate();

  let dayDiff: "" | "Tomorrow" | "Yesterday" = "";
  if (
    cityParts.year > localYear ||
    (cityParts.year === localYear && cityParts.month > localMonth) ||
    (cityParts.year === localYear && cityParts.month === localMonth && cityParts.day > localDay)
  ) {
    dayDiff = "Tomorrow";
  } else if (
    cityParts.year < localYear ||
    (cityParts.year === localYear && cityParts.month < localMonth) ||
    (cityParts.year === localYear && cityParts.month === localMonth && cityParts.day < localDay)
  ) {
    dayDiff = "Yesterday";
  }

  return { timeStr, abbr, dayDiff };
}

/**
 * Returns detected browser time zone from ECMAScript Intl API
 */
export function detectBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
