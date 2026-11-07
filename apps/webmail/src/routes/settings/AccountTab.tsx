import { Component, createSignal, createEffect, onMount, For, Show } from "solid-js";
import { Mailbox, UserMe, updateMailboxSettings, fetchMailboxSettings } from "../../api";
import { SUPPORTED_LANGUAGES } from "../../utils/translator";

export interface AccountTabProps {
  mailbox: Mailbox;
  currentUser: UserMe | null;
  mailboxKey?: Uint8Array | null;
  profilePhotoUrl?: string | null;
  onPhotoUpdated?: (newUrl: string | null, newRef: string | null) => void;
  currentLanguage?: string;
  onLanguageChange?: (lang: string) => void;
  showToast?: (msg: string) => void;
}

export const AccountTab: Component<AccountTabProps> = (props) => {
  const [saving, setSaving] = createSignal(false);
  const [savedSuccess, setSavedSuccess] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

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

  onMount(async () => {
    try {
      const s = await fetchMailboxSettings(props.mailbox.id);
      if (s.language) {
        setLanguage(s.language);
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

  const email = () => props.currentUser?.email || `${props.mailbox.local_part}@byos.local`;
  const displayName = () => props.currentUser?.display_name || props.mailbox.local_part;

  async function handleLanguageSelect(newLang: string) {
    setLanguage(newLang);
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
      }

      setSavedSuccess(true);
      props.showToast?.(`Display language set to ${newLang.toUpperCase()}`);
      setTimeout(() => setSavedSuccess(false), 2500);
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to update language setting");
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
      props.showToast?.(`Time format set to ${newTf}`);
    } catch (err) {
      console.warn("Failed to persist time format:", err);
    }
  }

  return (
    <div class="space-y-6 max-w-4xl mx-auto py-2">
      <div>
        <h2 class="text-lg font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Account Settings</h2>
        <p class="text-xs text-[#6E7075] dark:text-[#878A8E] mt-0.5">
          Manage your sovereign personal identity, display preferences, and regional localization.
        </p>
      </div>

      <Show when={savedSuccess()}>
        <div class="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
          <svg class="w-4 h-4 text-emerald-600 dark:text-emerald-400 stroke-current fill-none stroke-[2.5]" viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>Account preferences saved successfully.</span>
        </div>
      </Show>

      <Show when={errorMessage()}>
        <div class="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between">
          <span>{errorMessage()}</span>
          <button type="button" onClick={() => setErrorMessage(null)} class="text-rose-500 hover:text-rose-700 cursor-pointer">✕</button>
        </div>
      </Show>

      {/* Identity Information Details */}
      <section class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] p-5 sm:p-6 shadow-2xs space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">Identity Information</h3>
          <span class="text-[11px] font-mono font-medium px-2 py-0.5 rounded-full bg-[#F2E8E2] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F] border border-[#A27561]/20">
            {props.mailbox.mode === "private" ? "Private Mailbox" : "Org-Managed"}
          </span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div class="space-y-1.5">
            <span class="text-[#6E7075] dark:text-[#878A8E] font-medium">Display Name</span>
            <div class="font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] p-2.5 rounded-xl bg-[#FAF9F7] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35]">
              {displayName()}
            </div>
          </div>
          <div class="space-y-1.5">
            <span class="text-[#6E7075] dark:text-[#878A8E] font-medium">Primary Email</span>
            <div class="font-mono text-[#1A1B1E] dark:text-[#F3F4F6] p-2.5 rounded-xl bg-[#FAF9F7] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35]">
              {email()}
            </div>
          </div>
        </div>
      </section>

      {/* Language & Regional Localization */}
      <section class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] p-5 sm:p-6 shadow-2xs space-y-4">
        <div>
          <h3 class="text-sm font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">Language & Regional Preferences</h3>
          <p class="text-xs text-[#6E7075] dark:text-[#878A8E] mt-0.5">
            Set your preferred interface display language and timestamp formatting.
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Display Language */}
          <div class="p-4 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F7] dark:bg-[#18191D] space-y-2">
            <label for="settings-language-select" class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">
              Display Language
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
              Controls UI strings and timestamp localization.
            </p>
          </div>

          {/* Time Format */}
          <div class="p-4 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F7] dark:bg-[#18191D] space-y-2">
            <span class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">
              Time Format
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
                12-Hour (1:30 PM)
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
                24-Hour (13:30)
              </button>
            </div>
            <p class="text-[11px] text-[#6E7075] dark:text-[#878A8E]">
              Applied to message dates and headers.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
