export type KashcalCategory =
  | "coffee"
  | "food"
  | "meeting"
  | "flight"
  | "call"
  | "health"
  | "workout"
  | "party"
  | "focus"
  | "general";

export interface ParsedKashcalEvent {
  raw: string;
  title: string;
  category: KashcalCategory;
  startDate: Date;
  endDate: Date;
  durationMinutes: number;
  isAllDay: boolean;
  hasExplicitTime: boolean;
  hasExplicitDate: boolean;
}

const CATEGORY_KEYWORDS: Record<KashcalCategory, string[]> = {
  coffee: ["coffee", "cafe", "café", "latte", "espresso", "cappuccino", "starbucks"],
  food: ["lunch", "dinner", "breakfast", "brunch", "restaurant", "meal", "pizza", "sushi", "eat", "food", "tacos"],
  meeting: ["sync", "meeting", "1:1", "1-on-1", "one-on-one", "standup", "catchup", "catch up", "review", "retro", "retrospective", "planning", "interview", "demo", "onboarding"],
  flight: ["flight", "fly", "airport", "airline", "trip", "travel", "hotel", "boarding"],
  call: ["call", "phone", "zoom", "huddle", "meet", "teams", "facetime"],
  health: ["doctor", "dentist", "clinic", "appointment", "dental", "medical", "checkup", "therapy", "physio", "hospital", "pediatrician"],
  workout: ["gym", "workout", "run", "running", "yoga", "pilates", "crossfit", "exercise", "fitness", "swim", "swimming", "train", "training"],
  party: ["party", "birthday", "bday", "drinks", "happy hour", "celebration", "anniversary", "beer", "wine", "gala"],
  focus: ["focus", "focus time", "deep work", "coding", "dev", "study", "reading", "read", "book", "books", "write", "writing", "research"],
  general: [],
};

const MONTH_NAMES: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

export function detectCategory(text: string): KashcalCategory {
  const lower = text.toLowerCase();
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS) as [KashcalCategory, string[]][]) {
    if (cat === "general") continue;
    for (const w of words) {
      const regex = new RegExp(`(^|\\b|\\s)${w}(\\b|\\s|$)`, "i");
      if (regex.test(lower)) {
        return cat;
      }
    }
  }
  return "general";
}

/**
 * Natural language event parser inspired by KashCal's smart-add engine.
 * Parses input strings such as:
 * - "Coffee with Sarah tomorrow 3pm"
 * - "Design review Friday 10am 45m"
 * - "Dentist appointment Nov 12 at 2pm"
 * - "Team standup at 9:30am 15m"
 * - "Lunch with Alex at 12:30"
 */
export function parseNaturalLanguageEvent(rawText: string, referenceDate: Date = new Date()): ParsedKashcalEvent {
  const input = (rawText || "").trim();
  if (!input) {
    const start = new Date(referenceDate);
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);
    const end = new Date(start);
    end.setHours(start.getHours() + 1);
    return {
      raw: "",
      title: "New Event",
      category: "general",
      startDate: start,
      endDate: end,
      durationMinutes: 60,
      isAllDay: false,
      hasExplicitTime: false,
      hasExplicitDate: false,
    };
  }

  let textWorking = input;
  let hasExplicitDate = false;
  let hasExplicitTime = false;
  let isAllDay = false;
  let durationMinutes = 60;

  // 1. Target date initialization
  let targetYear = referenceDate.getFullYear();
  let targetMonth = referenceDate.getMonth();
  let targetDay = referenceDate.getDate();

  // 2. All-day flag check
  if (/\b(all[- ]?day)\b/i.test(textWorking)) {
    isAllDay = true;
    textWorking = textWorking.replace(/\b(all[- ]?day)\b/gi, " ");
  }

  // 3. Duration extraction (e.g., "15m", "30 min", "45 mins", "1h", "2 hours", "1.5h")
  const durationMatch = textWorking.match(/\b(\d+(?:\.\d+)?)\s*(m|min|mins|minutes|h|hr|hrs|hours)\b/i);
  if (durationMatch) {
    const val = parseFloat(durationMatch[1]);
    const unit = durationMatch[2].toLowerCase();
    if (unit.startsWith("h")) {
      durationMinutes = Math.round(val * 60);
    } else {
      durationMinutes = Math.round(val);
    }
    textWorking = textWorking.replace(durationMatch[0], " ");
  }

  // 4. Relative date keywords: "today", "tomorrow"
  if (/\b(today)\b/i.test(textWorking)) {
    hasExplicitDate = true;
    textWorking = textWorking.replace(/\b(today)\b/gi, " ");
  } else if (/\b(tomorrow)\b/i.test(textWorking)) {
    hasExplicitDate = true;
    const tom = new Date(referenceDate);
    tom.setDate(tom.getDate() + 1);
    targetYear = tom.getFullYear();
    targetMonth = tom.getMonth();
    targetDay = tom.getDate();
    textWorking = textWorking.replace(/\b(tomorrow)\b/gi, " ");
  }

  // 5. Day of the week: "next monday", "friday", "on sunday"
  const weekdayMatch = textWorking.match(/\b(?:(next)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/i);
  if (weekdayMatch && !hasExplicitDate) {
    hasExplicitDate = true;
    const isNext = Boolean(weekdayMatch[1]);
    const dayName = weekdayMatch[2].toLowerCase();
    const targetDayIndex = DAY_NAMES[dayName];

    if (targetDayIndex !== undefined) {
      const currentDayIndex = referenceDate.getDay();
      let diff = targetDayIndex - currentDayIndex;
      if (diff <= 0) diff += 7;
      if (isNext && diff < 7) diff += 7;

      const calcDate = new Date(referenceDate);
      calcDate.setDate(calcDate.getDate() + diff);
      targetYear = calcDate.getFullYear();
      targetMonth = calcDate.getMonth();
      targetDay = calcDate.getDate();
    }
    textWorking = textWorking.replace(weekdayMatch[0], " ");
  }

  // 6. Explicit date format: "Nov 12", "November 12th", "12 Nov", "11/12"
  const monthDayMatch = textWorking.match(/\b(?:on\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
  const dayMonthMatch = textWorking.match(/\b(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i);
  const numericDateMatch = textWorking.match(/\b(?:on\s+)?(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/i);

  if (monthDayMatch && !hasExplicitDate) {
    hasExplicitDate = true;
    const m = MONTH_NAMES[monthDayMatch[1].toLowerCase()];
    const d = parseInt(monthDayMatch[2], 10);
    if (m !== undefined && d >= 1 && d <= 31) {
      targetMonth = m;
      targetDay = d;
    }
    textWorking = textWorking.replace(monthDayMatch[0], " ");
  } else if (dayMonthMatch && !hasExplicitDate) {
    hasExplicitDate = true;
    const d = parseInt(dayMonthMatch[1], 10);
    const m = MONTH_NAMES[dayMonthMatch[2].toLowerCase()];
    if (m !== undefined && d >= 1 && d <= 31) {
      targetMonth = m;
      targetDay = d;
    }
    textWorking = textWorking.replace(dayMonthMatch[0], " ");
  } else if (numericDateMatch && !hasExplicitDate) {
    hasExplicitDate = true;
    const m = parseInt(numericDateMatch[1], 10) - 1;
    const d = parseInt(numericDateMatch[2], 10);
    if (m >= 0 && m <= 11 && d >= 1 && d <= 31) {
      targetMonth = m;
      targetDay = d;
      if (numericDateMatch[3]) {
        let yr = parseInt(numericDateMatch[3], 10);
        if (yr < 100) yr += 2000;
        targetYear = yr;
      }
    }
    textWorking = textWorking.replace(numericDateMatch[0], " ");
  }

  // 7. Time range or single time: "3pm-4:30pm", "10am to 11am", "at 3:30pm", "3pm", "14:00"
  let startHour = 9;
  let startMinute = 0;

  // Check for time range first e.g. "3pm-4pm", "10am - 11:30am", "14:00-15:30"
  const rangeMatch = textWorking.match(/\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (rangeMatch) {
    hasExplicitTime = true;
    let h1 = parseInt(rangeMatch[1], 10);
    const m1 = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : 0;
    const p1 = rangeMatch[3]?.toLowerCase();

    let h2 = parseInt(rangeMatch[4], 10);
    const m2 = rangeMatch[5] ? parseInt(rangeMatch[5], 10) : 0;
    const p2 = rangeMatch[6]?.toLowerCase();

    // infer p1 if missing
    let period1 = p1 || p2;
    if (period1 === "pm" && h1 < 12) h1 += 12;
    if (period1 === "am" && h1 === 12) h1 = 0;

    if (p2 === "pm" && h2 < 12) h2 += 12;
    if (p2 === "am" && h2 === 12) h2 = 0;

    startHour = h1;
    startMinute = m1;
    const endMinutes = h2 * 60 + m2;
    const startMinutes = h1 * 60 + m1;
    if (endMinutes > startMinutes) {
      durationMinutes = endMinutes - startMinutes;
    }
    textWorking = textWorking.replace(rangeMatch[0], " ");
  } else {
    // Single time match: "at 3:30pm", "3:30pm", "3pm", "15:00", "at 9"
    const singleTimeMatch = textWorking.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    const militaryTimeMatch = textWorking.match(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/i);

    if (singleTimeMatch) {
      hasExplicitTime = true;
      let h = parseInt(singleTimeMatch[1], 10);
      const m = singleTimeMatch[2] ? parseInt(singleTimeMatch[2], 10) : 0;
      const period = singleTimeMatch[3].toLowerCase();
      if (period === "pm" && h < 12) h += 12;
      if (period === "am" && h === 12) h = 0;
      startHour = h;
      startMinute = m;
      textWorking = textWorking.replace(singleTimeMatch[0], " ");
    } else if (militaryTimeMatch) {
      hasExplicitTime = true;
      startHour = parseInt(militaryTimeMatch[1], 10);
      startMinute = parseInt(militaryTimeMatch[2], 10);
      textWorking = textWorking.replace(militaryTimeMatch[0], " ");
    }
  }

  // 8. If no explicit time was provided and not all-day, default to the next full hour
  if (!hasExplicitTime && !isAllDay) {
    const nextH = new Date(referenceDate);
    nextH.setMinutes(0, 0, 0);
    nextH.setHours(nextH.getHours() + 1);
    startHour = nextH.getHours();
    startMinute = 0;
  }

  // 9. Clean up residual prepositions and extra spaces from the title
  let cleanTitle = textWorking
    .replace(/\b(at|on|for|from|in|to)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleanTitle) {
    cleanTitle = "New Event";
  }

  // 10. Detect category from raw text or title
  const category = detectCategory(input);

  // 11. Build Start and End Dates
  const startDate = new Date(targetYear, targetMonth, targetDay, startHour, startMinute, 0, 0);
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

  return {
    raw: input,
    title: cleanTitle,
    category,
    startDate,
    endDate,
    durationMinutes,
    isAllDay,
    hasExplicitTime,
    hasExplicitDate,
  };
}
