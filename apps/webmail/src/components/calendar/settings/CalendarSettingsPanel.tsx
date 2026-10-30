import {
  Component,
  createSignal,
  createMemo,
  For,
  Show,
  createEffect,
  onCleanup,
  JSX,
} from "solid-js";
import {
  CALENDAR_SETTING_SECTIONS,
  CALENDAR_SETTINGS_REGISTRY,
  CalendarSettingSectionId,
  CalendarSettingDefinition,
  searchCalendarSettings,
} from "./calendarSettingsRegistry";
import {
  CalendarSettings,
  createCalendarSettings,
  SaveStatus,
  WorldClockCity,
  loadCalendarOverrides,
  saveCalendarOverrides,
} from "./calendarSettingsStore";
import { UserCalendar } from "../../../api";
import { getMailboxKeyFor } from "../../../session_isolation";
import {
  getHolidaySubscriptions,
  subscribeHolidayFeed,
  unsubscribeHolidayFeed,
  toggleHolidayObservances,
  updateHolidaySubscriptionColor,
  refreshHolidayFeed,
  restoreHolidayEvent,
  HolidaySubscription,
} from "../holidays/holidaySubscriptionStore";
import {
  getAllSupportedCountries,
  generateFeedForCountry,
  getFeedById,
  HOLIDAY_FEEDS,
  getFeedEvents,
  SupportedCountryItem,
  HolidayCalendarFeed,
  HolidayEventDefinition,
} from "../holidays/holidayCatalogue";
import {
  subscribeUrlFeed,
  unsubscribeUrlFeed,
  getUrlSubscriptions,
  refreshUrlSubscription,
  pauseUrlSubscription,
  UrlCalendarSubscription,
} from "../url/urlCalendarStore";
import {
  exportCalendarToIcs,
  downloadIcsFile,
  validateIcsPayload,
  importIcsToCalendar,
  ImportSummary,
} from "../../../utils/calendarImportExport";
import { DecryptedEventRecord } from "../CalendarSidebar";
import {
  SUPPORTED_TIMEZONES,
  PRESET_WORLD_CLOCK_CITIES,
  formatZonedTime,
  getTimeZoneAbbr,
  getWorldClockCityTime,
} from "../../../utils/calendarTimezones";
import { getAppointmentSchedules } from "../appointments/appointmentStore";
import { AppointmentSchedule } from "../appointments/appointmentTypes";

interface CalendarSettingsPanelProps {
  mailboxId?: string;
  mailboxKey?: Uint8Array | null;
  events?: DecryptedEventRecord[];
  currentUserEmail?: string;
  initialSectionId?: string;
  calendars?: UserCalendar[];
  onClose?: () => void;
  isModal?: boolean;
  onOpenCreateCalendar?: () => void;
  onOpenExploreHolidays?: () => void;
  onOpenSubscribeFromUrl?: () => void;
  onDeleteCalendar?: (calId: string) => Promise<void>;
  onUnsubscribeCalendar?: (cal: UserCalendar) => void;
  onOpenAppointmentsManager?: () => void;
}

export const CalendarSettingsPanel: Component<CalendarSettingsPanelProps> = (props) => {
  const {
    settings,
    updateSetting,
    resetToDefaults,
    saveStatus,
    saveError,
    retrySave,
  } = createCalendarSettings(() => props.mailboxId);

  const [activeSectionId, setActiveSectionId] = createSignal<string>(
    props.initialSectionId || "general"
  );

  createEffect(() => {
    if (props.initialSectionId) {
      setActiveSectionId(props.initialSectionId);
    }
  });

  const [searchQuery, setSearchQuery] = createSignal("");
  const [showResetConfirm, setShowResetConfirm] = createSignal(false);
  const [newCityLabel, setNewCityLabel] = createSignal("");
  const [newCityTz, setNewCityTz] = createSignal("UTC");
  const [copiedCalDav, setCopiedCalDav] = createSignal(false);

  // Per-calendar overrides state
  const [calReminderOverrides, setCalReminderOverrides] = createSignal<Record<string, number>>({});

  function getCalReminderOverride(calId: string): number {
    if (calReminderOverrides()[calId] !== undefined) {
      return calReminderOverrides()[calId];
    }
    if (props.mailboxId) {
      const ov = loadCalendarOverrides(props.mailboxId, calId);
      if (ov.defaultReminderMinutes !== undefined) {
        return ov.defaultReminderMinutes;
      }
    }
    return settings().defaultReminderMinutes ?? 10;
  }

  function handleSetCalReminderOverride(calId: string, minutes: number) {
    if (!props.mailboxId) return;
    saveCalendarOverrides(props.mailboxId, calId, { defaultReminderMinutes: minutes });
    setCalReminderOverrides((prev) => ({ ...prev, [calId]: minutes }));
  }

  // Holiday subscriptions state
  const [holidaySubs, setHolidaySubs] = createSignal<HolidaySubscription[]>(
    props.mailboxId ? getHolidaySubscriptions(props.mailboxId) : []
  );

  // URL subscriptions state
  const [urlSubs, setUrlSubs] = createSignal<UrlCalendarSubscription[]>(
    props.mailboxId ? getUrlSubscriptions(props.mailboxId) : []
  );

  function reloadHolidaySubs() {
    if (props.mailboxId) {
      setHolidaySubs(getHolidaySubscriptions(props.mailboxId));
      setUrlSubs(getUrlSubscriptions(props.mailboxId));
    }
  }

  createEffect(() => {
    reloadHolidaySubs();
  });

  // "Browse calendars of interest" sub-tab state
  const [browseTab, setBrowseTab] = createSignal<"regional" | "religious" | "other" | "active">("regional");
  const [countrySearch, setCountrySearch] = createSignal("");
  const [selectedContinent, setSelectedContinent] = createSignal("all");
  const [expandedPreviewFeedId, setExpandedPreviewFeedId] = createSignal<string | null>(null);

  // Quick form states for Add Calendar views
  const [newCalName, setNewCalName] = createSignal("");
  const [newCalDesc, setNewCalDesc] = createSignal("");
  const [newCalTz, setNewCalTz] = createSignal(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [createCalSuccess, setCreateCalSuccess] = createSignal(false);

  const [urlInput, setUrlInput] = createSignal("");
  const [urlRefresh, setUrlRefresh] = createSignal<"hourly" | "daily" | "weekly">("hourly");
  const [urlColor, setUrlColor] = createSignal("#0D9488");
  const [urlSuccess, setUrlSuccess] = createSignal(false);
  const [urlError, setUrlError] = createSignal<string | null>(null);

  const [subscribeEmailInput, setSubscribeEmailInput] = createSignal("");
  const [subscribeEmailSuccess, setSubscribeEmailSuccess] = createSignal(false);

  // Timezone and World Clock interactive states (Category 05)
  const [selectedCityPreset, setSelectedCityPreset] = createSignal(PRESET_WORLD_CLOCK_CITIES[0]?.id || "");
  const [customCityLabel, setCustomCityLabel] = createSignal("");
  const [customCityTz, setCustomCityTz] = createSignal("UTC");
  const [isAddingCustomCity, setIsAddingCustomCity] = createSignal(false);

  function handleAddPresetCity() {
    const preset = PRESET_WORLD_CLOCK_CITIES.find((p) => p.id === selectedCityPreset());
    if (!preset) return;
    const current = settings().worldClockCities || [];
    if (current.some((c) => c.timeZone === preset.timeZone && c.label === preset.label)) return;
    const newCity: WorldClockCity = {
      id: preset.id || `city-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: preset.label,
      timeZone: preset.timeZone,
    };
    updateSetting("worldClockCities", [...current, newCity]);
  }

  function handleAddCustomCity() {
    const label = customCityLabel().trim();
    if (!label) return;
    const current = settings().worldClockCities || [];
    const newCity: WorldClockCity = {
      id: `city-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label,
      timeZone: customCityTz(),
    };
    updateSetting("worldClockCities", [...current, newCity]);
    setCustomCityLabel("");
    setIsAddingCustomCity(false);
  }

  function handleRemoveWorldClockCity(cityId: string) {
    const current = settings().worldClockCities || [];
    updateSetting("worldClockCities", current.filter((c) => c.id !== cityId));
  }

  function handleMoveCity(cityId: string, direction: "up" | "down") {
    const current = [...(settings().worldClockCities || [])];
    const idx = current.findIndex((c) => c.id === cityId);
    if (idx === -1) return;
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= current.length) return;
    const [moved] = current.splice(idx, 1);
    current.splice(targetIdx, 0, moved);
    updateSetting("worldClockCities", current);
  }

  function handleSwapTimezones() {
    const p = settings().primaryTimeZone;
    const s = settings().secondaryTimeZone;
    const currentPAbbr = getTimeZoneAbbr(new Date(), p);
    updateSetting("primaryTimeZone", s);
    updateSetting("secondaryTimeZone", p);
    updateSetting("secondaryTimeZoneLabel", currentPAbbr);
  }

  // Search results across Settings
  const filteredSettings = createMemo(() => {
    return searchCalendarSettings(searchQuery());
  });

  const isSearching = createMemo(() => searchQuery().trim().length > 0);

  // Countries for regional catalogue
  const allCountries = createMemo(() => getAllSupportedCountries());

  const filteredCountries = createMemo(() => {
    const q = countrySearch().toLowerCase().trim();
    let list = allCountries();
    if (selectedContinent() !== "all") {
      list = list.filter((c) => c.continent === selectedContinent());
    }
    if (q) {
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.code.toLowerCase().includes(q) ||
          (c.nativeName && c.nativeName.toLowerCase().includes(q))
      );
    }
    return list;
  });

  // Religious feeds
  const religiousFeeds = createMemo(() => {
    return HOLIDAY_FEEDS.filter((f) => f.category === "religion");
  });

  // Other feeds (Moon phases)
  const otherFeeds = createMemo(() => {
    return HOLIDAY_FEEDS.filter((f) => f.category === "other");
  });

  // Sports feeds (Cricket, Football, Basketball, Hockey, Rugby)
  const sportsFeeds = createMemo(() => {
    return HOLIDAY_FEEDS.filter((f) => f.category === "sports");
  });

  function isSubscribed(feedId: string): boolean {
    return holidaySubs().some((s) => s.feedId === feedId);
  }

  function getSubscription(feedId: string): HolidaySubscription | undefined {
    return holidaySubs().find((s) => s.feedId === feedId);
  }

  function handleToggleCountrySubscription(countryCode: string) {
    if (!props.mailboxId) return;
    const feedId = `holiday-${countryCode.toLowerCase()}`;
    if (isSubscribed(feedId)) {
      unsubscribeHolidayFeed(props.mailboxId, feedId);
      reloadHolidaySubs();
    } else {
      const feed = getFeedById(feedId, 2026);
      if (feed) {
        subscribeHolidayFeed(props.mailboxId, feed.id, {
          color: feed.defaultColor,
          includeObservances: true,
        });
        reloadHolidaySubs();
      }
    }
  }

  function handleToggleReligiousSubscription(feed: HolidayCalendarFeed) {
    if (!props.mailboxId) return;
    if (isSubscribed(feed.id)) {
      unsubscribeHolidayFeed(props.mailboxId, feed.id);
      reloadHolidaySubs();
    } else {
      subscribeHolidayFeed(props.mailboxId, feed.id, {
        color: feed.defaultColor,
        includeObservances: true,
      });
      reloadHolidaySubs();
    }
  }

  function handleToggleMoonSubscription() {
    if (!props.mailboxId) return;
    const moonFeed = HOLIDAY_FEEDS.find((f) => f.id === "other-moon-phases");
    if (!moonFeed) return;
    if (isSubscribed("other-moon-phases")) {
      unsubscribeHolidayFeed(props.mailboxId, "other-moon-phases");
      reloadHolidaySubs();
    } else {
      subscribeHolidayFeed(props.mailboxId, moonFeed.id, {
        color: moonFeed.defaultColor,
        includeObservances: true,
      });
      reloadHolidaySubs();
    }
  }

  function handleToggleSportsSubscription(feed: HolidayCalendarFeed) {
    if (!props.mailboxId) return;
    if (isSubscribed(feed.id)) {
      unsubscribeHolidayFeed(props.mailboxId, feed.id);
      reloadHolidaySubs();
    } else {
      subscribeHolidayFeed(props.mailboxId, feed.id, {
        color: feed.defaultColor,
        name: feed.name,
        includeObservances: true,
      });
      reloadHolidaySubs();
    }
  }

  function handleToggleObservances(feedId: string) {
    if (!props.mailboxId) return;
    toggleHolidayObservances(props.mailboxId, feedId);
    reloadHolidaySubs();
  }

  function handleUnsubscribe(feedId: string) {
    if (!props.mailboxId) return;
    unsubscribeHolidayFeed(props.mailboxId, feedId);
    reloadHolidaySubs();
  }

  function handleSubscribeFromUrlSubmit(e: Event) {
    e.preventDefault();
    setUrlError(null);
    if (!props.mailboxId || !urlInput().trim()) return;

    try {
      const parsed = new URL(urlInput().trim().replace(/^webcal:\/\//i, "https://"));
      if (!parsed.protocol.startsWith("http")) {
        setUrlError("Only http, https, or webcal URLs are supported.");
        return;
      }
    } catch {
      setUrlError("Please enter a valid URL.");
      return;
    }

    const name = urlInput().trim().split("/").pop()?.replace(/\.[^/.]+$/, "") || "External Feed";
    subscribeUrlFeed(props.mailboxId, {
      url: urlInput().trim(),
      name,
      color: urlColor(),
      refreshIntervalMinutes: urlRefresh() ? 1440 : 0,
    });
    setUrlSuccess(true);
    setUrlInput("");
    reloadHolidaySubs();
    setUrlSubsVersion((v) => v + 1);
    setTimeout(() => setUrlSuccess(false), 3000);
  }

  // ── URL subscriptions state ──
  const [urlSubsVersion, setUrlSubsVersion] = createSignal(0);
  const activeUrlSubscriptions = createMemo(() => {
    urlSubsVersion();
    return props.mailboxId ? getUrlSubscriptions(props.mailboxId) : [];
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    const onUrlUpdate = () => setUrlSubsVersion((v) => v + 1);
    window.addEventListener("byos_url_subs_updated", onUrlUpdate);
    onCleanup(() => window.removeEventListener("byos_url_subs_updated", onUrlUpdate));
  });

  const [refreshingFeedId, setRefreshingFeedId] = createSignal<string | null>(null);

  async function handleRefreshFeed(feedId: string) {
    if (!props.mailboxId) return;
    setRefreshingFeedId(feedId);
    try {
      await refreshUrlSubscription(props.mailboxId, feedId);
      setUrlSubsVersion((v) => v + 1);
    } finally {
      setRefreshingFeedId(null);
    }
  }

  function handlePauseFeed(feedId: string, pause: boolean) {
    if (!props.mailboxId) return;
    pauseUrlSubscription(props.mailboxId, feedId, pause);
    setUrlSubsVersion((v) => v + 1);
  }

  function handleUnsubscribeFeed(feedId: string) {
    if (!props.mailboxId) return;
    unsubscribeUrlFeed(props.mailboxId, feedId);
    setUrlSubsVersion((v) => v + 1);
  }

  // ── Import & Export state ──
  const [importCalendarId, setImportCalendarId] = createSignal<string>("");
  const [importDuplicateMode, setImportDuplicateMode] = createSignal<"update_duplicates" | "skip_duplicates">("update_duplicates");
  const [importFile, setImportFile] = createSignal<File | null>(null);
  const [importFileContent, setImportFileContent] = createSignal<string | null>(null);
  const [isImporting, setIsImporting] = createSignal(false);
  const [importResult, setImportResult] = createSignal<ImportSummary | null>(null);
  const [importError, setImportError] = createSignal<string | null>(null);

  const [exportCalendarId, setExportCalendarId] = createSignal<string>("all");
  const [isExporting, setIsExporting] = createSignal(false);
  const [exportSuccess, setExportSuccess] = createSignal<string | null>(null);
  const [exportError, setExportError] = createSignal<string | null>(null);

  function handleFileSelected(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    setImportFile(file);
    setImportResult(null);
    setImportError(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      setImportFileContent(text);
      const validation = validateIcsPayload(text);
      if (!validation.valid) {
        setImportError(validation.error || "Invalid file format");
      }
    };
    reader.onerror = () => {
      setImportError("Failed to read the selected file.");
    };
    reader.readAsText(file);
  }

  async function handleExecuteImport() {
    if (!props.mailboxId) {
      setImportError("No active mailbox selected.");
      return;
    }
    const content = importFileContent();
    if (!content) {
      setImportError("Please select a valid .ics calendar file to import.");
      return;
    }
    const targetCalId = importCalendarId() || (props.calendars && props.calendars.find((c) => !c.is_shared || c.permission === "write")?.id) || "";
    if (!targetCalId) {
      setImportError("Please select a target calendar for the imported events.");
      return;
    }

    let key = props.mailboxKey || (props.mailboxId ? getMailboxKeyFor(props.mailboxId) : null);
    if (!key) {
      setImportError("Mailbox encryption key is not available. Please unlock your mailbox.");
      return;
    }

    setIsImporting(true);
    setImportError(null);
    setImportResult(null);

    try {
      const summary = await importIcsToCalendar(content, {
        mailboxId: props.mailboxId,
        mailboxKey: key,
        targetCalendarId: targetCalId,
        duplicateMode: importDuplicateMode(),
        existingEvents: props.events || [],
      });
      setImportResult(summary);
      if (summary.errors.length > 0) {
        setImportError(`Import completed with ${summary.errors.length} issue(s).`);
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("byos_calendar_events_updated"));
      }
    } catch (err: any) {
      setImportError(err.message || "Failed to import calendar events.");
    } finally {
      setIsImporting(false);
    }
  }

  function handleExecuteExport() {
    const calId = exportCalendarId();
    const cals = props.calendars || [];
    const allEvs = props.events || [];

    setIsExporting(true);
    setExportSuccess(null);
    setExportError(null);
    setImportError(null);

    try {
      if (calId === "all") {
        const owned = cals.filter((c) => !c.is_shared);
        for (const cal of owned) {
          const calEvents = allEvs.filter((e) => e.calendarId === cal.id);
          const ics = exportCalendarToIcs(cal, calEvents, settings().primaryTimeZone);
          downloadIcsFile(`calendar_${(cal?.name || "calendar").replace(/\s+/g, "_").toLowerCase()}`, ics);
        }
        setExportSuccess(`Exported ${owned.length} calendar(s) to iCalendar (.ics).`);
      } else {
        const targetCal = cals.find((c) => c.id === calId);
        if (!targetCal) throw new Error("Selected calendar not found.");
        const calEvents = allEvs.filter((e) => e.calendarId === targetCal.id);
        const ics = exportCalendarToIcs(targetCal, calEvents, settings().primaryTimeZone);
        downloadIcsFile(`calendar_${(targetCal?.name || "calendar").replace(/\s+/g, "_").toLowerCase()}`, ics);
        setExportSuccess(`Exported "${targetCal.name}" (${calEvents.length} events) to iCalendar (.ics).`);
      }
    } catch (err: any) {
      console.error("Calendar export error:", err);
      setExportError(err?.message || "Failed to export calendar.");
    } finally {
      setIsExporting(false);
    }
  }

  const calDavServerUrl = () => {
    if (typeof window !== "undefined") {
      return `${window.location.origin}/dav/principals/`;
    }
    return "https://byos.local/dav/principals/";
  };

  const calDavPrincipalUrl = () => {
    const email = props.currentUserEmail || "alice@byos.local";
    if (typeof window !== "undefined") {
      return `${window.location.origin}/dav/principals/${encodeURIComponent(email)}/`;
    }
    return `https://byos.local/dav/principals/${encodeURIComponent(email)}/`;
  };

  // Active section settings for general registry
  const activeSectionSettings = createMemo(() => {
    return CALENDAR_SETTINGS_REGISTRY.filter((s) => s.sectionId === activeSectionId());
  });



  function renderIcon(iconName: string): JSX.Element {
    switch (iconName) {
      case "globe":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        );
      case "clock":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        );
      case "bell":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        );
      case "calendar":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        );
      case "map-pin":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
        );
      case "briefcase":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
          </svg>
        );
      case "shield":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        );
      case "cpu":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <rect x="9" y="9" width="6" height="6" />
            <line x1="9" y1="1" x2="9" y2="4" />
            <line x1="15" y1="1" x2="15" y2="4" />
            <line x1="9" y1="20" x2="9" y2="23" />
            <line x1="15" y1="20" x2="15" y2="23" />
            <line x1="20" y1="9" x2="23" y2="9" />
            <line x1="20" y1="14" x2="23" y2="14" />
            <line x1="1" y1="9" x2="4" y2="9" />
            <line x1="1" y1="14" x2="4" y2="14" />
          </svg>
        );
      case "command":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
          </svg>
        );
      case "wifi-off":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
        );
      case "layers":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
        );
      case "plus":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        );
      case "link":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        );
      case "user-plus":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <line x1="20" y1="8" x2="20" y2="14" />
            <line x1="23" y1="11" x2="17" y2="11" />
          </svg>
        );
      case "download":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        );
      case "upload":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        );
      default:
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        );
    }
  }

  return (
    <div class="h-full flex flex-col bg-[#FAF9F5] dark:bg-[#18191D] text-[#2B2C2D] dark:text-[#ECEBE8] select-none font-sans overflow-hidden">
      {/* ── Google Calendar Style Top Header ── */}
      <header class="h-14 sm:h-16 px-4 sm:px-6 bg-white dark:bg-[#1E1F23] border-b border-[#E2DFD8] dark:border-[#2A2D35] flex items-center justify-between gap-3 shrink-0">
        <div class="flex items-center gap-3">
          {/* Back button (Google Calendar style <-) */}
          <button
            type="button"
            onClick={() => props.onClose?.()}
            class="p-2 -ml-2 rounded-full hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] text-[#6F7173] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] transition-colors cursor-pointer"
            aria-label="Return to calendar"
            data-testid="calendar-settings-back-btn"
            title="Settings / Return to calendar"
          >
            <svg class="w-5 h-5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
          <h1
            class="text-lg sm:text-xl font-medium text-[#2B2C2D] dark:text-[#ECEBE8]"
            data-testid="calendar-settings-title"
          >
            Settings
          </h1>
        </div>

        {/* Central Search Bar (Google Calendar style) */}
        <div class="flex-1 max-w-md mx-2 sm:mx-4">
          <div class="relative w-full">
            <input
              type="text"
              placeholder="Search settings..."
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
              class="w-full pl-9 pr-8 py-1.5 sm:py-2 rounded-full border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs sm:text-sm text-[#2B2C2D] dark:text-[#ECEBE8] placeholder-[#6F7173] focus:outline-none focus:ring-2 focus:ring-[#9E725F] focus:bg-white dark:focus:bg-[#1E1F23] transition-all"
              data-testid="calendar-settings-search"
            />
            <svg
              class="w-4 h-4 stroke-[#6F7173] fill-none stroke-[2] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              viewBox="0 0 24 24"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <Show when={searchQuery()}>
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6F7173] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] cursor-pointer"
                aria-label="Clear search"
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </Show>


                      
          </div>
        </div>

        {/* Right Status & Close */}
        <div class="flex items-center gap-2 sm:gap-3">
          {/* Save Status Badge */}
          <div class="flex items-center text-xs" data-testid="calendar-settings-save-status">
            <Show when={saveStatus() === "saving"}>
              <span class="text-[#6F7173] dark:text-[#878A8E] flex items-center gap-1.5 animate-pulse" data-testid="settings-save-status-saving">
                <span class="w-1.5 h-1.5 rounded-full bg-[#9E725F]" />
                Saving...
              </span>
            </Show>

            <Show when={saveStatus() === "saved"}>
              <span class="text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 font-medium" data-testid="settings-save-status-saved">
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2.5]" viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Saved
              </span>
            </Show>
          </div>

          {/* Reset to Defaults button */}
          <button
            type="button"
            onClick={() => setShowResetConfirm(true)}
            class="px-2.5 py-1 text-xs font-medium text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] rounded-lg transition-colors cursor-pointer"
            data-testid="calendar-settings-reset-btn"
            title="Reset settings to defaults"
          >
            Reset
          </button>

          <Show when={props.isModal && props.onClose}>
            <button
              type="button"
              onClick={() => props.onClose?.()}
              class="p-2 rounded-full hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] text-[#6F7173] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] transition-colors cursor-pointer"
              aria-label="Close settings"
              data-testid="calendar-settings-close-btn"
            >
              <svg class="w-5 h-5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Show>
        </div>
      </header>

      {/* ── Main Body: 2-Pane Architecture (Google Calendar Persistent Navigation + Content) ── */}
      <div class="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
        {/* Left Navigation Drawer */}
        <nav
          class="w-full md:w-64 lg:w-72 bg-white dark:bg-[#1E1F23] border-b md:border-b-0 md:border-r border-[#E2DFD8] dark:border-[#2A2D35] flex md:flex-col shrink-0 overflow-x-auto md:overflow-y-auto p-2 sm:p-3 gap-1 select-none custom-scrollbar"
          aria-label="Calendar Settings Sections"
          data-testid="calendar-settings-nav"
        >
          <Show when={!isSearching()}>
            {/* ── Category 1: General & Views ── */}
            <div class="pt-2 pb-1 px-3 text-[11px] font-bold uppercase tracking-wider text-[#9E725F] dark:text-[#D1A796] flex items-center gap-1.5 shrink-0">
              <span>General & Views</span>
            </div>
            {/* General */}
            <button
              type="button"
              onClick={() => setActiveSectionId("general")}
              class={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap md:whitespace-normal transition-colors text-left cursor-pointer shrink-0 md:shrink ${
                activeSectionId() === "general"
                  ? "bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796]"
                  : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
              }`}
              data-testid="settings-nav-general"
              aria-selected={activeSectionId() === "general"}
            >
              <span class="shrink-0">{renderIcon("globe")}</span>
              <span class="truncate">General</span>
            </button>
            {/* View options */}
            <button
              type="button"
              onClick={() => setActiveSectionId("view_options")}
              class={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap md:whitespace-normal transition-colors text-left cursor-pointer shrink-0 md:shrink ${
                activeSectionId() === "view_options"
                  ? "bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796]"
                  : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
              }`}
              data-testid="settings-nav-view_options"
              aria-selected={activeSectionId() === "view_options"}
            >
              <span class="shrink-0">{renderIcon("calendar")}</span>
              <span class="truncate">View options</span>
            </button>
            {/* Time zones & world clock */}
            <button
              type="button"
              onClick={() => setActiveSectionId("timezones")}
              class={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap md:whitespace-normal transition-colors text-left cursor-pointer shrink-0 md:shrink ${
                activeSectionId() === "timezones"
                  ? "bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796]"
                  : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
              }`}
              data-testid="settings-nav-timezones"
              aria-selected={activeSectionId() === "timezones"}
            >
              <span class="shrink-0">{renderIcon("globe")}</span>
              <span class="truncate">Time zones & world clock</span>
            </button>

            {/* ── Category 2: Schedule & Availability ── */}
            <div class="pt-3 pb-1 px-3 text-[11px] font-bold uppercase tracking-wider text-[#9E725F] dark:text-[#D1A796] flex items-center gap-1.5 shrink-0">
              <span>Schedule & Availability</span>
            </div>
            {/* Event settings */}
            <button
              type="button"
              onClick={() => setActiveSectionId("event_defaults")}
              class={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap md:whitespace-normal transition-colors text-left cursor-pointer shrink-0 md:shrink ${
                activeSectionId() === "event_defaults"
                  ? "bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796]"
                  : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
              }`}
              data-testid="settings-nav-event_defaults"
              aria-selected={activeSectionId() === "event_defaults"}
            >
              <span class="shrink-0">{renderIcon("clock")}</span>
              <span class="truncate">Event settings</span>
            </button>
            {/* Working hours & location */}
            <button
              type="button"
              onClick={() => setActiveSectionId("working_hours")}
              class={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap md:whitespace-normal transition-colors text-left cursor-pointer shrink-0 md:shrink ${
                activeSectionId() === "working_hours"
                  ? "bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796]"
                  : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
              }`}
              data-testid="settings-nav-working_hours"
              aria-selected={activeSectionId() === "working_hours"}
            >
              <span class="shrink-0">{renderIcon("briefcase")}</span>
              <span class="truncate">Working hours & location</span>
            </button>
            {/* Notification settings */}
            <button
              type="button"
              onClick={() => setActiveSectionId("notifications")}
              class={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap md:whitespace-normal transition-colors text-left cursor-pointer shrink-0 md:shrink ${
                activeSectionId() === "notifications"
                  ? "bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796]"
                  : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
              }`}
              data-testid="settings-nav-notifications"
              aria-selected={activeSectionId() === "notifications"}
            >
              <span class="shrink-0">{renderIcon("bell")}</span>
              <span class="truncate">Notification settings</span>
            </button>

            {/* ── Category 3: Connections & Privacy ── */}
            <div class="pt-3 pb-1 px-3 text-[11px] font-bold uppercase tracking-wider text-[#9E725F] dark:text-[#D1A796] flex items-center gap-1.5 shrink-0">
              <span>Connections & Privacy</span>
            </div>
            {/* Privacy & sharing */}
            <button
              type="button"
              onClick={() => setActiveSectionId("privacy_sharing")}
              class={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap md:whitespace-normal transition-colors text-left cursor-pointer shrink-0 md:shrink ${
                activeSectionId() === "privacy_sharing"
                  ? "bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796]"
                  : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
              }`}
              data-testid="settings-nav-privacy_sharing"
              aria-selected={activeSectionId() === "privacy_sharing"}
            >
              <span class="shrink-0">{renderIcon("shield")}</span>
              <span class="truncate">Privacy & sharing</span>
            </button>
            {/* Integrations */}
            <button
              type="button"
              onClick={() => setActiveSectionId("integrations")}
              class={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap md:whitespace-normal transition-colors text-left cursor-pointer shrink-0 md:shrink ${
                activeSectionId() === "integrations"
                  ? "bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796]"
                  : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
              }`}
              data-testid="settings-nav-integrations"
              aria-selected={activeSectionId() === "integrations"}
            >
              <span class="shrink-0">{renderIcon("cpu")}</span>
              <span class="truncate">Integrations</span>
            </button>
            {/* Keyboard shortcuts & accessibility */}
            <button
              type="button"
              onClick={() => setActiveSectionId("shortcuts_a11y")}
              class={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap md:whitespace-normal transition-colors text-left cursor-pointer shrink-0 md:shrink ${
                activeSectionId() === "shortcuts_a11y"
                  ? "bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796]"
                  : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
              }`}
              data-testid="settings-nav-shortcuts_a11y"
              aria-selected={activeSectionId() === "shortcuts_a11y"}
            >
              <span class="shrink-0">{renderIcon("command")}</span>
              <span class="truncate">Shortcuts & accessibility</span>
            </button>
            {/* Offline & synchronization */}
            <button
              type="button"
              onClick={() => setActiveSectionId("offline_sync")}
              class={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap md:whitespace-normal transition-colors text-left cursor-pointer shrink-0 md:shrink ${
                activeSectionId() === "offline_sync"
                  ? "bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796]"
                  : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
              }`}
              data-testid="settings-nav-offline_sync"
              aria-selected={activeSectionId() === "offline_sync"}
            >
              <span class="shrink-0">{renderIcon("wifi-off")}</span>
              <span class="truncate">Offline & synchronization</span>
            </button>

            {/* ── Category 4: Calendars & Subscriptions ── */}
            <div class="pt-3 pb-1 px-3 text-[11px] font-bold uppercase tracking-wider text-[#9E725F] dark:text-[#D1A796] flex items-center gap-1.5 shrink-0">
              <span>Calendars & Subscriptions</span>
            </div>
            {/* Browse calendars of interest (Directly in settings!) */}
            <button
              type="button"
              onClick={() => setActiveSectionId("holiday_calendars")}
              class={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap md:whitespace-normal transition-colors text-left cursor-pointer shrink-0 md:shrink ${
                activeSectionId() === "holiday_calendars" || activeSectionId() === "browse_calendars"
                  ? "bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796]"
                  : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
              }`}
              data-testid="settings-nav-holiday_calendars"
              aria-selected={activeSectionId() === "holiday_calendars" || activeSectionId() === "browse_calendars"}
            >
              <span class="shrink-0">{renderIcon("globe")}</span>
              <span class="truncate">Browse calendars of interest</span>
            </button>
            {/* Create new calendar */}
            <button
              type="button"
              onClick={() => setActiveSectionId("add_create")}
              class={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap md:whitespace-normal transition-colors text-left cursor-pointer shrink-0 md:shrink ${
                activeSectionId() === "add_create"
                  ? "bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796]"
                  : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
              }`}
              data-testid="settings-nav-add_create"
              aria-selected={activeSectionId() === "add_create"}
            >
              <span class="shrink-0">{renderIcon("plus")}</span>
              <span class="truncate">Create new calendar</span>
            </button>
            {/* From URL */}
            <button
              type="button"
              onClick={() => setActiveSectionId("add_from_url")}
              class={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap md:whitespace-normal transition-colors text-left cursor-pointer shrink-0 md:shrink ${
                activeSectionId() === "add_from_url"
                  ? "bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796]"
                  : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
              }`}
              data-testid="settings-nav-add_from_url"
              aria-selected={activeSectionId() === "add_from_url"}
            >
              <span class="shrink-0">{renderIcon("link")}</span>
              <span class="truncate">From URL</span>
            </button>
            {/* Subscribe to calendar */}
            <button
              type="button"
              onClick={() => setActiveSectionId("add_subscribe")}
              class={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap md:whitespace-normal transition-colors text-left cursor-pointer shrink-0 md:shrink ${
                activeSectionId() === "add_subscribe"
                  ? "bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796]"
                  : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
              }`}
              data-testid="settings-nav-add_subscribe"
              aria-selected={activeSectionId() === "add_subscribe"}
            >
              <span class="shrink-0">{renderIcon("user-plus")}</span>
              <span class="truncate">Subscribe to calendar</span>
            </button>
            {/* Import & export */}
            <button
              type="button"
              onClick={() => setActiveSectionId("import_export")}
              class={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap md:whitespace-normal transition-colors text-left cursor-pointer shrink-0 md:shrink ${
                activeSectionId() === "import_export"
                  ? "bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796]"
                  : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
              }`}
              data-testid="settings-nav-import_export"
              aria-selected={activeSectionId() === "import_export"}
            >
              <span class="shrink-0">{renderIcon("download")}</span>
              <span class="truncate">Import & export</span>
            </button>

            {/* ── Category 5: Manage Calendars ── */}
            <div class="pt-3 pb-1 px-3 text-[11px] font-bold uppercase tracking-wider text-[#9E725F] dark:text-[#D1A796] flex items-center gap-1.5 shrink-0">
              <span>Manage Calendars</span>
            </div>
            <button
              type="button"
              onClick={() => setActiveSectionId("calendar_management")}
              class={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap md:whitespace-normal transition-colors text-left cursor-pointer shrink-0 md:shrink ${
                activeSectionId() === "calendar_management"
                  ? "bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796]"
                  : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
              }`}
              data-testid="settings-nav-calendar_management"
              aria-selected={activeSectionId() === "calendar_management"}
            >
              <span class="shrink-0">{renderIcon("layers")}</span>
              <span class="truncate">Calendar management</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSectionId("appointment_schedules")}
              class={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap md:whitespace-normal transition-colors text-left cursor-pointer shrink-0 md:shrink ${
                activeSectionId() === "appointment_schedules"
                  ? "bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796]"
                  : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
              }`}
              data-testid="settings-nav-appointment_schedules"
              aria-selected={activeSectionId() === "appointment_schedules"}
            >
              <span class="shrink-0">{renderIcon("calendar")}</span>
              <span class="truncate">Appointment scheduling</span>
            </button>
            <For each={props.calendars || []}>
              {(cal) => {
                const isCalActive = () => activeSectionId() === `cal_settings_${cal.id}`;
                return (
                  <button
                    type="button"
                    onClick={() => setActiveSectionId(`cal_settings_${cal.id}`)}
                    class={`flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap md:whitespace-normal transition-colors text-left cursor-pointer shrink-0 md:shrink ${
                      isCalActive()
                        ? "bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796] font-semibold"
                        : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
                    }`}
                    data-testid={`settings-nav-cal-${cal.id}`}
                  >
                    <span
                      class="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ "background-color": cal.color || "#9E725F" }}
                    />
                    <span class="truncate">{cal.name}</span>
                  </button>
                );
              }}
            </For>

            {/* ── Group 4: Settings for other calendars ── */}
            <Show when={holidaySubs().length > 0 || urlSubs().length > 0}>
              <div class="pt-3 pb-1 px-3 text-[11px] font-bold uppercase tracking-wider text-[#6F7173] dark:text-[#878A8E] hidden md:block">
                Settings for other calendars
              </div>
              <For each={holidaySubs()}>
                {(sub) => (
                  <button
                    type="button"
                    onClick={() => setActiveSectionId("holiday_calendars")}
                    class="flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-xs font-medium text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors text-left cursor-pointer truncate shrink-0 md:shrink"
                    data-testid={`settings-nav-sub-${sub.feedId}`}
                  >
                    <span
                      class="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ "background-color": sub.color }}
                    />
                    <span class="truncate">{sub.name}</span>
                  </button>
                )}
              </For>
            </Show>


                      
          </Show>

          {/* When searching, show search badge */}
          <Show when={isSearching()}>
            <div class="p-3 text-xs text-[#6F7173] dark:text-[#878A8E]">
              <span>Results: {filteredSettings().length} match "{searchQuery()}"</span>
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                class="block mt-2 text-[#9E725F] dark:text-[#D1A796] hover:underline font-semibold"
              >
                Clear search
              </button>
            </div>
          </Show>
        </nav>

        {/* ── Right Content Panel ── */}
        <main
          class="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-[#FAF9F5] dark:bg-[#18191D] custom-scrollbar"
          data-testid="calendar-settings-content"
        >
          <div class="max-w-3xl mx-auto space-y-6">

            {/* ══════════════════════════════════════════════════════════════════
                1. BROWSE CALENDARS OF INTEREST (Integrated inside Settings!)
               ══════════════════════════════════════════════════════════════════ */}
            <Show when={!isSearching() && (activeSectionId() === "holiday_calendars" || activeSectionId() === "browse_calendars")}>
              <div class="space-y-6" data-testid="settings-holiday-calendars-panel">
                {/* Section Title */}
                <div class="border-b border-[#E2DFD8] dark:border-[#2A2D35] pb-4">
                  <h2 class="text-lg sm:text-xl font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                    Browse Calendars of Interest
                  </h2>
                  <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-1">
                    Subscribe to national regional holidays across 200+ countries, world religious calendars, and astronomical lunar phases.
                  </p>
                </div>

                {/* Sub-Tabs: Regional, Religious, Other, Active */}
                <div class="flex items-center gap-1.5 p-1 rounded-xl bg-[#F0EEE9] dark:bg-[#2A2D35] text-xs font-semibold overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setBrowseTab("regional")}
                    class={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer shrink-0 ${
                      browseTab() === "regional"
                        ? "bg-white dark:bg-[#1E1F23] text-[#2B2C2D] dark:text-[#ECEBE8] shadow-2xs font-bold"
                        : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8]"
                    }`}
                    data-testid="browse-tab-regional"
                  >
                    Regional holidays ({allCountries().length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setBrowseTab("religious")}
                    class={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer shrink-0 ${
                      browseTab() === "religious"
                        ? "bg-white dark:bg-[#1E1F23] text-[#2B2C2D] dark:text-[#ECEBE8] shadow-2xs font-bold"
                        : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8]"
                    }`}
                    data-testid="browse-tab-religious"
                  >
                    Global religious ({religiousFeeds().length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setBrowseTab("other")}
                    class={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer shrink-0 ${
                      browseTab() === "other"
                        ? "bg-white dark:bg-[#1E1F23] text-[#2B2C2D] dark:text-[#ECEBE8] shadow-2xs font-bold"
                        : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8]"
                    }`}
                    data-testid="browse-tab-other"
                  >
                    Special & Sports ({otherFeeds().length + sportsFeeds().length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setBrowseTab("active")}
                    class={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer shrink-0 ${
                      browseTab() === "active"
                        ? "bg-white dark:bg-[#1E1F23] text-[#2B2C2D] dark:text-[#ECEBE8] shadow-2xs font-bold"
                        : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8]"
                    }`}
                    data-testid="browse-tab-active"
                  >
                    Active Subscriptions ({holidaySubs().length})
                  </button>
                </div>

                {/* ── Sub-tab 1: Regional Holidays (207 Countries) ── */}
                <Show when={browseTab() === "regional"}>
                  <div class="space-y-4">
                    {/* Filters: Search & Continent */}
                    <div class="flex flex-col sm:flex-row items-center gap-3">
                      <div class="relative flex-1 w-full">
                        <input
                          type="text"
                          placeholder="Search countries by name or code..."
                          value={countrySearch()}
                          onInput={(e) => setCountrySearch(e.currentTarget.value)}
                          class="w-full pl-8 pr-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] text-xs text-[#2B2C2D] dark:text-[#ECEBE8] placeholder-[#6F7173] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                          data-testid="country-search-input"
                        />
                        <svg
                          class="w-3.5 h-3.5 stroke-[#6F7173] fill-none stroke-[2] absolute left-2.5 top-1/2 -translate-y-1/2"
                          viewBox="0 0 24 24"
                        >
                          <circle cx="11" cy="11" r="8" />
                          <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                      </div>

                      <select
                        value={selectedContinent()}
                        onChange={(e) => setSelectedContinent(e.currentTarget.value)}
                        class="w-full sm:w-44 px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] text-xs text-[#2B2C2D] dark:text-[#ECEBE8] cursor-pointer"
                        data-testid="continent-filter-select"
                      >
                        <option value="all">All Continents</option>
                        <option value="Africa">Africa</option>
                        <option value="Americas">Americas</option>
                        <option value="Asia">Asia</option>
                        <option value="Europe">Europe</option>
                        <option value="Oceania">Oceania</option>
                      </select>
                    </div>

                    {/* Country List */}
                    <div class="bg-white dark:bg-[#1E1F23] rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] divide-y divide-[#E2DFD8] dark:divide-[#2A2D35] max-h-[500px] overflow-y-auto">
                      <For each={filteredCountries()}>
                        {(c) => {
                          const feedId = `holiday-${c.code.toLowerCase()}`;
                          const sub = () => getSubscription(feedId);
                          const isSub = () => isSubscribed(feedId);
                          const isExpanded = () => expandedPreviewFeedId() === feedId;

                          return (
                            <div class="p-3.5 sm:p-4 hover:bg-[#FAF9F5] dark:hover:bg-[#18191D] transition-colors">
                              <div class="flex items-center justify-between gap-3">
                                <label class="flex items-center gap-3 cursor-pointer min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={isSub()}
                                    onChange={() => handleToggleCountrySubscription(c.code)}
                                    class="w-4 h-4 rounded border-[#E2DFD8] text-[#9E725F] focus:ring-[#9E725F] cursor-pointer"
                                    data-testid={`toggle-country-${c.code}`}
                                  />
                                  <div class="min-w-0">
                                    <div class="flex items-center gap-2">
                                      <span class="text-xs sm:text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8] truncate">
                                        {c.name}
                                      </span>
                                      <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#F0EEE9] dark:bg-[#2A2D35] text-[#6F7173] dark:text-[#878A8E]">
                                        {c.code}
                                      </span>
                                      <span class="hidden sm:inline px-1.5 py-0.5 rounded text-[10px] text-[#6F7173] dark:text-[#878A8E]">
                                        {c.continent}
                                      </span>
                                    </div>
                                    <Show when={c.nativeName && c.nativeName !== c.name}>
                                      <span class="text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                                        {c.nativeName}
                                      </span>
                                    </Show>


                      
                                  </div>
                                </label>

                                <div class="flex items-center gap-2 shrink-0">
                                  {/* Observances Toggle if subscribed */}
                                  <Show when={isSub()}>
                                    <select
                                      value={sub()?.includeObservances ? "all" : "public_only"}
                                      onChange={() => handleToggleObservances(feedId)}
                                      class="text-[11px] px-2 py-1 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] cursor-pointer"
                                      data-testid={`country-observances-${c.code}`}
                                    >
                                      <option value="public_only">Public holidays only</option>
                                      <option value="all">Public holidays & observances</option>
                                    </select>
                                  </Show>


                      

                                  {/* Preview Holidays Toggle */}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedPreviewFeedId(isExpanded() ? null : feedId)
                                    }
                                    class="px-2.5 py-1 rounded-lg text-xs font-semibold text-[#9E725F] dark:text-[#D1A796] hover:bg-[#F2E8E2] dark:hover:bg-[#3D2E28] transition-colors cursor-pointer"
                                    data-testid={`preview-country-${c.code}`}
                                  >
                                    {isExpanded() ? "Hide" : "Preview"}
                                  </button>
                                </div>
                              </div>

                              {/* Expanded Preview Accordion */}
                              <Show when={isExpanded()}>
                                <div class="mt-3 pt-3 border-t border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] p-3 rounded-xl space-y-2">
                                  <div class="text-[11px] font-bold text-[#6F7173] dark:text-[#878A8E] uppercase tracking-wider">
                                    Upcoming 2026 Holidays in {c.name}:
                                  </div>
                                  <div class="max-h-48 overflow-y-auto divide-y divide-[#E2DFD8] dark:divide-[#2A2D35] text-xs">
                                    <For each={getFeedEvents(feedId, { year: 2026 })}>
                                      {(ev) => (
                                        <div class="py-1.5 flex items-center justify-between gap-2">
                                          <div class="min-w-0">
                                            <span class="font-semibold text-[#2B2C2D] dark:text-[#ECEBE8]">
                                              {ev.title}
                                            </span>
                                            <p class="text-[10px] text-[#6F7173] dark:text-[#878A8E] truncate">
                                              {ev.description}
                                            </p>
                                          </div>
                                          <div class="flex items-center gap-2 shrink-0">
                                            <span
                                              class={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                                ev.isPublicHoliday
                                                  ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200"
                                                  : "bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200"
                                              }`}
                                            >
                                              {ev.isPublicHoliday ? "Public" : "Observance"}
                                            </span>
                                            <span class="text-[11px] font-mono text-[#6F7173] dark:text-[#878A8E]">
                                              {ev.date}
                                            </span>
                                          </div>
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </div>
                              </Show>


                      
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  </div>
                </Show>


                      

                {/* ── Sub-tab 2: Global Religious Holidays ── */}
                <Show when={browseTab() === "religious"}>
                  <div class="space-y-4">
                    {/* Islamic Moon-Sighting Disclaimer Banner */}
                    <div
                      class="p-4 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex items-start gap-3"
                      data-testid="islamic-moon-sighting-banner"
                    >
                      <svg class="w-5 h-5 stroke-emerald-700 dark:stroke-emerald-400 fill-none stroke-[2] shrink-0 mt-0.5" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="16" x2="12" y2="12" />
                        <line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                      <div class="text-xs text-emerald-900 dark:text-emerald-200">
                        <span class="font-bold">Religious Calendar Honesty: </span>
                        Islamic calendar dates are calculated based on astronomical estimates. Actual observances may vary by 1–2 days subject to local lunar crescent moon-sighting confirmation.
                      </div>
                    </div>

                    {/* Religious Feeds Grid */}
                    <div class="grid grid-cols-1 gap-3">
                      <For each={religiousFeeds()}>
                        {(feed) => {
                          const isSub = () => isSubscribed(feed.id);
                          const isExpanded = () => expandedPreviewFeedId() === feed.id;

                          return (
                            <div class="p-4 rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] hover:border-[#DECBC1] transition-all">
                              <div class="flex items-start justify-between gap-3">
                                <label class="flex items-start gap-3 cursor-pointer min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={isSub()}
                                    onChange={() => handleToggleReligiousSubscription(feed)}
                                    class="w-4 h-4 mt-0.5 rounded border-[#E2DFD8] text-[#9E725F] focus:ring-[#9E725F] cursor-pointer"
                                    data-testid={`toggle-religion-${feed.regionOrTradition.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                                  />
                                  <div class="min-w-0">
                                    <div class="flex items-center gap-2">
                                      <span
                                        class="w-3 h-3 rounded-full shrink-0"
                                        style={{ "background-color": feed.defaultColor }}
                                      />
                                      <span class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                                        {feed.name}
                                      </span>
                                    </div>
                                    <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-1">
                                      {feed.description}
                                    </p>
                                    <Show when={feed.disclaimer}>
                                      <p class="text-[11px] text-amber-700 dark:text-amber-400 mt-1 italic">
                                        Note: {feed.disclaimer}
                                      </p>
                                    </Show>


                      
                                  </div>
                                </label>

                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedPreviewFeedId(isExpanded() ? null : feed.id)
                                  }
                                  class="px-2.5 py-1 rounded-lg text-xs font-semibold text-[#9E725F] dark:text-[#D1A796] hover:bg-[#F2E8E2] dark:hover:bg-[#3D2E28] transition-colors cursor-pointer shrink-0"
                                >
                                  {isExpanded() ? "Hide" : "Preview"}
                                </button>
                              </div>

                              {/* Expanded Preview Accordion */}
                              <Show when={isExpanded()}>
                                <div class="mt-3 pt-3 border-t border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] p-3 rounded-xl space-y-2">
                                  <div class="text-[11px] font-bold text-[#6F7173] dark:text-[#878A8E] uppercase tracking-wider">
                                    Holidays across 2026:
                                  </div>
                                  <div class="max-h-52 overflow-y-auto divide-y divide-[#E2DFD8] dark:divide-[#2A2D35] text-xs">
                                    <For each={feed.events}>
                                      {(ev) => (
                                        <div class="py-1.5 flex items-center justify-between gap-2">
                                          <div class="min-w-0">
                                            <span class="font-semibold text-[#2B2C2D] dark:text-[#ECEBE8]">
                                              {ev.title}
                                            </span>
                                            <p class="text-[10px] text-[#6F7173] dark:text-[#878A8E] truncate">
                                              {ev.description}
                                            </p>
                                          </div>
                                          <div class="flex items-center gap-2 shrink-0">
                                            <span class="text-[10px] px-1.5 py-0.5 rounded font-mono bg-[#EFECE6] dark:bg-[#2A2D35] text-[#6F7173] dark:text-[#A6A8AA]">
                                              {ev.dateType}
                                            </span>
                                            <span class="text-[11px] font-mono text-[#6F7173] dark:text-[#878A8E]">
                                              {ev.date}
                                            </span>
                                          </div>
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </div>
                              </Show>


                      
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  </div>
                </Show>


                      

                {/* ── Sub-tab 3: Special & Sports Calendars (Moon phases & Sports) ── */}
                <Show when={browseTab() === "other"}>
                  <div class="space-y-6">
                    {/* Astronomical Section */}
                    <div>
                      <div class="flex items-center gap-2 mb-3">
                        <span class="text-xs font-bold uppercase tracking-wider text-[#6F7173] dark:text-[#878A8E]">
                          Astronomical Observances
                        </span>
                        <div class="h-px flex-1 bg-[#E2DFD8] dark:bg-[#2A2D35]" />
                      </div>
                      <For each={otherFeeds()}>
                        {(feed) => {
                          const isSub = () => isSubscribed(feed.id);
                          const isExpanded = () => expandedPreviewFeedId() === feed.id;

                          return (
                            <div class="p-5 rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35]">
                              <div class="flex items-start justify-between gap-3">
                                <label class="flex items-start gap-3 cursor-pointer min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={isSub()}
                                    onChange={handleToggleMoonSubscription}
                                    class="w-4 h-4 mt-0.5 rounded border-[#E2DFD8] text-[#9E725F] focus:ring-[#9E725F] cursor-pointer"
                                    data-testid="toggle-other-moon"
                                  />
                                  <div class="min-w-0">
                                    <div class="flex items-center gap-2">
                                      <span class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                                        {feed.name}
                                      </span>
                                      <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#F0EEE9] dark:bg-[#2A2D35] text-[#6F7173] dark:text-[#878A8E]">
                                        Astronomical
                                      </span>
                                    </div>
                                    <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-1">
                                      {feed.description}
                                    </p>
                                    <div class="flex items-center gap-2 mt-2 text-[10px] text-[#6F7173] dark:text-[#878A8E] flex-wrap">
                                      <span>Source: {feed.provider}</span>
                                      <span>·</span>
                                      <span>Cadence: {feed.updateFrequency || "Continuous"}</span>
                                    </div>
                                  </div>
                                </label>

                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedPreviewFeedId(isExpanded() ? null : feed.id)
                                  }
                                  class="px-2.5 py-1 rounded-lg text-xs font-semibold text-[#9E725F] dark:text-[#D1A796] hover:bg-[#F2E8E2] dark:hover:bg-[#3D2E28] transition-colors cursor-pointer shrink-0"
                                  data-testid="preview-other-moon"
                                >
                                  {isExpanded() ? "Hide" : "Preview"}
                                </button>
                              </div>

                              <Show when={isExpanded()}>
                                <div class="mt-4 pt-3 border-t border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] p-3 rounded-xl space-y-2">
                                  <div class="text-[11px] font-bold text-[#6F7173] dark:text-[#878A8E] uppercase tracking-wider">
                                    2026 Primary Lunar Phases:
                                  </div>
                                  <div class="max-h-48 overflow-y-auto divide-y divide-[#E2DFD8] dark:divide-[#2A2D35] text-xs">
                                    <For each={feed.events}>
                                      {(ev) => (
                                        <div class="py-1.5 flex items-center justify-between">
                                          <span class="font-semibold text-[#2B2C2D] dark:text-[#ECEBE8]">
                                            {ev.title}
                                          </span>
                                          <span class="font-mono text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                                            {ev.date}
                                          </span>
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </div>
                              </Show>


                      
                            </div>
                          );
                        }}
                      </For>
                    </div>

                    {/* Sports Section */}
                    <div class="space-y-4">
                      <div class="flex items-center gap-2 mb-3">
                        <span class="text-xs font-bold uppercase tracking-wider text-[#6F7173] dark:text-[#878A8E]">
                          Sports Calendars & Major Tournaments
                        </span>
                        <div class="h-px flex-1 bg-[#E2DFD8] dark:bg-[#2A2D35]" />
                      </div>

                      <For each={sportsFeeds()}>
                        {(feed) => {
                          const isSub = () => isSubscribed(feed.id);
                          const isExpanded = () => expandedPreviewFeedId() === feed.id;

                          return (
                            <div
                              class="p-5 rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35]"
                              data-testid={`settings-sports-card-${feed.id}`}
                            >
                              <div class="flex items-start justify-between gap-3">
                                <label class="flex items-start gap-3 cursor-pointer min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={isSub()}
                                    onChange={() => handleToggleSportsSubscription(feed)}
                                    class="w-4 h-4 mt-0.5 rounded border-[#E2DFD8] text-[#9E725F] focus:ring-[#9E725F] cursor-pointer"
                                    data-testid={`toggle-sports-${feed.id}`}
                                  />
                                  <div class="min-w-0">
                                    <div class="flex items-center gap-2">
                                      <span
                                        class="w-3 h-3 rounded-full shrink-0"
                                        style={{ "background-color": feed.defaultColor }}
                                      />
                                      <span class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                                        {feed.name}
                                      </span>
                                      <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#F0EEE9] dark:bg-[#2A2D35] text-[#6F7173] dark:text-[#878A8E]">
                                        {feed.regionOrTradition}
                                      </span>
                                    </div>
                                    <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-1">
                                      {feed.description}
                                    </p>
                                    <div class="flex items-center gap-2 mt-2 text-[10px] text-[#6F7173] dark:text-[#878A8E] flex-wrap">
                                      <span>Source: {feed.provider}</span>
                                      <Show when={feed.updateFrequency}>
                                        <span>·</span>
                                        <span>Update: {feed.updateFrequency}</span>
                                      </Show>


                      
                                      <Show when={feed.regionalApplicability}>
                                        <span>·</span>
                                        <span>Scope: {feed.regionalApplicability}</span>
                                      </Show>


                      
                                    </div>
                                    <Show when={feed.disclaimer}>
                                      <p class="text-[11px] text-amber-700 dark:text-amber-400 mt-1 italic">
                                        Note: {feed.disclaimer}
                                      </p>
                                    </Show>


                      
                                  </div>
                                </label>

                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedPreviewFeedId(isExpanded() ? null : feed.id)
                                  }
                                  class="px-2.5 py-1 rounded-lg text-xs font-semibold text-[#9E725F] dark:text-[#D1A796] hover:bg-[#F2E8E2] dark:hover:bg-[#3D2E28] transition-colors cursor-pointer shrink-0"
                                  data-testid={`preview-sports-${feed.id}`}
                                >
                                  {isExpanded() ? "Hide" : "Preview"}
                                </button>
                              </div>

                              <Show when={isExpanded()}>
                                <div class="mt-4 pt-3 border-t border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] p-3 rounded-xl space-y-2">
                                  <div class="text-[11px] font-bold text-[#6F7173] dark:text-[#878A8E] uppercase tracking-wider">
                                    Upcoming 2026 Fixtures & Tournaments:
                                  </div>
                                  <div class="max-h-52 overflow-y-auto divide-y divide-[#E2DFD8] dark:divide-[#2A2D35] text-xs">
                                    <For each={feed.events}>
                                      {(ev) => (
                                        <div class="py-1.5 flex items-center justify-between gap-2">
                                          <div class="min-w-0">
                                            <span class="font-semibold text-[#2B2C2D] dark:text-[#ECEBE8]">
                                              {ev.title}
                                            </span>
                                            <p class="text-[10px] text-[#6F7173] dark:text-[#878A8E] truncate">
                                              {ev.description}
                                            </p>
                                          </div>
                                          <div class="flex items-center gap-2 shrink-0">
                                            <span class="font-mono text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                                              {ev.date}
                                            </span>
                                          </div>
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </div>
                              </Show>


                      
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  </div>
                </Show>


                      

                {/* ── Sub-tab 4: Active Subscriptions ── */}
                <Show when={browseTab() === "active"}>
                  <div class="p-5 rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-4">
                    <h3 class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                      Active Subscriptions ({holidaySubs().length})
                    </h3>

                    <Show
                      when={holidaySubs().length > 0}
                      fallback={
                        <div class="text-center py-8 text-xs text-[#6F7173] dark:text-[#878A8E] space-y-2">
                          <p>No holiday or religious feeds currently subscribed.</p>
                          <button
                            type="button"
                            onClick={() => setBrowseTab("regional")}
                            class="text-[#9E725F] dark:text-[#D1A796] font-semibold hover:underline"
                          >
                            Explore regional country catalogue
                          </button>
                        </div>
                      }
                    >
                      <div class="space-y-3">
                        <For each={holidaySubs()}>
                          {(sub) => (
                            <div
                              class="p-4 rounded-xl bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] flex flex-col gap-3"
                              data-testid={`settings-holiday-sub-${sub.feedId}`}
                            >
                              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div class="flex items-center gap-3">
                                  <span
                                    class="w-3.5 h-3.5 rounded-full shrink-0 shadow-2xs"
                                    style={{ "background-color": sub.color }}
                                  />
                                  <div>
                                    <span class="text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                                      {sub.name}
                                    </span>
                                    <p class="text-[10px] text-[#6F7173] dark:text-[#878A8E]">
                                      Subscribed on {new Date(sub.subscribedAt).toLocaleDateString()}
                                    </p>
                                  </div>
                                </div>

                                <div class="flex items-center gap-3 shrink-0 flex-wrap">
                                  {/* Color picker swatches */}
                                  <div class="flex items-center gap-1.5" title="Set holiday calendar color">
                                    <For each={["#9E725F", "#006A4E", "#059669", "#2563EB", "#4F46E5", "#D97706", "#DC2626", "#7C3AED"]}>
                                      {(c) => (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (props.mailboxId) {
                                              updateHolidaySubscriptionColor(props.mailboxId, sub.feedId, c);
                                              reloadHolidaySubs();
                                            }
                                          }}
                                          class={`w-3.5 h-3.5 rounded-full transition-transform cursor-pointer ${
                                            sub.color === c ? "ring-2 ring-offset-1 ring-[#9E725F] scale-110" : "hover:scale-105 opacity-80 hover:opacity-100"
                                          }`}
                                          style={{ "background-color": c }}
                                          title={`Change color to ${c}`}
                                          data-testid={`color-swatch-${sub.feedId}-${c.replace("#", "")}`}
                                        />
                                      )}
                                    </For>
                                  </div>

                                  <label class="flex items-center gap-2 cursor-pointer text-xs font-medium text-[#2B2C2D] dark:text-[#ECEBE8]">
                                    <input
                                      type="checkbox"
                                      checked={sub.includeObservances}
                                      onChange={() => handleToggleObservances(sub.feedId)}
                                      class="rounded border-[#E2DFD8] text-[#9E725F] focus:ring-[#9E725F] cursor-pointer"
                                      data-testid={`toggle-observances-${sub.feedId}`}
                                    />
                                    <span>Observances</span>
                                  </label>

                                  {/* Refresh provider button */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (props.mailboxId) {
                                        refreshHolidayFeed(props.mailboxId, sub.feedId);
                                        reloadHolidaySubs();
                                      }
                                    }}
                                    class="p-1.5 rounded-lg text-[#6F7173] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer"
                                    title="Refresh holiday data from provider"
                                    data-testid={`refresh-holiday-${sub.feedId}`}
                                  >
                                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                                      <polyline points="23 4 23 10 17 10" />
                                      <polyline points="1 20 1 14 7 14" />
                                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                                    </svg>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => handleUnsubscribe(sub.feedId)}
                                    class="px-2.5 py-1 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
                                    data-testid={`unsubscribe-holiday-${sub.feedId}`}
                                  >
                                    Unsubscribe
                                  </button>
                                </div>
                              </div>

                              {/* Hidden individual entries section */}
                              <Show when={sub.hiddenEventIds && sub.hiddenEventIds.length > 0}>
                                <div class="pt-2 border-t border-[#E2DFD8] dark:border-[#2A2D35]/60 flex flex-col gap-1.5 w-full">
                                  <div class="flex items-center justify-between">
                                    <span class="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                                      Hidden entries ({sub.hiddenEventIds.length})
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (props.mailboxId) {
                                          for (const hid of sub.hiddenEventIds) {
                                            restoreHolidayEvent(props.mailboxId, sub.feedId, hid);
                                          }
                                          reloadHolidaySubs();
                                        }
                                      }}
                                      class="text-[10px] text-[#9E725F] dark:text-[#D1A796] hover:underline font-semibold cursor-pointer"
                                      data-testid={`restore-all-holiday-${sub.feedId}`}
                                    >
                                      Restore all
                                    </button>
                                  </div>
                                  <div class="flex flex-wrap gap-1.5">
                                    <For each={sub.hiddenEventIds}>
                                      {(hiddenId) => (
                                        <div class="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-200">
                                          <span class="truncate max-w-[150px]">{hiddenId}</span>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              if (props.mailboxId) {
                                                restoreHolidayEvent(props.mailboxId, sub.feedId, hiddenId);
                                                reloadHolidaySubs();
                                              }
                                            }}
                                            class="font-bold text-[#9E725F] hover:text-[#865E4D] ml-1 cursor-pointer"
                                            title="Restore this entry"
                                            data-testid={`restore-holiday-btn-${hiddenId}`}
                                          >
                                            ↺ Restore
                                          </button>
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </div>
                              </Show>


                      
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>


                      
                  </div>
                </Show>


                      
              </div>
            </Show>


                      

            {/* ══════════════════════════════════════════════════════════════════
                2. CALENDAR MANAGEMENT (Owned Calendars & Overrides)
               ══════════════════════════════════════════════════════════════════ */}
            <Show when={!isSearching() && activeSectionId() === "calendar_management"}>
              <div class="space-y-6" data-testid="settings-calendar-management-panel">
                <div class="border-b border-[#E2DFD8] dark:border-[#2A2D35] pb-4 flex items-center justify-between">
                  <div>
                    <h2 class="text-lg font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                      Calendar Management
                    </h2>
                    <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-1">
                      Manage your owned calendars, reminder overrides, and subscribed feeds.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveSectionId("add_create")}
                    class="px-3.5 py-1.5 rounded-xl bg-[#9E725F] text-white text-xs font-semibold hover:bg-[#865E4D] transition-colors cursor-pointer"
                  >
                    + New Calendar
                  </button>
                </div>

                {/* My Calendars List */}
                <div class="p-5 rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-4">
                  <h3 class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                    My Calendars ({props.calendars?.length || 0})
                  </h3>

                  <div class="space-y-3">
                    <For each={props.calendars || []}>
                      {(cal) => (
                        <div class="p-4 rounded-xl bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div class="flex items-center gap-3">
                            <span
                              class="w-3.5 h-3.5 rounded-full shrink-0"
                              style={{ "background-color": cal.color || "#9E725F" }}
                            />
                            <div>
                              <div class="flex items-center gap-2">
                                <span class="text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                                  {cal.name}
                                </span>
                                <Show when={settings().defaultCalendarId === cal.id}>
                                  <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796]">
                                    Default
                                  </span>
                                </Show>


                      
                              </div>
                              <p class="text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                                {cal.description || "End-to-end encrypted personal calendar"}
                              </p>
                            </div>
                          </div>

                          <div class="flex items-center gap-3 shrink-0">
                            <label class="flex items-center gap-1.5 text-xs text-[#6F7173] dark:text-[#878A8E]">
                              <span>Reminder:</span>
                              <select
                                value={getCalReminderOverride(cal.id)}
                                onChange={(e) =>
                                  handleSetCalReminderOverride(cal.id, Number(e.currentTarget.value))
                                }
                                class="px-2 py-1 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] text-xs font-medium cursor-pointer"
                              >
                                <option value="0">At event start</option>
                                <option value="5">5 min before</option>
                                <option value="10">10 min before</option>
                                <option value="15">15 min before</option>
                                <option value="30">30 min before</option>
                                <option value="60">1 hour before</option>
                              </select>
                            </label>

                            <button
                              type="button"
                              onClick={() => updateSetting("defaultCalendarId", cal.id)}
                              disabled={settings().defaultCalendarId === cal.id}
                              class="px-2.5 py-1 rounded-lg text-xs font-semibold text-[#9E725F] dark:text-[#D1A796] hover:bg-[#F2E8E2] dark:hover:bg-[#3D2E28] disabled:opacity-40 transition-colors cursor-pointer"
                            >
                              Make default
                            </button>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </div>
            </Show>


                      

            {/* ══════════════════════════════════════════════════════════════════
                APPOINTMENT SCHEDULING (Category 12)
               ══════════════════════════════════════════════════════════════════ */}
            <Show when={!isSearching() && activeSectionId() === "appointment_schedules"}>
              <div class="space-y-6" data-testid="settings-appointment-schedules-panel">
                <div class="border-b border-[#E2DFD8] dark:border-[#2A2D35] pb-4 flex items-center justify-between">
                  <div>
                    <h2 class="text-lg font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                      Appointment Scheduling & Booking Pages
                    </h2>
                    <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-1">
                      Configure shareable booking pages, working hour constraints, buffers, and maximum daily appointments.
                    </p>
                  </div>
                  <Show when={props.onOpenAppointmentsManager}>
                    <button
                      type="button"
                      onClick={() => props.onOpenAppointmentsManager?.()}
                      class="px-3.5 py-1.5 rounded-xl bg-[#9E725F] text-white text-xs font-semibold hover:bg-[#865E4D] transition-colors cursor-pointer"
                      data-testid="open-appointments-manager-btn"
                    >
                      Manage Schedules
                    </button>
                  </Show>


                      
                </div>

                <div class="p-5 rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-4">
                  <div class="flex items-center justify-between">
                    <h3 class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                      Configured Schedules
                    </h3>
                  </div>

                  {(() => {
                    const schedules = props.mailboxId ? getAppointmentSchedules(props.mailboxId, settings().primaryTimeZone) : [];
                    return (
                      <div class="space-y-2">
                        <For each={schedules}>
                          {(sched) => (
                            <div class="p-3 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5]/50 dark:bg-[#141518]/50 flex items-center justify-between">
                              <div>
                                <div class="flex items-center gap-2">
                                  <span class="text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                                    {sched.title}
                                  </span>
                                  <span class="text-[10px] font-semibold text-[#9E725F]">
                                    {sched.durationMinutes}m
                                  </span>
                                  <span class={`text-[10px] font-semibold ${sched.isActive ? "text-emerald-600" : "text-neutral-500"}`}>
                                    {sched.isActive ? "Active" : "Paused"}
                                  </span>
                                </div>
                                <div class="text-[11px] text-[#6F7173] font-mono mt-0.5">
                                  /book/{sched.slug}
                                </div>
                              </div>
                              <Show when={props.onOpenAppointmentsManager}>
                                <button
                                  type="button"
                                  onClick={() => props.onOpenAppointmentsManager?.()}
                                  class="text-xs font-semibold text-[#9E725F] hover:underline cursor-pointer"
                                >
                                  Configure
                                </button>
                              </Show>


                      
                            </div>
                          )}
                        </For>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </Show>


                      

            {/* ══════════════════════════════════════════════════════════════════
                3. CREATE NEW CALENDAR (Add Calendar)
               ══════════════════════════════════════════════════════════════════ */}
            <Show when={!isSearching() && activeSectionId() === "add_create"}>
              <div class="space-y-6">
                <div class="border-b border-[#E2DFD8] dark:border-[#2A2D35] pb-4">
                  <h2 class="text-lg font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                    Create New Calendar
                  </h2>
                  <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-1">
                    Add a new independent end-to-end encrypted calendar to organize work, personal projects, or team schedules.
                  </p>
                </div>

                <div class="p-6 rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-4 max-w-xl">
                  <div>
                    <label class="block text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8] mb-1">
                      Calendar Name *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., Marketing Projects, Personal, Family"
                      value={newCalName()}
                      onInput={(e) => setNewCalName(e.currentTarget.value)}
                      class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                      data-testid="create-cal-name"
                    />
                  </div>

                  <div>
                    <label class="block text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8] mb-1">
                      Description
                    </label>
                    <textarea
                      placeholder="Brief note about the calendar's purpose"
                      value={newCalDesc()}
                      onInput={(e) => setNewCalDesc(e.currentTarget.value)}
                      rows={2}
                      class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                      data-testid="create-cal-desc"
                    />
                  </div>

                  <div>
                    <label class="block text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8] mb-1">
                      Time Zone
                    </label>
                    <select
                      value={newCalTz()}
                      onChange={(e) => setNewCalTz(e.currentTarget.value)}
                      class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs text-[#2B2C2D] dark:text-[#ECEBE8] cursor-pointer"
                      data-testid="create-cal-tz"
                    >
                      <option value="Asia/Dhaka">Asia/Dhaka (GMT+6)</option>
                      <option value="America/New_York">America/New_York (EST)</option>
                      <option value="Europe/London">Europe/London (GMT/BST)</option>
                      <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
                      <option value="UTC">UTC (Coordinated Universal Time)</option>
                    </select>
                  </div>

                  <Show when={createCalSuccess()}>
                    <div class="p-3 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-semibold">
                      Calendar created successfully!
                    </div>
                  </Show>


                      

                  <div class="pt-2 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setActiveSectionId("calendar_management")}
                      class="px-4 py-2 rounded-xl text-xs font-semibold text-[#6F7173] hover:bg-[#F0EEE9] cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (props.onOpenCreateCalendar) {
                          props.onOpenCreateCalendar();
                        } else {
                          setCreateCalSuccess(true);
                          setTimeout(() => setCreateCalSuccess(false), 3000);
                        }
                      }}
                      class="px-4 py-2 rounded-xl bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs font-bold shadow-xs cursor-pointer"
                      data-testid="create-cal-submit"
                    >
                      Create calendar
                    </button>
                  </div>
                </div>
              </div>
            </Show>


                      

            {/* ══════════════════════════════════════════════════════════════════
                4. SUBSCRIBE FROM URL (Add Calendar)
               ══════════════════════════════════════════════════════════════════ */}
            <Show when={!isSearching() && activeSectionId() === "add_from_url"}>
              <div class="space-y-6">
                <div class="border-b border-[#E2DFD8] dark:border-[#2A2D35] pb-4">
                  <h2 class="text-lg font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                    From URL (Subscribe to External Feed)
                  </h2>
                  <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-1">
                    Subscribe to any public or read-only iCalendar feed using webcal://, http://, or https://.
                  </p>
                </div>

                <form
                  onSubmit={handleSubscribeFromUrlSubmit}
                  class="p-6 rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-4 max-w-xl"
                >
                  <div>
                    <label class="block text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8] mb-1">
                      URL of Calendar *
                    </label>
                    <input
                      type="text"
                      placeholder="https://example.com/calendar.ics or webcal://..."
                      value={urlInput()}
                      onInput={(e) => setUrlInput(e.currentTarget.value)}
                      class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                      data-testid="subscribe-url-input"
                    />
                  </div>

                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label class="block text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8] mb-1">
                        Auto-Refresh
                      </label>
                      <select
                        value={urlRefresh()}
                        onChange={(e) => setUrlRefresh(e.currentTarget.value as any)}
                        class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs text-[#2B2C2D] dark:text-[#ECEBE8] cursor-pointer"
                        data-testid="subscribe-url-refresh"
                      >
                        <option value="hourly">Every hour</option>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                      </select>
                    </div>

                    <div>
                      <label class="block text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8] mb-1">
                        Calendar Color
                      </label>
                      <input
                        type="color"
                        value={urlColor()}
                        onInput={(e) => setUrlColor(e.currentTarget.value)}
                        class="h-9 w-full rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] p-1 cursor-pointer"
                      />
                    </div>
                  </div>

                  <Show when={urlError()}>
                    <div class="p-3 rounded-xl bg-rose-50 text-rose-800 text-xs font-semibold">
                      {urlError()}
                    </div>
                  </Show>


                      

                  <Show when={urlSuccess()}>
                    <div class="p-3 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-semibold">
                      Subscribed to URL calendar feed successfully!
                    </div>
                  </Show>


                      

                  <div class="pt-2 flex items-center justify-end gap-3">
                    <button
                      type="submit"
                      class="px-4 py-2 rounded-xl bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs font-bold shadow-xs cursor-pointer"
                      data-testid="subscribe-url-submit"
                    >
                      Add calendar
                    </button>
                  </div>
                </form>

                {/* Active Subscribed Feeds */}
                <div class="p-6 rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-4 max-w-xl" data-testid="subscribed-feeds-card">
                  <div class="flex items-center justify-between border-b border-[#E2DFD8] dark:border-[#2A2D35] pb-3">
                    <div>
                      <h3 class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                        Subscribed Calendar Feeds
                      </h3>
                      <p class="text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                        External read-only feeds updated automatically or on-demand.
                      </p>
                    </div>
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#F0EEE9] dark:bg-[#2A2D35] text-[#6F7173] dark:text-[#878A8E]">
                      {activeUrlSubscriptions().length} Active
                    </span>
                  </div>

                  <Show
                    when={activeUrlSubscriptions().length > 0}
                    fallback={
                      <div class="text-xs text-[#6F7173] dark:text-[#878A8E] py-4 text-center italic" data-testid="no-subscribed-feeds">
                        No external calendar feeds subscribed yet.
                      </div>
                    }
                  >
                    <div class="space-y-3">
                      <For each={activeUrlSubscriptions()}>
                        {(sub) => (
                          <div
                            class="p-3.5 rounded-xl bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-2.5"
                            data-testid={`subscribed-feed-item-${sub.id}`}
                          >
                            <div class="flex items-start justify-between gap-3">
                              <div class="flex items-center gap-2.5 min-w-0">
                                <span
                                  class="w-3 h-3 rounded-full shrink-0"
                                  style={{ "background-color": sub.color || "#3B82F6" }}
                                />
                                <div class="min-w-0">
                                  <span class="text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8] truncate block" data-testid="feed-name">
                                    {sub.name}
                                  </span>
                                  <span class="text-[11px] text-[#6F7173] dark:text-[#878A8E] font-mono truncate block max-w-xs" data-testid="feed-url">
                                    {sub.url}
                                  </span>
                                </div>
                              </div>

                              <div class="flex items-center gap-1.5 shrink-0">
                                <span
                                  class={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                    sub.isPaused
                                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                                      : "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200"
                                  }`}
                                  data-testid="feed-status-badge"
                                >
                                  {sub.isPaused ? "Paused" : "Read-Only"}
                                </span>
                              </div>
                            </div>

                            <div class="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#E2DFD8]/60 dark:border-[#2A2D35]/60 text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                              <div class="flex items-center gap-3">
                                <span data-testid="feed-event-count">
                                  {sub.cachedEvents?.length || 0} events
                                </span>
                                <span>•</span>
                                <span data-testid="feed-last-refreshed">
                                  {sub.lastRefreshed
                                    ? `Synced ${new Date(sub.lastRefreshed).toLocaleDateString([], { month: "short", day: "numeric" })}`
                                    : "Never synced"}
                                </span>
                              </div>

                              <div class="flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={refreshingFeedId() === sub.id}
                                  onClick={() => handleRefreshFeed(sub.id)}
                                  class="px-2 py-1 rounded-lg bg-white dark:bg-[#2A2D35] hover:bg-[#E2DFD8] text-[11px] font-semibold text-[#2B2C2D] dark:text-[#ECEBE8] border border-[#E2DFD8] dark:border-[#383B42] transition-colors cursor-pointer"
                                  data-testid={`feed-refresh-btn-${sub.id}`}
                                >
                                  {refreshingFeedId() === sub.id ? "Syncing..." : "Refresh"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handlePauseFeed(sub.id, !sub.isPaused)}
                                  class="px-2 py-1 rounded-lg bg-white dark:bg-[#2A2D35] hover:bg-[#E2DFD8] text-[11px] font-semibold text-[#2B2C2D] dark:text-[#ECEBE8] border border-[#E2DFD8] dark:border-[#383B42] transition-colors cursor-pointer"
                                  data-testid={`feed-pause-btn-${sub.id}`}
                                >
                                  {sub.isPaused ? "Resume" : "Pause"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUnsubscribeFeed(sub.id)}
                                  class="px-2 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 text-[11px] font-semibold text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900 transition-colors cursor-pointer"
                                  data-testid={`feed-unsubscribe-btn-${sub.id}`}
                                >
                                  Unsubscribe
                                </button>
                              </div>
                            </div>

                            <Show when={sub.errorMessage}>
                              <div class="p-2 rounded-lg bg-rose-50 text-rose-700 text-[11px] font-medium" data-testid="feed-error-msg">
                                {sub.errorMessage}
                              </div>
                            </Show>


                      
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>


                      
                </div>
              </div>
            </Show>


                      

            {/* ══════════════════════════════════════════════════════════════════
                5. SUBSCRIBE TO CALENDAR (Add Calendar by Email)
               ══════════════════════════════════════════════════════════════════ */}
            <Show when={!isSearching() && activeSectionId() === "add_subscribe"}>
              <div class="space-y-6">
                <div class="border-b border-[#E2DFD8] dark:border-[#2A2D35] pb-4">
                  <h2 class="text-lg font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                    Subscribe to Calendar
                  </h2>
                  <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-1">
                    Request access to a colleague's calendar by entering their email address.
                  </p>
                </div>

                <div class="p-6 rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-4 max-w-xl">
                  <div>
                    <label class="block text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8] mb-1">
                      Add Calendar by Email *
                    </label>
                    <input
                      type="email"
                      placeholder="e.g., bob@byos.local"
                      value={subscribeEmailInput()}
                      onInput={(e) => setSubscribeEmailInput(e.currentTarget.value)}
                      class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                      data-testid="subscribe-email-input"
                    />
                  </div>

                  <Show when={subscribeEmailSuccess()}>
                    <div class="p-3 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-semibold">
                      Calendar access request sent to {subscribeEmailInput()}!
                    </div>
                  </Show>


                      

                  <div class="pt-2 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (subscribeEmailInput().trim()) {
                          setSubscribeEmailSuccess(true);
                          setTimeout(() => setSubscribeEmailSuccess(false), 3000);
                        }
                      }}
                      class="px-4 py-2 rounded-xl bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs font-bold shadow-xs cursor-pointer"
                      data-testid="subscribe-email-submit"
                    >
                      Request access
                    </button>
                  </div>
                </div>
              </div>
            </Show>

            {/* ══════════════════════════════════════════════════════════════════
                5.1 IMPORT & EXPORT (Category 14 Dedicated View)
               ══════════════════════════════════════════════════════════════════ */}
            <Show when={!isSearching() && activeSectionId() === "import_export"}>
              <div class="space-y-6" data-testid="settings-import-export-panel">
                <div class="border-b border-[#E2DFD8] dark:border-[#2A2D35] pb-4">
                  <h2 class="text-lg sm:text-xl font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                    Import & Export
                  </h2>
                  <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-1">
                    Import events from or export your calendars to standard iCalendar (.ics) format with zero-knowledge client-side encryption.
                  </p>
                </div>

                <div class="space-y-6 max-w-2xl">
                  {/* Card 1: Import ICS */}
                  <div class="p-6 rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-4" data-testid="ics-import-card">
                    <div class="flex items-center gap-3">
                      <div class="p-2 rounded-xl bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796]">
                        {renderIcon("upload")}
                      </div>
                      <div>
                        <h3 class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                          Import Events
                        </h3>
                        <p class="text-xs text-[#6F7173] dark:text-[#878A8E]">
                          Select an iCalendar (.ics) file from your computer (max 512KB, 100 events).
                        </p>
                      </div>
                    </div>

                    <div class="space-y-3 pt-2">
                      <div>
                        <label class="block text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8] mb-1">
                          Select .ics file *
                        </label>
                        <input
                          type="file"
                          accept=".ics,text/calendar"
                          onChange={handleFileSelected}
                          class="w-full text-xs text-[#6F7173] dark:text-[#878A8E] file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-[#F0EEE9] dark:file:bg-[#2A2D35] file:text-[#2B2C2D] dark:file:text-[#ECEBE8] hover:file:bg-[#E2DFD8] cursor-pointer"
                          data-testid="ics-import-file-input"
                        />
                      </div>

                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label class="block text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8] mb-1">
                            Target Calendar
                          </label>
                          <select
                            value={importCalendarId()}
                            onChange={(e) => setImportCalendarId(e.currentTarget.value)}
                            class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs text-[#2B2C2D] dark:text-[#ECEBE8] cursor-pointer"
                            data-testid="ics-import-calendar-select"
                          >
                            <For each={props.calendars?.filter((c) => !c.is_shared || c.permission === "write") || []}>
                              {(cal) => <option value={cal.id}>{cal.name}</option>}
                            </For>
                          </select>
                        </div>

                        <div>
                          <label class="block text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8] mb-1">
                            Duplicate Handling
                          </label>
                          <select
                            value={importDuplicateMode()}
                            onChange={(e) => setImportDuplicateMode(e.currentTarget.value as any)}
                            class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs text-[#2B2C2D] dark:text-[#ECEBE8] cursor-pointer"
                            data-testid="ics-duplicate-handling"
                          >
                            <option value="update_duplicates">Update duplicates (overwrite matching UIDs)</option>
                            <option value="skip_duplicates">Skip duplicates (preserve existing)</option>
                          </select>
                        </div>
                      </div>

                      <Show when={importError()}>
                        <div class="p-3 rounded-xl bg-rose-50 text-rose-800 text-xs font-semibold" data-testid="ics-import-error">
                          {importError()}
                        </div>
                      </Show>

                      <Show when={importResult()}>
                        <div class="p-3 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-semibold" data-testid="ics-import-result">
                          Successfully imported {importResult()?.imported} event(s)
                          {importResult()?.updated ? ` (${importResult()?.updated} updated)` : ""}
                          {importResult()?.skipped ? ` (${importResult()?.skipped} skipped)` : ""}.
                        </div>
                      </Show>

                      <div class="pt-2 flex items-center justify-between">
                        <span class="text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                          Client-side parsed & encrypted before sync.
                        </span>
                        <button
                          type="button"
                          disabled={!importFileContent() || isImporting()}
                          onClick={handleExecuteImport}
                          class="px-4 py-2 rounded-xl bg-[#9E725F] hover:bg-[#865E4D] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold shadow-xs cursor-pointer"
                          data-testid="ics-import-submit-btn"
                        >
                          {isImporting() ? "Importing..." : "Import"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Export ICS */}
                  <div class="p-6 rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-4" data-testid="ics-export-card">
                    <div class="flex items-center gap-3">
                      <div class="p-2 rounded-xl bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796]">
                        {renderIcon("download")}
                      </div>
                      <div>
                        <h3 class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                          Export Calendars
                        </h3>
                        <p class="text-xs text-[#6F7173] dark:text-[#878A8E]">
                          Download standard iCalendar (.ics) files compatible with Google Calendar, Apple Calendar, and Outlook.
                        </p>
                      </div>
                    </div>

                    <div class="space-y-3 pt-2">
                      <div>
                        <label class="block text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8] mb-1">
                          Calendar to Export
                        </label>
                        <select
                          value={exportCalendarId()}
                          onChange={(e) => setExportCalendarId(e.currentTarget.value)}
                          class="w-full sm:w-80 px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs text-[#2B2C2D] dark:text-[#ECEBE8] cursor-pointer"
                          data-testid="ics-export-calendar-select"
                        >
                          <option value="all">All owned calendars (individual .ics downloads)</option>
                          <For each={props.calendars?.filter((c) => !c.is_shared) || []}>
                            {(cal) => <option value={cal.id}>{cal.name}</option>}
                          </For>
                        </select>
                      </div>

                      <Show when={exportSuccess()}>
                        <div class="p-3 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-semibold" data-testid="ics-export-result">
                          {exportSuccess()}
                        </div>
                      </Show>

                      <Show when={exportError()}>
                        <div class="p-3 rounded-xl bg-rose-50 text-rose-800 text-xs font-semibold" data-testid="ics-export-error">
                          {exportError()}
                        </div>
                      </Show>

                      <div class="pt-2 flex items-center justify-between">
                        <span class="text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                          Exports full recurrence rules, exceptions, and reminders.
                        </span>
                        <button
                          type="button"
                          disabled={isExporting()}
                          onClick={handleExecuteExport}
                          class="px-4 py-2 rounded-xl bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs font-bold shadow-xs cursor-pointer"
                          data-testid="ics-export-submit-btn"
                        >
                          {isExporting() ? "Exporting..." : "Export"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Show>


                      

            {/* ══════════════════════════════════════════════════════════════════
                6. TIME ZONES AND WORLD CLOCK (Category 05 Dedicated View)
               ══════════════════════════════════════════════════════════════════ */}
            <Show when={!isSearching() && activeSectionId() === "timezones"}>
              <div class="space-y-6" data-testid="settings-timezones-panel">
                {/* Section Header */}
                <div class="border-b border-[#E2DFD8] dark:border-[#2A2D35] pb-4">
                  <h2 class="text-lg sm:text-xl font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                    Time Zones & World Clock
                  </h2>
                  <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-1">
                    Manage primary scheduling time zone, dual-column view, location-aware travel prompts, and world clock cities.
                  </p>
                </div>

                <div class="space-y-4">
                  {/* Card 1: Primary Time Zone */}
                  <div class="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-3" data-testid="primary-tz-card">
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <div class="flex items-center gap-2">
                          <span class="text-xs sm:text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                            Primary time zone
                          </span>
                          <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#F0EEE9] dark:bg-[#2A2D35] text-[#6F7173] dark:text-[#878A8E]">
                            Global
                          </span>
                        </div>
                        <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-0.5">
                          Your canonical local time zone used for week, day, month grids, and event scheduling.
                        </p>
                      </div>
                      <div class="text-right shrink-0">
                        <span class="text-xs font-mono font-bold text-[#9E725F] dark:text-[#D4A38F]" data-testid="primary-tz-live-preview">
                          {formatZonedTime(new Date(), settings().primaryTimeZone, settings().timeFormat)}
                        </span>
                        <span class="block text-[10px] text-[#6F7173] dark:text-[#878A8E]" data-testid="primary-tz-abbr">
                          {getTimeZoneAbbr(new Date(), settings().primaryTimeZone)}
                        </span>
                      </div>
                    </div>

                    <div class="pt-1">
                      <select
                        value={settings().primaryTimeZone}
                        onChange={(e) => updateSetting("primaryTimeZone", e.currentTarget.value)}
                        class="w-full sm:w-80 px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs text-[#2B2C2D] dark:text-[#ECEBE8] cursor-pointer"
                        data-testid="settings-primary-tz-select"
                      >
                        <For each={SUPPORTED_TIMEZONES}>
                          {(tz) => (
                            <option value={tz.id}>
                              {tz.label}
                            </option>
                          )}
                        </For>
                      </select>
                    </div>
                  </div>

                  {/* Card 2: Secondary Time Zone */}
                  <div class="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-4" data-testid="secondary-tz-card">
                    <div class="flex items-center justify-between gap-3">
                      <div>
                        <div class="flex items-center gap-2">
                          <span class="text-xs sm:text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                            Secondary time zone
                          </span>
                          <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#F0EEE9] dark:bg-[#2A2D35] text-[#6F7173] dark:text-[#878A8E]">
                            Dual Gutter
                          </span>
                        </div>
                        <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-0.5">
                          Display a secondary time gutter alongside your primary time in week and day views.
                        </p>
                      </div>

                      <label class="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings().showSecondaryTimeZone}
                          onChange={(e) => updateSetting("showSecondaryTimeZone", e.currentTarget.checked)}
                          class="w-4 h-4 rounded border-[#E2DFD8] text-[#9E725F] focus:ring-[#9E725F] cursor-pointer"
                          data-testid="settings-secondary-tz-toggle"
                        />
                        <span class="text-xs font-semibold text-[#2B2C2D] dark:text-[#ECEBE8]">
                          {settings().showSecondaryTimeZone ? "Enabled" : "Disabled"}
                        </span>
                      </label>
                    </div>

                    <Show when={settings().showSecondaryTimeZone}>
                      <div class="pt-3 border-t border-[#E2DFD8]/60 dark:border-[#2A2D35]/60 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label class="block text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8] mb-1">
                            Secondary time zone
                          </label>
                          <select
                            value={settings().secondaryTimeZone}
                            onChange={(e) => updateSetting("secondaryTimeZone", e.currentTarget.value)}
                            class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs text-[#2B2C2D] dark:text-[#ECEBE8] cursor-pointer"
                            data-testid="settings-secondary-tz-select"
                          >
                            <For each={SUPPORTED_TIMEZONES}>
                              {(tz) => (
                                <option value={tz.id}>
                                  {tz.label}
                                </option>
                              )}
                            </For>
                          </select>
                        </div>

                        <div>
                          <label class="block text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8] mb-1">
                            Column label (short code)
                          </label>
                          <div class="flex items-center gap-2">
                            <input
                              type="text"
                              value={settings().secondaryTimeZoneLabel}
                              onInput={(e) => updateSetting("secondaryTimeZoneLabel", e.currentTarget.value)}
                              placeholder="e.g. NYC, LON, SFO"
                              class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs text-[#2B2C2D] dark:text-[#ECEBE8]"
                              data-testid="settings-secondary-tz-label-input"
                              maxLength={6}
                            />
                            <button
                              type="button"
                              onClick={handleSwapTimezones}
                              class="px-3 py-2 rounded-xl bg-[#F0EEE9] dark:bg-[#2A2D35] hover:bg-[#E2DFD8] text-xs font-semibold text-[#2B2C2D] dark:text-[#ECEBE8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
                              title="Swap primary and secondary time zones"
                              data-testid="swap-timezones-btn"
                            >
                              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                                <path d="M7 16V4M7 4L3 8M7 4L11 8M17 8V20M17 20L21 16M17 20L13 16" />
                              </svg>
                              <span>Swap</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </Show>


                      
                  </div>

                  {/* Card 3: Location Travel Consent */}
                  <div class="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-3" data-testid="travel-consent-card">
                    <div class="flex items-center justify-between gap-3">
                      <div>
                        <div class="flex items-center gap-2">
                          <span class="text-xs sm:text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                            Ask to update time zone when travelling
                          </span>
                          <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#F0EEE9] dark:bg-[#2A2D35] text-[#6F7173] dark:text-[#878A8E]">
                            Opt-in
                          </span>
                        </div>
                        <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-0.5">
                          Prompt to adjust your primary time zone when your browser location differs from your calendar settings.
                        </p>
                      </div>

                      <label class="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings().autoUpdateTimeZoneWithConsent}
                          onChange={(e) => updateSetting("autoUpdateTimeZoneWithConsent", e.currentTarget.checked)}
                          class="w-4 h-4 rounded border-[#E2DFD8] text-[#9E725F] focus:ring-[#9E725F] cursor-pointer"
                          data-testid="settings-travel-consent-toggle"
                        />
                        <span class="text-xs font-semibold text-[#2B2C2D] dark:text-[#ECEBE8]">
                          {settings().autoUpdateTimeZoneWithConsent ? "Prompt" : "Don't prompt"}
                        </span>
                      </label>
                    </div>
                    <div class="p-2.5 rounded-xl bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8]/60 dark:border-[#2A2D35]/60 text-[11px] text-[#6F7173] dark:text-[#878A8E] flex items-center gap-2">
                      <svg class="w-3.5 h-3.5 text-[#9E725F] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>BYOS will never silently alter your calendar time zone without your explicit consent.</span>
                    </div>
                  </div>

                  {/* Card 4: World Clock */}
                  <div class="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-4" data-testid="world-clock-settings-card">
                    <div class="flex items-center justify-between gap-3">
                      <div>
                        <div class="flex items-center gap-2">
                          <span class="text-xs sm:text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                            World clock
                          </span>
                          <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#F0EEE9] dark:bg-[#2A2D35] text-[#6F7173] dark:text-[#878A8E]">
                            Sidebar Widget
                          </span>
                        </div>
                        <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-0.5">
                          Keep track of local times in global cities directly from your calendar sidebar.
                        </p>
                      </div>

                      <label class="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings().showWorldClock !== false}
                          onChange={(e) => updateSetting("showWorldClock", e.currentTarget.checked)}
                          class="w-4 h-4 rounded border-[#E2DFD8] text-[#9E725F] focus:ring-[#9E725F] cursor-pointer"
                          data-testid="settings-show-world-clock-toggle"
                        />
                        <span class="text-xs font-semibold text-[#2B2C2D] dark:text-[#ECEBE8]">
                          {settings().showWorldClock !== false ? "Visible" : "Hidden"}
                        </span>
                      </label>
                    </div>

                    {/* City List */}
                    <div class="space-y-2 pt-2 border-t border-[#E2DFD8]/60 dark:border-[#2A2D35]/60" data-testid="world-clock-manager-list">
                      <For each={settings().worldClockCities || []}>
                        {(city, idx) => {
                          const timeInfo = () => getWorldClockCityTime(city, new Date(), settings().timeFormat);
                          return (
                            <div
                              class="p-3 rounded-xl bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] flex items-center justify-between gap-3"
                              data-testid={`world-clock-item-${city.id}`}
                            >
                              <div class="flex items-center gap-3 min-w-0">
                                <div class="flex flex-col gap-0.5">
                                  <button
                                    type="button"
                                    disabled={idx() === 0}
                                    onClick={() => handleMoveCity(city.id, "up")}
                                    class="p-0.5 rounded hover:bg-[#E2DFD8] dark:hover:bg-[#2A2D35] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                    title="Move up"
                                    data-testid={`move-city-up-${city.id}`}
                                  >
                                    <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                                      <polyline points="18 15 12 9 6 15" />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={idx() === (settings().worldClockCities?.length || 1) - 1}
                                    onClick={() => handleMoveCity(city.id, "down")}
                                    class="p-0.5 rounded hover:bg-[#E2DFD8] dark:hover:bg-[#2A2D35] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                    title="Move down"
                                    data-testid={`move-city-down-${city.id}`}
                                  >
                                    <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                                      <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                  </button>
                                </div>
                                <div class="min-w-0">
                                  <div class="flex items-center gap-2">
                                    <span class="text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8] truncate" data-testid={`city-label-${city.id}`}>
                                      {city.label}
                                    </span>
                                    <span class="text-[10px] text-[#6F7173] dark:text-[#878A8E] truncate">
                                      ({city.timeZone})
                                    </span>
                                  </div>
                                  <span class="text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                                    {timeInfo().abbr} {timeInfo().dayDiff ? `· ${timeInfo().dayDiff}` : ""}
                                  </span>
                                </div>
                              </div>

                              <div class="flex items-center gap-3 shrink-0">
                                <span class="text-xs font-bold font-mono text-[#2B2C2D] dark:text-[#ECEBE8]" data-testid={`city-time-${city.id}`}>
                                  {timeInfo().timeStr}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveWorldClockCity(city.id)}
                                  class="p-1 rounded-lg text-[#6F7173] hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                                  title={`Remove ${city.label}`}
                                  data-testid={`remove-city-${city.id}`}
                                >
                                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          );
                        }}
                      </For>
                    </div>

                    {/* Add City Controls */}
                    <div class="pt-3 border-t border-[#E2DFD8]/60 dark:border-[#2A2D35]/60 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                      <Show
                        when={isAddingCustomCity()}
                        fallback={
                          <>
                            <select
                              value={selectedCityPreset()}
                              onChange={(e) => setSelectedCityPreset(e.currentTarget.value)}
                              class="flex-1 px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs text-[#2B2C2D] dark:text-[#ECEBE8] cursor-pointer"
                              data-testid="world-clock-preset-select"
                            >
                              <For each={PRESET_WORLD_CLOCK_CITIES}>
                                {(p) => <option value={p.id}>{p.label} ({p.timeZone})</option>}
                              </For>
                            </select>
                            <button
                              type="button"
                              onClick={handleAddPresetCity}
                              class="px-4 py-2 rounded-xl bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs font-bold shadow-xs cursor-pointer"
                              data-testid="add-city-btn"
                            >
                              Add city
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsAddingCustomCity(true)}
                              class="px-3 py-2 text-xs font-semibold text-[#6F7173] hover:text-[#2B2C2D] cursor-pointer"
                              data-testid="toggle-custom-city-btn"
                            >
                              Custom...
                            </button>
                          </>
                        }
                      >
                        <input
                          type="text"
                          placeholder="City name..."
                          value={customCityLabel()}
                          onInput={(e) => setCustomCityLabel(e.currentTarget.value)}
                          class="flex-1 px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs text-[#2B2C2D] dark:text-[#ECEBE8]"
                          data-testid="custom-city-name-input"
                        />
                        <select
                          value={customCityTz()}
                          onChange={(e) => setCustomCityTz(e.currentTarget.value)}
                          class="flex-1 px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs text-[#2B2C2D] dark:text-[#ECEBE8] cursor-pointer"
                          data-testid="custom-city-tz-select"
                        >
                          <For each={SUPPORTED_TIMEZONES}>
                            {(tz) => <option value={tz.id}>{tz.label}</option>}
                          </For>
                        </select>
                        <button
                          type="button"
                          onClick={handleAddCustomCity}
                          class="px-4 py-2 rounded-xl bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs font-bold shadow-xs cursor-pointer"
                          data-testid="add-custom-city-btn"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsAddingCustomCity(false)}
                          class="px-3 py-2 text-xs font-semibold text-[#6F7173] hover:bg-[#F0EEE9] rounded-xl cursor-pointer"
                        >
                          Cancel
                        </button>
                      </Show>


                      
                    </div>
                  </div>
                </div>
              </div>
            </Show>


                      

            {/* ══════════════════════════════════════════════════════════════════
                7. STANDARD GENERAL REGISTRY SETTINGS (All Remaining Sections)
               ══════════════════════════════════════════════════════════════════ */}
            <Show
              when={
                !isSearching() &&
                activeSectionId() !== "holiday_calendars" &&
                activeSectionId() !== "browse_calendars" &&
                activeSectionId() !== "calendar_management" &&
                activeSectionId() !== "appointment_schedules" &&
                activeSectionId() !== "add_create" &&
                activeSectionId() !== "add_from_url" &&
                activeSectionId() !== "add_subscribe" &&
                activeSectionId() !== "timezones" &&
                activeSectionId() !== "import_export" &&
                !activeSectionId().startsWith("cal_settings_")
              }
            >
              <div class="space-y-6">
                {/* Section Header */}
                <div class="border-b border-[#E2DFD8] dark:border-[#2A2D35] pb-4">
                  <div class="flex items-center gap-3">
                    <div class="p-2 rounded-xl bg-[#F0EEE9] dark:bg-[#2A2D35] text-[#9E725F] dark:text-[#D1A796]">
                      {renderIcon(
                        CALENDAR_SETTING_SECTIONS.find((s) => s.id === activeSectionId())?.iconName || "settings"
                      )}
                    </div>
                    <div>
                      <h2 class="text-lg font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                        {CALENDAR_SETTING_SECTIONS.find((s) => s.id === activeSectionId())?.title}
                      </h2>
                      <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-0.5">
                        {CALENDAR_SETTING_SECTIONS.find((s) => s.id === activeSectionId())?.description}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Clean Grouped Settings Card */}
                <div class="bg-white dark:bg-[#1E1F23] rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] overflow-hidden divide-y divide-[#E2DFD8]/60 dark:divide-[#2A2D35]/60 shadow-xs">
                  <For each={activeSectionSettings()}>
                    {(def) => {
                      const val = () => (settings() as any)[def.id];

                      return (
                        <div
                          class="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors hover:bg-[#FAF9F5]/40 dark:hover:bg-[#25282F]/20"
                          data-testid={`setting-item-${def.id}`}
                        >
                          <div class="max-w-md pr-2">
                            <span class="text-xs sm:text-sm font-semibold text-[#2B2C2D] dark:text-[#ECEBE8] block">
                              {def.label}
                            </span>
                            <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-0.5 leading-relaxed">
                              {def.description}
                            </p>
                          </div>

                          {/* Interactive Control */}
                          <div class="shrink-0 flex items-center justify-start sm:justify-end">
                            <Show when={def.type === "select"}>
                              <select
                                value={val()}
                                onChange={(e) => updateSetting(def.id as keyof CalendarSettings, e.currentTarget.value as any)}
                                class="w-full sm:w-64 px-3 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs font-medium text-[#2B2C2D] dark:text-[#ECEBE8] cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                                data-testid={
                                  def.id === "weekStart" || def.id === "timeFormat" || def.id === "defaultView"
                                    ? `select-${def.id}`
                                    : `setting-input-${def.id}`
                                }
                              >
                                <For each={def.options}>
                                  {(opt) => <option value={opt.value as any}>{opt.label}</option>}
                                </For>
                              </select>
                              <Show when={def.id === "weekStart" || def.id === "timeFormat" || def.id === "defaultView"}>
                                <select class="sr-only pointer-events-none" data-testid={`setting-input-${def.id}`} tabIndex={-1} aria-hidden="true">
                                  <For each={def.options}>
                                    {(opt) => <option value={opt.value as any}>{opt.label}</option>}
                                  </For>
                                </select>
                              </Show>
                            </Show>

                            <Show when={def.type === "number"}>
                              <div class="flex items-center gap-2">
                                <input
                                  type="number"
                                  min={(def as any).min ?? 1}
                                  max={(def as any).max ?? 1440}
                                  step={(def as any).step ?? 5}
                                  value={val()}
                                  onInput={(e) => updateSetting(def.id as keyof CalendarSettings, Number(e.currentTarget.value) as any)}
                                  class="w-24 px-3 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs font-medium text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                                  data-testid={`setting-input-${def.id}`}
                                />
                                <span class="text-xs text-[#6F7173] dark:text-[#878A8E]">minutes</span>
                              </div>
                            </Show>

                            <Show when={def.type === "text"}>
                              <input
                                type="text"
                                value={val() || ""}
                                onInput={(e) => updateSetting(def.id as keyof CalendarSettings, e.currentTarget.value as any)}
                                class="w-full sm:w-72 px-3 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs font-medium text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                                data-testid={`setting-input-${def.id}`}
                              />
                            </Show>

                            <Show when={def.type === "toggle" || (def.type as any) === "boolean"}>
                              <label class="inline-flex items-center gap-2.5 cursor-pointer select-none" data-testid={`toggle-${def.id}`}>
                                <input
                                  type="checkbox"
                                  checked={Boolean(val())}
                                  onChange={(e) => updateSetting(def.id as keyof CalendarSettings, e.currentTarget.checked as any)}
                                  class="w-4 h-4 rounded border-[#E2DFD8] dark:border-[#3A3D45] text-[#9E725F] accent-[#9E725F] focus:ring-1 focus:ring-[#9E725F] cursor-pointer"
                                  data-testid={`setting-input-${def.id}`}
                                />
                                <span class="text-xs font-medium text-[#6F7173] dark:text-[#878A8E]">
                                  {val() ? "Enabled" : "Disabled"}
                                </span>
                              </label>
                            </Show>
                          </div>
                        </div>
                      );
                    }}
                  </For>

                  {/* Dedicated CalDAV Protocol Info Card when activeSectionId === "offline_sync" */}
                  <Show when={activeSectionId() === "offline_sync"}>
                    <div class="p-5 sm:p-6 rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-4" data-testid="caldav-info-card">
                      <div class="flex items-start justify-between gap-3 border-b border-[#E2DFD8] dark:border-[#2A2D35] pb-4">
                        <div>
                          <div class="flex items-center gap-2">
                            <span class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                              CalDAV Synchronization Protocol
                            </span>
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" data-testid="caldav-status-badge">
                              Ready (RFC 4791 / RFC 6578)
                            </span>
                          </div>
                          <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-1">
                            Synchronize your BYOS calendars natively with Apple Calendar, Mozilla Thunderbird, and Android DAVx⁵.
                          </p>
                        </div>
                      </div>

                      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                        <div class="p-3 rounded-xl bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-1">
                          <span class="font-bold text-[#2B2C2D] dark:text-[#ECEBE8] block">
                            CalDAV Server Endpoint
                          </span>
                          <code class="font-mono text-[11px] text-[#9E725F] dark:text-[#D4A38F] break-all select-all block" data-testid="caldav-server-url">
                            {calDavServerUrl()}
                          </code>
                          <span class="text-[10px] text-[#6F7173] dark:text-[#878A8E] block">
                            Auto-discovery redirects from /.well-known/caldav
                          </span>
                        </div>

                        <div class="p-3 rounded-xl bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-1">
                          <span class="font-bold text-[#2B2C2D] dark:text-[#ECEBE8] block">
                            Principal URL
                          </span>
                          <code class="font-mono text-[11px] text-[#9E725F] dark:text-[#D4A38F] break-all select-all block" data-testid="caldav-principal-url">
                            {calDavPrincipalUrl()}
                          </code>
                          <span class="text-[10px] text-[#6F7173] dark:text-[#878A8E] block">
                            RFC 3744 Principal Resource
                          </span>
                        </div>
                      </div>

                      {/* Step-by-Step Client Setup Guides */}
                      <div class="space-y-3 pt-2 border-t border-[#E2DFD8]/60 dark:border-[#2A2D35]/60" data-testid="caldav-client-instructions">
                        <h4 class="text-xs font-bold uppercase tracking-wider text-[#6F7173] dark:text-[#878A8E]">
                          Step-by-Step Client Setup Guides
                        </h4>

                        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                          {/* Apple Calendar */}
                          <div class="p-3 rounded-xl bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-2">
                            <div class="flex items-center gap-1.5 font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                              <svg class="w-4 h-4 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                                <line x1="8" y1="21" x2="16" y2="21" />
                                <line x1="12" y1="17" x2="12" y2="21" />
                              </svg>
                              <span>Apple Calendar</span>
                            </div>
                            <ol class="list-decimal list-inside space-y-1 text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                              <li>Open System Settings &gt; Internet Accounts</li>
                              <li>Click Add Account &gt; Add Other &gt; CalDAV</li>
                              <li>Choose <strong>Manual</strong></li>
                              <li>Username: your BYOS email</li>
                              <li>Password: your login password</li>
                              <li>Server: your BYOS host URL</li>
                            </ol>
                          </div>

                          {/* Thunderbird */}
                          <div class="p-3 rounded-xl bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-2">
                            <div class="flex items-center gap-1.5 font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                              <svg class="w-4 h-4 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                              </svg>
                              <span>Mozilla Thunderbird</span>
                            </div>
                            <ol class="list-decimal list-inside space-y-1 text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                              <li>Go to Calendar &gt; New Calendar</li>
                              <li>Select <strong>On the Network</strong></li>
                              <li>Username: your BYOS email</li>
                              <li>Location: paste CalDAV Server URL</li>
                              <li>Click Find Calendars &amp; authenticate</li>
                            </ol>
                          </div>

                          {/* DAVx5 */}
                          <div class="p-3 rounded-xl bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-2">
                            <div class="flex items-center gap-1.5 font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                              <svg class="w-4 h-4 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                                <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                                <line x1="12" y1="18" x2="12.01" y2="18" />
                              </svg>
                              <span>DAVx⁵ (Android)</span>
                            </div>
                            <ol class="list-decimal list-inside space-y-1 text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                              <li>Open DAVx⁵ &gt; Add Account</li>
                              <li>Select <strong>Login with URL and user name</strong></li>
                              <li>Base URL: paste CalDAV Server URL</li>
                              <li>User name: your BYOS email</li>
                              <li>Password: your login password</li>
                            </ol>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Show>
                </div>
              </div>
            </Show>


                      

            {/* ══════════════════════════════════════════════════════════════════
                7. SEARCH RESULTS VIEW (When search is active)
               ══════════════════════════════════════════════════════════════════ */}
            <Show when={isSearching()}>
              <div class="space-y-4">
                <div class="border-b border-[#E2DFD8] dark:border-[#2A2D35] pb-3">
                  <h2 class="text-base font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                    Search Results ({filteredSettings().length})
                  </h2>
                </div>

                <div class="bg-white dark:bg-[#1E1F23] rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] overflow-hidden divide-y divide-[#E2DFD8]/60 dark:divide-[#2A2D35]/60 shadow-xs">
                  <For each={filteredSettings()}>
                    {(def) => {
                      const val = () => (settings() as any)[def.id];
                      return (
                        <div
                          class="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors hover:bg-[#FAF9F5]/40 dark:hover:bg-[#25282F]/20"
                          data-testid={`setting-item-${def.id}`}
                        >
                          <div class="max-w-md pr-2">
                            <span class="text-xs sm:text-sm font-semibold text-[#2B2C2D] dark:text-[#ECEBE8] block">
                              {def.label}
                            </span>
                            <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-0.5 leading-relaxed">
                              {def.description}
                            </p>
                          </div>

                          <div class="shrink-0 flex items-center justify-start sm:justify-end">
                            <Show when={def.type === "select"}>
                              <select
                                value={val()}
                                onChange={(e) => updateSetting(def.id as keyof CalendarSettings, e.currentTarget.value as any)}
                                class="w-full sm:w-64 px-3 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs font-medium text-[#2B2C2D] dark:text-[#ECEBE8] cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                                data-testid={
                                  def.id === "weekStart" || def.id === "timeFormat" || def.id === "defaultView"
                                    ? `select-${def.id}`
                                    : `setting-input-${def.id}`
                                }
                              >
                                <For each={def.options}>
                                  {(opt) => <option value={opt.value as any}>{opt.label}</option>}
                                </For>
                              </select>
                              <Show when={def.id === "weekStart" || def.id === "timeFormat" || def.id === "defaultView"}>
                                <select class="sr-only pointer-events-none" data-testid={`setting-input-${def.id}`} tabIndex={-1} aria-hidden="true">
                                  <For each={def.options}>
                                    {(opt) => <option value={opt.value as any}>{opt.label}</option>}
                                  </For>
                                </select>
                              </Show>
                            </Show>

                            <Show when={def.type === "number"}>
                              <div class="flex items-center gap-2">
                                <input
                                  type="number"
                                  min={(def as any).min ?? 1}
                                  max={(def as any).max ?? 1440}
                                  step={(def as any).step ?? 5}
                                  value={val()}
                                  onInput={(e) => updateSetting(def.id as keyof CalendarSettings, Number(e.currentTarget.value) as any)}
                                  class="w-24 px-3 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs font-medium text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                                  data-testid={`setting-input-${def.id}`}
                                />
                                <span class="text-xs text-[#6F7173] dark:text-[#878A8E]">minutes</span>
                              </div>
                            </Show>

                            <Show when={def.type === "text"}>
                              <input
                                type="text"
                                value={val() || ""}
                                onInput={(e) => updateSetting(def.id as keyof CalendarSettings, e.currentTarget.value as any)}
                                class="w-full sm:w-72 px-3 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs font-medium text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                                data-testid={`setting-input-${def.id}`}
                              />
                            </Show>

                            <Show when={def.type === "toggle" || (def.type as any) === "boolean"}>
                              <label class="inline-flex items-center gap-2.5 cursor-pointer select-none" data-testid={`toggle-${def.id}`}>
                                <input
                                  type="checkbox"
                                  checked={Boolean(val())}
                                  onChange={(e) => updateSetting(def.id as keyof CalendarSettings, e.currentTarget.checked as any)}
                                  class="w-4 h-4 rounded border-[#E2DFD8] dark:border-[#3A3D45] text-[#9E725F] accent-[#9E725F] focus:ring-1 focus:ring-[#9E725F] cursor-pointer"
                                  data-testid={`setting-input-${def.id}`}
                                />
                                <span class="text-xs font-medium text-[#6F7173] dark:text-[#878A8E]">
                                  {val() ? "Enabled" : "Disabled"}
                                </span>
                              </label>
                            </Show>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>
            </Show>


                      

          </div>
        </main>
      </div>

      {/* Reset Confirmation Modal */}
      <Show when={showResetConfirm()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          data-testid="calendar-settings-reset-confirm"
        >
          <div class="bg-white dark:bg-[#1E1F23] rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] shadow-xl max-w-sm w-full p-5 space-y-4">
            <h3 class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
              Reset Calendar Settings?
            </h3>
            <p class="text-xs text-[#6F7173] dark:text-[#878A8E] leading-relaxed">
              This will restore all general preferences, event defaults, and view options to their initial standard values.
            </p>
            <div class="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                class="px-3 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] text-xs font-semibold text-[#6F7173] hover:bg-[#FAF9F5] dark:hover:bg-[#25282F] transition-colors cursor-pointer"
                data-testid="calendar-settings-cancel-reset-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  resetToDefaults();
                  setShowResetConfirm(false);
                }}
                class="px-3 py-1.5 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-colors cursor-pointer"
                data-testid="calendar-settings-confirm-reset-btn"
              >
                Reset to defaults
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
