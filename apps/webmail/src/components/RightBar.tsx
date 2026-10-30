import { Component } from "solid-js";

export type AppModule = "mail" | "calendar" | "notes";

export interface RightBarProps {
  activeModule?: AppModule;
  onSwitchModule?: (mod: AppModule) => void;
  onOpenContacts?: () => void;
}

export const RightBar: Component<RightBarProps> = (props) => {
  return (
    <aside
      role="toolbar"
      aria-label="Workspace Tools"
      data-testid="right-utility-bar"
      class="hidden md:flex w-12 h-full flex-col items-center py-3 bg-white dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] rounded-2xl shadow-2xs z-30 flex-shrink-0 select-none transition-colors"
    >
      {/* ── Primary Module Switchers (Email, Calendar, Notes) with Morphing Indicator ── */}
      <div class="relative flex flex-col items-center gap-1.5 w-full">
        {/* Morphing Sliding Highlight Pill (left-1.5 perfectly centers 36px pill in 48px bar) */}
        <div
          class="absolute left-1.5 w-9 h-9 rounded-xl bg-[#F3ECE8] dark:bg-[#2D2522] border border-[#9E725F]/30 shadow-2xs pointer-events-none transition-all duration-250 ease-[cubic-bezier(0.2,0,0,1)] z-0"
          style={{
            top:
              props.activeModule === "mail"
                ? "0px"
                : props.activeModule === "calendar"
                ? "42px"
                : props.activeModule === "notes"
                ? "84px"
                : "0px",
            opacity: props.activeModule ? "1" : "0",
            transform: props.activeModule ? "scale(1)" : "scale(0.95)",
          }}
        />

        {/* Emails Module Button */}
        <button
          type="button"
          onClick={() => props.onSwitchModule?.("mail")}
          data-testid="right-bar-emails-btn"
          title="Emails (Mailbox)"
          aria-label="Switch to Emails"
          aria-selected={props.activeModule === "mail"}
          class={`relative z-10 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150 ease-out cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/40 active:scale-95 bg-transparent border border-transparent ${
            props.activeModule === "mail"
              ? "text-[#9E725F] dark:text-[#E2B7A3] font-semibold"
              : "text-[#6E7075] dark:text-[#A1A1AA] hover:bg-[#F0EEE9]/60 dark:hover:bg-[#252830]/60 hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6]"
          }`}
        >
          <span data-testid="nav-emails-tab" class="flex items-center justify-center w-full h-full">
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </span>
        </button>

        {/* Calendar Module Button */}
        <button
          type="button"
          onClick={() => props.onSwitchModule?.("calendar")}
          data-testid="right-bar-calendar-btn"
          title="Calendar"
          aria-label="Switch to Calendar"
          aria-selected={props.activeModule === "calendar"}
          class={`relative z-10 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150 ease-out cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/40 active:scale-95 bg-transparent border border-transparent ${
            props.activeModule === "calendar"
              ? "text-[#9E725F] dark:text-[#E2B7A3] font-semibold"
              : "text-[#6E7075] dark:text-[#A1A1AA] hover:bg-[#F0EEE9]/60 dark:hover:bg-[#252830]/60 hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6]"
          }`}
        >
          <span data-testid="nav-calendar-tab" class="flex items-center justify-center w-full h-full">
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </span>
        </button>

        {/* Notes Module Button */}
        <button
          type="button"
          onClick={() => props.onSwitchModule?.("notes")}
          data-testid="right-bar-notes-btn"
          title="Notes"
          aria-label="Switch to Notes"
          aria-selected={props.activeModule === "notes"}
          class={`relative z-10 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150 ease-out cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/40 active:scale-95 bg-transparent border border-transparent ${
            props.activeModule === "notes"
              ? "text-[#9E725F] dark:text-[#E2B7A3] font-semibold"
              : "text-[#6E7075] dark:text-[#A1A1AA] hover:bg-[#F0EEE9]/60 dark:hover:bg-[#252830]/60 hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6]"
          }`}
        >
          <span data-testid="nav-notes-tab" class="flex items-center justify-center w-full h-full">
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </span>
        </button>
      </div>
    </aside>
  );
};
