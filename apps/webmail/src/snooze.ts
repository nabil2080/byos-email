// Snooze helper functions and preset calculations
// Known V1 Limitations:
// - If the user is actively viewing the inbox when a snooze expires, the message doesn't appear until the next refresh
// - Search results may include snoozed messages (V1.1 fix)
// - No notification when a snooze expires (V1.1 push notification)

export function computeLaterToday(from: Date = new Date()): Date {
  const d = new Date(from);
  if (d.getHours() < 18) {
    d.setHours(18, 0, 0, 0);
  } else {
    d.setTime(d.getTime() + 3 * 60 * 60 * 1000);
  }
  return d;
}

export function computeTomorrow(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d;
}

export function computeThisWeekend(from: Date = new Date()): Date {
  const d = new Date(from);
  const day = d.getDay(); // 0: Sun, 6: Sat
  let daysUntilSaturday = 6 - day;
  if (daysUntilSaturday <= 0) {
    daysUntilSaturday += 7;
  }
  d.setDate(d.getDate() + daysUntilSaturday);
  d.setHours(8, 0, 0, 0);
  return d;
}

export function computeNextWeek(from: Date = new Date()): Date {
  const d = new Date(from);
  const day = d.getDay(); // 0: Sun, 1: Mon
  let daysUntilMonday = (1 - day + 7) % 7;
  if (daysUntilMonday === 0) {
    daysUntilMonday = 7;
  }
  d.setDate(d.getDate() + daysUntilMonday);
  d.setHours(8, 0, 0, 0);
  return d;
}

export function formatTime12(date: Date): string {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12;
  const minStr = minutes < 10 ? "0" + minutes : String(minutes);
  return `${hours}:${minStr} ${ampm}`;
}

export function formatSnoozeTime(date: Date, now: Date = new Date()): string {
  const timeStr = formatTime12(date);

  const isSameDay = (d1: Date, d2: Date) =>
    d1.getDate() === d2.getDate() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getFullYear() === d2.getFullYear();

  if (isSameDay(date, now)) {
    return `Today at ${timeStr}`;
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameDay(date, tomorrow)) {
    return `Tomorrow at ${timeStr}`;
  }

  const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const diffTime = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (24 * 60 * 60 * 1000));

  if (diffDays > 1 && diffDays < 7) {
    return `${daysOfWeek[date.getDay()]} at ${timeStr}`;
  }

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[date.getMonth()]} ${date.getDate()} at ${timeStr}`;
}

/**
 * Returns true if the message is actively snoozed at reference timestamp `now`.
 */
export function isMessageSnoozed(snoozedUntil?: string | null, now: number = Date.now()): boolean {
  if (!snoozedUntil) return false;
  const time = new Date(snoozedUntil).getTime();
  return !isNaN(time) && time > now;
}

/**
 * Identify messages whose snooze window elapsed between `lastCheck` and `now`.
 */
export function checkSnoozeExpirations<T extends { id: string; snoozedUntil?: string }>(
  messages: T[],
  lastCheck: number,
  now: number = Date.now()
): T[] {
  return messages.filter((m) => {
    if (!m.snoozedUntil) return false;
    const time = new Date(m.snoozedUntil).getTime();
    return !isNaN(time) && time > lastCheck && time <= now;
  });
}

