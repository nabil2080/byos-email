/**
 * BYOS Calendar - Alternate Calendar Conversion & Formatting Engine
 * Category 04: Alternate and Special Calendars
 *
 * Evaluates and formats secondary date displays without altering underlying
 * canonical Gregorian event instants or database storage.
 *
 * Supported systems:
 *  - Islamic lunar (Hijri - Umm al-Qura standard)
 *  - Hebrew (Jewish lunisolar)
 *  - Chinese (Lunar)
 *  - Indian National (Saka calendar)
 *  - Persian (Solar Hijri / Jalali)
 *  - Korean (Dangi lunar)
 *  - Bengali (Bangabda - Revised Bangladesh Bangla Academy standard)
 */

export type AlternateCalendarSystem =
  | "none"
  | "islamic"
  | "hebrew"
  | "chinese"
  | "indian"
  | "persian"
  | "korean"
  | "bengali";

export interface AlternateDateInfo {
  system: AlternateCalendarSystem;
  systemLabel: string;
  dayText: string;
  monthText: string;
  yearText: string;
  badge: string;
  fullText: string;
}

/**
 * Bengali (Bangabda) Revised Calendar Conversion
 * Standard: Bangladesh Bangla Academy (1987, amended 2019)
 *  - Year starts on April 14 (Pohela Boishakh = 1 Boishakh)
 *  - Months 1-6 (Boishakh, Jyoistho, Asharh, Srabon, Bhadro, Ashwin): 31 days
 *  - Months 7-11 (Kartik, Agrohayon, Poush, Magh, Falgun): 30 days (Falgun 31 in leap year)
 *  - Month 12 (Choitro): 30 days
 *  - Era (BE): April 14 - Dec 31 = Gregorian Year - 593; Jan 1 - April 13 = Gregorian Year - 594
 */
const BENGALI_MONTHS = [
  "Boishakh",
  "Jyoistho",
  "Asharh",
  "Srabon",
  "Bhadro",
  "Ashwin",
  "Kartik",
  "Agrohayon",
  "Poush",
  "Magh",
  "Falgun",
  "Choitro",
];

const BENGALI_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

export function toBengaliNumerals(num: number | string): string {
  return String(num).replace(/[0-9]/g, (d) => BENGALI_DIGITS[parseInt(d, 10)]);
}

function isGregorianLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function getBengaliDate(date: Date): {
  year: number;
  month: string;
  monthIndex: number;
  day: number;
  dayBangla: string;
  yearBangla: string;
} {
  const gYear = date.getFullYear();
  const boishakh1ThisYear = new Date(gYear, 3, 14); // April 14

  let diffDays = Math.floor(
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
      Date.UTC(boishakh1ThisYear.getFullYear(), boishakh1ThisYear.getMonth(), boishakh1ThisYear.getDate())) /
      (1000 * 60 * 60 * 24)
  );

  let bYear = gYear - 593;
  if (diffDays < 0) {
    bYear = gYear - 594;
    const boishakh1PrevYear = new Date(gYear - 1, 3, 14);
    diffDays = Math.floor(
      (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
        Date.UTC(boishakh1PrevYear.getFullYear(), boishakh1PrevYear.getMonth(), boishakh1PrevYear.getDate())) /
        (1000 * 60 * 60 * 24)
    );
  }

  // Falgun occurs in Gregorian year (bYear + 594). In Bangladesh standard, Falgun has 29 days (30 in leap year).
  const isFalgunLeap = isGregorianLeapYear(bYear + 594);
  const monthLengths = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, isFalgunLeap ? 30 : 29, 30];

  let remaining = diffDays;
  let bMonthIndex = 0;
  let bDay = 1;

  for (let m = 0; m < 12; m++) {
    if (remaining < monthLengths[m]) {
      bMonthIndex = m;
      bDay = remaining + 1;
      break;
    }
    remaining -= monthLengths[m];
  }

  return {
    year: bYear,
    month: BENGALI_MONTHS[bMonthIndex],
    monthIndex: bMonthIndex + 1,
    day: bDay,
    dayBangla: toBengaliNumerals(bDay),
    yearBangla: toBengaliNumerals(bYear),
  };
}

/**
 * Maps AlternateCalendarSystem to Intl locale identifier
 */
const SYSTEM_LOCALES: Record<Exclude<AlternateCalendarSystem, "none" | "bengali">, { locale: string; label: string }> = {
  islamic: { locale: "en-u-ca-islamic-umalqura", label: "Hijri" },
  hebrew: { locale: "en-u-ca-hebrew", label: "Hebrew" },
  chinese: { locale: "en-u-ca-chinese", label: "Chinese" },
  indian: { locale: "en-u-ca-indian", label: "Saka" },
  persian: { locale: "en-u-ca-persian", label: "Solar Hijri" },
  korean: { locale: "en-u-ca-dangi", label: "Dangi" },
};

/**
 * Converts a Gregorian date into an AlternateDateInfo structure
 */
export function formatAlternateDate(
  date: Date,
  system: AlternateCalendarSystem
): AlternateDateInfo | null {
  if (!system || system === "none") return null;

  if (system === "bengali") {
    const b = getBengaliDate(date);
    const dayStr = String(b.day);
    const badge = b.day === 1 ? `1 ${b.month.slice(0, 4)}` : dayStr;
    return {
      system: "bengali",
      systemLabel: "Bengali",
      dayText: dayStr,
      monthText: b.month,
      yearText: `${b.year} BE`,
      badge,
      fullText: `${b.day} ${b.month} ${b.year} BE (${b.dayBangla} ${b.month} ${b.yearBangla} বঙ্গাব্দ)`,
    };
  }

  const config = SYSTEM_LOCALES[system];
  if (!config) return null;

  try {
    const dtf = new Intl.DateTimeFormat(config.locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    const parts = dtf.formatToParts(date);
    let day = "";
    let month = "";
    let year = "";

    for (const part of parts) {
      if (part.type === "day") day = part.value;
      if (part.type === "month") month = part.value;
      if (part.type === "year") year = part.value;
    }

    if (!day) day = String(date.getDate());
    if (!month) month = config.label;

    const badge = day === "1" ? `1 ${month.slice(0, 4)}` : day;
    const fullText = year ? `${day} ${month} ${year}` : `${day} ${month} (${config.label})`;

    return {
      system,
      systemLabel: config.label,
      dayText: day,
      monthText: month,
      yearText: year,
      badge,
      fullText,
    };
  } catch (err) {
    // Graceful fallback if particular system is unsupported in runtime
    return {
      system,
      systemLabel: config.label,
      dayText: String(date.getDate()),
      monthText: config.label,
      yearText: "",
      badge: String(date.getDate()),
      fullText: `${date.getDate()} (${config.label})`,
    };
  }
}
