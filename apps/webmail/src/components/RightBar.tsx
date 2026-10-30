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
      {/* ── Primary Module Switchers (Email, Calendar, Notes, Contacts) ── */}
      <div class="flex flex-col items-center gap-1.5 w-full">
        {/* Emails Module Button */}
        <button
          type="button"
          onClick={() => props.onSwitchModule?.("mail")}
          data-testid="nav-emails-tab"
          data-testid-secondary="right-bar-emails-btn"
          title="Emails (Mailbox)"
          aria-label="Switch to Emails"
          aria-selected={props.activeModule === "mail"}
          class={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150 ease-out cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/40 active:scale-95 ${
            props.activeModule === "mail"
              ? "bg-[#F3ECE8] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#E2B7A3] shadow-2xs font-semibold border border-[#9E725F]/30"
              : "text-[#6E7075] dark:text-[#A1A1AA] hover:bg-[#F0EEE9] dark:hover:bg-[#252830] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] border border-transparent"
          }`}
        >
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8] pointer-events-none" viewBox="0 0 24 24">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
        </button>

        {/* Calendar Module Button */}
        <button
          type="button"
          onClick={() => props.onSwitchModule?.("calendar")}
          data-testid="nav-calendar-tab"
          data-testid-secondary="right-bar-calendar-btn"
          title="Calendar"
          aria-label="Switch to Calendar"
          aria-selected={props.activeModule === "calendar"}
          class={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150 ease-out cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/40 active:scale-95 ${
            props.activeModule === "calendar"
              ? "bg-[#F3ECE8] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#E2B7A3] shadow-2xs font-semibold border border-[#9E725F]/30"
              : "text-[#6E7075] dark:text-[#A1A1AA] hover:bg-[#F0EEE9] dark:hover:bg-[#252830] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] border border-transparent"
          }`}
        >
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8] pointer-events-none" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>

        {/* Notes Module Button */}
        <button
          type="button"
          onClick={() => props.onSwitchModule?.("notes")}
          data-testid="nav-notes-tab"
          data-testid-secondary="right-bar-notes-btn"
          title="Notes"
          aria-label="Switch to Notes"
          aria-selected={props.activeModule === "notes"}
          class={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150 ease-out cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/40 active:scale-95 ${
            props.activeModule === "notes"
              ? "bg-[#F3ECE8] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#E2B7A3] shadow-2xs font-semibold border border-[#9E725F]/30"
              : "text-[#6E7075] dark:text-[#A1A1AA] hover:bg-[#F0EEE9] dark:hover:bg-[#252830] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] border border-transparent"
          }`}
        >
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8] pointer-events-none" viewBox="0 0 24 24">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        </button>

        {/* Subtle 1px structural container divider */}
        <div class="w-5 h-px bg-[#E2DFD8] dark:bg-[#2A2D35] my-0.5" />

        {/* Contacts Modal Trigger Button */}
        <button
          type="button"
          onClick={() => props.onOpenContacts?.()}
          data-testid="contacts-nav-btn"
          data-testid-secondary="right-bar-contacts-btn"
          aria-label="Open Contacts"
          title="Contacts"
          class="w-9 h-9 rounded-xl flex items-center justify-center text-[#6E7075] dark:text-[#A1A1AA] hover:bg-[#F0EEE9] dark:hover:bg-[#252830] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] transition-all duration-150 ease-out cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/40 active:scale-95 border border-transparent"
        >
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </button>
      </div>
    </aside>
  );
};
