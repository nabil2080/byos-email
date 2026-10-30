import { Component, createSignal, createEffect, onMount, onCleanup, For, Show } from "solid-js";
import { Mailbox, updateMailboxSettings } from "../api";
import { getFocusedInboxEnabled, setFocusedInboxEnabled } from "../focused_inbox";

export interface QuickSettingsPanelProps {
  mailbox: Mailbox | null;
  currentDensity: "compact" | "cozy" | "comfortable";
  currentLayout: "split" | "full";
  currentTheme: "cloud_dancer" | "dark";
  currentTimeFormat: "12h" | "24h";
  currentLanguage: string;
  currentWeekStart: "sunday" | "monday" | "saturday";
  focusedInboxEnabled?: boolean;
  viewMode?: "threads" | "flat";
  fontScale?: "default" | "large" | "xlarge";
  highContrast?: boolean;
  onDensityChange: (d: "compact" | "cozy" | "comfortable") => void;
  onLayoutChange: (l: "split" | "full") => void;
  onThemeChange: (t: "cloud_dancer" | "dark") => void;
  onTimeFormatChange: (tf: "12h" | "24h") => void;
  onLanguageChange: (lang: string) => void;
  onWeekStartChange: (ws: "sunday" | "monday" | "saturday") => void;
  onToggleFocusedInbox?: (enabled: boolean) => void;
  onToggleViewMode?: () => void;
  onFontScaleChange?: (scale: "default" | "large" | "xlarge") => void;
  onHighContrastChange?: (enabled: boolean) => void;
  onResetDefaults?: () => void;
  onClose: () => void;
  onOpenFullSettings?: () => void;
}

export const QuickSettingsPanel: Component<QuickSettingsPanelProps> = (props) => {
  const [saving, setSaving] = createSignal(false);
  const [savedSuccess, setSavedSuccess] = createSignal(false);
  const [lastSavedTime, setLastSavedTime] = createSignal<string>("Just now");

  // Local mirror signals for immediate reactivity
  const [density, setDensity] = createSignal<"compact" | "cozy" | "comfortable">(props.currentDensity || "cozy");
  const [layoutMode, setLayoutMode] = createSignal<"split" | "full">(props.currentLayout || "split");
  const [theme, setTheme] = createSignal<"cloud_dancer" | "dark">(props.currentTheme || "cloud_dancer");
  const [timeFormat, setTimeFormat] = createSignal<"12h" | "24h">(props.currentTimeFormat || "12h");
  const [language, setLanguage] = createSignal<string>(props.currentLanguage || "en");
  const [weekStart, setWeekStart] = createSignal<"sunday" | "monday" | "saturday">(props.currentWeekStart || "sunday");
  const [focusedInboxState, setFocusedInboxState] = createSignal<boolean>(
    props.focusedInboxEnabled !== undefined ? props.focusedInboxEnabled : getFocusedInboxEnabled()
  );
  const [fontScale, setFontScale] = createSignal<"default" | "large" | "xlarge">(props.fontScale || "default");
  const [highContrast, setHighContrast] = createSignal<boolean>(props.highContrast || false);

  // Sync with props
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
  createEffect(() => {
    if (props.focusedInboxEnabled !== undefined) setFocusedInboxState(props.focusedInboxEnabled);
  });
  createEffect(() => {
    if (props.fontScale) setFontScale(props.fontScale);
  });
  createEffect(() => {
    if (props.highContrast !== undefined) setHighContrast(props.highContrast);
  });

  // Handle escape key to close cleanly
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      props.onClose();
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDown);
  });

  async function triggerSave(
    newDensity = density(),
    newLayout = layoutMode(),
    newTheme = theme(),
    newLanguage = language(),
    newTimeFormat = timeFormat(),
    newWeekStart = weekStart()
  ) {
    setSaving(true);
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("byos_density", newDensity);
        localStorage.setItem("byos_layout", newLayout);
        localStorage.setItem("byos_theme", newTheme);
        localStorage.setItem("byos_language", newLanguage);
        localStorage.setItem("byos_time_format", newTimeFormat);
        localStorage.setItem("byos_week_start", newWeekStart);
      }

      if (props.mailbox?.id) {
        await updateMailboxSettings(props.mailbox.id, {
          density: newDensity,
          layout_mode: newLayout,
          theme: newTheme,
          language: newLanguage,
          time_format: newTimeFormat,
          week_start: newWeekStart,
        });
      }

      setSavedSuccess(true);
      const d = new Date();
      setLastSavedTime(
        d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })
      );
      setTimeout(() => setSavedSuccess(false), 2000);
    } catch (err) {
      console.warn("Failed to persist UI settings to backend:", err);
    } finally {
      setSaving(false);
    }
  }

  function handleDensitySelect(d: "compact" | "cozy" | "comfortable") {
    setDensity(d);
    props.onDensityChange(d);
    triggerSave(d, layoutMode(), theme(), language(), timeFormat(), weekStart());
  }

  function handleLayoutSelect(l: "split" | "full") {
    setLayoutMode(l);
    props.onLayoutChange(l);
    triggerSave(density(), l, theme(), language(), timeFormat(), weekStart());
  }

  function handleThemeSelect(t: "cloud_dancer" | "dark") {
    setTheme(t);
    props.onThemeChange(t);
    triggerSave(density(), layoutMode(), t, language(), timeFormat(), weekStart());
  }

  function handleTimeFormatSelect(tf: "12h" | "24h") {
    setTimeFormat(tf);
    props.onTimeFormatChange(tf);
    triggerSave(density(), layoutMode(), theme(), language(), tf, weekStart());
  }

  function handleLanguageSelect(lang: string) {
    setLanguage(lang);
    props.onLanguageChange(lang);
    triggerSave(density(), layoutMode(), theme(), lang, timeFormat(), weekStart());
  }

  function handleWeekStartSelect(ws: "sunday" | "monday" | "saturday") {
    setWeekStart(ws);
    props.onWeekStartChange(ws);
    triggerSave(density(), layoutMode(), theme(), language(), timeFormat(), ws);
  }

  function handleFocusedInboxToggle(enabled: boolean) {
    setFocusedInboxState(enabled);
    setFocusedInboxEnabled(enabled);
    props.onToggleFocusedInbox?.(enabled);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("byos_focused_inbox_changed", { detail: { enabled } }));
    }
  }

  function handleFontScaleSelect(scale: "default" | "large" | "xlarge") {
    setFontScale(scale);
    props.onFontScaleChange?.(scale);
    if (typeof window !== "undefined") {
      localStorage.setItem("byos_font_scale", scale);
    }
  }

  function handleHighContrastToggle(enabled: boolean) {
    setHighContrast(enabled);
    props.onHighContrastChange?.(enabled);
    if (typeof window !== "undefined") {
      localStorage.setItem("byos_high_contrast", enabled ? "true" : "false");
      if (enabled) {
        document.documentElement.classList.add("high-contrast");
      } else {
        document.documentElement.classList.remove("high-contrast");
      }
    }
  }

  function handleRestoreDefaults() {
    handleThemeSelect("cloud_dancer");
    handleLayoutSelect("split");
    handleDensitySelect("cozy");
    handleFontScaleSelect("default");
    handleTimeFormatSelect("12h");
    handleWeekStartSelect("sunday");
    handleLanguageSelect("en");
    handleHighContrastToggle(false);
    handleFocusedInboxToggle(true);
    props.onResetDefaults?.();
  }

  const densityList: {
    id: "compact" | "cozy" | "comfortable";
    label: string;
    desc: string;
    lineH: string;
  }[] = [
    {
      id: "compact",
      label: "Compact",
      desc: "Maximum rows, slim heights",
      lineH: "h-5 text-[11px]",
    },
    {
      id: "cozy",
      label: "Cozy",
      desc: "Balanced ergonomic density",
      lineH: "h-7 text-xs",
    },
    {
      id: "comfortable",
      label: "Comfortable",
      desc: "Relaxed spacing & airflow",
      lineH: "h-9 text-sm",
    },
  ];

  return (
    <aside
      data-testid="quick-settings-panel"
      role="region"
      aria-label="Appearance and UI Settings"
      class="w-full sm:w-88 md:w-92 xl:w-96 h-full flex flex-col bg-[#FAF9F6] dark:bg-[#18191D] border-l border-[#E2DFD8] dark:border-[#2A2D35] rounded-2xl shadow-xl md:shadow-2xs overflow-hidden flex-shrink-0 animate-slide-in-right z-30 lg:z-20 transition-colors"
    >
      {/* ── Panel Header ── */}
      <div class="px-5 py-4 border-b border-[#E2DFD8] dark:border-[#2A2D35] flex items-center justify-between flex-shrink-0 bg-white/70 dark:bg-[#1E2025]/70 backdrop-blur-xs lg:pr-28">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl bg-[#F3ECE8] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F] flex items-center justify-center flex-shrink-0 shadow-2xs">
            <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2a10 10 0 0 1 0 20v-20z" />
            </svg>
          </div>
          <div>
            <h2 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] tracking-tight uppercase font-mono">
              UI Customizer
            </h2>
            <p class="text-[11px] text-[#6E7075] dark:text-[#A1A1AA] leading-none mt-0.5">
              Instant layout & appearance tweaks
            </p>
          </div>
        </div>

        <div class="flex items-center gap-1.5">
          {/* Live Status indicator */}
          <Show when={savedSuccess()}>
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-[10px] font-mono text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 animate-fade-in">
              <svg class="w-3 h-3 stroke-current fill-none stroke-[2.5]" viewBox="0 0 24 24">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Saved</span>
            </span>
          </Show>

          <Show when={saving() && !savedSuccess()}>
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-[10px] font-mono text-stone-600 dark:text-stone-300">
              <div class="w-2.5 h-2.5 border-2 border-[#9E725F] border-t-transparent rounded-full animate-spin" />
              <span>Saving</span>
            </span>
          </Show>

          {/* Close Panel Button */}
          <button
            type="button"
            onClick={props.onClose}
            data-testid="close-quick-settings-btn"
            aria-label="Close UI Customizer"
            class="w-7 h-7 rounded-lg flex items-center justify-center text-[#6E7075] hover:text-[#1A1B1E] dark:text-[#A1A1AA] dark:hover:text-[#F3F4F6] hover:bg-[#F0EEE9] dark:hover:bg-[#252830] transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 ml-1"
          >
            <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Scrollable Tweaks Body ── */}
      <div class="flex-1 overflow-y-auto px-5 py-4 space-y-6 custom-scrollbar text-xs">
        {/* 1. Theme & Color Palette */}
        <section class="space-y-2.5">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold text-[#6E7075] dark:text-[#A1A1AA] uppercase tracking-wider font-mono">
              Palette & Theme
            </span>
            <span class="text-[10px] text-[#878A8E] font-mono capitalize">{theme()}</span>
          </div>

          <div class="grid grid-cols-2 gap-2.5">
            {/* Cloud Dancer Card */}
            <button
              type="button"
              onClick={() => handleThemeSelect("cloud_dancer")}
              data-testid="quick-theme-light"
              class={`p-3 rounded-xl border text-left transition flex flex-col justify-between cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 ${
                theme() === "cloud_dancer"
                  ? "border-[#9E725F] bg-[#F3ECE8] dark:bg-[#2D2522] shadow-2xs ring-1 ring-[#9E725F]"
                  : "border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E2025] hover:bg-[#F8F7F4] dark:hover:bg-[#252830]"
              }`}
            >
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-1.5">
                  <span class="w-3.5 h-3.5 rounded-full bg-[#F0EEE9] border border-[#D5D1C8]" title="Cloud Dancer Canvas" />
                  <span class="w-3.5 h-3.5 rounded-full bg-[#9E725F]" title="Mocha Mousse Primary" />
                  <span class="w-3.5 h-3.5 rounded-full bg-[#3C3D3E]" title="Neutral Charcoal" />
                </div>
                <Show when={theme() === "cloud_dancer"}>
                  <span class="w-3.5 h-3.5 rounded-full bg-[#9E725F] text-white flex items-center justify-center text-[9px] font-bold">
                    ✓
                  </span>
                </Show>
              </div>
              <div>
                <span class="font-bold text-xs text-[#1A1B1E] dark:text-[#F3F4F6] block">Cloud Dancer</span>
                <span class="text-[10px] text-[#6E7075] dark:text-[#A1A1AA]">Signature light alabaster</span>
              </div>
            </button>

            {/* Dark Charcoal Card */}
            <button
              type="button"
              onClick={() => handleThemeSelect("dark")}
              data-testid="quick-theme-dark"
              class={`p-3 rounded-xl border text-left transition flex flex-col justify-between cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 ${
                theme() === "dark"
                  ? "border-[#9E725F] bg-[#F3ECE8] dark:bg-[#2D2522] shadow-2xs ring-1 ring-[#9E725F]"
                  : "border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E2025] hover:bg-[#F8F7F4] dark:hover:bg-[#252830]"
              }`}
            >
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-1.5">
                  <span class="w-3.5 h-3.5 rounded-full bg-[#121316] border border-[#2E3138]" title="Carbon Deep Canvas" />
                  <span class="w-3.5 h-3.5 rounded-full bg-[#9E725F]" title="Mocha Mousse Primary" />
                  <span class="w-3.5 h-3.5 rounded-full bg-[#F3F4F6]" title="High-clarity Text" />
                </div>
                <Show when={theme() === "dark"}>
                  <span class="w-3.5 h-3.5 rounded-full bg-[#9E725F] text-white flex items-center justify-center text-[9px] font-bold">
                    ✓
                  </span>
                </Show>
              </div>
              <div>
                <span class="font-bold text-xs text-[#1A1B1E] dark:text-[#F3F4F6] block">Midnight Dark</span>
                <span class="text-[10px] text-[#6E7075] dark:text-[#A1A1AA]">Deep carbon slate</span>
              </div>
            </button>
          </div>
        </section>

        {/* 2. Reading Pane Architecture */}
        <section class="space-y-2.5">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold text-[#6E7075] dark:text-[#A1A1AA] uppercase tracking-wider font-mono">
              Reading Layout
            </span>
            <span class="text-[10px] text-[#878A8E] font-mono">
              {layoutMode() === "split" ? "Split 380px" : "Full List"}
            </span>
          </div>

          <div class="grid grid-cols-2 gap-2.5">
            {/* Split Pane Option */}
            <button
              type="button"
              onClick={() => handleLayoutSelect("split")}
              data-testid="quick-layout-split"
              class={`p-3 rounded-xl border text-left transition flex flex-col justify-between cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 ${
                layoutMode() === "split"
                  ? "border-[#9E725F] bg-[#F3ECE8] dark:bg-[#2D2522] shadow-2xs ring-1 ring-[#9E725F]"
                  : "border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E2025] hover:bg-[#F8F7F4] dark:hover:bg-[#252830]"
              }`}
            >
              <div class="w-full h-11 bg-white dark:bg-[#18191D] rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] p-1 flex gap-1 mb-2">
                <div class="w-2/5 h-full bg-[#E2DFD8] dark:bg-[#2E3138] rounded-xs" />
                <div class="w-3/5 h-full bg-[#F3ECE8] dark:bg-[#2D2522] border border-[#9E725F]/40 rounded-xs flex flex-col gap-0.5 p-0.5">
                  <div class="w-full h-1 bg-[#9E725F]/50 rounded-xs" />
                  <div class="w-2/3 h-1 bg-stone-300 dark:bg-stone-600 rounded-xs" />
                </div>
              </div>
              <span class="font-bold text-xs text-[#1A1B1E] dark:text-[#F3F4F6] block">Split Columns</span>
              <span class="text-[10px] text-[#6E7075] dark:text-[#A1A1AA]">Side-by-side reading</span>
            </button>

            {/* Full Width List Option */}
            <button
              type="button"
              onClick={() => handleLayoutSelect("full")}
              data-testid="quick-layout-full"
              class={`p-3 rounded-xl border text-left transition flex flex-col justify-between cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 ${
                layoutMode() === "full"
                  ? "border-[#9E725F] bg-[#F3ECE8] dark:bg-[#2D2522] shadow-2xs ring-1 ring-[#9E725F]"
                  : "border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E2025] hover:bg-[#F8F7F4] dark:hover:bg-[#252830]"
              }`}
            >
              <div class="w-full h-11 bg-white dark:bg-[#18191D] rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] p-1 flex flex-col gap-1 mb-2 justify-center">
                <div class="w-full h-2 bg-[#E2DFD8] dark:bg-[#2E3138] rounded-xs" />
                <div class="w-full h-2 bg-[#E2DFD8] dark:bg-[#2E3138] rounded-xs" />
              </div>
              <span class="font-bold text-xs text-[#1A1B1E] dark:text-[#F3F4F6] block">Full Width List</span>
              <span class="text-[10px] text-[#6E7075] dark:text-[#A1A1AA]">Expansive single list</span>
            </button>
          </div>
        </section>

        {/* 3. Inbox Message Density */}
        <section class="space-y-2.5">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold text-[#6E7075] dark:text-[#A1A1AA] uppercase tracking-wider font-mono">
              Inbox Density
            </span>
            <span class="text-[10px] text-[#878A8E] font-mono capitalize">{density()}</span>
          </div>

          <div class="space-y-2">
            <For each={densityList}>
              {(opt) => {
                const isSelected = () => density() === opt.id;
                return (
                  <button
                    type="button"
                    onClick={() => handleDensitySelect(opt.id)}
                    data-testid={`quick-density-${opt.id}`}
                    class={`w-full p-2.5 rounded-xl border text-left transition flex items-center justify-between cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 ${
                      isSelected()
                        ? "border-[#9E725F] bg-[#F3ECE8] dark:bg-[#2D2522] shadow-2xs ring-1 ring-[#9E725F]"
                        : "border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E2025] hover:bg-[#F8F7F4] dark:hover:bg-[#252830]"
                    }`}
                  >
                    <div class="flex items-center gap-2.5">
                      <span
                        class={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                          isSelected()
                            ? "border-[#9E725F] bg-[#9E725F]"
                            : "border-[#E2DFD8] dark:border-[#2E3138]"
                        }`}
                      >
                        {isSelected() && <span class="w-1.5 h-1.5 rounded-full bg-white" />}
                      </span>
                      <div>
                        <span class="font-bold text-xs text-[#1A1B1E] dark:text-[#F3F4F6]">{opt.label}</span>
                        <p class="text-[10px] text-[#6E7075] dark:text-[#A1A1AA] leading-none mt-0.5">{opt.desc}</p>
                      </div>
                    </div>

                    {/* Miniature live row snippet */}
                    <div class={`w-20 ${opt.lineH} bg-stone-100 dark:bg-stone-800 rounded px-1.5 flex items-center justify-between border border-stone-200 dark:border-stone-700`}>
                      <div class="w-8 h-1.5 bg-stone-400 dark:bg-stone-500 rounded" />
                      <div class="w-3 h-1.5 bg-stone-300 dark:bg-stone-600 rounded" />
                    </div>
                  </button>
                );
              }}
            </For>
          </div>
        </section>

        {/* 4. Reading Pane Font Sizing */}
        <section class="space-y-2.5">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold text-[#6E7075] dark:text-[#A1A1AA] uppercase tracking-wider font-mono">
              Reading Text Scale
            </span>
            <span class="text-[10px] text-[#878A8E] font-mono capitalize">{fontScale()}</span>
          </div>

          <div class="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => handleFontScaleSelect("default")}
              data-testid="font-scale-default"
              class={`py-2 px-2 rounded-xl border text-center transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 ${
                fontScale() === "default"
                  ? "border-[#9E725F] bg-[#F3ECE8] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F] font-bold shadow-2xs"
                  : "border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E2025] text-[#1A1B1E] dark:text-[#F3F4F6]"
              }`}
            >
              <span class="text-xs block">Standard</span>
              <span class="text-[9px] text-[#6E7075] dark:text-[#A1A1AA]">100%</span>
            </button>

            <button
              type="button"
              onClick={() => handleFontScaleSelect("large")}
              data-testid="font-scale-large"
              class={`py-2 px-2 rounded-xl border text-center transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 ${
                fontScale() === "large"
                  ? "border-[#9E725F] bg-[#F3ECE8] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F] font-bold shadow-2xs"
                  : "border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E2025] text-[#1A1B1E] dark:text-[#F3F4F6]"
              }`}
            >
              <span class="text-sm block">Large</span>
              <span class="text-[9px] text-[#6E7075] dark:text-[#A1A1AA]">110%</span>
            </button>

            <button
              type="button"
              onClick={() => handleFontScaleSelect("xlarge")}
              data-testid="font-scale-xlarge"
              class={`py-2 px-2 rounded-xl border text-center transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 ${
                fontScale() === "xlarge"
                  ? "border-[#9E725F] bg-[#F3ECE8] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F] font-bold shadow-2xs"
                  : "border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E2025] text-[#1A1B1E] dark:text-[#F3F4F6]"
              }`}
            >
              <span class="text-base block font-medium">Extra</span>
              <span class="text-[9px] text-[#6E7075] dark:text-[#A1A1AA]">120%</span>
            </button>
          </div>
        </section>

        {/* 5. Focused Inbox (Smart Categories) */}
        <section class="p-3.5 bg-white dark:bg-[#1E2025] rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] shadow-2xs space-y-3">
          <div class="flex items-center justify-between">
            <div>
              <span class="font-bold text-xs text-[#1A1B1E] dark:text-[#F3F4F6] block">Focused Inbox</span>
              <p class="text-[10px] text-[#6E7075] dark:text-[#A1A1AA] leading-tight mt-0.5">
                Sort incoming mail into smart category tabs
              </p>
            </div>

            <label
              data-testid="focused-inbox-toggle-label"
              class="relative inline-flex items-center cursor-pointer"
            >
              <input
                type="checkbox"
                id="focused-inbox-toggle"
                data-testid="focused-inbox-toggle"
                checked={focusedInboxState()}
                onChange={(e) => handleFocusedInboxToggle(e.currentTarget.checked)}
                class="sr-only peer"
              />
              <div class="w-9 h-5 bg-[#E2DFD8] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#9E725F]/50 dark:bg-[#2E3138] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#9E725F]" />
            </label>
          </div>

          {/* Category Chip Previews */}
          <div class="flex flex-wrap gap-1.5 pt-1 border-t border-[#E2DFD8]/60 dark:border-[#2E3138]">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#F3ECE8] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F] border border-[#9E725F]/20">
              📥 Primary
            </span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
              🔔 Notifications
            </span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
              📰 Newsletters
            </span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
              👥 Social
            </span>
          </div>
        </section>

        {/* 6. Message Grouping (View Mode) */}
        <Show when={props.onToggleViewMode}>
          <section class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-bold text-[#6E7075] dark:text-[#A1A1AA] uppercase tracking-wider font-mono">
                Message Grouping
              </span>
              <span class="text-[10px] text-[#878A8E] font-mono capitalize">
                {props.viewMode === "threads" ? "Conversations" : "Flat List"}
              </span>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => props.viewMode !== "threads" && props.onToggleViewMode?.()}
                data-testid="quick-view-threads"
                class={`py-2 px-3 rounded-xl border text-center transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 ${
                  props.viewMode === "threads"
                    ? "border-[#9E725F] bg-[#F3ECE8] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F] font-bold shadow-2xs"
                    : "border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E2025] text-[#1A1B1E] dark:text-[#F3F4F6]"
                }`}
              >
                Threads (Grouped)
              </button>

              <button
                type="button"
                onClick={() => props.viewMode === "threads" && props.onToggleViewMode?.()}
                data-testid="quick-view-flat"
                class={`py-2 px-3 rounded-xl border text-center transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 ${
                  props.viewMode !== "threads"
                    ? "border-[#9E725F] bg-[#F3ECE8] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F] font-bold shadow-2xs"
                    : "border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E2025] text-[#1A1B1E] dark:text-[#F3F4F6]"
                }`}
              >
                Flat Chronological
              </button>
            </div>
          </section>
        </Show>

        {/* 7. Time & Regional Formats */}
        <section class="space-y-3">
          <span class="text-[10px] font-bold text-[#6E7075] dark:text-[#A1A1AA] uppercase tracking-wider font-mono block">
            Regional & Time
          </span>

          <div class="grid grid-cols-2 gap-2">
            {/* 12h vs 24h */}
            <button
              type="button"
              onClick={() => handleTimeFormatSelect("12h")}
              data-testid="quick-time-12h"
              class={`py-2 px-2.5 rounded-xl border text-center transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 ${
                timeFormat() === "12h"
                  ? "border-[#9E725F] bg-[#F3ECE8] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F] font-bold shadow-2xs"
                  : "border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E2025] text-[#1A1B1E] dark:text-[#F3F4F6]"
              }`}
            >
              12-Hour (1:30 PM)
            </button>
            <button
              type="button"
              onClick={() => handleTimeFormatSelect("24h")}
              data-testid="quick-time-24h"
              class={`py-2 px-2.5 rounded-xl border text-center transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 ${
                timeFormat() === "24h"
                  ? "border-[#9E725F] bg-[#F3ECE8] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F] font-bold shadow-2xs"
                  : "border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E2025] text-[#1A1B1E] dark:text-[#F3F4F6]"
              }`}
            >
              24-Hour (13:30)
            </button>
          </div>

          {/* Language Control */}
          <div>
            <label class="block text-[10px] text-[#6E7075] dark:text-[#A1A1AA] mb-1 font-mono">
              Language
            </label>
            <select
              value={language()}
              onChange={(e) => handleLanguageSelect(e.currentTarget.value)}
              data-testid="quick-language-select"
              class="w-full px-2.5 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#1E2025] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 cursor-pointer"
            >
              <option value="en">English (US)</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
            </select>
          </div>
        </section>

        {/* 8. High Contrast Toggle */}
        <section class="p-3 bg-white dark:bg-[#1E2025] rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] flex items-center justify-between">
          <div>
            <span class="font-bold text-xs text-[#1A1B1E] dark:text-[#F3F4F6] block">High Contrast Borders</span>
            <span class="text-[10px] text-[#6E7075] dark:text-[#A1A1AA]">Sharp container outlines</span>
          </div>

          <label class="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              data-testid="quick-high-contrast-toggle"
              checked={highContrast()}
              onChange={(e) => handleHighContrastToggle(e.currentTarget.checked)}
              class="sr-only peer"
            />
            <div class="w-9 h-5 bg-[#E2DFD8] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#9E725F]/50 dark:bg-[#2E3138] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#9E725F]" />
          </label>
        </section>
      </div>

      {/* ── Panel Footer Action Bar ── */}
      <div class="px-5 py-3.5 border-t border-[#E2DFD8] dark:border-[#2A2D35] bg-white/70 dark:bg-[#1E2025]/70 backdrop-blur-xs flex items-center justify-between flex-shrink-0">
        <button
          type="button"
          onClick={handleRestoreDefaults}
          data-testid="quick-reset-defaults-btn"
          class="text-[11px] text-[#6E7075] hover:text-[#1A1B1E] dark:text-[#A1A1AA] dark:hover:text-[#F3F4F6] hover:underline cursor-pointer transition font-medium"
        >
          Reset to Defaults
        </button>

        <Show when={props.onOpenFullSettings}>
          <button
            type="button"
            onClick={props.onOpenFullSettings}
            data-testid="quick-open-full-settings-btn"
            class="text-[11px] text-[#9E725F] dark:text-[#D4A38F] hover:text-[#865E4D] font-semibold flex items-center gap-1 cursor-pointer"
          >
            <span>Full Settings</span>
            <span>→</span>
          </button>
        </Show>
      </div>
    </aside>
  );
};
