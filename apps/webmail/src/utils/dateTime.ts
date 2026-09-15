// Date & Time formatting utility supporting 12h/24h formats, language locales, and week starts

export function formatTime(
  dateInput: string | Date | number,
  timeFormat: "12h" | "24h" = "12h"
): string {
  if (!dateInput) return "";
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);

  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: timeFormat === "12h",
  });
}

export function formatMessageDate(
  dateInput: string | Date | number,
  timeFormat: "12h" | "24h" = "12h",
  locale: string = "en"
): string {
  if (!dateInput) return "";
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);

  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  if (isToday) {
    return formatTime(d, timeFormat);
  }

  const isThisYear = d.getFullYear() === now.getFullYear();
  if (isThisYear) {
    return d.toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
    });
  }

  return d.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatFullDateTime(
  dateInput: string | Date | number,
  timeFormat: "12h" | "24h" = "12h",
  locale: string = "en"
): string {
  if (!dateInput) return "";
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);

  const datePart = d.toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timePart = formatTime(d, timeFormat);

  return `${datePart} • ${timePart}`;
}
