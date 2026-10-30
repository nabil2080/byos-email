import {
  HolidayCalendarFeed,
  HolidayEventDefinition,
  getFeedById,
  getFeedEvents,
  getFeedEventsForYearRange,
} from "./holidayCatalogue";
import { UserCalendar } from "../../../api";
import { DecryptedEventRecord } from "../CalendarSidebar";

export interface HolidaySubscription {
  feedId: string;
  calendarId: string;
  name: string;
  color: string;
  includeObservances: boolean;
  hiddenEventIds: string[];
  isVisible: boolean;
  subscribedAt: string;
  lastRefreshed: string;
}

function getStorageKey(mailboxId: string): string {
  return `byos_calendar_holiday_subs_${mailboxId}`;
}

/**
 * Load user's holiday subscriptions from localStorage
 */
export function getHolidaySubscriptions(mailboxId?: string): HolidaySubscription[] {
  if (!mailboxId || typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(getStorageKey(mailboxId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("[holidaySubscriptionStore] Failed to load subscriptions:", err);
    return [];
  }
}

/**
 * Save subscriptions to localStorage and dispatch update event
 */
function saveSubscriptions(mailboxId: string, subs: HolidaySubscription[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getStorageKey(mailboxId), JSON.stringify(subs));
    if (typeof window.dispatchEvent === "function") {
      try {
        const EventCtor = (window as any).CustomEvent || (globalThis as any).CustomEvent;
        if (EventCtor) {
          window.dispatchEvent(
            new EventCtor("byos_holiday_subs_updated", {
              detail: { mailboxId, subscriptions: subs },
            })
          );
        }
      } catch {}
    }
  } catch (err) {
    console.warn("[holidaySubscriptionStore] Failed to save subscriptions:", err);
  }
}

function extractFeedId(feedOrId: string | HolidayCalendarFeed | any): string {
  if (!feedOrId) return "";
  if (typeof feedOrId === "string") return feedOrId;
  if (typeof feedOrId === "object" && feedOrId.id) return String(feedOrId.id);
  return String(feedOrId);
}

/**
 * Subscribe to a holiday or religious calendar feed.
 * Prevents duplicate subscriptions.
 */
export function subscribeHolidayFeed(
  mailboxId: string,
  feedOrId: string | HolidayCalendarFeed | any,
  options?: {
    color?: string;
    name?: string;
    includeObservances?: boolean;
  }
): HolidaySubscription {
  const feedId = extractFeedId(feedOrId);
  const feed = typeof feedOrId === "object" && feedOrId?.events ? feedOrId : getFeedById(feedId);
  if (!feed || !feedId) {
    throw new Error(`Holiday feed '${feedId}' not found in catalogue`);
  }

  const existing = getHolidaySubscriptions(mailboxId);
  const found = existing.find((s) => s.feedId === feedId || s.calendarId === feedId);
  if (found) {
    // Duplicate prevented; update options if supplied
    if (options) {
      return (
        updateHolidaySubscription(mailboxId, feedId, {
          color: options.color ?? found.color,
          name: options.name ?? found.name,
          includeObservances:
            options.includeObservances !== undefined ? options.includeObservances : found.includeObservances,
        }) || found
      );
    }
    return found;
  }

  const newSub: HolidaySubscription = {
    feedId,
    calendarId: `holiday-${feedId}`,
    name: options?.name || feed.name,
    color: options?.color || feed.defaultColor,
    includeObservances: options?.includeObservances ?? true,
    hiddenEventIds: [],
    isVisible: true,
    subscribedAt: new Date().toISOString(),
    lastRefreshed: new Date().toISOString(),
  };

  const updated = [...existing, newSub];
  saveSubscriptions(mailboxId, updated);
  return newSub;
}

/**
 * Unsubscribe from a holiday feed
 */
export function unsubscribeHolidayFeed(mailboxId: string, feedOrId: string | HolidayCalendarFeed | any): void {
  const feedId = extractFeedId(feedOrId);
  if (!feedId) return;
  const existing = getHolidaySubscriptions(mailboxId);
  const updated = existing.filter((s) => s.feedId !== feedId && s.calendarId !== feedId);
  saveSubscriptions(mailboxId, updated);
}

/**
 * Update subscription preferences (color, name, visibility, observances)
 */
export function updateHolidaySubscription(
  mailboxId: string,
  feedOrId: string | HolidayCalendarFeed | any,
  updates: Partial<HolidaySubscription>
): HolidaySubscription | undefined {
  const feedId = extractFeedId(feedOrId);
  if (!feedId) return undefined;
  const existing = getHolidaySubscriptions(mailboxId);
  let updatedSub: HolidaySubscription | undefined = undefined;

  const next = existing.map((s) => {
    if (s.feedId === feedId || s.calendarId === feedId) {
      updatedSub = { ...s, ...updates };
      return updatedSub;
    }
    return s;
  });

  if (updatedSub) {
    saveSubscriptions(mailboxId, next);
  }
  return updatedSub;
}

/**
 * Update holiday subscription color
 */
export function updateHolidaySubscriptionColor(mailboxId: string, feedOrId: string | HolidayCalendarFeed | any, color: string): void {
  updateHolidaySubscription(mailboxId, feedOrId, { color });
}

/**
 * Toggle inclusion of observances in holiday subscription
 */
export function toggleHolidayObservances(mailboxId: string, feedOrId: string | HolidayCalendarFeed | any): boolean {
  const feedId = extractFeedId(feedOrId);
  if (!feedId) return false;
  const existing = getHolidaySubscriptions(mailboxId);
  const found = existing.find((s) => s.feedId === feedId || s.calendarId === feedId);
  const nextVal = found ? !found.includeObservances : false;
  updateHolidaySubscription(mailboxId, feedId, { includeObservances: nextVal });
  return nextVal;
}

/**
 * Toggle visibility of a subscribed calendar
 */
export function toggleHolidayVisibility(mailboxId: string, feedOrId: string | HolidayCalendarFeed | any): boolean {
  const feedId = extractFeedId(feedOrId);
  if (!feedId) return false;
  const existing = getHolidaySubscriptions(mailboxId);
  let newVisibility = true;

  const next = existing.map((s) => {
    if (s.feedId === feedId || s.calendarId === feedId) {
      newVisibility = !s.isVisible;
      return { ...s, isVisible: newVisibility };
    }
    return s;
  });

  saveSubscriptions(mailboxId, next);
  return newVisibility;
}

/**
 * Hide an individual holiday entry from the calendar
 */
export function hideHolidayEvent(mailboxId: string, feedOrId: string | HolidayCalendarFeed | any, eventId: string): void {
  const feedId = extractFeedId(feedOrId);
  if (!feedId) return;
  const existing = getHolidaySubscriptions(mailboxId);
  const next = existing.map((s) => {
    if (s.feedId === feedId || s.calendarId === feedId) {
      const hidden = new Set(s.hiddenEventIds || []);
      hidden.add(eventId);
      return { ...s, hiddenEventIds: Array.from(hidden) };
    }
    return s;
  });
  saveSubscriptions(mailboxId, next);
}

/**
 * Restore a previously hidden individual holiday entry
 */
export function restoreHolidayEvent(mailboxId: string, feedOrId: string | HolidayCalendarFeed | any, eventId: string): void {
  const feedId = extractFeedId(feedOrId);
  if (!feedId) return;
  const existing = getHolidaySubscriptions(mailboxId);
  const next = existing.map((s) => {
    if (s.feedId === feedId || s.calendarId === feedId) {
      return {
        ...s,
        hiddenEventIds: (s.hiddenEventIds || []).filter((id) => id !== eventId),
      };
    }
    return s;
  });
  saveSubscriptions(mailboxId, next);
}

/**
 * Refresh a holiday feed timestamp from provider
 */
export function refreshHolidayFeed(mailboxId: string, feedOrId: string | HolidayCalendarFeed | any): void {
  const feedId = extractFeedId(feedOrId);
  if (!feedId) return;
  const existing = getHolidaySubscriptions(mailboxId);
  const next = existing.map((s) => {
    if (s.feedId === feedId || s.calendarId === feedId) {
      return { ...s, lastRefreshed: new Date().toISOString() };
    }
    return s;
  });
  saveSubscriptions(mailboxId, next);
}

/**
 * Convert a HolidaySubscription into a UserCalendar interface for sidebar and views
 */
export function subscriptionToUserCalendar(sub: HolidaySubscription): UserCalendar {
  const feed = getFeedById(sub.feedId);
  return {
    id: sub.calendarId,
    mailbox_id: "byos-holidays",
    name: sub.name,
    color: sub.color,
    is_default: false,
    created_at: sub.subscribedAt,
    updated_at: sub.lastRefreshed,
    is_shared: true,
    permission: "read",
    owner_email: feed?.provider || "BYOS Public Holiday Registry",
    share_id: `sub-${sub.feedId}`,
  };
}

/**
 * Generate DecryptedEventRecord items for all visible, non-hidden holiday events within a window
 */
export function buildHolidayDecryptedRecords(
  mailboxId: string,
  windowStart: Date,
  windowEnd: Date
): DecryptedEventRecord[] {
  const subs = getHolidaySubscriptions(mailboxId);
  const records: DecryptedEventRecord[] = [];

  for (const sub of subs) {
    if (!sub.isVisible) continue;
    const feed = getFeedById(sub.feedId);
    if (!feed) continue;

    const startYear = windowStart.getFullYear();
    const endYear = windowEnd.getFullYear();
    const events = getFeedEventsForYearRange(sub.feedId, startYear, endYear, {
      includeObservances: sub.includeObservances,
      hiddenEventIds: sub.hiddenEventIds,
    });

    for (const ev of events) {
      const [y, m, d] = ev.date.split("-").map(Number);
      const start = new Date(y, m - 1, d, 0, 0, 0);
      const end = new Date(y, m - 1, d, 23, 59, 59);

      // Window filter
      if (end < windowStart || start > windowEnd) continue;

      records.push({
        id: `holiday-${ev.id}`,
        calendarId: sub.calendarId,
        startTime: start,
        endTime: end,
        isAllDay: true,
        status: "free", // Holidays do not block private scheduling by default
        details: {
          title: ev.title,
          description: ev.description,
          location: feed.regionOrTradition,
          attendees: [],
          reminders: [],
          organizer: { email: feed.provider },
        },
        baseEventId: `holiday-${ev.id}`,
        isOccurrence: false,
        isHoliday: true,
        holidayMeta: {
          feedId: sub.feedId,
          eventId: ev.id,
          tradition: ev.tradition,
          dateType: ev.dateType,
          provisionalNote: ev.provisionalNote,
          regionalDifferences: ev.regionalDifferences,
          provider: feed.provider,
          lastUpdated: feed.lastUpdated,
          isObservance: ev.isObservance,
        },
      });
    }
  }

  return records;
}
