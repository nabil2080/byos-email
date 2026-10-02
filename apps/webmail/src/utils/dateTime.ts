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

export function formatScheduledChip(
  sendAt?: string | Date | number,
  status?: string
): string {
  if (!sendAt) return "Scheduled";
  const d = new Date(sendAt);
  if (isNaN(d.getTime())) return "Scheduled";
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs <= 0) {
    return "Sending shortly…";
  }
  const diffMinutes = Math.round(diffMs / (60 * 1000));
  const diffHours = Math.round(diffMs / (60 * 60 * 1000));

  if (diffMinutes < 60) {
    return `Scheduled · in ${Math.max(1, diffMinutes)}m`;
  }
  if (diffHours < 24) {
    return `Scheduled · in ${diffHours}h`;
  }
  const formattedDate = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const formattedTime = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `Scheduled · ${formattedDate}, ${formattedTime}`;
}

export function formatScheduledBanner(
  sendAt?: string | Date | number,
  status?: string
): string {
  if (!sendAt) return "Scheduled to send";
  const d = new Date(sendAt);
  if (isNaN(d.getTime())) return "Scheduled to send";
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs <= 0) {
    return "Sending shortly…";
  }
  const diffMinutes = Math.round(diffMs / (60 * 1000));
  const diffHours = Math.round(diffMs / (60 * 60 * 1000));

  let timeRelative = "";
  if (diffMinutes < 60) {
    const mins = Math.max(1, diffMinutes);
    timeRelative = `in ${mins} minute${mins === 1 ? "" : "s"}`;
  } else if (diffHours < 24) {
    timeRelative = `in ${diffHours} hour${diffHours === 1 ? "" : "s"}`;
  } else {
    const diffDays = Math.round(diffHours / 24);
    timeRelative = `in ${diffDays} day${diffDays === 1 ? "" : "s"}`;
  }

  const formattedDate = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const formattedTime = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return `Scheduled to send · ${formattedDate}, ${formattedTime} (${timeRelative})`;
}
