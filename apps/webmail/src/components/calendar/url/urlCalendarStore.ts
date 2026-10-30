import { UserCalendar } from "../../../api";
import { DecryptedEventRecord } from "../CalendarSidebar";
import { parseIcs, ParsedIcsEvent } from "../../../utils/calendarIcs";
import { expandEventOccurrences } from "../../../utils/calendarRrule";

export interface CachedUrlEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  startTime: string; // ISO date string
  endTime: string;   // ISO date string
  isAllDay: boolean;
  rrule?: string;
  status?: string;
}

export interface UrlCalendarSubscription {
  id: string;
  calendarId: string;
  name: string;
  url: string;
  color: string;
  refreshIntervalMinutes: number; // 0 = manual, 1440 = daily, 10080 = weekly
  lastRefreshed?: string;
  cachedEvents: CachedUrlEvent[];
  isVisible: boolean;
  isReadOnly: boolean;
  isPaused?: boolean;
  errorMessage?: string;
}

const STORAGE_PREFIX = "byos_calendar_url_subs_";

function getStorageKey(mailboxId: string): string {
  return `${STORAGE_PREFIX}${mailboxId}`;
}

export function getUrlSubscriptions(mailboxId: string): UrlCalendarSubscription[] {
  if (typeof window === "undefined" || !mailboxId) return [];
  try {
    const raw = localStorage.getItem(getStorageKey(mailboxId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("[urlCalendarStore] Failed to load url subscriptions:", err);
    return [];
  }
}

function persistUrlSubscriptions(mailboxId: string, subs: UrlCalendarSubscription[]): void {
  if (typeof window === "undefined" || !mailboxId) return;
  try {
    localStorage.setItem(getStorageKey(mailboxId), JSON.stringify(subs));
    if (typeof window.dispatchEvent === "function") {
      try {
        const EventCtor = (window as any).CustomEvent || (window as any).Event || (globalThis as any).CustomEvent || (globalThis as any).Event;
        if (EventCtor) {
          window.dispatchEvent(new EventCtor("byos_url_subs_updated"));
        }
      } catch {}
    }
  } catch (err) {
    console.warn("[urlCalendarStore] Failed to persist url subscriptions:", err);
  }
}

export function normalizeCalendarUrl(url: string): string {
  let cleaned = url.trim();
  if (cleaned.startsWith("webcal://")) {
    cleaned = "https://" + cleaned.slice(9);
  }
  return cleaned;
}

export function isValidCalendarUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  return (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("webcal://")
  );
}

export function urlSubToUserCalendar(sub: UrlCalendarSubscription): UserCalendar {
  return {
    id: sub.calendarId,
    mailbox_id: "",
    name: sub.name,
    color: sub.color || "#3B82F6",
    is_default: false,
    is_shared: true,
    permission: "read",
    template: "url_feed",
    created_at: sub.lastRefreshed || new Date().toISOString(),
    updated_at: sub.lastRefreshed || new Date().toISOString(),
  };
}

export async function fetchAndParseUrlFeed(
  url: string
): Promise<{ title?: string; events: CachedUrlEvent[] }> {
  const normalized = normalizeCalendarUrl(url);
  let resp: Response;
  try {
    resp = await fetch(normalized, {
      method: "GET",
      headers: {
        Accept: "text/calendar, text/plain, */*",
      },
    });
  } catch (err: any) {
    const isCorsOrNetwork =
      err instanceof TypeError ||
      err?.name === "TypeError" ||
      err?.message?.includes("Failed to fetch") ||
      err?.message?.includes("NetworkError") ||
      err?.message?.includes("CORS");
    if (isCorsOrNetwork) {
      throw new Error(
        `Unable to fetch calendar feed due to cross-origin restriction (CORS) or network error: ${err.message}. To import external feeds that block direct browser requests, download the .ics file and use Calendar Settings -> Import ICS.`
      );
    }
    throw new Error(`Failed to connect to calendar feed: ${err?.message || String(err)}`);
  }

  if (!resp.ok) {
    throw new Error(`Failed to fetch calendar feed: HTTP ${resp.status} ${resp.statusText}`);
  }

  const icsText = await resp.text();
  const parsed = parseIcs(icsText);

  // Derive title from X-WR-CALNAME or URL hostname if not in ICS
  let calendarTitle: string | undefined;
  const calNameMatch = icsText.match(/X-WR-CALNAME:(.+)/i);
  if (calNameMatch && calNameMatch[1]) {
    calendarTitle = calNameMatch[1].trim();
  }

  const events: CachedUrlEvent[] = parsed.events.map((ev) => ({
    uid: ev.uid,
    summary: ev.summary || "Untitled Event",
    description: ev.description,
    location: ev.location,
    startTime: ev.startTime.toISOString(),
    endTime: ev.endTime.toISOString(),
    isAllDay: ev.isAllDay,
    rrule: ev.rrule,
    status: ev.status ? ev.status.toLowerCase() : "busy",
  }));

  return { title: calendarTitle, events };
}

export function subscribeUrlFeed(
  mailboxId: string,
  input: {
    url: string;
    name?: string;
    color?: string;
    refreshIntervalMinutes?: number;
    initialEvents?: CachedUrlEvent[];
  }
): UrlCalendarSubscription {
  const current = getUrlSubscriptions(mailboxId);
  const normalized = normalizeCalendarUrl(input.url);

  // Check if feed already subscribed
  const existing = current.find((s) => normalizeCalendarUrl(s.url) === normalized);
  if (existing) {
    return existing;
  }

  const id = `url-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const calendarId = id;

  let derivedName = input.name?.trim();
  if (!derivedName) {
    try {
      const u = new URL(normalized);
      derivedName = u.pathname.split("/").pop() || u.hostname;
      if (derivedName.endsWith(".ics")) derivedName = derivedName.slice(0, -4);
    } catch {
      derivedName = "Subscribed Feed";
    }
  }

  const newSub: UrlCalendarSubscription = {
    id,
    calendarId,
    name: derivedName,
    url: normalized,
    color: input.color || "#3B82F6",
    refreshIntervalMinutes: input.refreshIntervalMinutes ?? 1440,
    lastRefreshed: new Date().toISOString(),
    cachedEvents: input.initialEvents || [],
    isVisible: true,
    isReadOnly: true,
  };

  current.push(newSub);
  persistUrlSubscriptions(mailboxId, current);
  return newSub;
}

export function unsubscribeUrlFeed(mailboxId: string, calendarId: string): void {
  const current = getUrlSubscriptions(mailboxId);
  const updated = current.filter((s) => s.calendarId !== calendarId && s.id !== calendarId);
  persistUrlSubscriptions(mailboxId, updated);
}

export function toggleUrlSubscriptionVisibility(mailboxId: string, calendarId: string): void {
  const current = getUrlSubscriptions(mailboxId);
  const target = current.find((s) => s.calendarId === calendarId || s.id === calendarId);
  if (target) {
    target.isVisible = !target.isVisible;
    persistUrlSubscriptions(mailboxId, current);
  }
}

export function pauseUrlSubscription(mailboxId: string, calendarId: string, paused: boolean): void {
  const current = getUrlSubscriptions(mailboxId);
  const target = current.find((s) => s.calendarId === calendarId || s.id === calendarId);
  if (target) {
    target.isPaused = paused;
    persistUrlSubscriptions(mailboxId, current);
  }
}

export function updateUrlSubscriptionColor(
  mailboxId: string,
  calendarId: string,
  color: string
): void {
  const current = getUrlSubscriptions(mailboxId);
  const target = current.find((s) => s.calendarId === calendarId || s.id === calendarId);
  if (target) {
    target.color = color;
    persistUrlSubscriptions(mailboxId, current);
  }
}

export async function refreshUrlSubscription(
  mailboxId: string,
  calendarId: string
): Promise<boolean> {
  const current = getUrlSubscriptions(mailboxId);
  const target = current.find((s) => s.calendarId === calendarId || s.id === calendarId);
  if (!target) return false;

  try {
    const res = await fetchAndParseUrlFeed(target.url);
    target.cachedEvents = res.events;
    target.lastRefreshed = new Date().toISOString();
    target.errorMessage = undefined;
    persistUrlSubscriptions(mailboxId, current);
    return true;
  } catch (err: any) {
    console.warn(`[urlCalendarStore] Refresh failed for ${target.url}:`, err);
    target.errorMessage = err?.message || "Failed to refresh feed";
    target.lastRefreshed = new Date().toISOString();
    persistUrlSubscriptions(mailboxId, current);
    return false;
  }
}

export function buildUrlDecryptedRecords(
  mailboxId: string,
  windowStart: Date,
  windowEnd: Date
): DecryptedEventRecord[] {
  const subs = getUrlSubscriptions(mailboxId);
  const visible = subs.filter((s) => s.isVisible && !s.isPaused);
  const records: DecryptedEventRecord[] = [];

  for (const sub of visible) {
    for (const item of sub.cachedEvents) {
      const start = new Date(item.startTime);
      const end = new Date(item.endTime);

      if (item.rrule) {
        // Expand recurring feed events
        const occurrences = expandEventOccurrences(
          item.uid,
          start,
          end,
          item.rrule,
          windowStart,
          windowEnd
        );

        for (const occ of occurrences) {
          records.push({
            id: `${item.uid}_${occ.startTime.getTime()}`,
            calendarId: sub.calendarId,
            startTime: occ.startTime,
            endTime: occ.endTime,
            isAllDay: item.isAllDay,
            status: item.status || "busy",
            baseEventId: item.uid,
            rrule: item.rrule,
            isOccurrence: true,
            details: {
              title: item.summary,
              description: item.description,
              location: item.location,
            },
          });
        }
      } else {
        // Simple non-recurring event: check window overlap
        if (end >= windowStart && start <= windowEnd) {
          records.push({
            id: item.uid,
            calendarId: sub.calendarId,
            startTime: start,
            endTime: end,
            isAllDay: item.isAllDay,
            status: item.status || "busy",
            details: {
              title: item.summary,
              description: item.description,
              location: item.location,
            },
          });
        }
      }
    }
  }

  return records;
}

/**
 * Automatically checks all active URL subscriptions for the mailbox
 * and refreshes any subscription whose lastRefreshed is older than its refreshIntervalMinutes.
 */
export async function refreshDueUrlSubscriptions(mailboxId: string): Promise<number> {
  if (!mailboxId) return 0;
  const subs = getUrlSubscriptions(mailboxId);
  const now = Date.now();
  let refreshedCount = 0;

  for (const sub of subs) {
    if (sub.isPaused) continue;
    const intervalMinutes = sub.refreshIntervalMinutes ?? 1440;
    const lastRefreshedMs = sub.lastRefreshed ? new Date(sub.lastRefreshed).getTime() : 0;
    const elapsedMinutes = (now - lastRefreshedMs) / (1000 * 60);

    if (elapsedMinutes >= intervalMinutes) {
      const ok = await refreshUrlSubscription(mailboxId, sub.calendarId);
      if (ok) refreshedCount++;
    }
  }

  return refreshedCount;
}

/**
 * Starts a background interval lifecycle that periodically refreshes due URL subscriptions.
 * Returns a cleanup cancellation function.
 */
export function startUrlFeedAutoRefresh(
  mailboxId: string,
  checkIntervalMs: number = 60000,
  onRefresh?: () => void
): () => void {
  if (typeof window === "undefined" || !mailboxId) {
    return () => {};
  }

  // Initial check shortly after starting
  const initialTimer = setTimeout(() => {
    refreshDueUrlSubscriptions(mailboxId)
      .then((count) => {
        if (count > 0 && onRefresh) onRefresh();
      })
      .catch((err) => console.warn("[urlCalendarStore] Initial auto-refresh failed:", err));
  }, 2000);
  if (typeof (initialTimer as any)?.unref === "function") {
    (initialTimer as any).unref();
  }

  const intervalId = setInterval(() => {
    refreshDueUrlSubscriptions(mailboxId)
      .then((count) => {
        if (count > 0 && onRefresh) onRefresh();
      })
      .catch((err) => console.warn("[urlCalendarStore] Interval auto-refresh failed:", err));
  }, checkIntervalMs);
  if (typeof (intervalId as any)?.unref === "function") {
    (intervalId as any).unref();
  }

  return () => {
    clearTimeout(initialTimer);
    clearInterval(intervalId);
  };
}
