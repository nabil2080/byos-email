import { Component, createSignal, createMemo, createEffect, For, Show, onMount, onCleanup } from "solid-js";
import {
  HOLIDAY_FEEDS,
  HolidayCalendarFeed,
  HolidayEventDefinition,
  getFeedById,
  getFeedsByCategory,
  getAllSupportedCountries,
  generateFeedForCountry,
} from "./holidayCatalogue";
import {
  HolidaySubscription,
  getHolidaySubscriptions,
  subscribeHolidayFeed,
  unsubscribeHolidayFeed,
  updateHolidaySubscription,
} from "./holidaySubscriptionStore";

interface HolidayCatalogueModalProps {
  isOpen: boolean;
  onClose: () => void;
  mailboxId?: string;
  onSubscriptionsChanged?: () => void;
}

const PRESET_HOLIDAY_COLORS = [
  "#15803D", // Forest Emerald (BD)
  "#1E3A8A", // Deep Navy (US)
  "#065F46", // British Green (UK)
  "#047857", // Islamic Emerald
  "#9333EA", // Royal Purple (Christian)
  "#D97706", // Saffron Amber (Hindu)
  "#EA580C", // Robe Orange (Buddhist)
  "#2563EB", // Tallit Blue (Jewish)
  "#9E725F", // BYOS Mocha Mousse
  "#B85D38", // Terracotta
];

export const HolidayCatalogueModal: Component<HolidayCatalogueModalProps> = (props) => {
  const [activeCategory, setActiveCategory] = createSignal<"country" | "religion">("country");
  const [searchQuery, setSearchQuery] = createSignal("");
  const [selectedContinent, setSelectedContinent] = createSignal<string>("all");
  const [selectedFeedId, setSelectedFeedId] = createSignal<string>("holiday-bd");
  const [customColor, setCustomColor] = createSignal<string>("#15803D");
  const [includeObservances, setIncludeObservances] = createSignal<boolean>(true);
  const [actionSuccess, setActionSuccess] = createSignal<string | null>(null);

  // Read subscriptions reactively
  const [subscriptions, setSubscriptions] = createSignal<HolidaySubscription[]>([]);

  function reloadSubscriptions() {
    if (props.mailboxId) {
      setSubscriptions(getHolidaySubscriptions(props.mailboxId));
    }
  }

  onMount(() => {
    reloadSubscriptions();
    const handleSubsUpdated = () => reloadSubscriptions();
    window.addEventListener("byos_holiday_subs_updated", handleSubsUpdated);
    onCleanup(() => window.removeEventListener("byos_holiday_subs_updated", handleSubsUpdated));
  });

  // Handle escape key
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && props.isOpen) {
        props.onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  // Reset tab and state whenever modal opens
  createEffect(() => {
    if (props.isOpen) {
      setActiveCategory("country");
      setSearchQuery("");
      setSelectedContinent("all");
      setActionSuccess(null);
      setSelectedFeedId("holiday-bd");
    }
  });

  // Whenever modal opens or selected feed changes, sync preferences
  const selectedFeed = createMemo(() => getFeedById(selectedFeedId()) || HOLIDAY_FEEDS[0]);
  const currentSub = createMemo(() =>
    subscriptions().find((s) => s.feedId === selectedFeed().id)
  );

  function selectFeed(feed: HolidayCalendarFeed) {
    setSelectedFeedId(feed.id);
    const existing = subscriptions().find((s) => s.feedId === feed.id);
    if (existing) {
      setCustomColor(existing.color);
      setIncludeObservances(existing.includeObservances);
    } else {
      setCustomColor(feed.defaultColor);
      setIncludeObservances(true);
    }
    setActionSuccess(null);
  }

  // Filtered feeds list
  const filteredFeeds = createMemo<HolidayCalendarFeed[]>(() => {
    const q = searchQuery().toLowerCase().trim();
    if (activeCategory() === "religion") {
      const religiousFeeds = HOLIDAY_FEEDS.filter((f) => f.category === "religion");
      if (!q) return religiousFeeds;
      return religiousFeeds.filter((f) => {
        return (
          f.name.toLowerCase().includes(q) ||
          f.regionOrTradition.toLowerCase().includes(q) ||
          f.description.toLowerCase().includes(q) ||
          f.events.some((e) => e.title.toLowerCase().includes(q))
        );
      });
    }

    // Country category: full catalogue from date-holidays (200+ countries)
    const allCountries = getAllSupportedCountries();
    let matching = allCountries;
    if (selectedContinent() !== "all") {
      matching = matching.filter((c) => c.continent === selectedContinent());
    }
    if (q) {
      matching = matching.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.code.toLowerCase().includes(q) ||
          (c.nativeName && c.nativeName.toLowerCase().includes(q))
      );
    }

    // Map each matching country into a feed item
    return matching
      .map((c) => {
        const curated = HOLIDAY_FEEDS.find(
          (f) => f.category === "country" && f.countryCode === c.code
        );
        if (curated) return curated;
        const generated = getFeedById(`holiday-${c.code.toLowerCase()}`);
        return (
          generated || {
            id: `holiday-${c.code.toLowerCase()}`,
            category: "country" as const,
            countryCode: c.code,
            name: `${c.name} Holidays`,
            regionOrTradition: c.continent,
            defaultColor: "#2563EB",
            description: `Official public holidays and observances of ${c.name}.`,
            supportsObservances: true,
            provider: `date-holidays (${c.code})`,
            lastUpdated: new Date().toISOString(),
            events: [],
          }
        );
      })
      .filter(Boolean);
  });

  function handleSubscribe() {
    if (!props.mailboxId) return;
    const feed = selectedFeed();
    subscribeHolidayFeed(props.mailboxId, feed.id, {
      color: customColor(),
      includeObservances: includeObservances(),
    });
    reloadSubscriptions();
    setActionSuccess(`Subscribed to ${feed.name}!`);
    props.onSubscriptionsChanged?.();
  }

  function handleSavePreferences() {
    if (!props.mailboxId) return;
    const feed = selectedFeed();
    updateHolidaySubscription(props.mailboxId, feed.id, {
      color: customColor(),
      includeObservances: includeObservances(),
    });
    reloadSubscriptions();
    setActionSuccess(`Updated preferences for ${feed.name}!`);
    props.onSubscriptionsChanged?.();
  }

  function handleUnsubscribe() {
    if (!props.mailboxId) return;
    const feed = selectedFeed();
    unsubscribeHolidayFeed(props.mailboxId, feed.id);
    reloadSubscriptions();
    setActionSuccess(`Unsubscribed from ${feed.name}`);
    props.onSubscriptionsChanged?.();
  }

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-3 md:p-6"
        data-testid="holiday-catalogue-modal"
      >
        <div
          class="w-full max-w-4xl h-[90vh] max-h-[720px] bg-white dark:bg-[#1E1F23] rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] shadow-2xl flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Modal Header ── */}
          <div class="px-6 py-4 border-b border-[#E2DFD8] dark:border-[#2A2D35] flex items-center justify-between bg-[#FAF9F5] dark:bg-[#18191D]">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-lg bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796] flex items-center justify-center">
                <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </div>
              <div>
                <h2 class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                  Explore Holiday & Religious Calendars
                </h2>
                <p class="text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                  Subscribe to verified public holidays and world religious calendar feeds
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={props.onClose}
              class="p-1.5 rounded-lg text-[#6F7173] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]"
              aria-label="Close modal"
              data-testid="close-holiday-modal-btn"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* ── Subheader: Search & Categories ── */}
          <div class="px-6 py-3 border-b border-[#E2DFD8] dark:border-[#2A2D35] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-[#1E1F23]">
            {/* Category Tabs */}
            <div class="flex items-center gap-1 p-0.5 bg-[#F0EEE9] dark:bg-[#18191D] rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setActiveCategory("country");
                  setSearchQuery("");
                }}
                class={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                  activeCategory() === "country" && !searchQuery()
                    ? "bg-white dark:bg-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] shadow-2xs"
                    : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D]"
                }`}
                data-testid="category-tab-country"
              >
                Regional & National
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveCategory("religion");
                  setSearchQuery("");
                }}
                class={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                  activeCategory() === "religion" && !searchQuery()
                    ? "bg-white dark:bg-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] shadow-2xs"
                    : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D]"
                }`}
                data-testid="category-tab-religion"
              >
                Religious Traditions
              </button>
            </div>

            {/* Search Input */}
            <div class="relative w-full sm:w-64">
              <input
                type="text"
                placeholder="Search calendars or holidays..."
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                class="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#18191D] text-[#2B2C2D] dark:text-[#ECEBE8] placeholder-[#A8A6A1] focus:outline-none focus:ring-2 focus:ring-[#9E725F]"
                data-testid="holiday-search-input"
              />
              <svg
                class="w-3.5 h-3.5 text-[#6F7173] absolute left-2.5 top-1/2 -translate-y-1/2 stroke-current fill-none stroke-[2]"
                viewBox="0 0 24 24"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
          </div>

          {/* ── Main Two-Pane Explorer ── */}
          <div class="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
            {/* Left Column: Feed List */}
            <div class="w-full md:w-80 border-r border-[#E2DFD8] dark:border-[#2A2D35] flex flex-col min-h-0">
              {/* Continent Filter for Country Category */}
              <Show when={activeCategory() === "country"}>
                <div class="px-3 py-2 border-b border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] shrink-0">
                  <div class="flex items-center gap-2">
                    <label for="holiday-continent-select" class="text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] shrink-0">
                      Region:
                    </label>
                    <select
                      id="holiday-continent-select"
                      value={selectedContinent()}
                      onChange={(e) => setSelectedContinent(e.currentTarget.value)}
                      class="flex-1 text-xs px-2 py-1 rounded-md border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] text-[#2B2C2D] dark:text-[#ECEBE8] cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                      data-testid="holiday-continent-select"
                    >
                      <option value="all">All Continents (200+ Countries)</option>
                      <option value="Asia">Asia</option>
                      <option value="Europe">Europe</option>
                      <option value="Americas">Americas</option>
                      <option value="Africa">Africa</option>
                      <option value="Oceania">Oceania</option>
                    </select>
                  </div>
                </div>
              </Show>

              <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
                <For each={filteredFeeds()}>
                {(feed) => {
                  const isSelected = () => selectedFeedId() === feed.id;
                  const isSubbed = () => subscriptions().some((s) => s.feedId === feed.id);
                  return (
                    <button
                      type="button"
                      onClick={() => selectFeed(feed)}
                      class={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-1 ${
                        isSelected()
                          ? "bg-[#FAF9F5] dark:bg-[#2A2D35] border-[#9E725F] dark:border-[#9E725F] shadow-2xs"
                          : "border-[#E2DFD8] dark:border-[#2A2D35] hover:bg-[#F0EEE9]/50 dark:hover:bg-[#252830]"
                      }`}
                      data-testid={`feed-item-${feed.id}`}
                    >
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2 min-w-0">
                          <span
                            class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ "background-color": feed.defaultColor }}
                          />
                          <span class="text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8] truncate">
                            {feed.name}
                          </span>
                        </div>
                        <Show when={isSubbed()}>
                          <span
                            class="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 flex-shrink-0"
                            data-testid="subscribed-feed-badge"
                          >
                            Subscribed
                          </span>
                        </Show>
                      </div>

                      <div class="flex items-center gap-2 text-[10px] text-[#6F7173] dark:text-[#878A8E]">
                        <span class="capitalize">{feed.regionOrTradition}</span>
                        <span>•</span>
                        <span>{feed.events.length} events</span>
                      </div>
                    </button>
                  );
                }}
              </For>
              </div>
            </div>

            {/* Right Column: Feed Preview & Subscription Controls */}
            <div class="flex-1 overflow-y-auto p-5 flex flex-col gap-5 bg-white dark:bg-[#1E1F23]">
              {/* Success Notification */}
              <Show when={actionSuccess()}>
                <div
                  class="px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs font-medium text-emerald-800 dark:text-emerald-200"
                  data-testid="holiday-action-success"
                >
                  {actionSuccess()}
                </div>
              </Show>

              {/* Feed Header */}
              <div class="flex flex-col gap-1.5 pb-3 border-b border-[#E2DFD8] dark:border-[#2A2D35]">
                <div class="flex items-center justify-between flex-wrap gap-2">
                  <div class="flex items-center gap-2.5">
                    <span
                      class="w-4 h-4 rounded-full flex-shrink-0"
                      style={{ "background-color": customColor() }}
                    />
                    <h3 class="text-base font-bold text-[#2B2C2D] dark:text-[#ECEBE8]" data-testid="preview-feed-title">
                      {selectedFeed().name}
                    </h3>
                  </div>

                  {/* Subscription status action */}
                  <div>
                    <Show
                      when={currentSub()}
                      fallback={
                        <button
                          type="button"
                          onClick={handleSubscribe}
                          class="px-4 py-1.5 rounded-lg bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                          data-testid="subscribe-holiday-btn"
                        >
                          Subscribe to Calendar
                        </button>
                      }
                    >
                      <div class="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleSavePreferences}
                          class="px-3 py-1.5 rounded-lg bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                          data-testid="save-holiday-pref-btn"
                        >
                          Save Changes
                        </button>
                        <button
                          type="button"
                          onClick={handleUnsubscribe}
                          class="px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold transition-colors cursor-pointer"
                          data-testid="unsubscribe-holiday-feed-btn"
                        >
                          Unsubscribe
                        </button>
                      </div>
                    </Show>
                  </div>
                </div>

                <p class="text-xs text-[#6F7173] dark:text-[#878A8E] leading-relaxed">
                  {selectedFeed().description}
                </p>

                {/* Attribution & Last Updated Metadata */}
                <div class="flex flex-wrap items-center gap-3 text-[11px] text-[#6F7173] dark:text-[#878A8E] mt-1 pt-2 border-t border-[#F0EEE9] dark:border-[#2A2D35]">
                  <span>
                    <strong class="font-semibold text-[#2B2C2D] dark:text-[#ECEBE8]">Provider:</strong>{" "}
                    <span data-testid="provider-attribution">{selectedFeed().provider}</span>
                  </span>
                  <span>•</span>
                  <span>
                    <strong class="font-semibold text-[#2B2C2D] dark:text-[#ECEBE8]">Updated:</strong>{" "}
                    {new Date(selectedFeed().lastUpdated).toLocaleDateString([], {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>

                {/* Honest Disclaimer Banner (For calculated or lunar observation feeds) */}
                <Show when={selectedFeed().disclaimer}>
                  <div
                    class="mt-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-900 dark:text-amber-200 leading-relaxed"
                    data-testid="feed-disclaimer-banner"
                  >
                    <strong class="font-semibold">Astronomical & Regional Notice:</strong>{" "}
                    {selectedFeed().disclaimer}
                  </div>
                </Show>
              </div>

              {/* Preferences Configuration */}
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 bg-[#FAF9F5] dark:bg-[#18191D] rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35]">
                {/* Color Chooser */}
                <div>
                  <label class="block text-xs font-semibold text-[#2B2C2D] dark:text-[#ECEBE8] mb-1.5">
                    Calendar Color
                  </label>
                  <div class="flex items-center gap-1.5 flex-wrap" data-testid="holiday-color-palette">
                    <For each={PRESET_HOLIDAY_COLORS}>
                      {(c) => (
                        <button
                          type="button"
                          onClick={() => setCustomColor(c)}
                          class={`w-5 h-5 rounded-full transition-transform cursor-pointer flex items-center justify-center ${
                            customColor() === c
                              ? "scale-110 ring-2 ring-offset-2 ring-[#9E725F]"
                              : "hover:scale-105"
                          }`}
                          style={{ "background-color": c }}
                          data-testid={`holiday-color-${c}`}
                        >
                          <Show when={customColor() === c}>
                            <svg class="w-3 h-3 text-white stroke-current fill-none stroke-[3]" viewBox="0 0 24 24">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </Show>
                        </button>
                      )}
                    </For>
                  </div>
                </div>

                {/* Observances Toggle */}
                <Show when={selectedFeed().supportsObservances}>
                  <div class="flex flex-col justify-center">
                    <label class="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={includeObservances()}
                        onChange={(e) => setIncludeObservances(e.currentTarget.checked)}
                        class="rounded border-[#E2DFD8] text-[#9E725F] focus:ring-[#9E725F] cursor-pointer"
                        data-testid="holiday-observances-toggle"
                      />
                      <span class="text-xs font-semibold text-[#2B2C2D] dark:text-[#ECEBE8]">
                        Include Observances & Cultural Events
                      </span>
                    </label>
                    <p class="text-[10px] text-[#6F7173] dark:text-[#878A8E] mt-0.5 ml-5">
                      Show secondary observances alongside statutory public holidays.
                    </p>
                  </div>
                </Show>
              </div>

              {/* Holiday Events Preview Table */}
              <div class="flex flex-col gap-2">
                <span class="text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                  Included Holidays ({selectedFeed().events.length})
                </span>

                <div class="border border-[#E2DFD8] dark:border-[#2A2D35] rounded-xl overflow-hidden">
                  <For each={selectedFeed().events}>
                    {(ev) => (
                      <div
                        class="p-3 border-b border-[#F0EEE9] dark:border-[#2A2D35] last:border-b-0 flex flex-col gap-1 hover:bg-[#FAF9F5] dark:hover:bg-[#18191D] transition-colors"
                        data-testid="preview-holiday-row"
                      >
                        <div class="flex items-start justify-between gap-2">
                          <div class="flex items-center gap-2 min-w-0 flex-1">
                            <span class="text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8] truncate" data-testid="preview-holiday-title">
                              {ev.title}
                            </span>

                            {/* Honest Date Type Badges */}
                            <Show when={ev.dateType === "fixed"}>
                              <span
                                class="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 flex-shrink-0"
                                data-testid="badge-date-fixed"
                              >
                                Fixed Date
                              </span>
                            </Show>
                            <Show when={ev.dateType === "calculated"}>
                              <span
                                class="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 flex-shrink-0"
                                data-testid="badge-date-calculated"
                              >
                                Calculated
                              </span>
                            </Show>
                            <Show when={ev.dateType === "provisional"}>
                              <span
                                class="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 flex-shrink-0"
                                data-testid="badge-date-provisional"
                              >
                                Provisional (Moon Sighting)
                              </span>
                            </Show>
                          </div>

                          <span class="text-xs font-semibold text-[#6F7173] dark:text-[#878A8E] flex-shrink-0">
                            {new Date(ev.date + "T00:00:00Z").toLocaleDateString([], {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </span>
                        </div>

                        <p class="text-[11px] text-[#6F7173] dark:text-[#878A8E] leading-relaxed">
                          {ev.description}
                        </p>

                        <Show when={ev.provisionalNote}>
                          <span class="text-[10px] text-rose-700 dark:text-rose-400 font-medium">
                            • {ev.provisionalNote}
                          </span>
                        </Show>
                        <Show when={ev.regionalDifferences}>
                          <span class="text-[10px] text-amber-700 dark:text-amber-400">
                            • {ev.regionalDifferences}
                          </span>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};
