import { Component, createSignal, createEffect, onMount, For, Show } from "solid-js";
import { Mailbox, UserMe, updateMailboxSettings, fetchMailboxSettings } from "../../api";
import { SUPPORTED_LANGUAGES } from "../../utils/translator";
import { t, setLocale } from "../../utils/i18n";

export interface AccountTabProps {
  mailbox: Mailbox;
  currentUser: UserMe | null;
  mailboxKey?: Uint8Array | null;
  profilePhotoUrl?: string | null;
  onPhotoUpdated?: (newUrl: string | null, newRef: string | null) => void;
  currentLanguage?: string;
  onLanguageChange?: (lang: string) => void;
  theme?: string;
  onThemeChange?: (theme: "cloud_dancer" | "dark") => void;
  showToast?: (msg: string) => void;
}

export const AccountTab: Component<AccountTabProps> = (props) => {
  const [saving, setSaving] = createSignal(false);
  const [savedSuccess, setSavedSuccess] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

  const [firstName, setFirstName] = createSignal("");
  const [lastName, setLastName] = createSignal("");
  const [nameSaving, setNameSaving] = createSignal(false);
  const [nameSavedSuccess, setNameSavedSuccess] = createSignal(false);

  const [language, setLanguage] = createSignal<string>(
    props.currentLanguage ||
      (typeof window !== "undefined" ? localStorage.getItem("byos_language") || "en" : "en")
  );

  const [timeFormat, setTimeFormat] = createSignal<"12h" | "24h">(
    typeof window !== "undefined" ? (localStorage.getItem("byos_time_format") as any) || "12h" : "12h"
  );

  createEffect(() => {
    if (props.currentLanguage) {
      setLanguage(props.currentLanguage);
    }
  });

  const email = () => props.currentUser?.email || `${props.mailbox.local_part}@byos.local`;

  // Parse existing display name into initial first and last name
  function parseNames(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const parts = trimmed.split(/\s+/);
    setFirstName(parts[0] || "");
    setLastName(parts.slice(1).join(" ") || "");
  }

  onMount(async () => {
    // Initialize from props.currentUser or mailbox local_part first
    const initialRaw = props.currentUser?.display_name || props.mailbox.local_part || "";
    parseNames(initialRaw);

    try {
      const s = await fetchMailboxSettings(props.mailbox.id);
      if (s.display_name) {
        parseNames(s.display_name);
      }
      if (s.language && !props.currentLanguage) {
        setLanguage(s.language);
        setLocale(s.language);
        if (typeof window !== "undefined") {
          localStorage.setItem("byos_language", s.language);
          document.documentElement.lang = s.language;
        }
      }
      if (s.time_format) {
        setTimeFormat(s.time_format);
      }
    } catch (err) {
      console.warn("Could not fetch mailbox settings in AccountTab:", err);
    }
  });

  const computedDisplayName = () => {
    const combined = `${firstName()} ${lastName()}`.trim();
    return combined || props.mailbox.local_part;
  };

  async function handleSaveName(e?: Event) {
    e?.preventDefault();
    setNameSaving(true);
    setErrorMessage(null);

    const combined = `${firstName()} ${lastName()}`.trim();
    try {
      await updateMailboxSettings(props.mailbox.id, { display_name: combined });
      if (props.currentUser) {
        props.currentUser.display_name = combined;
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("byos_display_name_updated", { detail: { displayName: combined } })
        );
      }
      props.showToast?.(t("Display name saved: {name}", { name: combined || props.mailbox.local_part }));
      setNameSavedSuccess(true);
      setTimeout(() => setNameSavedSuccess(false), 2500);
    } catch (err: any) {
      setErrorMessage(err?.message || t("Failed to update display name"));
    } finally {
      setNameSaving(false);
    }
  }

  async function handleLanguageSelect(newLang: string) {
    const prevLang = language();
    if (prevLang === newLang) return;
    setLanguage(newLang);
    setLocale(newLang);
    setSaving(true);
    setErrorMessage(null);

    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("byos_language", newLang);
        document.documentElement.lang = newLang;
        window.dispatchEvent(new CustomEvent("byos_language_changed", { detail: { language: newLang } }));
      }

      if (props.onLanguageChange) {
        props.onLanguageChange(newLang);
      } else {
        await updateMailboxSettings(props.mailbox.id, { language: newLang });
        props.showToast?.(t("Display language set to {lang}", { lang: newLang.toUpperCase() }));
      }

      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } catch (err: any) {
      setErrorMessage(err?.message || t("Failed to update language setting"));
    } finally {
      setSaving(false);
    }
  }

  async function handleTimeFormatSelect(newTf: "12h" | "24h") {
    setTimeFormat(newTf);
    if (typeof window !== "undefined") {
      localStorage.setItem("byos_time_format", newTf);
    }
    try {
      await updateMailboxSettings(props.mailbox.id, { time_format: newTf });
      props.showToast?.(t("Time format set to {format}", { format: newTf }));
    } catch (err) {
      console.warn("Failed to persist time format:", err);
    }
  }

  return (
    <div class="space-y-6 max-w-4xl mx-auto py-2">
      <div>
        <h2 class="text-lg font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">{t("Account Settings")}</h2>
        <p class="text-xs text-[#6E7075] dark:text-[#878A8E] mt-0.5">
          {t("Manage your sovereign personal identity, display preferences, and regional localization.")}
        </p>
      </div>

      <Show when={savedSuccess()}>
        <div class="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
          <svg class="w-4 h-4 text-emerald-600 dark:text-emerald-400 stroke-current fill-none stroke-[2.5]" viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{t("Account preferences saved successfully.")}</span>
        </div>
      </Show>

      <Show when={errorMessage()}>
        <div class="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between">
          <span>{errorMessage()}</span>
          <button type="button" onClick={() => setErrorMessage(null)} class="text-rose-500 hover:text-rose-700 cursor-pointer">✕</button>
        </div>
      </Show>

      {/* Editable Sovereign Identity (First Name, Last Name, Primary Email) */}
      <section class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] p-5 sm:p-6 shadow-2xs space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-sm font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">{t("Personal Identity")}</h3>
            <p class="text-[11px] text-[#6E7075] dark:text-[#878A8E] mt-0.5">
              {t("Configure your sender identity name. Appears on outbound emails and address headers.")}
            </p>
          </div>
          <span class="text-[11px] font-mono font-medium px-2 py-0.5 rounded-full bg-[#F2E8E2] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F] border border-[#A27561]/20">
            {props.mailbox.mode === "private" ? t("Private Mailbox") : t("Org-Managed")}
          </span>
        </div>

        <form onSubmit={handleSaveName} class="space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            {/* First Name Input */}
            <div class="space-y-1.5">
              <label for="settings-first-name-input" class="block font-medium text-[#1A1B1E] dark:text-[#F3F4F6]">
                {t("First Name")}
              </label>
              <input
                id="settings-first-name-input"
                data-testid="settings-first-name-input"
                type="text"
                placeholder={t("First name")}
                value={firstName()}
                onInput={(e) => setFirstName(e.currentTarget.value)}
                class="w-full px-3 py-2.5 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F7] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-1 focus:ring-[#A27561] focus:bg-white dark:focus:bg-[#1E2025] transition"
              />
            </div>

            {/* Last Name Input */}
            <div class="space-y-1.5">
              <label for="settings-last-name-input" class="block font-medium text-[#1A1B1E] dark:text-[#F3F4F6]">
                {t("Last Name")}
              </label>
              <input
                id="settings-last-name-input"
                data-testid="settings-last-name-input"
                type="text"
                placeholder={t("Last name")}
                value={lastName()}
                onInput={(e) => setLastName(e.currentTarget.value)}
                class="w-full px-3 py-2.5 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F7] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-1 focus:ring-[#A27561] focus:bg-white dark:focus:bg-[#1E2025] transition"
              />
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            {/* Computed Display Name Preview */}
            <div class="space-y-1.5">
              <span class="text-[#6E7075] dark:text-[#878A8E] font-medium">{t("Effective Display Name")}</span>
              <div
                data-testid="settings-display-name-preview"
                class="font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] p-2.5 rounded-xl bg-[#FAF9F7] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] flex items-center justify-between"
              >
                <span>{computedDisplayName()}</span>
                <span class="text-[10px] text-[#A27561] font-mono">{t("Active")}</span>
              </div>
            </div>

            {/* Primary Email (Read-only) */}
            <div class="space-y-1.5">
              <span class="text-[#6E7075] dark:text-[#878A8E] font-medium">{t("Primary Mailbox Address")}</span>
              <div
                data-testid="settings-primary-email"
                class="font-mono text-[#1A1B1E] dark:text-[#F3F4F6] p-2.5 rounded-xl bg-[#FAF9F7] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35]"
              >
                {email()}
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div class="flex items-center justify-between pt-2">
            <Show when={nameSavedSuccess()}>
              <span class="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5">
                <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>{t("Display name saved!")}</span>
              </span>
            </Show>
            <Show when={!nameSavedSuccess()}>
              <span />
            </Show>

            <button
              type="submit"
              data-testid="settings-save-name-btn"
              disabled={nameSaving()}
              class="px-4 py-2 rounded-xl bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-semibold transition disabled:opacity-50 flex items-center gap-2 shadow-2xs cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#A27561]/40"
            >
              <Show when={nameSaving()}>
                <div class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </Show>
              <span>{nameSaving() ? t("Saving…") : t("Save Display Name")}</span>
            </button>
          </div>
        </form>
      </section>

      {/* Language & Regional Localization */}
      <section class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] p-5 sm:p-6 shadow-2xs space-y-4">
        <div>
          <h3 class="text-sm font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">{t("Language & Regional Preferences")}</h3>
          <p class="text-xs text-[#6E7075] dark:text-[#878A8E] mt-0.5">
            {t("Set your preferred interface display language and timestamp formatting.")}
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Display Language */}
          <div class="p-4 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F7] dark:bg-[#18191D] space-y-2">
            <label for="settings-language-select" class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">
              {t("Display Language")}
            </label>
            <select
              id="settings-language-select"
              data-testid="settings-language-select"
              value={language()}
              onChange={(e) => handleLanguageSelect(e.currentTarget.value)}
              disabled={saving()}
              class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E2025] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-1 focus:ring-[#A27561] cursor-pointer"
            >
              <For each={SUPPORTED_LANGUAGES}>
                {(l) => (
                  <option value={l.code}>
                    {l.nativeName} ({l.name})
                  </option>
                )}
              </For>
            </select>
            <p class="text-[11px] text-[#6E7075] dark:text-[#878A8E]">
              {t("Controls UI strings and timestamp localization.")}
            </p>
          </div>

          {/* Time Format */}
          <div class="p-4 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F7] dark:bg-[#18191D] space-y-2">
            <span class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">
              {t("Time Format")}
            </span>
            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleTimeFormatSelect("12h")}
                data-testid="settings-time-12h"
                class={`py-2 px-3 rounded-xl border text-xs font-medium text-center transition cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#A27561]/40 ${
                  timeFormat() === "12h"
                    ? "border-[#A27561] bg-[#F2E8E2] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F] font-bold shadow-2xs"
                    : "border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E2025] text-[#1A1B1E] dark:text-[#F3F4F6]"
                }`}
              >
                {t("12-Hour (1:30 PM)")}
              </button>
              <button
                type="button"
                onClick={() => handleTimeFormatSelect("24h")}
                data-testid="settings-time-24h"
                class={`py-2 px-3 rounded-xl border text-xs font-medium text-center transition cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#A27561]/40 ${
                  timeFormat() === "24h"
                    ? "border-[#A27561] bg-[#F2E8E2] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F] font-bold shadow-2xs"
                    : "border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E2025] text-[#1A1B1E] dark:text-[#F3F4F6]"
                }`}
              >
                {t("24-Hour (13:30)")}
              </button>
            </div>
            <p class="text-[11px] text-[#6E7075] dark:text-[#878A8E]">
              {t("Applied to message dates and headers.")}
            </p>
          </div>
        </div>
      </section>

      {/* Appearance & Theme Preferences */}
      <section class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] p-5 sm:p-6 shadow-2xs space-y-4">
        <div>
          <h3 class="text-sm font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">{t("Appearance & Theme")}</h3>
          <p class="text-xs text-[#6E7075] dark:text-[#878A8E] mt-0.5">
            {t("Choose between warm Cloud Dancer light mode and low-glare dark mode.")}
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            data-testid="settings-theme-light-btn"
            onClick={() => props.onThemeChange?.("cloud_dancer")}
            class={`p-4 rounded-xl border flex items-center gap-3 transition cursor-pointer text-left ${
              props.theme !== "dark"
                ? "border-[#A27561] bg-[#F2E8E2] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F] font-bold shadow-2xs"
                : "border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F7] dark:bg-[#18191D] text-[#1A1B1E] dark:text-[#F3F4F6]"
            }`}
          >
            <div class="w-8 h-8 rounded-lg bg-white border border-[#E2DFD8] flex items-center justify-center text-[#1A1B1E] shadow-2xs flex-shrink-0">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            </div>
            <div>
              <div class="text-xs font-semibold">{t("Cloud Dancer (Light)")}</div>
              <div class="text-[10px] text-[#6E7075] dark:text-[#878A8E]">{t("Warm, editorial paper tone")}</div>
            </div>
          </button>

          <button
            type="button"
            data-testid="settings-theme-dark-btn"
            onClick={() => props.onThemeChange?.("dark")}
            class={`p-4 rounded-xl border flex items-center gap-3 transition cursor-pointer text-left ${
              props.theme === "dark"
                ? "border-[#A27561] bg-[#F2E8E2] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F] font-bold shadow-2xs"
                : "border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F7] dark:bg-[#18191D] text-[#1A1B1E] dark:text-[#F3F4F6]"
            }`}
          >
            <div class="w-8 h-8 rounded-lg bg-[#18191D] border border-[#2A2D35] flex items-center justify-center text-white shadow-2xs flex-shrink-0">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            </div>
            <div>
              <div class="text-xs font-semibold">{t("Dark")}</div>
              <div class="text-[10px] text-[#6E7075] dark:text-[#878A8E]">{t("Low-glare high-security dark palette")}</div>
            </div>
          </button>
        </div>
      </section>
    </div>
  );
};
