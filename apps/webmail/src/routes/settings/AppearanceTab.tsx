import { Component, createSignal, createEffect, onMount, For, Show } from "solid-js";
import {
  Mailbox,
  MailboxSettings,
  fetchMailboxSettings,
  updateMailboxSettings,
} from "../../api";

interface AppearanceTabProps {
  mailbox: Mailbox;
  currentDensity: "compact" | "cozy" | "comfortable";
  currentLayout: "split" | "full";
  currentTheme: "cloud_dancer" | "dark";
  onDensityChange?: (d: "compact" | "cozy" | "comfortable") => void;
  onLayoutChange?: (l: "split" | "full") => void;
  onThemeChange?: (t: "cloud_dancer" | "dark") => void;
  currentTimeFormat?: "12h" | "24h";
  onTimeFormatChange?: (tf: "12h" | "24h") => void;
  currentLanguage?: string;
  onLanguageChange?: (lang: string) => void;
  currentWeekStart?: "sunday" | "monday" | "saturday";
  onWeekStartChange?: (ws: "sunday" | "monday" | "saturday") => void;
}

export const AppearanceTab: Component<AppearanceTabProps> = (props) => {
  const [loading, setLoading] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [savedSuccess, setSavedSuccess] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const [density, setDensity] = createSignal<"compact" | "cozy" | "comfortable">(
    props.currentDensity || "cozy"
  );
  const [layoutMode, setLayoutMode] = createSignal<"split" | "full">(
    props.currentLayout || "split"
  );
  const [theme, setTheme] = createSignal<"cloud_dancer" | "dark">(
    props.currentTheme || "cloud_dancer"
  );
  const [language, setLanguage] = createSignal<string>(
    props.currentLanguage || (typeof window !== "undefined" ? localStorage.getItem("byos_language") || "en" : "en")
  );
  const [timeFormat, setTimeFormat] = createSignal<"12h" | "24h">(
    props.currentTimeFormat || (typeof window !== "undefined" ? (localStorage.getItem("byos_time_format") as any) || "12h" : "12h")
  );
  const [weekStart, setWeekStart] = createSignal<"sunday" | "monday" | "saturday">(
    props.currentWeekStart || (typeof window !== "undefined" ? (localStorage.getItem("byos_week_start") as any) || "sunday" : "sunday")
  );

  // Sync with incoming props if they change externally
  createEffect(() => {
    if (props.currentDensity) setDensity(props.currentDensity);
  });
  createEffect(() => {
    if (props.currentLayout) setLayoutMode(props.currentLayout);
  });
  createEffect(() => {
    if (props.currentTheme) setTheme(props.currentTheme);
  });
  createEffect(() => {
    if (props.currentTimeFormat) setTimeFormat(props.currentTimeFormat);
  });
  createEffect(() => {
    if (props.currentLanguage) setLanguage(props.currentLanguage);
  });
  createEffect(() => {
    if (props.currentWeekStart) setWeekStart(props.currentWeekStart);
  });

  onMount(async () => {
    try {
      setLoading(true);
      const s = await fetchMailboxSettings(props.mailbox.id);
      if (s.density) {
        setDensity(s.density);
        props.onDensityChange?.(s.density);
      }
      if (s.layout_mode) {
        setLayoutMode(s.layout_mode);
        props.onLayoutChange?.(s.layout_mode);
      }
      if (s.theme) {
        setTheme(s.theme);
        props.onThemeChange?.(s.theme);
      }
      if (s.language) {
        setLanguage(s.language);
        props.onLanguageChange?.(s.language);
      }
      if (s.time_format) {
        setTimeFormat(s.time_format);
        props.onTimeFormatChange?.(s.time_format);
      }
      if (s.week_start) {
        setWeekStart(s.week_start);
        props.onWeekStartChange?.(s.week_start);
      }
    } catch (err: any) {
      console.warn("Using current appearance settings:", err);
    } finally {
      setLoading(false);
    }
  });

  async function handleApply(
    newDensity = density(),
    newLayout = layoutMode(),
    newTheme = theme(),
    newLanguage = language(),
    newTimeFormat = timeFormat(),
    newWeekStart = weekStart()
  ) {
    setSaving(true);
    setError(null);
    try {
      // 1. Update local signals
      setDensity(newDensity);
      setLayoutMode(newLayout);
      setTheme(newTheme);
      setLanguage(newLanguage);
      setTimeFormat(newTimeFormat);
      setWeekStart(newWeekStart);

      // 2. Update localStorage immediately
      if (typeof window !== "undefined") {
        localStorage.setItem("byos_density", newDensity);
        localStorage.setItem("byos_layout", newLayout);
        localStorage.setItem("byos_theme", newTheme);
        localStorage.setItem("byos_language", newLanguage);
        localStorage.setItem("byos_time_format", newTimeFormat);
        localStorage.setItem("byos_week_start", newWeekStart);
      }

      // 3. Notify parent handlers to update app UI immediately
      props.onDensityChange?.(newDensity);
      props.onLayoutChange?.(newLayout);
      props.onThemeChange?.(newTheme);
      props.onLanguageChange?.(newLanguage);
      props.onTimeFormatChange?.(newTimeFormat);
      props.onWeekStartChange?.(newWeekStart);

      // 4. Persist to backend
      await updateMailboxSettings(props.mailbox.id, {
        density: newDensity,
        layout_mode: newLayout,
        theme: newTheme,
        language: newLanguage,
        time_format: newTimeFormat,
        week_start: newWeekStart,
      });

      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } catch (err: any) {
      setError(err?.message || "Failed to update appearance preferences.");
    } finally {
      setSaving(false);
    }
  }

  const densityOptions: {
    id: "compact" | "cozy" | "comfortable";
    label: string;
    description: string;
    sampleHeight: string;
  }[] = [
    {
      id: "compact",
      label: "Compact",
      description: "Maximum message density, slim line heights, tighter margins.",
      sampleHeight: "h-6 text-[11px]",
    },
    {
      id: "cozy",
      label: "Cozy (Default)",
      description: "Balanced ergonomics optimized for high-volume email workflows.",
      sampleHeight: "h-9 text-xs",
    },
    {
      id: "comfortable",
      label: "Comfortable",
      description: "Generous whitespace, large typography, relaxed line spacing.",
      sampleHeight: "h-12 text-sm",
    },
  ];

  return (
    <div class="space-y-6">
      <div>
        <h3 class="text-lg font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Appearance & Layout</h3>
        <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] mt-1">
          Customize spacing density, reading pane placement, and color palette.
        </p>
      </div>

      <Show when={error()}>
        <div class="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between">
          <span>{error()}</span>
          <button onClick={() => setError(null)} class="text-rose-500 hover:text-rose-800 dark:hover:text-rose-200 p-0.5 cursor-pointer" title="Dismiss">
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </Show>

      <Show when={savedSuccess()}>
        <div class="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
          <svg class="w-4 h-4 text-emerald-600 dark:text-emerald-400 stroke-current fill-none stroke-[2.5]" viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>Appearance preferences updated.</span>
        </div>
      </Show>

      {/* Inbox Density Section */}
      <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-4">
        <div>
          <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
            Inbox Density
          </h4>
          <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] mt-0.5">
            Controls row height and information density in message lists.
          </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <For each={densityOptions}>
            {(opt) => {
              const isSelected = () => density() === opt.id;
              return (
                <button
                  type="button"
                  onClick={() => {
                    setDensity(opt.id);
                    handleApply(opt.id, layoutMode(), theme());
                  }}
                  class={`p-4 rounded-xl border text-left transition flex flex-col justify-between cursor-pointer ${
                    isSelected()
                      ? "border-[#A27561] bg-[#F3ECE8] dark:bg-[#2D2522] dark:border-[#A27561] shadow-xs"
                      : "border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] hover:bg-white dark:hover:bg-[#252830]"
                  }`}
                >
                  <div>
                    <div class="flex items-center justify-between mb-1">
                      <span class={`text-xs font-bold ${isSelected() ? "text-[#A27561] dark:text-[#D4A38F]" : "text-[#1A1B1E] dark:text-[#F3F4F6]"}`}>{opt.label}</span>
                      <span
                        class={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                          isSelected() ? "border-[#A27561] bg-[#A27561]" : "border-[#E2DFD8] dark:border-[#2E3138]"
                        }`}
                      >
                        {isSelected() && <span class="w-1.5 h-1.5 rounded-full bg-white"></span>}
                      </span>
                    </div>
                    <p class="text-[11px] text-[#6E7075] dark:text-[#A1A1AA] leading-relaxed">{opt.description}</p>
                  </div>

                  {/* Sample rows mockup */}
                  <div class="mt-4 pt-3 border-t border-[#E2DFD8]/60 dark:border-[#2E3138] space-y-1.5">
                    <div
                      class={`w-full ${opt.sampleHeight} bg-white dark:bg-[#1E2025] rounded border border-[#E2DFD8] dark:border-[#2E3138] px-2 flex items-center justify-between`}
                    >
                      <div class="w-16 h-2 bg-stone-300 dark:bg-stone-600 rounded"></div>
                      <div class="w-8 h-2 bg-stone-200 dark:bg-stone-700 rounded"></div>
                    </div>
                    <div
                      class={`w-full ${opt.sampleHeight} bg-white dark:bg-[#1E2025] rounded border border-[#E2DFD8] dark:border-[#2E3138] px-2 flex items-center justify-between`}
                    >
                      <div class="w-20 h-2 bg-stone-300 dark:bg-stone-600 rounded"></div>
                      <div class="w-6 h-2 bg-stone-200 dark:bg-stone-700 rounded"></div>
                    </div>
                  </div>
                </button>
              );
            }}
          </For>
        </div>
      </div>

      {/* Reading Pane Layout Mode */}
      <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-4">
        <div>
          <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
            Reading Pane Layout
          </h4>
          <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] mt-0.5">
            Choose between a multi-column split view or full-width list with modal reader.
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => {
              setLayoutMode("split");
              handleApply(density(), "split", theme());
            }}
            class={`p-4 rounded-xl border text-left transition flex items-start gap-3 cursor-pointer ${
              layoutMode() === "split"
                ? "border-[#A27561] bg-[#F3ECE8] dark:bg-[#2D2522] dark:border-[#A27561] shadow-xs"
                : "border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] hover:bg-white dark:hover:bg-[#252830]"
            }`}
          >
            <div class="w-10 h-10 rounded-lg bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-center text-lg flex-shrink-0 text-[#1A1B1E] dark:text-[#F3F4F6]">
              ◫
            </div>
            <div>
              <div class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Split Pane (Columns)</div>
              <div class="text-[11px] text-[#6E7075] dark:text-[#A1A1AA] mt-0.5 leading-snug">
                Message list on the left, full email reading pane on the right.
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setLayoutMode("full");
              handleApply(density(), "full", theme());
            }}
            class={`p-4 rounded-xl border text-left transition flex items-start gap-3 cursor-pointer ${
              layoutMode() === "full"
                ? "border-[#A27561] bg-[#F3ECE8] dark:bg-[#2D2522] dark:border-[#A27561] shadow-xs"
                : "border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] hover:bg-white dark:hover:bg-[#252830]"
            }`}
          >
            <div class="w-10 h-10 rounded-lg bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-center text-lg flex-shrink-0 text-[#1A1B1E] dark:text-[#F3F4F6]">
              ◻
            </div>
            <div>
              <div class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Full Width List</div>
              <div class="text-[11px] text-[#6E7075] dark:text-[#A1A1AA] mt-0.5 leading-snug">
                Full-width message rows; messages open in an expansive reading overlay.
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Color Theme */}
      <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-4">
        <div>
          <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
            Color Palette & Contrast
          </h4>
          <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] mt-0.5">
            Select high-clarity color grading designed for readability.
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => {
              setTheme("cloud_dancer");
              handleApply(density(), layoutMode(), "cloud_dancer");
            }}
            class={`p-4 rounded-xl border text-left transition flex items-center gap-3 cursor-pointer ${
              theme() === "cloud_dancer"
                ? "border-[#A27561] bg-[#F3ECE8] dark:bg-[#2D2522] dark:border-[#A27561] shadow-xs"
                : "border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] hover:bg-white dark:hover:bg-[#252830]"
            }`}
          >
            <div class="flex items-center gap-1.5 flex-shrink-0">
              <span class="w-4 h-4 rounded-full bg-[#F0EEE9] border border-stone-300"></span>
              <span class="w-4 h-4 rounded-full bg-[#A27561]"></span>
              <span class="w-4 h-4 rounded-full bg-[#464748]"></span>
            </div>
            <div>
              <div class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Cloud Dancer (Signature)</div>
              <div class="text-[10px] text-[#6E7075] dark:text-[#A1A1AA]">Warm alabaster, Mocha Mousse & Neutral Charcoal</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setTheme("dark");
              handleApply(density(), layoutMode(), "dark");
            }}
            class={`p-4 rounded-xl border text-left transition flex items-center gap-3 cursor-pointer ${
              theme() === "dark"
                ? "border-[#A27561] bg-[#F3ECE8] dark:bg-[#2D2522] dark:border-[#A27561] shadow-xs"
                : "border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] hover:bg-white dark:hover:bg-[#252830]"
            }`}
          >
            <div class="flex items-center gap-1.5 flex-shrink-0">
              <span class="w-4 h-4 rounded-full bg-[#121316] border border-[#2E3138]"></span>
              <span class="w-4 h-4 rounded-full bg-[#A27561]"></span>
              <span class="w-4 h-4 rounded-full bg-[#F3F4F6]"></span>
            </div>
            <div>
              <div class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Dark Mode</div>
              <div class="text-[10px] text-[#6E7075] dark:text-[#A1A1AA]">High-contrast deep carbon for low light environments</div>
            </div>
          </button>
        </div>
      </div>

      {/* Regional, Time Format & Week Start Section */}
      <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-5">
        <div>
          <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
            Language & Regional Format
          </h4>
          <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] mt-0.5">
            Configure system language, timestamp display format, and calendar week beginning.
          </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Language Selector */}
          <div class="p-4 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] space-y-2">
            <label class="block text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">
              Display Language
            </label>
            <select
              value={language()}
              onChange={(e) => {
                const val = e.currentTarget.value;
                setLanguage(val);
                handleApply(density(), layoutMode(), theme(), val, timeFormat(), weekStart());
              }}
              class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#1E2025] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#A27561] cursor-pointer"
            >
              <option value="en">English (US/UK)</option>
              <option value="es">Español (Spanish)</option>
              <option value="fr">Français (French)</option>
              <option value="de">Deutsch (German)</option>
            </select>
            <p class="text-[10px] text-[#6E7075] dark:text-[#A1A1AA]">
              Controls date localization and language presets.
            </p>
          </div>

          {/* Time Format Selector */}
          <div class="p-4 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] space-y-2">
            <label class="block text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">
              Time Format
            </label>
            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setTimeFormat("12h");
                  handleApply(density(), layoutMode(), theme(), language(), "12h", weekStart());
                }}
                class={`py-2 px-3 rounded-xl border text-xs font-medium text-center transition cursor-pointer ${
                  timeFormat() === "12h"
                    ? "border-[#A27561] bg-[#F3ECE8] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F] font-bold"
                    : "border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#1E2025] text-[#1A1B1E] dark:text-[#F3F4F6]"
                }`}
              >
                12-Hour (1:30 PM)
              </button>
              <button
                type="button"
                onClick={() => {
                  setTimeFormat("24h");
                  handleApply(density(), layoutMode(), theme(), language(), "24h", weekStart());
                }}
                class={`py-2 px-3 rounded-xl border text-xs font-medium text-center transition cursor-pointer ${
                  timeFormat() === "24h"
                    ? "border-[#A27561] bg-[#F3ECE8] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F] font-bold"
                    : "border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#1E2025] text-[#1A1B1E] dark:text-[#F3F4F6]"
                }`}
              >
                24-Hour (13:30)
              </button>
            </div>
            <p class="text-[10px] text-[#6E7075] dark:text-[#A1A1AA]">
              Applies to all email timestamps and sent indicators.
            </p>
          </div>

          {/* Week Start Selector */}
          <div class="p-4 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] space-y-2">
            <label class="block text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">
              Week Starts On
            </label>
            <select
              value={weekStart()}
              onChange={(e) => {
                const val = e.currentTarget.value as "sunday" | "monday" | "saturday";
                setWeekStart(val);
                handleApply(density(), layoutMode(), theme(), language(), timeFormat(), val);
              }}
              class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#1E2025] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#A27561] cursor-pointer"
            >
              <option value="sunday">Sunday</option>
              <option value="monday">Monday</option>
              <option value="saturday">Saturday</option>
            </select>
            <p class="text-[10px] text-[#6E7075] dark:text-[#A1A1AA]">
              Configures calendar schedules and date pickers.
            </p>
          </div>
        </div>
      </div>

      {/* Save Action Bar */}
      <div class="flex items-center justify-between pt-4 border-t border-[#E2DFD8] dark:border-[#2E3138]">
        <div class="flex items-center gap-2">
          <Show when={savedSuccess()}>
            <span class="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5">
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2.5]" viewBox="0 0 24 24">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Preferences saved
            </span>
          </Show>
          <Show when={saving()}>
            <span class="text-xs text-[#878A8E] dark:text-[#A1A1AA] flex items-center gap-1.5 font-mono">
              <div class="w-3 h-3 border-2 border-[#A27561] border-t-transparent rounded-full animate-spin"></div>
              Saving…
            </span>
          </Show>
        </div>

        <button
          type="button"
          disabled={saving()}
          onClick={() => handleApply(density(), layoutMode(), theme(), language(), timeFormat(), weekStart())}
          class="px-5 py-2.5 rounded-xl bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-semibold shadow-xs transition disabled:opacity-50 cursor-pointer flex items-center gap-2"
        >
          <Show when={saving()}>
            <div class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          </Show>
          <span>{saving() ? "Saving Preferences…" : "Save Preferences"}</span>
        </button>
      </div>
    </div>
  );
};
