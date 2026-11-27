import {
  Component,
  createSignal,
  createEffect,
  createMemo,
  Show,
  onMount,
  onCleanup,
} from "solid-js";
import {
  UserCalendar,
  CalendarEventItem,
  ContactItem,
  fetchCalendars,
  fetchMailboxDetail,
  createCalendar,
  updateCalendar,
  deleteCalendar,
  fetchCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  createCalendarEventException,
  updateCalendarEventException,
  deleteCalendarEventException,
  revokeCalendarShare,
  UserMe,
  Mailbox,
  ConnectedAccount,
} from "../../api";
import * as WasmCore from "../../generated/crypto-core/byos_crypto_core.js";
import {
  encryptCalendarEventPayload,
  decryptCalendarEventPayload,
  CalendarEventPlaintext,
} from "../../calendar_crypto";
import {
  findLegacyCalendarEvents,
  executeLegacyCalendarEventRecovery,
} from "../../calendar_recovery";
import { expandEventOccurrences, EventExceptionInput } from "../../utils/calendarRrule";
import { generateIcs } from "../../utils/calendarIcs";
import { CalendarSidebar, DecryptedEventRecord } from "./CalendarSidebar";
import { CalendarToolbar, CalendarViewMode } from "./CalendarToolbar";
import { getMailboxKeyFor } from "../../session_isolation";

export type { CalendarViewMode };
import { TopFixedBar, AppModule } from "../TopFixedBar";
import { WeekView } from "./WeekView";
import { DayView } from "./DayView";
import { MonthView } from "./MonthView";
import { YearView } from "./YearView";
import { AgendaView } from "./AgendaView";
import { MobileCalendarHeader } from "./MobileCalendarHeader";
import { MobileCalendarFab } from "./MobileCalendarFab";
import { MobileMonthSplitView } from "./MobileMonthSplitView";
import { EventModal } from "./EventModal";
import { CalendarModal } from "./CalendarModal";
import { ShareCalendarModal } from "./ShareCalendarModal";
import {
  createCalendarSettings,
  saveCalendarOverrides,
  loadCalendarOverrides,
  CalendarOverrides,
} from "./settings/calendarSettingsStore";
import { CalendarSettingsModal } from "./CalendarSettingsModal";
import {
  HolidaySubscription,
  getHolidaySubscriptions,
  subscriptionToUserCalendar,
  buildHolidayDecryptedRecords,
  toggleHolidayVisibility,
  unsubscribeHolidayFeed,
  hideHolidayEvent,
} from "./holidays/holidaySubscriptionStore";
import {
  UrlCalendarSubscription,
  getUrlSubscriptions,
  urlSubToUserCalendar,
  buildUrlDecryptedRecords,
  toggleUrlSubscriptionVisibility,
  unsubscribeUrlFeed,
  refreshUrlSubscription,
  startUrlFeedAutoRefresh,
} from "./url/urlCalendarStore";
import { SubscribeFromUrlModal } from "./url/SubscribeFromUrlModal";
import { detectBrowserTimeZone } from "../../utils/calendarTimezones";
import { generateContactBirthdayEvents } from "../../utils/calendarContactsIntegration";
import {
  ActiveCalendarReminderAlert,
  evaluateUpcomingReminders,
  evaluateUpcomingTaskReminders,
  snoozeReminderAlert,
  getDispatchedLedger,
  markAlertDispatched,
  unmarkAlertDispatched,
} from "../../utils/calendarNotifications";
import { CalendarTrashModal } from "./trash/CalendarTrashModal";
import {
  moveEventToTrash,
  restoreEventFromTrash,
  TrashEventRecord,
} from "./trash/calendarTrashStore";
import { CalendarShortcutsModal } from "./shortcuts/CalendarShortcutsModal";
import {
  isBrowserOnline,
  getOfflineQueue,
  syncOfflineQueue,
  enqueueOfflineAction,
  cacheDecryptedEvents,
  getCachedDecryptedEvents,
} from "./offline/calendarOfflineSync";

interface CalendarViewProps {
  currentUser?: UserMe | null;
  selectedMailbox?: Mailbox | null;
  connectedAccounts?: ConnectedAccount[];
  activeAccountId?: string;
  onSelectAccount?: (account: ConnectedAccount) => void;
  onSelectAllInboxes?: () => void;
  onOpenAddMailbox?: () => void;
  onLogout?: (accountId?: string, logOutAll?: boolean) => void;
  profilePhotoUrl?: string | null;
  photoUrls?: Record<string, string>;
  isUnlocked?: boolean;
  storageError?: string | null;
  accountUnreadCounts?: Record<string, number>;
  unifiedUnreadCount?: number;
  mailboxId: string;
  mailboxKey: Uint8Array | null;
  mailboxPk?: string | null;
  unlockedBoxId?: string | null;
  currentUserEmail?: string;
  contacts?: ContactItem[];
  class?: string;
  onSwitchToMail?: () => void;
  onSendInvitation?: (attendeeEmail: string, icsContent: string, subject: string) => Promise<void>;
  externalSearchQuery?: string;
  activeModule?: AppModule;
  onSwitchModule?: (mod: AppModule) => void;
  onOpenContacts?: () => void;
  onOpenSettings?: () => void;
  onSearchChange?: (q: string) => void;
  isOnline?: boolean;
  isCustomizerOpen?: boolean;
  onToggleCustomizer?: () => void;
  theme?: string;
  onToggleTheme?: () => void;
  savedViewMode?: CalendarViewMode;
  onViewModeChange?: (mode: CalendarViewMode) => void;
  onCheckReminders?: () => void;
  selectedEventId?: string | null;
}

export const CalendarView: Component<CalendarViewProps> = (props) => {
  const [currentDate, setCurrentDate] = createSignal(new Date());
  const getInitialViewMode = (): CalendarViewMode => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      if (!props.savedViewMode || props.savedViewMode === "year" || props.savedViewMode === "week") {
        return "agenda";
      }
      return props.savedViewMode;
    }
    return props.savedViewMode && props.savedViewMode !== "year" ? props.savedViewMode : "week";
  };
  const [viewMode, setViewMode] = createSignal<CalendarViewMode>(getInitialViewMode());
  const changeViewMode = (mode: CalendarViewMode) => {
    setViewMode(mode);
    props.onViewModeChange?.(mode);
  };

  const hourHeight = createMemo(() => 56);
  const [searchQuery, setSearchQuery] = createSignal("");
  createEffect(() => {
    if (props.externalSearchQuery !== undefined) {
      setSearchQuery(props.externalSearchQuery);
    }
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = createSignal(false);
  const calendarSettings = createCalendarSettings(() => props.mailboxId);
  const [isCalendarSettingsOpen, setIsCalendarSettingsOpen] = createSignal(false);

  // Offline & Trash & Accessibility state (Category 15)
  const [isTrashModalOpen, setIsTrashModalOpen] = createSignal(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = createSignal(false);
  const [isOnline, setIsOnline] = createSignal(isBrowserOnline());
  const [offlineQueueCount, setOfflineQueueCount] = createSignal(0);
  const [screenReaderAnnouncement, setScreenReaderAnnouncement] = createSignal("");

  // Travel / Location Timezone Detection (Category 05)
  const [travelBannerDismissed, setTravelBannerDismissed] = createSignal(false);
  const detectedBrowserTz = createMemo(() => detectBrowserTimeZone());
  const showTravelBanner = createMemo(() => {
    if (travelBannerDismissed()) return false;
    const settings = calendarSettings.settings();
    if (!settings.autoUpdateTimeZoneWithConsent) return false;
    const detected = detectedBrowserTz();
    return Boolean(detected && settings.primaryTimeZone && detected !== settings.primaryTimeZone);
  });

  onMount(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      if (!props.savedViewMode || props.savedViewMode === "year" || props.savedViewMode === "week") {
        setViewMode("agenda");
      } else {
        setViewMode(props.savedViewMode);
      }
    } else if (props.savedViewMode && props.savedViewMode !== "year") {
      setViewMode(props.savedViewMode);
    } else {
      setViewMode("week");
    }

    const updateOnline = () => {
      const online = isBrowserOnline();
      setIsOnline(online);
      if (online && props.mailboxId) {
        handleSyncOffline();
      }
    };
    const updateQueue = () => {
      if (props.mailboxId) {
        setOfflineQueueCount(getOfflineQueue(props.mailboxId).length);
      }
    };
    updateQueue();

    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    window.addEventListener("byos_offline_queue_updated", updateQueue);
    window.addEventListener("keydown", handleGlobalKeyDown);

    const stopUrlRefresh = startUrlFeedAutoRefresh(props.mailboxId || "", 60000, () => {
      loadCalendars();
    });

    onCleanup(() => {
      stopUrlRefresh();
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      window.removeEventListener("byos_offline_queue_updated", updateQueue);
      window.removeEventListener("keydown", handleGlobalKeyDown);
    });
  });

  // Calendars state
  const [calendars, setCalendars] = createSignal<UserCalendar[]>([]);
  const [visibleCalIds, setVisibleCalIds] = createSignal<Set<string>>(new Set());

  // Settings navigation & Holiday Subscriptions state
  const [settingsInitialSection, setSettingsInitialSection] = createSignal<string>("general");
  const [holidaySubs, setHolidaySubs] = createSignal<HolidaySubscription[]>([]);

  function loadHolidaySubs() {
    if (props.mailboxId) {
      setHolidaySubs(getHolidaySubscriptions(props.mailboxId));
    }
  }

  // External URL Subscriptions state (Category 02)
  const [isSubscribeUrlModalOpen, setIsSubscribeUrlModalOpen] = createSignal(false);
  const [urlSubs, setUrlSubs] = createSignal<UrlCalendarSubscription[]>([]);

  function loadUrlSubs() {
    if (props.mailboxId) {
      setUrlSubs(getUrlSubscriptions(props.mailboxId));
    }
  }

  const [pendingOpenEventId, setPendingOpenEventId] = createSignal<string | null>(null);

  createEffect(() => {
    const pendingId = pendingOpenEventId();
    if (!pendingId) return;
    const found = allDecryptedEvents().find((ev) => ev.id === pendingId);
    if (found) {
      setEventToEdit(found);
      setIsEventModalOpen(true);
      setPendingOpenEventId(null);
    }
  });

  onMount(() => {
    loadHolidaySubs();
    loadUrlSubs();
    const handleSubsUpdated = () => loadHolidaySubs();
    const handleUrlSubsUpdated = () => loadUrlSubs();
    const handleOpenCalEvent = (e: any) => {
      const eventId = e.detail?.eventId;
      if (!eventId) return;
      const found = allDecryptedEvents().find((ev) => ev.id === eventId);
      if (found) {
        setEventToEdit(found);
        setIsEventModalOpen(true);
      } else {
        setPendingOpenEventId(eventId);
      }
    };
    const handleOpenEmailMsg = () => {
      if (props.onSwitchToMail) {
        props.onSwitchToMail();
      }
    };
    const handleEventsUpdated = () => loadEvents();
    window.addEventListener("byos_holiday_subs_updated", handleSubsUpdated);
    window.addEventListener("byos_url_subs_updated", handleUrlSubsUpdated);
    window.addEventListener("byos_open_calendar_event", handleOpenCalEvent);
    window.addEventListener("byos_open_email_message", handleOpenEmailMsg);
    window.addEventListener("byos_calendar_events_updated", handleEventsUpdated);
    onCleanup(() => {
      window.removeEventListener("byos_holiday_subs_updated", handleSubsUpdated);
      window.removeEventListener("byos_url_subs_updated", handleUrlSubsUpdated);
      window.removeEventListener("byos_open_calendar_event", handleOpenCalEvent);
      window.removeEventListener("byos_open_email_message", handleOpenEmailMsg);
      window.removeEventListener("byos_calendar_events_updated", handleEventsUpdated);
    });
  });

  const holidayCalendars = createMemo<UserCalendar[]>(() => {
    return holidaySubs().map(subscriptionToUserCalendar);
  });
  const urlCalendars = createMemo<UserCalendar[]>(() => {
    return urlSubs().map(urlSubToUserCalendar);
  });
  const allCalendars = createMemo<UserCalendar[]>(() => {
    const bdayCal: UserCalendar[] = calendarSettings.settings().showBirthdaysFromContacts
      ? [
          {
            id: "contacts_birthdays",
            mailbox_id: props.mailboxId,
            name: "Birthdays (Contacts)",
            color: "#9E725F",
            is_default: false,
            created_at: "",
            updated_at: "",
          },
        ]
      : [];
    return [...calendars(), ...holidayCalendars(), ...urlCalendars(), ...bdayCal];
  });

  createEffect(() => {
    const subs = holidaySubs();
    if (subs.length > 0) {
      setVisibleCalIds((prev) => {
        const next = new Set(prev);
        for (const sub of subs) {
          if (sub.isVisible) {
            next.add(sub.calendarId);
          } else {
            next.delete(sub.calendarId);
          }
        }
        return next;
      });
    }
  });

  createEffect(() => {
    const uSubs = urlSubs();
    if (uSubs.length > 0) {
      setVisibleCalIds((prev) => {
        const next = new Set(prev);
        for (const sub of uSubs) {
          if (sub.isVisible) {
            next.add(sub.calendarId);
          } else {
            next.delete(sub.calendarId);
          }
        }
        return next;
      });
    }
  });

  // Raw API events state
  const [rawEvents, setRawEvents] = createSignal<CalendarEventItem[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);

  // Legacy Calendar Migration State
  const legacyEvents = createMemo(() => findLegacyCalendarEvents(rawEvents()));
  const [migrationRunning, setMigrationRunning] = createSignal(false);
  const [migrationProgress, setMigrationProgress] = createSignal<{ current: number; total: number } | null>(null);
  const [migrationError, setMigrationError] = createSignal<string | null>(null);
  const [migrationSuccess, setMigrationSuccess] = createSignal<string | null>(null);

  async function handleStartRecovery() {
    const eventsToMigrate = legacyEvents();
    if (eventsToMigrate.length === 0) return;
    let key = props.mailboxKey;
    if (!key && props.mailboxId) {
      key = getMailboxKeyFor(props.mailboxId);
    }
    if (!key) {
      setMigrationError("Mailbox key not available. Please unlock mailbox.");
      return;
    }
    let pk = props.mailboxPk;
    if (!pk && props.mailboxId) {
      try {
        const detail = await fetchMailboxDetail(props.mailboxId);
        pk = detail.mailbox_pk;
      } catch (err: any) {
        console.warn("[CalendarView] Failed to fetch mailbox detail for public key:", err);
      }
    }
    if (!pk) {
      setMigrationError("Mailbox public key not available.");
      return;
    }
    let unlockedId = props.unlockedBoxId;
    if (!unlockedId && key && props.mailboxId) {
      unlockedId = props.mailboxId;
    }
    if (!unlockedId || unlockedId !== props.mailboxId) {
      setMigrationError("Active mailbox does not match unlocked mailbox identity.");
      return;
    }

    setMigrationRunning(true);
    setMigrationError(null);
    setMigrationSuccess(null);
    setMigrationProgress({ current: 0, total: eventsToMigrate.length });

    let migratedCount = 0;
    try {
      for (let i = 0; i < eventsToMigrate.length; i++) {
        const item = eventsToMigrate[i];
        setMigrationProgress({ current: i + 1, total: eventsToMigrate.length });
        const res = await executeLegacyCalendarEventRecovery(
          WasmCore,
          props.mailboxId,
          key,
          pk,
          unlockedId,
          item
        );
        if (!res.success) {
          throw new Error(`Failed to recover event ${item.id}: ${res.error}`);
        }
        migratedCount++;
      }
      setMigrationSuccess(`Successfully upgraded ${migratedCount} legacy calendar event(s) to end-to-end encryption.`);
      await loadEvents();
    } catch (err: any) {
      console.error("[CalendarView] Recovery error:", err);
      setMigrationError(err?.message || "Failed to upgrade legacy events.");
    } finally {
      setMigrationRunning(false);
    }
  }

  // Modals state
  const [isEventModalOpen, setIsEventModalOpen] = createSignal(false);
  const [eventToEdit, setEventToEdit] = createSignal<DecryptedEventRecord | null>(null);
  const [slotStartDate, setSlotStartDate] = createSignal<Date | undefined>(undefined);
  const [slotEndDate, setSlotEndDate] = createSignal<Date | undefined>(undefined);

  const [isCalendarModalOpen, setIsCalendarModalOpen] = createSignal(false);
  const [calendarToEdit, setCalendarToEdit] = createSignal<UserCalendar | null>(null);

  const [isShareModalOpen, setIsShareModalOpen] = createSignal(false);
  const [calendarToShare, setCalendarToShare] = createSignal<UserCalendar | null>(null);

  // Load calendars on mount or mailbox change
  async function loadCalendars() {
    if (!props.mailboxId) return;
    try {
      const list = await fetchCalendars(props.mailboxId);
      setCalendars(list);
      // Default: all owned & shared calendars visible, plus active holiday subscriptions
      const idSet = new Set([
        ...list.map((c) => c.id),
        ...holidaySubs().filter((s) => s.isVisible).map((s) => s.calendarId),
        "contacts_birthdays",
      ]);
      setVisibleCalIds(idSet);
    } catch (e) {
      console.error("[CalendarView] Failed to load calendars:", e);
    }
  }

  // Load events within appropriate window
  async function loadEvents() {
    if (!props.mailboxId) return;
    setIsLoading(true);
    try {
      const curr = currentDate();
      const isYear = viewMode() === "year";
      // Load a window covering the view (full year if year view, otherwise -30 to +90 days)
      const start = isYear
        ? new Date(curr.getFullYear(), 0, 1)
        : new Date(curr.getTime() - 30 * 24 * 60 * 60 * 1000);
      const end = isYear
        ? new Date(curr.getFullYear(), 11, 31, 23, 59, 59)
        : new Date(curr.getTime() + 90 * 24 * 60 * 60 * 1000);
      const items = await fetchCalendarEvents(
        props.mailboxId,
        start.toISOString(),
        end.toISOString()
      );
      setRawEvents(items);
    } catch (e) {
      console.error("[CalendarView] Failed to load events:", e);
    } finally {
      setIsLoading(false);
    }
  }

  createEffect(() => {
    if (props.mailboxId) {
      loadCalendars();
      loadHolidaySubs();
    }
  });

  createEffect(() => {
    if (props.mailboxId) {
      // Re-fetch events when mailbox, currentDate, or viewMode changes
      currentDate();
      viewMode();
      loadEvents();
    }
  });

  // Decrypt and expand events into occurrences
  const allDecryptedEvents = createMemo<DecryptedEventRecord[]>(() => {
    const rawList = rawEvents();
    const key = props.mailboxKey;
    const boxId = props.mailboxId;

    const curr = currentDate();
    const isYear = viewMode() === "year";
    const windowStart = isYear
      ? new Date(curr.getFullYear(), 0, 1, 0, 0, 0)
      : new Date(curr.getTime() - 45 * 24 * 60 * 60 * 1000);
    const windowEnd = isYear
      ? new Date(curr.getFullYear(), 11, 31, 23, 59, 59)
      : new Date(curr.getTime() + 90 * 24 * 60 * 60 * 1000);

    const result: DecryptedEventRecord[] = [];

    for (const item of rawList) {
      let plaintext: CalendarEventPlaintext;
      const eventBoxId = item.mailbox_id || boxId;
      if (key && eventBoxId) {
        plaintext = decryptCalendarEventPayload(WasmCore, key, eventBoxId, item.encrypted_payload);
      } else {
        plaintext = {
          title: "(Unlock mailbox to view details)",
          description: "",
          location: "",
          attendees: [],
          reminders: [],
        };
      }

      const start = new Date(item.start_time);
      const end = new Date(item.end_time);

      if (item.rrule) {
        const parsedExceptions: EventExceptionInput[] = [];
        if (item.exceptions && item.exceptions.length > 0) {
          for (const exc of item.exceptions) {
            let excPlaintext = plaintext;
            if (key && eventBoxId && exc.encrypted_payload) {
              excPlaintext = decryptCalendarEventPayload(WasmCore, key, eventBoxId, exc.encrypted_payload);
            }
            parsedExceptions.push({
              id: exc.id,
              parentEventId: item.id,
              recurrenceId: exc.recurrence_id,
              isCancelled: exc.is_cancelled,
              startTime: new Date(exc.start_time),
              endTime: new Date(exc.end_time),
              isAllDay: exc.is_all_day,
              status: exc.status,
              payload: excPlaintext,
            });
          }
        }

        const occurrences = expandEventOccurrences(
          item.id,
          start,
          end,
          item.rrule,
          windowStart,
          windowEnd,
          200,
          parsedExceptions
        );
        for (const occ of occurrences) {
          result.push({
            id: occ.id,
            calendarId: item.calendar_id,
            startTime: occ.startTime,
            endTime: occ.endTime,
            isAllDay: item.is_all_day,
            status: occ.status || item.status,
            details: (occ.payload as CalendarEventPlaintext) || plaintext,
            baseEventId: item.id,
            recurrenceId: occ.recurrenceId,
            rrule: item.rrule,
            isOccurrence: occ.isOccurrence,
            isException: occ.isException,
            exceptionId: occ.exceptionId,
          });
        }
      } else {
        result.push({
          id: item.id,
          calendarId: item.calendar_id,
          startTime: start,
          endTime: end,
          isAllDay: item.is_all_day,
          status: item.status,
          details: plaintext,
          baseEventId: item.id,
          isOccurrence: false,
        });
      }
    }

    // Merge subscribed holiday and religious calendar events (Category 03)
    if (props.mailboxId) {
      const holidayRecords = buildHolidayDecryptedRecords(props.mailboxId, windowStart, windowEnd);
      result.push(...holidayRecords);
      const urlRecords = buildUrlDecryptedRecords(props.mailboxId, windowStart, windowEnd);
      result.push(...urlRecords);
    }

    // Merge Contact Birthdays if enabled (Category 13)
    if (calendarSettings.settings().showBirthdaysFromContacts && props.contacts && props.contacts.length > 0) {
      const bdayRecords = generateContactBirthdayEvents(
        props.contacts,
        curr.getFullYear() - 1,
        curr.getFullYear() + 2
      );
      result.push(...bdayRecords);
    }

    const seenEventKeys = new Set<string>();
    const deduplicated: DecryptedEventRecord[] = [];
    for (const r of result) {
      const k = `${r.id}_${r.startTime.toISOString()}`;
      if (!seenEventKeys.has(k)) {
        seenEventKeys.add(k);
        deduplicated.push(r);
      }
    }

    return deduplicated;
  });

  // Filter events by calendar visibility, search query, and showDeclinedEvents (Category 15)
  const filteredEvents = createMemo<DecryptedEventRecord[]>(() => {
    let list = allDecryptedEvents();
    if (list.length === 0 && (!isOnline() || rawEvents().length === 0) && props.mailboxId) {
      const cached = getCachedDecryptedEvents(props.mailboxId);
      if (cached && cached.length > 0) {
        list = cached;
      }
    }
    const visible = visibleCalIds();
    const query = searchQuery().toLowerCase().trim();
    const showDeclined = calendarSettings.settings().showDeclinedEvents !== false;

    return list.filter((ev) => {
      if (!visible.has(ev.calendarId)) return false;
      if (!showDeclined && (ev.status === "declined" || ev.status === "cancelled" || ev.details.status === "declined")) {
        return false;
      }
      if (query) {
        const titleMatch = ev.details.title.toLowerCase().includes(query);
        const locMatch = ev.details.location?.toLowerCase().includes(query);
        const descMatch = ev.details.description?.toLowerCase().includes(query);
        if (!titleMatch && !locMatch && !descMatch) return false;
      }
      return true;
    });
  });

  // Offline event caching (Category 15)
  createEffect(() => {
    const list = allDecryptedEvents();
    if (props.mailboxId && list.length > 0 && props.mailboxKey) {
      cacheDecryptedEvents(props.mailboxId, list);
      props.onCheckReminders?.();
    }
  });

  // Upcoming events for sidebar
  const upcomingEvents = createMemo<DecryptedEventRecord[]>(() => {
    const now = new Date();
    return filteredEvents()
      .filter((ev) => ev.endTime >= now)
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  });

  // ── Reminders & Notification Delegation (Category 08) ──
  // Reminders are evaluated centrally in App.tsx for cross-module reliability.
  createEffect(() => {
    const id = props.selectedEventId;
    if (id) {
      const ev = allDecryptedEvents().find((e) => e.id === id || e.baseEventId === id);
      if (ev) {
        setEventToEdit(ev);
        setIsEventModalOpen(true);
      }
    }
  });

  onMount(() => {
    props.onCheckReminders?.();
  });

  createEffect(() => {
    allDecryptedEvents();
    props.onCheckReminders?.();
  });

  // Period Title formatting
  const periodTitle = createMemo(() => {
    const curr = currentDate();
    const mode = viewMode();

    if (mode === "day") {
      return curr.toLocaleDateString("en-US", {
        weekday: "short",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }

    if (mode === "3days") {
      const start = new Date(curr);
      const end = new Date(curr);
      end.setDate(curr.getDate() + 2);

      const startMonth = start.toLocaleDateString("en-US", { month: "short" });
      const endMonth = end.toLocaleDateString("en-US", { month: "short" });
      const year = end.getFullYear();

      if (startMonth === endMonth) {
        return `${startMonth} ${start.getDate()} – ${end.getDate()}, ${year}`;
      } else {
        return `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}, ${year}`;
      }
    }

    if (mode === "week") {
      const startOfWeek = new Date(curr);
      startOfWeek.setDate(curr.getDate() - curr.getDay());
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);

      const startMonth = startOfWeek.toLocaleDateString("en-US", { month: "short" });
      const endMonth = endOfWeek.toLocaleDateString("en-US", { month: "short" });
      const year = endOfWeek.getFullYear();

      if (startMonth === endMonth) {
        return `${startMonth} ${startOfWeek.getDate()} – ${endOfWeek.getDate()}, ${year}`;
      } else {
        return `${startMonth} ${startOfWeek.getDate()} – ${endMonth} ${endOfWeek.getDate()}, ${year}`;
      }
    }

    if (mode === "year") {
      return curr.getFullYear().toString();
    }

    // Month or Agenda
    return curr.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  });

  // Navigation handlers
  function handleToday() {
    setCurrentDate(new Date());
  }

  function handlePrev() {
    const mode = viewMode();
    const curr = new Date(currentDate());
    if (mode === "day") {
      curr.setDate(curr.getDate() - 1);
    } else if (mode === "3days") {
      curr.setDate(curr.getDate() - 3);
    } else if (mode === "week") {
      curr.setDate(curr.getDate() - 7);
    } else if (mode === "month") {
      curr.setMonth(curr.getMonth() - 1);
    } else if (mode === "year") {
      curr.setFullYear(curr.getFullYear() - 1);
    } else {
      curr.setDate(curr.getDate() - 14);
    }
    setCurrentDate(curr);
  }

  function handleNext() {
    const mode = viewMode();
    const curr = new Date(currentDate());
    if (mode === "day") {
      curr.setDate(curr.getDate() + 1);
    } else if (mode === "3days") {
      curr.setDate(curr.getDate() + 3);
    } else if (mode === "week") {
      curr.setDate(curr.getDate() + 7);
    } else if (mode === "month") {
      curr.setMonth(curr.getMonth() + 1);
    } else if (mode === "year") {
      curr.setFullYear(curr.getFullYear() + 1);
    } else {
      curr.setDate(curr.getDate() + 14);
    }
    setCurrentDate(curr);
  }

  // ── Global Hotkeys & Keyboard Navigation (Category 15) ──
  function handleGlobalKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    ) {
      return;
    }

    // Modal dismiss
    if (e.key === "Escape") {
      if (isShortcutsModalOpen()) {
        setIsShortcutsModalOpen(false);
        return;
      }
      if (isTrashModalOpen()) {
        setIsTrashModalOpen(false);
        return;
      }
      if (isCalendarSettingsOpen()) {
        setIsCalendarSettingsOpen(false);
        return;
      }
      if (isEventModalOpen()) {
        setIsEventModalOpen(false);
        return;
      }
      return;
    }

    // Do not trigger background hotkeys if any modal is active
    if (
      isEventModalOpen() ||
      isCalendarModalOpen() ||
      isShareModalOpen() ||
      isCalendarSettingsOpen() ||
      isTrashModalOpen() ||
      isShortcutsModalOpen()
    ) {
      return;
    }

    if (e.key === "?") {
      e.preventDefault();
      setIsShortcutsModalOpen(true);
      return;
    }

    if (e.key === "1" || e.key === "d") {
      e.preventDefault();
      changeViewMode("day");
      setScreenReaderAnnouncement("Switched to Day view");
      return;
    }
    if (e.key === "2" || e.key === "w") {
      e.preventDefault();
      changeViewMode("week");
      setScreenReaderAnnouncement("Switched to Week view");
      return;
    }
    if (e.key === "3" || e.key === "m") {
      e.preventDefault();
      changeViewMode("month");
      setScreenReaderAnnouncement("Switched to Month view");
      return;
    }
    if (e.key === "4" || e.key === "y") {
      e.preventDefault();
      changeViewMode("year");
      setScreenReaderAnnouncement("Switched to Year view");
      return;
    }
    if (e.key === "5" || e.key === "a") {
      e.preventDefault();
      changeViewMode("agenda");
      setScreenReaderAnnouncement("Switched to Agenda view");
      return;
    }

    if (e.key === "t") {
      e.preventDefault();
      handleToday();
      setScreenReaderAnnouncement("Jumped to Today");
      return;
    }
    if (e.key === "p" || e.key === "k") {
      e.preventDefault();
      handlePrev();
      setScreenReaderAnnouncement("Navigated to previous period");
      return;
    }
    if (e.key === "n" || e.key === "j") {
      e.preventDefault();
      handleNext();
      setScreenReaderAnnouncement("Navigated to next period");
      return;
    }

    if (e.key === "c") {
      e.preventDefault();
      setEventToEdit(null);
      setSlotStartDate(undefined);
      setSlotEndDate(undefined);
      setIsEventModalOpen(true);
      return;
    }

    if (e.key === "/") {
      e.preventDefault();
      const searchInput = document.querySelector<HTMLInputElement>('[data-testid="calendar-search-input"]');
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
      return;
    }
  }

  // ── Offline Sync Handlers (Category 15) ──
  async function handleSyncOffline() {
    if (!props.mailboxId) return;
    try {
      const res = await syncOfflineQueue(props.mailboxId, {
        remoteEvents: rawEvents(),
      });
      setOfflineQueueCount(res.remaining);
      if (res.synced > 0) {
        await loadEvents();
        setScreenReaderAnnouncement(`Synchronized ${res.synced} offline changes`);
      }
    } catch (err) {
      console.warn("[CalendarView] Offline sync failed:", err);
    }
  }

  // ── Trash Restoration Handler (Category 15) ──
  async function handleRestoreFromTrash(item: TrashEventRecord) {
    const ev = item.event;
    await handleSaveEvent({
      calendarId: ev.calendarId,
      startTime: new Date(ev.startTime),
      endTime: new Date(ev.endTime),
      isAllDay: ev.isAllDay,
      rrule: ev.rrule,
      status: ev.status,
      sendInvitations: false,
      targetEvent: null,
      details: {
        ...ev.details,
      },
    });
    setScreenReaderAnnouncement(`Restored event: ${ev.details.title}`);
  }

  function handleToggleCalendarVisibility(calId: string) {
    if (calId.startsWith("holiday-")) {
      const feedId = calId.replace("holiday-", "");
      if (props.mailboxId) {
        toggleHolidayVisibility(props.mailboxId, feedId);
        loadHolidaySubs();
      }
      return;
    }
    if (calId.startsWith("url-")) {
      if (props.mailboxId) {
        toggleUrlSubscriptionVisibility(props.mailboxId, calId);
        loadUrlSubs();
      }
      return;
    }
    setVisibleCalIds((prev) => {
      const next = new Set(prev);
      if (next.has(calId)) {
        next.delete(calId);
      } else {
        next.add(calId);
      }
      return next;
    });
  }

  // Open modal prefilled from slot click
  function handleSlotClick(start: Date, end: Date) {
    setEventToEdit(null);
    setSlotStartDate(start);
    setSlotEndDate(end);
    setIsEventModalOpen(true);
  }

  function handleSelectEvent(ev: DecryptedEventRecord) {
    setEventToEdit(ev);
    setIsEventModalOpen(true);
  }

  function handleHideHoliday(feedId: string, eventId: string) {
    if (props.mailboxId) {
      hideHolidayEvent(props.mailboxId, feedId, eventId);
      loadHolidaySubs();
    }
  }

  // Save Event handler
  async function handleSaveEvent(payload: {
    calendarId: string;
    startTime: Date;
    endTime: Date;
    isAllDay: boolean;
    rrule?: string;
    status?: string;
    sendInvitations?: boolean;
    details: CalendarEventPlaintext;
    editScope?: "occurrence" | "series" | "this";
    targetEvent?: DecryptedEventRecord | null;
  }) {
    if (!props.mailboxId) return;

    if (!props.mailboxKey || !(props.mailboxKey instanceof Uint8Array) || props.mailboxKey.length !== 32) {
      throw new Error("Mailbox is locked. Unlock your mailbox to create or edit events.");
    }

    const ev = payload.targetEvent !== undefined ? payload.targetEvent : eventToEdit();
    if (!payload.details.uid) {
      payload.details.uid =
        ev?.details?.uid ||
        "byos-evt-" + (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    }
    if (ev) {
      payload.details.sequence = ((ev?.details?.sequence as number) || 0) + 1;
    } else {
      payload.details.sequence = 0;
    }

    if (!payload.details.organizer && props.currentUserEmail) {
      payload.details.organizer = { email: props.currentUserEmail };
    }

    const targetCal = calendars().find((c) => c.id === payload.calendarId);
    if (targetCal?.is_shared && targetCal.permission === "read") {
      throw new Error("Cannot create or modify events on a read-only calendar");
    }
    const calOwnerMailboxId = targetCal?.mailbox_id || props.mailboxId;

    let encryptedPayload: string;
    try {
      encryptedPayload = encryptCalendarEventPayload(
        WasmCore,
        props.mailboxKey,
        calOwnerMailboxId,
        payload.details
      );
    } catch (err: any) {
      console.error("[CalendarView] Event encryption failed:", err);
      throw new Error(`Failed to encrypt event: ${err?.message || "Encryption error"}`);
    }

    if (ev) {
      const isRecurring = Boolean(ev.rrule || ev.isOccurrence);
      const scope = payload.editScope || "series";

      if (isRecurring && (scope === "occurrence" || (scope as string) === "this")) {
        const baseId = ev.baseEventId || ev.id.split("_")[0];
        const recurrenceId = ev.recurrenceId || ev.startTime.toISOString();

        if (!isOnline()) {
          if (ev.isException && ev.exceptionId) {
            enqueueOfflineAction(props.mailboxId, {
              actionType: "update_exception",
              calendarId: payload.calendarId,
              eventId: baseId,
              exceptionId: ev.exceptionId,
              payload: {
                exceptionId: ev.exceptionId,
                start_time: payload.startTime.toISOString(),
                end_time: payload.endTime.toISOString(),
                is_all_day: payload.isAllDay,
                status: payload.status,
                encrypted_payload: encryptedPayload,
              },
            });
          } else {
            enqueueOfflineAction(props.mailboxId, {
              actionType: "create_exception",
              calendarId: payload.calendarId,
              eventId: baseId,
              payload: {
                recurrence_id: recurrenceId,
                is_cancelled: false,
                start_time: payload.startTime.toISOString(),
                end_time: payload.endTime.toISOString(),
                is_all_day: payload.isAllDay,
                status: payload.status,
                encrypted_payload: encryptedPayload,
              },
            });
          }
          setOfflineQueueCount(getOfflineQueue(props.mailboxId).length);
          setRawEvents((prev) =>
            prev.map((e) => {
              if (e.id === baseId) {
                const existingExceptions = e.exceptions ? [...e.exceptions] : [];
                if (ev.isException && ev.exceptionId) {
                  return {
                    ...e,
                    exceptions: existingExceptions.map((ex) =>
                      ex.id === ev.exceptionId
                        ? {
                            ...ex,
                            start_time: payload.startTime.toISOString(),
                            end_time: payload.endTime.toISOString(),
                            is_all_day: Boolean(payload.isAllDay),
                            status: payload.status || "busy",
                            encrypted_payload: encryptedPayload,
                          }
                        : ex
                    ),
                  };
                } else {
                  const newEx = {
                    id: `offline-ex-${Date.now()}`,
                    parent_event_id: baseId,
                    mailbox_id: props.mailboxId,
                    calendar_id: payload.calendarId,
                    recurrence_id: recurrenceId,
                    is_cancelled: false,
                    start_time: payload.startTime.toISOString(),
                    end_time: payload.endTime.toISOString(),
                    is_all_day: Boolean(payload.isAllDay),
                    status: payload.status || "busy",
                    encrypted_payload: encryptedPayload,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  };
                  return { ...e, exceptions: [...existingExceptions, newEx] };
                }
              }
              return e;
            })
          );
        } else {
          if (ev.isException && ev.exceptionId) {
            await updateCalendarEventException(props.mailboxId, baseId, ev.exceptionId, {
              start_time: payload.startTime.toISOString(),
              end_time: payload.endTime.toISOString(),
              is_all_day: payload.isAllDay,
              status: payload.status,
              encrypted_payload: encryptedPayload,
            });
          } else {
            await createCalendarEventException(props.mailboxId, baseId, {
              recurrence_id: recurrenceId,
              is_cancelled: false,
              start_time: payload.startTime.toISOString(),
              end_time: payload.endTime.toISOString(),
              is_all_day: payload.isAllDay,
              status: payload.status,
              encrypted_payload: encryptedPayload,
            });
          }
          await loadEvents();
        }
      } else {
        const targetId = ev.baseEventId || ev.id.split("_")[0];
        if (!isOnline()) {
          enqueueOfflineAction(props.mailboxId, {
            actionType: "update",
            calendarId: payload.calendarId,
            eventId: targetId,
            payload: {
              calendar_id: payload.calendarId,
              start_time: payload.startTime.toISOString(),
              end_time: payload.endTime.toISOString(),
              is_all_day: payload.isAllDay,
              rrule: payload.rrule,
              status: payload.status,
              encrypted_payload: encryptedPayload,
            },
          });
          setOfflineQueueCount(getOfflineQueue(props.mailboxId).length);
          setRawEvents((prev) =>
            prev.map((e) =>
              e.id === targetId
                ? {
                    ...e,
                    calendar_id: payload.calendarId,
                    start_time: payload.startTime.toISOString(),
                    end_time: payload.endTime.toISOString(),
                    is_all_day: payload.isAllDay,
                    rrule: payload.rrule || undefined,
                    status: payload.status || "confirmed",
                    encrypted_payload: encryptedPayload,
                  }
                : e
            )
          );
          setScreenReaderAnnouncement(`Event update queued locally: ${payload.details.title}`);
        } else {
          await updateCalendarEvent(props.mailboxId, targetId, {
            calendar_id: payload.calendarId,
            start_time: payload.startTime.toISOString(),
            end_time: payload.endTime.toISOString(),
            is_all_day: payload.isAllDay,
            rrule: payload.rrule,
            status: payload.status,
            encrypted_payload: encryptedPayload,
          });
          await loadEvents();
        }
      }
    } else {
      if (!isOnline()) {
        enqueueOfflineAction(props.mailboxId, {
          actionType: "create",
          calendarId: payload.calendarId,
          payload: {
            calendar_id: payload.calendarId,
            start_time: payload.startTime.toISOString(),
            end_time: payload.endTime.toISOString(),
            is_all_day: payload.isAllDay,
            rrule: payload.rrule,
            status: payload.status,
            encrypted_payload: encryptedPayload,
          },
        });
        setOfflineQueueCount(getOfflineQueue(props.mailboxId).length);
        const localItem: CalendarEventItem = {
          id: `local-${Date.now()}`,
          mailbox_id: props.mailboxId,
          calendar_id: payload.calendarId,
          start_time: payload.startTime.toISOString(),
          end_time: payload.endTime.toISOString(),
          is_all_day: payload.isAllDay,
          rrule: payload.rrule || undefined,
          status: payload.status || "confirmed",
          encrypted_payload: encryptedPayload,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        setRawEvents((prev) => [...prev, localItem]);
        setScreenReaderAnnouncement(`Event queued locally: ${payload.details.title}`);
      } else {
        await createCalendarEvent(props.mailboxId, {
          calendar_id: payload.calendarId,
          start_time: payload.startTime.toISOString(),
          end_time: payload.endTime.toISOString(),
          is_all_day: payload.isAllDay,
          rrule: payload.rrule,
          status: payload.status,
          encrypted_payload: encryptedPayload,
        });
        await loadEvents();
      }
    }

    // Dispatch invitations if requested and attendees exist
    if (
      payload.sendInvitations &&
      props.onSendInvitation &&
      payload.details.attendees &&
      payload.details.attendees.length > 0
    ) {
      const isUpdate = (payload.details.sequence || 0) > 0;
      const subject = `${isUpdate ? "Updated Invitation: " : "Invitation: "}${payload.details.title}`;
      const icsPayload = generateIcs({
        uid: payload.details.uid,
        sequence: payload.details.sequence,
        method: "REQUEST",
        title: payload.details.title,
        description: payload.details.description,
        location: payload.details.location,
        meetingUrl: payload.details.meetingUrl,
        startTime: payload.startTime,
        endTime: payload.endTime,
        isAllDay: payload.isAllDay,
        rrule: payload.rrule,
        organizer: payload.details.organizer || { email: props.currentUserEmail || "organizer@byos.local" },
        attendees: payload.details.attendees.map((a) => ({
          name: a.name,
          email: a.email,
          role: "REQ-PARTICIPANT",
          partstat: "NEEDS-ACTION",
          rsvp: true,
        })),
      });

      for (const attendee of payload.details.attendees) {
        try {
          await props.onSendInvitation(
            attendee.email,
            icsPayload,
            subject
          );
        } catch (err) {
          console.warn("[CalendarView] Failed to dispatch invitation to:", attendee.email, err);
        }
      }
    }
  }

  // Delete Event handler
  async function handleDeleteEvent(eventId: string, deleteScope?: "occurrence" | "series" | "this") {
    if (!props.mailboxId || !props.mailboxKey) return;

    const ev = eventToEdit();
    if (ev) {
      const targetCal = calendars().find((c) => c.id === ev.calendarId);
      if (targetCal?.is_shared && targetCal.permission === "read") {
        throw new Error("Cannot delete events from a read-only calendar");
      }
    }
    const isRecurring = Boolean(ev?.rrule || ev?.isOccurrence);
    const scope = deleteScope || "series";

    // 1. Occurrence cancellation
    if (ev && isRecurring && (scope === "occurrence" || (scope as string) === "this")) {
      const baseId = ev.baseEventId || ev.id.split("_")[0];
      const recurrenceId = ev.recurrenceId || ev.startTime.toISOString();

      let encPayload = "";
      try {
        encPayload = encryptCalendarEventPayload(
          WasmCore,
          props.mailboxKey,
          props.mailboxId,
          {
            ...ev.details,
            sequence: ((ev.details.sequence as number) || 0) + 1,
          }
        );
      } catch (encErr) {
        console.warn("[CalendarView] Failed to encrypt cancellation payload:", encErr);
      }

      if (!isOnline()) {
        if (ev.isException && ev.exceptionId) {
          enqueueOfflineAction(props.mailboxId, {
            actionType: "delete_exception",
            calendarId: ev.calendarId,
            eventId: baseId,
            exceptionId: ev.exceptionId,
            payload: { exceptionId: ev.exceptionId },
          });
        } else {
          enqueueOfflineAction(props.mailboxId, {
            actionType: "create_exception",
            calendarId: ev.calendarId,
            eventId: baseId,
            payload: {
              recurrence_id: recurrenceId,
              is_cancelled: true,
              start_time: ev.startTime.toISOString(),
              end_time: ev.endTime.toISOString(),
              is_all_day: ev.isAllDay,
              status: "free",
              encrypted_payload: encPayload,
            },
          });
        }
        setOfflineQueueCount(getOfflineQueue(props.mailboxId).length);
        setRawEvents((prev) =>
          prev.map((e) => {
            if (e.id === baseId) {
              const existingExceptions = e.exceptions ? [...e.exceptions] : [];
              if (ev.isException && ev.exceptionId) {
                return {
                  ...e,
                  exceptions: existingExceptions.filter((ex) => ex.id !== ev.exceptionId),
                };
              } else {
                const cancelEx = {
                  id: `offline-ex-cancel-${Date.now()}`,
                  parent_event_id: baseId,
                  mailbox_id: props.mailboxId,
                  calendar_id: ev.calendarId,
                  recurrence_id: recurrenceId,
                  is_cancelled: true,
                  start_time: ev.startTime.toISOString(),
                  end_time: ev.endTime.toISOString(),
                  is_all_day: ev.isAllDay,
                  status: "free",
                  encrypted_payload: encPayload,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                };
                return { ...e, exceptions: [...existingExceptions, cancelEx] };
              }
            }
            return e;
          })
        );
        return;
      }

      await createCalendarEventException(props.mailboxId, baseId, {
        recurrence_id: recurrenceId,
        is_cancelled: true,
        start_time: ev.startTime.toISOString(),
        end_time: ev.endTime.toISOString(),
        is_all_day: ev.isAllDay,
        status: "free",
        encrypted_payload: encPayload,
      });

      if (
        props.onSendInvitation &&
        ev.details.attendees &&
        ev.details.attendees.length > 0
      ) {
        const cancelIcs = generateIcs({
          uid: ev.details.uid || "byos-evt-" + baseId,
          sequence: ((ev.details.sequence as number) || 0) + 1,
          method: "CANCEL",
          status: "CANCELLED",
          title: ev.details.title,
          startTime: ev.startTime,
          endTime: ev.endTime,
          isAllDay: ev.isAllDay,
          recurrenceId: recurrenceId,
          organizer: ev.details.organizer || { email: props.currentUserEmail || "organizer@byos.local" },
          attendees: ev.details.attendees.map((a) => ({
            name: a.name,
            email: a.email,
            role: "REQ-PARTICIPANT",
            partstat: "DECLINED",
          })),
        });

        for (const attendee of ev.details.attendees) {
          try {
            await props.onSendInvitation(
              attendee.email,
              cancelIcs,
              `Cancelled: ${ev.details.title}`
            );
          } catch (err) {
            console.warn("[CalendarView] Failed to dispatch cancellation to:", attendee.email, err);
          }
        }
      }

      await loadEvents();
      return;
    }

    // 2. Series or single event cancellation
    if (
      ev &&
      props.onSendInvitation &&
      ev.details.attendees &&
      ev.details.attendees.length > 0
    ) {
      const targetUid = ev.details.uid || "byos-evt-" + (ev.baseEventId || eventId.split("_")[0]);
      const cancelIcs = generateIcs({
        uid: targetUid,
        sequence: ((ev.details.sequence as number) || 0) + 1,
        method: "CANCEL",
        status: "CANCELLED",
        title: ev.details.title,
        startTime: ev.startTime,
        endTime: ev.endTime,
        isAllDay: ev.isAllDay,
        rrule: ev.rrule,
        organizer: ev.details.organizer || { email: props.currentUserEmail || "organizer@byos.local" },
        attendees: ev.details.attendees.map((a) => ({
          name: a.name,
          email: a.email,
          role: "REQ-PARTICIPANT",
          partstat: "DECLINED",
        })),
      });

      for (const attendee of ev.details.attendees) {
        try {
          await props.onSendInvitation(
            attendee.email,
            cancelIcs,
            `Cancelled: ${ev.details.title}`
          );
        } catch (err) {
          console.warn("[CalendarView] Failed to dispatch cancellation to:", attendee.email, err);
        }
      }
    }

    const targetId = ev?.baseEventId || eventId.split("_")[0];
    if (ev) {
      const prevTimer = deletedEventState()?.timer;
      if (prevTimer) clearTimeout(prevTimer);
      const timer = setTimeout(() => {
        setDeletedEventState(null);
      }, 8000);
      setDeletedEventState({
        event: ev,
        timer,
      });

      // Move to 30-day trash store (Category 15)
      const calName = allCalendars().find((c) => c.id === ev.calendarId)?.name || "Personal";
      moveEventToTrash(props.mailboxId, ev, calName);
    }
    setEventToEdit(null);
    if (!isOnline()) {
      enqueueOfflineAction(props.mailboxId, {
        actionType: "delete",
        calendarId: ev?.calendarId || "",
        eventId: targetId,
      });
      setOfflineQueueCount(getOfflineQueue(props.mailboxId).length);
      setRawEvents((prev) => prev.filter((e) => e.id !== targetId));
      setScreenReaderAnnouncement("Event moved to trash and queued deletion locally");
    } else {
      await deleteCalendarEvent(props.mailboxId, targetId);
      setRawEvents((prev) => prev.filter((e) => e.id !== targetId));
      await loadEvents();
      setScreenReaderAnnouncement("Event moved to trash");
    }
  }

  // Undo deletion state & recovery (Category 06)
  const [deletedEventState, setDeletedEventState] = createSignal<{
    event: DecryptedEventRecord;
    timer: any;
  } | null>(null);

  async function handleUndoDelete() {
    const item = deletedEventState();
    if (!item) return;
    if (item.timer) clearTimeout(item.timer);
    setDeletedEventState(null);

    const ev = item.event;
    await handleSaveEvent({
      calendarId: ev.calendarId,
      startTime: ev.startTime,
      endTime: ev.endTime,
      isAllDay: ev.isAllDay,
      rrule: ev.rrule,
      status: ev.status,
      sendInvitations: false,
      targetEvent: null,
      details: {
        ...ev.details,
        uid: undefined,
      },
    });
  }

  async function handleDuplicateEvent(ev: DecryptedEventRecord) {
    if (!props.mailboxId || !props.mailboxKey) return;
    const duplicatedTitle = `[Copy] ${ev.details.title}`;
    await handleSaveEvent({
      calendarId: ev.calendarId,
      startTime: ev.startTime,
      endTime: ev.endTime,
      isAllDay: ev.isAllDay,
      rrule: ev.rrule,
      status: ev.status,
      sendInvitations: false,
      targetEvent: null,
      details: {
        ...ev.details,
        title: duplicatedTitle,
        uid: undefined,
      },
    });
  }

  async function handleCopyToCalendar(ev: DecryptedEventRecord, targetCalendarId: string) {
    if (!props.mailboxId || !props.mailboxKey || !targetCalendarId) return;
    await handleSaveEvent({
      calendarId: targetCalendarId,
      startTime: ev.startTime,
      endTime: ev.endTime,
      isAllDay: ev.isAllDay,
      rrule: ev.rrule,
      status: ev.status,
      sendInvitations: false,
      targetEvent: null,
      details: {
        ...ev.details,
        uid: undefined,
      },
    });
  }

  // Calendar Management
  async function handleSaveCalendar(payload: {
    name: string;
    color: string;
    isDefault: boolean;
    description?: string;
    template?: string;
    defaultReminderMinutes?: number;
  }) {
    if (!props.mailboxId) return;
    let targetCalId = calendarToEdit()?.id;
    if (targetCalId) {
      const updated = await updateCalendar(props.mailboxId, targetCalId, {
        name: payload.name,
        color: payload.color,
        is_default: payload.isDefault,
      });
      setCalendars((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } else {
      const created = await createCalendar(props.mailboxId, {
        name: payload.name,
        color: payload.color,
        is_default: payload.isDefault,
      });
      targetCalId = created.id;
      setCalendars((prev) => [...prev, created]);
      setVisibleCalIds((prev) => new Set([...prev, created.id]));
    }

    if (targetCalId) {
      saveCalendarOverrides(props.mailboxId, targetCalId, {
        description: payload.description,
        template: payload.template,
        defaultReminderMinutes: payload.defaultReminderMinutes,
        colorOverride: payload.color,
      });
    }
  }

  async function handleDeleteCalendar(calendarId: string) {
    if (!props.mailboxId) return;
    await deleteCalendar(props.mailboxId, calendarId);
    setCalendars((prev) => prev.filter((c) => c.id !== calendarId));
    setRawEvents((prev) => prev.filter((e) => e.calendar_id !== calendarId));
  }

  async function handleUnsubscribeCalendar(calendarInput: UserCalendar | string, shareId?: string) {
    if (!props.mailboxId) return;
    const calendarId = typeof calendarInput === "string" ? calendarInput : calendarInput.id;
    if (calendarId.startsWith("holiday-")) {
      unsubscribeHolidayFeed(props.mailboxId, calendarId);
      loadHolidaySubs();
      setIsCalendarModalOpen(false);
      return;
    }
    if (calendarId.startsWith("url-")) {
      unsubscribeUrlFeed(props.mailboxId, calendarId);
      loadUrlSubs();
      setIsCalendarModalOpen(false);
      return;
    }
    let sId = shareId;
    if (!sId) {
      const found = calendars().find((c) => c.id === calendarId);
      sId = found?.share_id;
    }
    if (sId) {
      await revokeCalendarShare(props.mailboxId, calendarId, sId);
      setCalendars((prev) => prev.filter((c) => c.id !== calendarId));
      setRawEvents((prev) => prev.filter((e) => e.calendar_id !== calendarId));
      setIsCalendarModalOpen(false);
    }
  }

  async function handleRefreshUrlFeed(calId: string) {
    if (props.mailboxId) {
      await refreshUrlSubscription(props.mailboxId, calId);
      loadUrlSubs();
    }
  }

  return (
    <div
      class={`flex flex-1 h-full min-h-0 bg-transparent overflow-hidden gap-2.5 sm:gap-3 ${
        props.class || ""
      }`}
      data-testid="calendar-view"
    >
      {/* ── Desktop Left Sidebar (Matching Mailbox Sidebar Container) ── */}
      <div class="hidden lg:flex flex-shrink-0 h-full">
        <CalendarSidebar
          currentUser={props.currentUser}
          selectedMailbox={props.selectedMailbox}
          connectedAccounts={props.connectedAccounts}
          activeAccountId={props.activeAccountId}
          onSelectAccount={props.onSelectAccount}
          onSelectAllInboxes={props.onSelectAllInboxes}
          onOpenAddMailbox={props.onOpenAddMailbox}
          onLogout={props.onLogout}
          profilePhotoUrl={props.profilePhotoUrl}
          photoUrls={props.photoUrls}
          isUnlocked={props.isUnlocked}
          storageError={props.storageError}
          accountUnreadCounts={props.accountUnreadCounts}
          unifiedUnreadCount={props.unifiedUnreadCount}
          selectedDate={currentDate()}
          onSelectDate={(d) => setCurrentDate(d)}
          calendars={allCalendars()}
          visibleCalendarIds={visibleCalIds()}
          onToggleCalendarVisibility={handleToggleCalendarVisibility}
          onOpenCreateEvent={() => {
            setEventToEdit(null);
            setSlotStartDate(undefined);
            setSlotEndDate(undefined);
            setIsEventModalOpen(true);
          }}
          onOpenCreateCalendar={() => {
            setCalendarToEdit(null);
            setIsCalendarModalOpen(true);
          }}
          onOpenEditCalendar={(cal) => {
            setCalendarToEdit(cal);
            setIsCalendarModalOpen(true);
          }}
          onOpenShareCalendar={(cal) => {
            setCalendarToShare(cal || null);
            setIsShareModalOpen(true);
          }}
          onUnsubscribeCalendar={handleUnsubscribeCalendar}
          onOpenExploreHolidays={() => {
            setSettingsInitialSection("holiday_calendars");
            setIsCalendarSettingsOpen(true);
          }}
          onOpenSubscribeFromUrl={() => setIsSubscribeUrlModalOpen(true)}
          onRefreshUrlFeed={handleRefreshUrlFeed}
          upcomingEvents={upcomingEvents()}
          onSelectEvent={handleSelectEvent}
          worldClockCities={calendarSettings.settings().worldClockCities}
          timeFormat={calendarSettings.settings().timeFormat}
          showWorldClock={calendarSettings.settings().showWorldClock !== false}
          onOpenWorldClockSettings={() => {
            setSettingsInitialSection("timezones");
            setIsCalendarSettingsOpen(true);
          }}
          onOpenContacts={props.onOpenContacts}
          onOpenSettings={props.onOpenSettings}
        />
      </div>

      {/* ── Mobile & Tablet Sidebar Drawer (< lg) ── */}
      <div
        class={`fixed inset-0 bg-black/40 backdrop-blur-xs z-50 lg:hidden transition-opacity duration-200 ease-[cubic-bezier(0.2,0,0,1)] ${
          mobileSidebarOpen() ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMobileSidebarOpen(false)}
        aria-hidden="true"
      />
      <div
        class={`fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-[#F0EEE9] dark:bg-[#18191D] z-50 lg:hidden shadow-2xl flex flex-col transition-[translate,visibility] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none ${
          mobileSidebarOpen()
            ? "translate-x-0 visible"
            : "-translate-x-full invisible"
        }`}
      >
          <CalendarSidebar
            currentUser={props.currentUser}
            selectedMailbox={props.selectedMailbox}
            connectedAccounts={props.connectedAccounts}
            activeAccountId={props.activeAccountId}
            onSelectAccount={(acc) => {
              props.onSelectAccount?.(acc);
              setMobileSidebarOpen(false);
            }}
            onSelectAllInboxes={() => {
              props.onSelectAllInboxes?.();
              setMobileSidebarOpen(false);
            }}
            onOpenAddMailbox={() => {
              props.onOpenAddMailbox?.();
              setMobileSidebarOpen(false);
            }}
            onLogout={props.onLogout}
            profilePhotoUrl={props.profilePhotoUrl}
            photoUrls={props.photoUrls}
            isUnlocked={props.isUnlocked}
            storageError={props.storageError}
            accountUnreadCounts={props.accountUnreadCounts}
            unifiedUnreadCount={props.unifiedUnreadCount}
            onCloseMobile={() => setMobileSidebarOpen(false)}
            selectedDate={currentDate()}
            onSelectDate={(d) => {
              setCurrentDate(d);
              setMobileSidebarOpen(false);
            }}
            calendars={allCalendars()}
            visibleCalendarIds={visibleCalIds()}
            onToggleCalendarVisibility={handleToggleCalendarVisibility}
            onOpenCreateEvent={() => {
              setEventToEdit(null);
              setMobileSidebarOpen(false);
              setIsEventModalOpen(true);
            }}
            onOpenCreateCalendar={() => {
              setCalendarToEdit(null);
              setMobileSidebarOpen(false);
              setIsCalendarModalOpen(true);
            }}
            onOpenEditCalendar={(cal) => {
              setCalendarToEdit(cal);
              setMobileSidebarOpen(false);
              setIsCalendarModalOpen(true);
            }}
            onOpenShareCalendar={(cal) => {
              setCalendarToShare(cal || null);
              setMobileSidebarOpen(false);
              setIsShareModalOpen(true);
            }}
            onUnsubscribeCalendar={handleUnsubscribeCalendar}
            onOpenExploreHolidays={() => {
              setMobileSidebarOpen(false);
              setSettingsInitialSection("holiday_calendars");
              setIsCalendarSettingsOpen(true);
            }}
            onOpenSubscribeFromUrl={() => {
              setMobileSidebarOpen(false);
              setIsSubscribeUrlModalOpen(true);
            }}
            onRefreshUrlFeed={handleRefreshUrlFeed}
            upcomingEvents={upcomingEvents()}
            onSelectEvent={(ev) => {
              handleSelectEvent(ev);
              setMobileSidebarOpen(false);
            }}
            worldClockCities={calendarSettings.settings().worldClockCities}
            timeFormat={calendarSettings.settings().timeFormat}
            showWorldClock={calendarSettings.settings().showWorldClock !== false}
            onOpenWorldClockSettings={() => {
              setMobileSidebarOpen(false);
              setSettingsInitialSection("timezones");
              setIsCalendarSettingsOpen(true);
            }}
            onOpenContacts={() => {
              props.onOpenContacts?.();
              setMobileSidebarOpen(false);
            }}
            onOpenSettings={() => {
              props.onOpenSettings?.();
              setMobileSidebarOpen(false);
            }}
            currentViewMode={viewMode()}
            onChangeViewMode={(mode) => {
              changeViewMode(mode);
              setMobileSidebarOpen(false);
            }}
          />
        </div>

      {/* ── Right Content Column beside CalendarSidebar ── */}
      <div class="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden gap-1.5 sm:gap-2">
        {/* Mobile Google Calendar Top Header (< md) */}
        <MobileCalendarHeader
          periodTitle={periodTitle()}
          selectedDate={currentDate()}
          onSelectDate={(d) => setCurrentDate(d)}
          onToday={handleToday}
          onOpenSidebar={() => setMobileSidebarOpen(true)}
          searchQuery={searchQuery()}
          onSearchChange={(q) => {
            setSearchQuery(q);
            props.onSearchChange?.(q);
          }}
          profilePhotoUrl={props.profilePhotoUrl}
          currentUserEmail={props.currentUserEmail}
        />

        {/* Top Fixed Bar (Desktop only, >= md) */}
        <div class="hidden md:block">
          <TopFixedBar
            activeModule="calendar"
            onSwitchModule={props.onSwitchModule || (() => {})}
            searchQuery={searchQuery()}
            onSearchChange={(q) => {
              setSearchQuery(q);
              props.onSearchChange?.(q);
            }}
            onOpenContacts={props.onOpenContacts || (() => {})}
            onOpenMobileMenu={() => setMobileSidebarOpen(true)}
            isOnline={props.isOnline ?? isOnline()}
            isCustomizerOpen={props.isCustomizerOpen}
            onToggleCustomizer={props.onToggleCustomizer}
            theme={props.theme}
            onToggleTheme={props.onToggleTheme}
          />
        </div>

        {/* ── Main Workspace Card ── */}
        <div class="flex-1 rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#18191D] shadow-2xs overflow-hidden flex flex-col min-w-0 min-h-0">
          {/* Toolbar */}
          <CalendarToolbar
            hideRedundantTopBarItems={true}
            viewMode={viewMode()}
            onChangeViewMode={changeViewMode}
            periodTitle={periodTitle()}
            onToday={handleToday}
            onPrev={handlePrev}
            onNext={handleNext}
            searchQuery={searchQuery()}
            onSearchChange={setSearchQuery}
            onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
            onSwitchToMail={props.onSwitchToMail}
            onOpenSettings={() => {
              setSettingsInitialSection("general");
              setIsCalendarSettingsOpen(true);
            }}
            isOnline={isOnline()}
            offlineQueueCount={offlineQueueCount()}
            onSyncOffline={handleSyncOffline}
            onOpenTrash={() => setIsTrashModalOpen(true)}
          />

        {/* Upgrade Banner for Legacy Events */}
        <Show when={legacyEvents().length > 0}>
          <div
            data-testid="calendar-legacy-upgrade-banner"
            class="flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 text-xs sm:text-sm font-medium transition-all"
          >
            <div class="flex items-center gap-2.5 min-w-0">
              <svg
                class="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span class="truncate">
                {legacyEvents().length} legacy unencrypted calendar event{legacyEvents().length > 1 ? "s" : ""} detected.
              </span>
            </div>
            <button
              type="button"
              disabled={migrationRunning()}
              onClick={handleStartRecovery}
              class="shrink-0 px-3 py-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded text-xs font-semibold shadow-xs transition-colors focus:outline-hidden focus:ring-2 focus:ring-amber-500"
            >
              {migrationRunning()
                ? `Upgrading (${migrationProgress()?.current || 0}/${migrationProgress()?.total || 0})...`
                : "Upgrade to End-to-End Encryption"}
            </button>
          </div>
        </Show>

        <Show when={migrationSuccess()}>
          <div
            data-testid="calendar-legacy-upgrade-success"
            class="flex items-center justify-between gap-3 px-4 py-2 bg-emerald-50 dark:bg-emerald-950/40 border-b border-emerald-200 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200 text-xs transition-all"
          >
            <div class="flex items-center gap-2">
              <svg class="w-4 h-4 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
              <span>{migrationSuccess()}</span>
            </div>
            <button
              type="button"
              onClick={() => setMigrationSuccess(null)}
              class="text-emerald-700 hover:text-emerald-900 dark:hover:text-emerald-100 font-bold px-1"
            >
              ×
            </button>
          </div>
        </Show>

        <Show when={migrationError()}>
          <div
            data-testid="calendar-legacy-upgrade-error"
            class="flex items-center justify-between gap-3 px-4 py-2 bg-rose-50 dark:bg-rose-950/40 border-b border-rose-200 dark:border-rose-800/60 text-rose-900 dark:text-rose-200 text-xs transition-all"
          >
            <div class="flex items-center gap-2">
              <svg class="w-4 h-4 text-rose-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span>{migrationError()}</span>
            </div>
            <button
              type="button"
              onClick={() => setMigrationError(null)}
              class="text-rose-700 hover:text-rose-900 dark:hover:text-rose-100 font-bold px-1"
            >
              ×
            </button>
          </div>
        </Show>

        {/* Travel / Timezone Update Consent Banner (Category 05 - BYOS Warm Brand System) */}
        <Show when={showTravelBanner()}>
          <div
            data-testid="calendar-travel-timezone-banner"
            class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 py-3 bg-[#FAF9F5] dark:bg-[#18191D] border-b border-[#E2DFD8] dark:border-[#2A2D35] text-[#18191D] dark:text-[#ECEBE8] text-xs font-medium transition-all"
          >
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-7 h-7 rounded-lg bg-[#FAF0E6] dark:bg-[#2A221E] flex items-center justify-center shrink-0 border border-[#E2DFD8] dark:border-[#382B24]">
                <svg class="w-4 h-4 text-[#9E725F] dark:text-[#D4A38F] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </div>
              <span class="leading-relaxed">
                Your device appears to be in <strong class="font-bold text-[#9E725F] dark:text-[#D4A38F]">{detectedBrowserTz()}</strong>. Would you like to update your primary calendar time zone from {calendarSettings.settings().primaryTimeZone}?
              </span>
            </div>
            <div class="flex items-center gap-2 shrink-0 self-end sm:self-auto">
              <button
                type="button"
                onClick={async () => {
                  await calendarSettings.updateSetting("primaryTimeZone", detectedBrowserTz());
                  setTravelBannerDismissed(true);
                }}
                class="px-3 py-1.5 bg-[#9E725F] hover:bg-[#865E4D] text-white rounded-xl text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                data-testid="accept-travel-tz-btn"
              >
                Update to {detectedBrowserTz()}
              </button>
              <button
                type="button"
                onClick={() => setTravelBannerDismissed(true)}
                class="px-3 py-1.5 bg-[#F0EEE9] dark:bg-[#202227] hover:bg-[#E8E5DF] text-[#3C3D3E] dark:text-[#ECEBE8] rounded-xl text-xs font-semibold border border-[#E2DFD8] dark:border-[#2A2D35] transition-colors cursor-pointer"
                data-testid="dismiss-travel-tz-btn"
              >
                Keep {calendarSettings.settings().primaryTimeZone}
              </button>
            </div>
          </div>
        </Show>

        {/* View Component + Tasks Sidebar Panel (Category 11 & 15) */}
        <div
          class="flex-1 min-h-0 flex overflow-hidden"
          data-density={calendarSettings.settings().density || "comfortable"}
        >
          <div class="flex-1 min-h-0 flex flex-col overflow-hidden animate-view-fade">
            {/* Print-only header (Category 15) */}
            <div class="hidden print:block p-4 border-b border-black/20 text-black">
              <h1 class="text-xl font-bold">{periodTitle()}</h1>
              <p class="text-xs text-black/70">
                Printed on {new Date().toLocaleDateString()} • Timezone: {calendarSettings.settings().primaryTimeZone || "UTC"}
              </p>
            </div>
            <Show when={viewMode() === "week"}>
              <WeekView
                currentDate={currentDate()}
                calendars={allCalendars()}
                events={filteredEvents()}
                onSelectEvent={handleSelectEvent}
                onSlotClick={handleSlotClick}
                hourHeight={hourHeight()}
                timeFormat={calendarSettings.settings().timeFormat}
                weekStart={calendarSettings.settings().weekStart}
                showWeekends={calendarSettings.settings().showWeekends}
                workingHoursEnabled={calendarSettings.settings().workingHoursEnabled}
                workingDays={calendarSettings.settings().workingDays}
                workHoursStart={calendarSettings.settings().workHoursStart}
                workHoursEnd={calendarSettings.settings().workHoursEnd}
                alternateCalendar={calendarSettings.settings().alternateCalendar}
                primaryTimeZone={calendarSettings.settings().primaryTimeZone}
                showSecondaryTimeZone={calendarSettings.settings().showSecondaryTimeZone}
                secondaryTimeZone={calendarSettings.settings().secondaryTimeZone}
                secondaryTimeZoneLabel={calendarSettings.settings().secondaryTimeZoneLabel}
                calendarSettings={calendarSettings.settings()}
                onPrev={handlePrev}
                onNext={handleNext}
              />
            </Show>

            <Show when={viewMode() === "day"}>
              <DayView
                currentDate={currentDate()}
                calendars={allCalendars()}
                events={filteredEvents()}
                onSelectEvent={handleSelectEvent}
                onSlotClick={handleSlotClick}
                hourHeight={hourHeight()}
                timeFormat={calendarSettings.settings().timeFormat}
                workingHoursEnabled={calendarSettings.settings().workingHoursEnabled}
                workingDays={calendarSettings.settings().workingDays}
                workHoursStart={calendarSettings.settings().workHoursStart}
                workHoursEnd={calendarSettings.settings().workHoursEnd}
                alternateCalendar={calendarSettings.settings().alternateCalendar}
                primaryTimeZone={calendarSettings.settings().primaryTimeZone}
                showSecondaryTimeZone={calendarSettings.settings().showSecondaryTimeZone}
                secondaryTimeZone={calendarSettings.settings().secondaryTimeZone}
                secondaryTimeZoneLabel={calendarSettings.settings().secondaryTimeZoneLabel}
                calendarSettings={calendarSettings.settings()}
                onPrev={handlePrev}
                onNext={handleNext}
              />
            </Show>

            <Show when={viewMode() === "3days"}>
              <WeekView
                numDays={3}
                currentDate={currentDate()}
                calendars={allCalendars()}
                events={filteredEvents()}
                onSelectEvent={handleSelectEvent}
                onSlotClick={handleSlotClick}
                hourHeight={hourHeight()}
                timeFormat={calendarSettings.settings().timeFormat}
                workingHoursEnabled={calendarSettings.settings().workingHoursEnabled}
                workingDays={calendarSettings.settings().workingDays}
                workHoursStart={calendarSettings.settings().workHoursStart}
                workHoursEnd={calendarSettings.settings().workHoursEnd}
                alternateCalendar={calendarSettings.settings().alternateCalendar}
                primaryTimeZone={calendarSettings.settings().primaryTimeZone}
                showSecondaryTimeZone={calendarSettings.settings().showSecondaryTimeZone}
                secondaryTimeZone={calendarSettings.settings().secondaryTimeZone}
                secondaryTimeZoneLabel={calendarSettings.settings().secondaryTimeZoneLabel}
                calendarSettings={calendarSettings.settings()}
                onPrev={handlePrev}
                onNext={handleNext}
              />
            </Show>

            <Show when={viewMode() === "month"}>
              {/* Mobile: Google Calendar Split Month View */}
              <div class="md:hidden flex-1 flex flex-col min-h-0">
                <MobileMonthSplitView
                  currentDate={currentDate()}
                  onSelectDate={(d) => setCurrentDate(d)}
                  calendars={allCalendars()}
                  events={filteredEvents()}
                  onSelectEvent={handleSelectEvent}
                  onOpenCreateEvent={() => {
                    setEventToEdit(null);
                    setSlotStartDate(currentDate());
                    setSlotEndDate(new Date(currentDate().getTime() + 60 * 60 * 1000));
                    setIsEventModalOpen(true);
                  }}
                  onSlotClick={handleSlotClick}
                  weekStart={calendarSettings.settings().weekStart}
                  onPrev={handlePrev}
                  onNext={handleNext}
                />
              </div>

              {/* Desktop: Full Month Grid View */}
              <div class="hidden md:flex flex-1 flex-col min-h-0">
                <MonthView
                  currentDate={currentDate()}
                  calendars={allCalendars()}
                  events={filteredEvents()}
                  onSelectEvent={handleSelectEvent}
                  onSelectDate={(d) => {
                    setCurrentDate(d);
                    changeViewMode("day");
                  }}
                  onSlotClick={handleSlotClick}
                  weekStart={calendarSettings.settings().weekStart}
                  showWeekNumbers={calendarSettings.settings().showWeekNumbers}
                  firstWeekOfYear={calendarSettings.settings().firstWeekOfYear}
                  alternateCalendar={calendarSettings.settings().alternateCalendar}
                  primaryTimeZone={calendarSettings.settings().primaryTimeZone}
                />
              </div>
            </Show>

            <Show when={viewMode() === "year"}>
              <YearView
                currentDate={currentDate()}
                calendars={allCalendars()}
                events={filteredEvents()}
                onSelectEvent={handleSelectEvent}
                onSelectDate={(d) => {
                  setCurrentDate(d);
                  changeViewMode("day");
                }}
                onSelectMonth={(monthIndex, year) => {
                  setCurrentDate(new Date(year, monthIndex, 1));
                  changeViewMode("month");
                }}
                onSlotClick={handleSlotClick}
                weekStart={calendarSettings.settings().weekStart}
                alternateCalendar={calendarSettings.settings().alternateCalendar}
              />
            </Show>

            <Show when={viewMode() === "agenda"}>
              <AgendaView
                currentDate={currentDate()}
                calendars={allCalendars()}
                events={filteredEvents()}
                onSelectEvent={handleSelectEvent}
                onOpenCreateEvent={(d) => {
                  setEventToEdit(null);
                  const target = d || currentDate();
                  const start = new Date(target);
                  const now = new Date();
                  if (
                    start.getFullYear() === now.getFullYear() &&
                    start.getMonth() === now.getMonth() &&
                    start.getDate() === now.getDate()
                  ) {
                    start.setHours(now.getHours() + 1, 0, 0, 0);
                  } else {
                    start.setHours(9, 0, 0, 0);
                  }
                  const end = new Date(start.getTime() + (calendarSettings.settings().defaultDuration || 60) * 60 * 1000);
                  setSlotStartDate(start);
                  setSlotEndDate(end);
                  setIsEventModalOpen(true);
                }}
              />
            </Show>
          </div>
        </div>
      </div>
      </div>

      {/* ── Mobile Google Calendar Floating Action Button ── */}
      <MobileCalendarFab
        onOpenCreateEvent={() => {
          setEventToEdit(null);
          const start = new Date(currentDate());
          const now = new Date();
          if (
            start.getFullYear() === now.getFullYear() &&
            start.getMonth() === now.getMonth() &&
            start.getDate() === now.getDate()
          ) {
            start.setHours(now.getHours() + 1, 0, 0, 0);
          } else {
            start.setHours(9, 0, 0, 0);
          }
          const end = new Date(start.getTime() + (calendarSettings.settings().defaultDuration || 60) * 60 * 1000);
          setSlotStartDate(start);
          setSlotEndDate(end);
          setIsEventModalOpen(true);
        }}
      />

      {/* ── Modals ── */}
      <EventModal
        isOpen={isEventModalOpen()}
        onClose={() => {
          setIsEventModalOpen(false);
          setEventToEdit(null);
        }}
        isLocked={!props.mailboxKey || !(props.mailboxKey instanceof Uint8Array) || props.mailboxKey.length !== 32}
        eventToEdit={eventToEdit()}
        defaultStartDate={slotStartDate()}
        defaultEndDate={slotEndDate()}
        defaultDurationMinutes={calendarSettings.settings().defaultDuration}
        defaultCalendarId={calendarSettings.settings().defaultCalendarId}
        defaultTimeZone={calendarSettings.settings().primaryTimeZone}
        defaultVisibility={calendarSettings.settings().defaultEventVisibility}
        defaultGuestPermissions={{
          modifyEvent: calendarSettings.settings().guestsCanModify,
          inviteOthers: calendarSettings.settings().guestsCanInviteOthers,
          seeGuestList: calendarSettings.settings().guestsCanSeeGuestList,
        }}
        defaultReminderMinutes={calendarSettings.settings().defaultReminderMinutes}
        calendars={allCalendars()}
        contacts={props.contacts}
        onSave={handleSaveEvent}
        onDelete={handleDeleteEvent}
        onDuplicate={handleDuplicateEvent}
        onCopyToCalendar={handleCopyToCalendar}
        onHideHoliday={handleHideHoliday}
      />

      <CalendarModal
        isOpen={isCalendarModalOpen()}
        onClose={() => setIsCalendarModalOpen(false)}
        calendarToEdit={calendarToEdit()}
        mailboxId={props.mailboxId}
        onSave={handleSaveCalendar}
        onDelete={handleDeleteCalendar}
        onUnsubscribe={handleUnsubscribeCalendar}
      />

      <ShareCalendarModal
        isOpen={isShareModalOpen()}
        onClose={() => setIsShareModalOpen(false)}
        calendar={calendarToShare()}
        mailboxId={props.mailboxId}
        mailboxKey={props.mailboxKey}
        contacts={props.contacts}
        onSharesChanged={loadCalendars}
      />

      <CalendarSettingsModal
        isOpen={isCalendarSettingsOpen()}
        onClose={() => setIsCalendarSettingsOpen(false)}
        mailboxId={props.mailboxId}
        mailboxKey={props.mailboxKey}
        events={allDecryptedEvents()}
        currentUserEmail={props.currentUserEmail}
        initialSectionId={settingsInitialSection()}
        calendars={allCalendars()}
        onOpenCreateCalendar={() => {
          setIsCalendarSettingsOpen(false);
          setCalendarToEdit(null);
          setIsCalendarModalOpen(true);
        }}
        onOpenExploreHolidays={() => {
          setSettingsInitialSection("holiday_calendars");
        }}
        onOpenSubscribeFromUrl={() => {
          setIsCalendarSettingsOpen(false);
          setIsSubscribeUrlModalOpen(true);
        }}
        onDeleteCalendar={handleDeleteCalendar}
        onUnsubscribeCalendar={handleUnsubscribeCalendar}
      />

      <SubscribeFromUrlModal
        isOpen={isSubscribeUrlModalOpen()}
        onClose={() => setIsSubscribeUrlModalOpen(false)}
        mailboxId={props.mailboxId}
        onSubscribed={() => {
          loadUrlSubs();
        }}
      />

      {/* ── Undo Deletion Toast (Category 06) ── */}
      <Show when={deletedEventState()}>
        <div
          class="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 bg-[#2B2C2D] dark:bg-[#1E1F23] text-white text-xs font-semibold rounded-2xl shadow-xl border border-white/10 animate-in slide-in-from-bottom duration-200"
          data-testid="undo-delete-toast"
        >
          <svg class="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          <span class="truncate max-w-[200px] sm:max-w-[280px]">
            Event "{deletedEventState()?.event.details.title}" deleted
          </span>
          <button
            type="button"
            onClick={handleUndoDelete}
            class="px-2.5 py-1 bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
            data-testid="undo-delete-btn"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => {
              if (deletedEventState()?.timer) clearTimeout(deletedEventState()!.timer);
              setDeletedEventState(null);
            }}
            class="p-1 text-white/60 hover:text-white rounded transition-colors cursor-pointer"
            aria-label="Dismiss toast"
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </Show>

      {/* ── Calendar Trash Bin Modal (Category 15) ── */}
      <CalendarTrashModal
        isOpen={isTrashModalOpen()}
        mailboxId={props.mailboxId || ""}
        mailboxKey={props.mailboxKey}
        onClose={() => setIsTrashModalOpen(false)}
        onRestore={handleRestoreFromTrash}
      />

      {/* ── Keyboard Shortcuts Cheatsheet Modal (Category 15) ── */}
      <CalendarShortcutsModal
        isOpen={isShortcutsModalOpen()}
        onClose={() => setIsShortcutsModalOpen(false)}
      />

      {/* ── Screen Reader Live Region (Category 15) ── */}
      <div
        class="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-testid="calendar-screen-reader-announcer"
      >
        {screenReaderAnnouncement()}
      </div>
    </div>
  );
};
