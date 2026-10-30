import { Component, For, Show, createSignal, onMount, onCleanup } from "solid-js";
import { MiniMonthPicker } from "./MiniMonthPicker";
import { UserCalendar, UserMe, Mailbox, ConnectedAccount } from "../../api";
import { ExpandedEventOccurrence } from "../../utils/calendarRrule";
import { CalendarEventPlaintext } from "../../calendar_crypto";
import { WorldClockCity } from "./settings/calendarSettingsStore";
import { getWorldClockCityTime } from "../../utils/calendarTimezones";
import { AccountSwitcher } from "../AccountSwitcher";

export interface DecryptedEventRecord {
  id: string;
  calendarId: string;
  startTime: Date;
  endTime: Date;
  isAllDay: boolean;
  status: string;
  details: CalendarEventPlaintext;
  baseEventId?: string;
  recurrenceId?: string;
  rrule?: string;
  isOccurrence?: boolean;
  isException?: boolean;
  exceptionId?: string;
  isHoliday?: boolean;
  holidayMeta?: {
    feedId?: string;
    eventId?: string;
    tradition?: string;
    dateType?: "fixed" | "calculated" | "provisional";
    provisionalNote?: string;
    regionalDifferences?: string;
    provider?: string;
    lastUpdated?: string;
    isObservance?: boolean;
  };
}

interface CalendarSidebarProps {
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
  class?: string;
  onCloseMobile?: () => void;
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  calendars: UserCalendar[];
  visibleCalendarIds: Set<string>;
  onToggleCalendarVisibility: (calId: string) => void;
  onOpenCreateEvent: () => void;
  onOpenCreateCalendar: () => void;
  onOpenEditCalendar: (cal: UserCalendar) => void;
  onOpenShareCalendar?: (cal?: UserCalendar) => void;
  onUnsubscribeCalendar?: (cal: UserCalendar) => void;
  onOpenExploreHolidays?: () => void;
  onOpenSubscribeFromUrl?: () => void;
  onRefreshUrlFeed?: (calId: string) => void;
  upcomingEvents: DecryptedEventRecord[];
  onSelectEvent: (ev: DecryptedEventRecord) => void;
  worldClockCities?: WorldClockCity[];
  timeFormat?: "12h" | "24h";
  showWorldClock?: boolean;
  onOpenWorldClockSettings?: () => void;
  onOpenContacts?: () => void;
  onOpenSettings?: () => void;
}

export const CalendarSidebar: Component<CalendarSidebarProps> = (props) => {
  const [showAddMenu, setShowAddMenu] = createSignal(false);
  let addMenuRef: HTMLDivElement | undefined;

  const mailboxEmail = () => {
    if (!props.selectedMailbox) return props.currentUser?.email || "byos.email";
    if ((props.selectedMailbox as any)?.email) return (props.selectedMailbox as any).email;
    if ((props.selectedMailbox as any)?.domain_name) {
      return `${props.selectedMailbox.local_part}@${(props.selectedMailbox as any).domain_name}`;
    }
    const domain = props.currentUser?.email?.split("@")[1] || "byos.email";
    return `${props.selectedMailbox.local_part}@${domain}`;
  };

  const isPrivate = () => props.selectedMailbox?.mode === "private";

  onMount(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      if (showAddMenu() && addMenuRef && !addMenuRef.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showAddMenu()) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener("click", handleDocumentClick);
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      document.removeEventListener("click", handleDocumentClick);
      window.removeEventListener("keydown", handleKeyDown);
    });
  });

  const myCalendars = () => props.calendars.filter((c) => !c.is_shared);
  const sharedCalendars = () => props.calendars.filter((c) => c.is_shared);

  return (
    <aside
      data-testid="calendar-sidebar"
      class={`w-full md:w-64 flex-shrink-0 bg-[#F0EEE9] dark:bg-[#18191D] flex flex-col justify-between select-none h-full relative ${
        props.class || ""
      }`}
    >
      {/* ── TOP SECTION: Brand Header, Account Switcher, New Event Action ── */}
      <div class="p-2 pb-2 relative z-50 overflow-visible space-y-2 flex-shrink-0">
        {/* Top-Left App Brand Header */}
        <div class="flex items-center justify-between px-1.5 pt-0.5 pb-0.5">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-xl bg-gradient-to-br from-[#A27561] to-[#8E6351] flex items-center justify-center text-white font-bold text-xs shadow-xs tracking-wider ring-1 ring-black/5 dark:ring-white/10 select-none">
              B
            </div>
            <div class="flex flex-col">
              <span class="text-sm font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] tracking-tight leading-tight">BYOS Calendar</span>
              <span class="text-[10px] font-mono text-[#878A8E] tracking-wider uppercase leading-none mt-0.5">Zero-Knowledge</span>
            </div>
          </div>
          <Show when={props.onCloseMobile}>
            <button
              type="button"
              onClick={props.onCloseMobile}
              class="md:hidden flex items-center justify-center w-8 h-8 rounded-lg text-[#6F7173] dark:text-[#878A8E] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF] dark:hover:bg-[#26282E] transition cursor-pointer"
              title="Close navigation menu"
              aria-label="Close navigation menu"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Show>
        </div>

        {/* User Identity & Account Switcher (Top-Left) */}
        <AccountSwitcher
          currentEmail={mailboxEmail()}
          isPrivate={isPrivate()}
          connectedAccounts={props.connectedAccounts || []}
          activeAccountId={props.activeAccountId || props.selectedMailbox?.id || ""}
          onSelectAccount={(acc) => {
            props.onSelectAccount?.(acc);
            props.onCloseMobile?.();
          }}
          onSelectAllInboxes={() => {
            props.onSelectAllInboxes?.();
            props.onCloseMobile?.();
          }}
          onOpenAddMailbox={() => {
            props.onOpenAddMailbox?.();
            props.onCloseMobile?.();
          }}
          onSignOut={props.onLogout || (() => {})}
          unreadCounts={props.accountUnreadCounts}
          totalUnifiedUnread={props.unifiedUnreadCount}
          profilePhotoUrl={props.profilePhotoUrl}
          photoUrls={props.photoUrls}
        />

        {/* New Event Button matching Compose Pill */}
        <div class="space-y-1.5">
          <button
            type="button"
            onClick={() => {
              props.onOpenCreateEvent();
              props.onCloseMobile?.();
            }}
            class="w-full bg-[#A27561] hover:bg-[#8F6452] dark:bg-[#A27561] dark:hover:bg-[#B2826F] text-white text-[13px] tracking-wide font-semibold py-2.5 px-3.5 min-h-[40px] rounded-xl shadow-none transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
            data-testid="calendar-new-event-btn"
          >
            <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>New event</span>
          </button>
        </div>
      </div>

      {/* ── MIDDLE SCROLLABLE SECTION: Mini Month Picker, Calendars List, World Clock ── */}
      <div class="flex-1 min-h-0 overflow-y-auto px-2 py-1 space-y-3 custom-scrollbar">

      {/* Mini Month Picker */}
      <MiniMonthPicker
        selectedDate={props.selectedDate}
        onSelectDate={props.onSelectDate}
      />

      {/* My Calendars */}
      <div class="px-1">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] uppercase tracking-wider px-1">
            My Calendars
          </span>
          <div ref={addMenuRef} class="relative">
            <button
              type="button"
              onClick={() => { setShowAddMenu(!showAddMenu()); props.onOpenCreateCalendar(); }}
              class="p-1 rounded-lg text-[#6F7173] hover:text-[#9E725F] dark:hover:text-[#D4A38F] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
              title="Add calendar"
              aria-label="Add calendar"
              aria-haspopup="true"
              aria-expanded={showAddMenu()}
              data-testid="add-calendar-btn"
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>

            <Show when={showAddMenu()}>
              <div
                class="absolute right-0 top-full mt-1.5 w-52 rounded-xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] shadow-xl z-[60] py-1 text-xs overflow-hidden"
                role="menu"
                data-testid="add-calendar-dropdown-menu"
              >
                <button
                  type="button"
                  onClick={() => { setShowAddMenu(false); props.onOpenCreateCalendar(); }}
                  class="w-full px-3 py-2 text-left hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] text-[#3C3D3E] dark:text-[#ECEBE8] flex items-center gap-2.5 cursor-pointer transition-colors"
                  role="menuitem"
                  data-testid="add-calendar-menu-create"
                >
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2] text-[#9E725F]" viewBox="0 0 24 24">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Create new calendar
                </button>

                <button
                  type="button"
                  onClick={() => { setShowAddMenu(false); props.onOpenExploreHolidays?.(); }}
                  class="w-full px-3 py-2 text-left hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] text-[#3C3D3E] dark:text-[#ECEBE8] flex items-center gap-2.5 cursor-pointer transition-colors"
                  role="menuitem"
                  data-testid="add-calendar-menu-browse"
                >
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2] text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  Browse holidays & interests
                </button>

                <button
                  type="button"
                  onClick={() => { setShowAddMenu(false); props.onOpenSubscribeFromUrl?.(); }}
                  class="w-full px-3 py-2 text-left hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] text-[#3C3D3E] dark:text-[#ECEBE8] flex items-center gap-2.5 cursor-pointer transition-colors"
                  role="menuitem"
                  data-testid="add-calendar-menu-url"
                >
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2] text-blue-600 dark:text-blue-400" viewBox="0 0 24 24">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  From URL (webcal/ics)
                </button>

                <div class="my-1 border-t border-[#F0EEE9] dark:border-[#2A2D35]" />

                <button
                  type="button"
                  onClick={() => { setShowAddMenu(false); props.onOpenShareCalendar?.(); }}
                  class="w-full px-3 py-2 text-left hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] text-[#3C3D3E] dark:text-[#ECEBE8] flex items-center gap-2.5 cursor-pointer transition-colors"
                  role="menuitem"
                  data-testid="add-calendar-menu-subscribe"
                >
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2] text-purple-600 dark:text-purple-400" viewBox="0 0 24 24">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  Subscribe to calendar
                </button>
              </div>
            </Show>
          </div>
        </div>

        <div class="flex flex-col gap-0.5">
          <For each={myCalendars()}>
            {(cal) => {
              const isVisible = () => props.visibleCalendarIds.has(cal.id);
              return (
                <div class="group flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors" data-testid="calendar-row">
                  <label class="flex items-center gap-2 cursor-pointer min-w-0 flex-1">
                    <span
                      class="w-3 h-3 rounded-sm flex-shrink-0 border-2 transition-all cursor-pointer"
                      style={{
                        "background-color": isVisible() ? (cal.color || "#9E725F") : "transparent",
                        "border-color": cal.color || "#9E725F",
                      }}
                      onClick={() => props.onToggleCalendarVisibility(cal.id)}
                      role="checkbox"
                      aria-checked={isVisible()}
                      aria-label={`Show ${cal.name}`}
                      tabindex="0"
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") props.onToggleCalendarVisibility(cal.id); }}
                    />
                    <span class="text-xs font-medium text-[#3C3D3E] dark:text-[#ECEBE8] truncate" data-testid="calendar-item-name">
                      {cal.name}
                    </span>
                    <Show when={cal.is_default}>
                      <span
                        class="text-[9px] px-1 rounded font-medium flex-shrink-0 bg-[#F2E8E2] dark:bg-[#3D2C24] text-[#9E725F] dark:text-[#D4A38F]"
                        data-testid="calendar-default-badge"
                      >
                        Default
                      </span>
                    </Show>
                  </label>

                  <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <Show when={props.onOpenShareCalendar}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); props.onOpenShareCalendar?.(cal); }}
                        class="p-1 text-[#6F7173] hover:text-[#9E725F] dark:hover:text-[#D4A38F] rounded transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
                        title="Share"
                        aria-label={`Share ${cal.name}`}
                        data-testid="share-calendar-btn"
                      >
                        <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                          <circle cx="18" cy="5" r="3" />
                          <circle cx="6" cy="12" r="3" />
                          <circle cx="18" cy="19" r="3" />
                          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                        </svg>
                      </button>
                    </Show>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); props.onOpenEditCalendar(cal); }}
                      class="p-1 text-[#6F7173] hover:text-[#3C3D3E] dark:hover:text-[#ECEBE8] rounded transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
                      title="Settings"
                      aria-label={`Settings for ${cal.name}`}
                      data-testid="edit-calendar-btn"
                    >
                      <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="1" />
                        <circle cx="12" cy="5" r="1" />
                        <circle cx="12" cy="19" r="1" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </div>

      {/* Other Calendars */}
      <div class="px-1">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] uppercase tracking-wider px-1">
            Other Calendars
          </span>
          <Show when={props.onOpenExploreHolidays}>
            <button
              type="button"
              onClick={() => props.onOpenExploreHolidays?.()}
              class="p-1 rounded-lg text-[#6F7173] hover:text-[#9E725F] dark:hover:text-[#D4A38F] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
              title="Browse holiday calendars"
              aria-label="Browse holiday calendars"
              data-testid="explore-calendars-btn"
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </Show>
        </div>

        <Show
          when={sharedCalendars().length > 0}
          fallback={
            <div class="px-2 py-2 text-[11px] text-[#6F7173] dark:text-[#878A8E]" data-testid="shared-calendars-section">
              <Show when={props.onOpenExploreHolidays}>
                <button
                  type="button"
                  onClick={() => props.onOpenExploreHolidays?.()}
                  class="text-[#9E725F] dark:text-[#D4A38F] hover:underline cursor-pointer font-medium"
                  data-testid="explore-calendars-empty-btn"
                >
                  Browse holidays & interests
                </button>
              </Show>
            </div>
          }
        >
          <div class="flex flex-col gap-0.5" data-testid="shared-calendars-section">
            <For each={sharedCalendars()}>
              {(cal) => {
                const isVisible = () => props.visibleCalendarIds.has(cal.id);
                const isSportsFeed = () =>
                  cal.id.startsWith("sports-") || cal.id.startsWith("holiday-sports-");
                const isMoonFeed = () =>
                  cal.id === "other-moon-phases" || cal.id === "holiday-other-moon-phases";
                const isReligiousFeed = () =>
                  cal.id.startsWith("religion-") || cal.id.startsWith("holiday-religion-");
                const isCountryHolidayFeed = () =>
                  (cal.id.startsWith("holiday-") || cal.mailbox_id === "byos-holidays") &&
                  !isSportsFeed() &&
                  !isMoonFeed() &&
                  !isReligiousFeed();
                const isUrlFeed = () => cal.template === "url_feed" || cal.id.startsWith("url-");
                const isHolidaySystemFeed = () =>
                  isSportsFeed() ||
                  isMoonFeed() ||
                  isReligiousFeed() ||
                  isCountryHolidayFeed() ||
                  cal.mailbox_id === "byos-holidays" ||
                  (cal as any).source_type === "holiday";

                return (
                  <div class="group flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors" data-testid="shared-calendar-row">
                    <label class="flex items-center gap-2 cursor-pointer min-w-0 flex-1">
                      <span
                        class="w-3 h-3 rounded-sm flex-shrink-0 border-2 transition-all cursor-pointer"
                        style={{
                          "background-color": isVisible() ? (cal.color || "#9E725F") : "transparent",
                          "border-color": cal.color || "#9E725F",
                        }}
                        onClick={() => props.onToggleCalendarVisibility(cal.id)}
                        role="checkbox"
                        aria-checked={isVisible()}
                        aria-label={`Show ${cal.name}`}
                        tabindex="0"
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") props.onToggleCalendarVisibility(cal.id); }}
                        data-testid="calendar-visibility-checkbox"
                      />
                      <div class="flex flex-col min-w-0 flex-1">
                        <div class="flex items-center gap-1.5 min-w-0">
                          <span class="text-xs font-medium text-[#3C3D3E] dark:text-[#ECEBE8] truncate" data-testid="calendar-item-name">
                            {cal.name}
                          </span>
                          <Show when={isUrlFeed()}>
                            <span class="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 shrink-0" data-testid="url-calendar-badge">
                              URL
                            </span>
                          </Show>
                          <Show when={isMoonFeed()}>
                            <span class="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-semibold bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 shrink-0" data-testid="moon-calendar-badge">
                              Moon
                            </span>
                          </Show>
                          <Show when={isSportsFeed()}>
                            <span class="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 shrink-0" data-testid="sports-calendar-badge">
                              Sports
                            </span>
                          </Show>
                          <Show when={isHolidaySystemFeed() && !isMoonFeed() && !isSportsFeed()}>
                            <span class="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 shrink-0" data-testid="holiday-calendar-badge">
                              Holiday
                            </span>
                          </Show>
                        </div>
                        <Show when={cal.owner_email}>
                          <span class="text-[10px] text-[#6F7173] dark:text-[#878A8E] truncate" data-testid="shared-calendar-owner">
                            {isHolidaySystemFeed() ? cal.owner_email : `Shared by ${cal.owner_email}`}
                          </span>
                        </Show>
                      </div>
                    </label>

                    <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <Show when={isUrlFeed() && props.onRefreshUrlFeed}>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); props.onRefreshUrlFeed?.(cal.id); }}
                          class="p-1 text-[#6F7173] hover:text-[#3C3D3E] dark:hover:text-[#ECEBE8] rounded transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
                          title="Refresh"
                          aria-label={`Refresh ${cal.name}`}
                          data-testid="refresh-url-feed-btn"
                        >
                          <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                          </svg>
                        </button>
                      </Show>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isHolidaySystemFeed() && props.onOpenExploreHolidays) {
                            props.onOpenExploreHolidays();
                          } else {
                            props.onOpenEditCalendar(cal);
                          }
                        }}
                        class="p-1 text-[#6F7173] hover:text-[#3C3D3E] dark:hover:text-[#ECEBE8] rounded transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
                        title="Settings"
                        aria-label={`Settings for ${cal.name}`}
                        data-testid="edit-shared-calendar-btn"
                      >
                        <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                          <circle cx="12" cy="12" r="1" />
                          <circle cx="12" cy="5" r="1" />
                          <circle cx="12" cy="19" r="1" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (props.onUnsubscribeCalendar) {
                            props.onUnsubscribeCalendar(cal);
                          } else {
                            props.onOpenEditCalendar(cal);
                          }
                        }}
                        class="p-1 text-[#6F7173] hover:text-rose-600 dark:hover:text-rose-400 rounded transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                        title="Unsubscribe"
                        aria-label={`Unsubscribe from ${cal.name}`}
                        data-testid="unsubscribe-calendar-row-btn"
                      >
                        <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>

      {/* World Clock Widget (Category 05) */}
      <Show when={props.showWorldClock !== false}>
        <div class="px-2 pt-3 border-t border-[#E2DFD8]/60 dark:border-[#2A2D35]/60 shrink-0" data-testid="calendar-world-clock-widget">
          <div class="flex items-center justify-between mb-1.5 px-1">
            <span class="text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] uppercase tracking-wider">
              World Clock
            </span>
            <Show when={props.onOpenWorldClockSettings}>
              <button
                type="button"
                onClick={() => props.onOpenWorldClockSettings?.()}
                class="p-1 rounded-lg text-[#6F7173] hover:text-[#9E725F] dark:hover:text-[#D4A38F] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer"
                title="Configure World Clock"
                aria-label="Configure World Clock"
                data-testid="configure-world-clock-btn"
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            </Show>
          </div>

          <div class="space-y-1">
            <For
              each={
                props.worldClockCities && props.worldClockCities.length > 0
                  ? props.worldClockCities
                  : [
                      { id: "c1", label: "London", timeZone: "Europe/London" },
                      { id: "c2", label: "New York", timeZone: "America/New_York" },
                      { id: "c3", label: "Tokyo", timeZone: "Asia/Tokyo" },
                    ]
              }
            >
              {(city) => {
                const liveInfo = () => getWorldClockCityTime(city, new Date(), props.timeFormat || "12h");
                return (
                  <div
                    class="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors text-xs"
                    data-testid={`world-clock-city-${city.id}`}
                  >
                    <span class="font-medium text-[#2B2C2D] dark:text-[#ECEBE8] truncate">{city.label}</span>
                    <span class="text-[11px] font-mono text-[#6F7173] dark:text-[#878A8E]">{liveInfo().timeStr}</span>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </Show>
      </div>

      {/* ── FIXED BOTTOM: Contacts, Settings & Sign Out ── */}
      <div class="p-2 border-t border-[#E2DFD8]/60 dark:border-[#333336] space-y-1.5 relative z-40 overflow-visible flex-shrink-0">
        <div class="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => {
              props.onOpenContacts?.();
              props.onCloseMobile?.();
            }}
            data-testid="sidebar-contacts-btn"
            data-testid-secondary="contacts-nav-btn"
            class="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl text-xs font-medium text-[#5E6063] dark:text-[#A3A3A3] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#E8E5DF]/60 dark:hover:bg-[#2A2A2E] border border-[#E2DFD8]/80 dark:border-[#2E3138] transition-colors cursor-pointer select-none"
            title="Contacts"
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>Contacts</span>
          </button>

          <button
            type="button"
            onClick={() => {
              props.onOpenSettings?.();
              props.onCloseMobile?.();
            }}
            data-testid="sidebar-settings-btn"
            class="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl text-xs font-medium text-[#5E6063] dark:text-[#A3A3A3] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#E8E5DF]/60 dark:hover:bg-[#2A2A2E] border border-[#E2DFD8]/80 dark:border-[#2E3138] transition-colors cursor-pointer select-none"
            title="Settings"
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span>Settings</span>
          </button>
        </div>

        <div class="flex items-center justify-between px-2 py-1 text-xs text-[#878A8E]">
          <span class="text-[11px] truncate max-w-[120px] font-mono">
            {props.currentUser?.email?.split("@")[0] || "User"}
          </span>
          <button
            onClick={() => props.onLogout?.(props.selectedMailbox?.id, false)}
            class="text-[11px] text-[#5E6063] dark:text-[#A3A3A3] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:underline cursor-pointer font-medium"
          >
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
};
