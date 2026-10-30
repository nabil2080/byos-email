/**
 * BYOS Calendar - Category 13: Integrations & External Connections Store
 * Manages email-to-calendar linking, dismissed suggestions, and video-conferencing providers.
 */

import { EmailExtractionCategory } from "../../../utils/calendarEmailExtractor";

export interface LinkedEmailEventRecord {
  messageId: string;
  eventId: string;
  calendarId: string;
  category: EmailExtractionCategory;
  confirmationCode?: string;
  title: string;
  addedAt: string;
}

export interface CalendarIntegrationsSettings {
  enabled: boolean;
  categories: {
    flights: boolean;
    hotels: boolean;
    restaurants: boolean;
    tickets: boolean;
    events: boolean;
  };
  autoSuggestInReadingPane: boolean;
  showBirthdaysFromContacts: boolean;
  videoConferenceProvider: "none" | "byos_room" | "jitsi" | "custom";
  customVideoUrlTemplate: string;
}

export const DEFAULT_INTEGRATIONS_SETTINGS: CalendarIntegrationsSettings = {
  enabled: true,
  categories: {
    flights: true,
    hotels: true,
    restaurants: true,
    tickets: true,
    events: true,
  },
  autoSuggestInReadingPane: true,
  showBirthdaysFromContacts: true,
  videoConferenceProvider: "byos_room",
  customVideoUrlTemplate: "https://meet.jit.si/byos-{roomId}",
};

function getSettingsKey(mailboxId: string): string {
  return `byos_calendar_integrations_settings_${mailboxId || "default"}`;
}

function getDismissedKey(mailboxId: string): string {
  return `byos_calendar_dismissed_suggestions_${mailboxId || "default"}`;
}

function getLinksKey(mailboxId: string): string {
  return `byos_calendar_linked_email_events_${mailboxId || "default"}`;
}

export function getIntegrationSettings(mailboxId: string): CalendarIntegrationsSettings {
  try {
    const raw = localStorage.getItem(getSettingsKey(mailboxId));
    if (!raw) return { ...DEFAULT_INTEGRATIONS_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_INTEGRATIONS_SETTINGS,
      ...parsed,
      categories: {
        ...DEFAULT_INTEGRATIONS_SETTINGS.categories,
        ...(parsed.categories || {}),
      },
    };
  } catch {
    return { ...DEFAULT_INTEGRATIONS_SETTINGS };
  }
}

function safeDispatchEvent(name: string, detail: any) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  try {
    const CustomEventClass = (window as any).CustomEvent || (globalThis as any).CustomEvent;
    if (typeof CustomEventClass === "function") {
      window.dispatchEvent(new CustomEventClass(name, { detail }));
    }
  } catch {
    // Graceful fallback for headless Node.js test harness
  }
}

export function saveIntegrationSettings(
  mailboxId: string,
  settings: Partial<CalendarIntegrationsSettings>
): CalendarIntegrationsSettings {
  const current = getIntegrationSettings(mailboxId);
  const updated: CalendarIntegrationsSettings = {
    ...current,
    ...settings,
    categories: {
      ...current.categories,
      ...(settings.categories || {}),
    },
  };
  try {
    localStorage.setItem(getSettingsKey(mailboxId), JSON.stringify(updated));
    safeDispatchEvent("byos_calendar_integrations_updated", { mailboxId, settings: updated });
  } catch (e) {
    console.error("[calendarIntegrationsStore] Failed to save settings:", e);
  }
  return updated;
}

export function getDismissedSuggestionIds(mailboxId: string): string[] {
  try {
    const raw = localStorage.getItem(getDismissedKey(mailboxId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function dismissSuggestion(mailboxId: string, suggestionId: string): void {
  try {
    const list = getDismissedSuggestionIds(mailboxId);
    if (!list.includes(suggestionId)) {
      list.push(suggestionId);
      localStorage.setItem(getDismissedKey(mailboxId), JSON.stringify(list));
      safeDispatchEvent("byos_calendar_integrations_updated", { mailboxId });
    }
  } catch (e) {
    console.error("[calendarIntegrationsStore] Failed to dismiss suggestion:", e);
  }
}

export function getLinkedEmailEvents(mailboxId: string): Record<string, LinkedEmailEventRecord> {
  try {
    const raw = localStorage.getItem(getLinksKey(mailboxId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function linkEmailToCalendarEvent(
  mailboxId: string,
  record: LinkedEmailEventRecord
): void {
  try {
    const map = getLinkedEmailEvents(mailboxId);
    map[record.messageId] = record;
    localStorage.setItem(getLinksKey(mailboxId), JSON.stringify(map));
    safeDispatchEvent("byos_calendar_integrations_updated", { mailboxId, record });
  } catch (e) {
    console.error("[calendarIntegrationsStore] Failed to link email event:", e);
  }
}

export function unlinkEmailEvent(mailboxId: string, messageId: string): void {
  try {
    const map = getLinkedEmailEvents(mailboxId);
    delete map[messageId];
    localStorage.setItem(getLinksKey(mailboxId), JSON.stringify(map));
    safeDispatchEvent("byos_calendar_integrations_updated", { mailboxId, messageId });
  } catch (e) {
    console.error("[calendarIntegrationsStore] Failed to unlink email event:", e);
  }
}

/**
 * Generates a video conference meeting link based on the user's selected provider.
 */
export function generateVideoMeetingUrl(
  provider: "none" | "byos_room" | "jitsi" | "custom",
  eventTitle?: string,
  customTemplate?: string
): string {
  if (provider === "none") return "";

  // Generate random 8-character token
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 8; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  const slug = eventTitle
    ? eventTitle
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .slice(0, 20)
    : "room";

  const roomId = `${slug}-${token}`;

  switch (provider) {
    case "byos_room":
      return `https://meet.byos.local/room/byos-${roomId}`;
    case "jitsi":
      return `https://meet.jit.si/byos-${roomId}`;
    case "custom":
      if (customTemplate && customTemplate.includes("{roomId}")) {
        return customTemplate.replace("{roomId}", roomId);
      }
      return customTemplate || `https://meet.example.com/${roomId}`;
    default:
      return `https://meet.byos.local/room/byos-${roomId}`;
  }
}
