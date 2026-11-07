import { Component, Show } from "solid-js";
import { AppModule } from "./TopFixedBar";

export interface BottomFixedBarProps {
  activeModule: AppModule;
  onSwitchModule: (module: AppModule) => void;
  unreadCount?: number;
}

export const BottomFixedBar: Component<BottomFixedBarProps> = (props) => {
  return (
    <nav
      aria-label="Mobile Navigation Bar"
      data-testid="bottom-fixed-bar"
      class="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 dark:bg-[#18191D]/95 backdrop-blur-md border-t border-[#E2DFD8] dark:border-[#2E3138] px-4 py-1.5 flex items-center justify-around select-none shadow-[0_-4px_16px_rgba(0,0,0,0.04)] h-16"
    >
      {/* 1. Mailbox Tab */}
      <button
        type="button"
        role="tab"
        aria-selected={props.activeModule === "mail"}
        aria-label="Mailbox"
        data-testid="bottom-nav-mail-tab"
        onClick={() => props.onSwitchModule("mail")}
        class={`flex flex-col items-center justify-center flex-1 h-full min-h-[48px] min-w-[44px] py-1 px-2 rounded-xl transition-all duration-150 active:scale-95 relative cursor-pointer ${
          props.activeModule === "mail"
            ? "text-[#9E725F] dark:text-[#E2B7A3]"
            : "text-[#6E7075] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6]"
        }`}
      >
        <div class="relative">
          <svg class="w-6 h-6 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
          <Show when={(props.unreadCount || 0) > 0}>
            <span class="absolute -top-1 -right-2 min-w-[18px] h-4.5 px-1.5 rounded-full bg-[#9E725F] text-white text-xs font-mono font-bold flex items-center justify-center leading-none">
              {props.unreadCount! > 99 ? "99+" : props.unreadCount}
            </span>
          </Show>
        </div>
        <span class={`text-[13px] mt-0.5 tracking-tight ${props.activeModule === "mail" ? "font-bold" : "font-medium"}`}>
          Mail
        </span>
        <Show when={props.activeModule === "mail"}>
          <div class="absolute bottom-0 w-8 h-0.5 bg-[#9E725F] dark:bg-[#E2B7A3] rounded-full animate-view-fade" />
        </Show>
      </button>

      {/* 2. Calendar Tab */}
      <button
        type="button"
        role="tab"
        aria-selected={props.activeModule === "calendar"}
        aria-label="Calendar"
        data-testid="bottom-nav-calendar-tab"
        onClick={() => props.onSwitchModule("calendar")}
        class={`flex flex-col items-center justify-center flex-1 h-full min-h-[48px] min-w-[44px] py-1 px-2 rounded-xl transition-all duration-150 active:scale-95 relative cursor-pointer ${
          props.activeModule === "calendar"
            ? "text-[#9E725F] dark:text-[#E2B7A3]"
            : "text-[#6E7075] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6]"
        }`}
      >
        <div class="relative">
          <svg class="w-6 h-6 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
        <span class={`text-[13px] mt-0.5 tracking-tight ${props.activeModule === "calendar" ? "font-bold" : "font-medium"}`}>
          Calendar
        </span>
        <Show when={props.activeModule === "calendar"}>
          <div class="absolute bottom-0 w-8 h-0.5 bg-[#9E725F] dark:bg-[#E2B7A3] rounded-full animate-view-fade" />
        </Show>
      </button>

      {/* 3. Notes Tab */}
      <button
        type="button"
        role="tab"
        aria-selected={props.activeModule === "notes"}
        aria-label="Notes"
        data-testid="bottom-nav-notes-tab"
        onClick={() => props.onSwitchModule("notes")}
        class={`flex flex-col items-center justify-center flex-1 h-full min-h-[48px] min-w-[44px] py-1 px-2 rounded-xl transition-all duration-150 active:scale-95 relative cursor-pointer ${
          props.activeModule === "notes"
            ? "text-[#9E725F] dark:text-[#E2B7A3]"
            : "text-[#6E7075] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6]"
        }`}
      >
        <div class="relative">
          <svg class="w-6 h-6 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        </div>
        <span class={`text-[13px] mt-0.5 tracking-tight ${props.activeModule === "notes" ? "font-bold" : "font-medium"}`}>
          Notes
        </span>
        <Show when={props.activeModule === "notes"}>
          <div class="absolute bottom-0 w-8 h-0.5 bg-[#9E725F] dark:bg-[#E2B7A3] rounded-full animate-view-fade" />
        </Show>
      </button>
    </nav>
  );
};
