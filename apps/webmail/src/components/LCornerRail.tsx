import { Component, createSignal, Show } from "solid-js";

export type AppModule = "mail" | "calendar" | "notes";

export interface LCornerRailProps {
  activeModule?: AppModule;
  onSwitchModule?: (mod: AppModule) => void;
  isCustomizerOpen?: boolean;
  onToggleCustomizer?: () => void;
  theme?: string;
  onToggleTheme?: () => void;
  class?: string;
}

export const LCornerRail: Component<LCornerRailProps> = (props) => {
  const [hoveredItem, setHoveredItem] = createSignal<string | null>(null);

  const isDark = () => props.theme === "dark";

  return (
    <aside
      role="toolbar"
      aria-label="Workspace Tools and Navigation"
      data-testid="right-utility-bar"
      data-testid-secondary="l-corner-rail"
      class={`hidden md:block relative select-none z-50 flex-shrink-0 ${props.class || ""}`}
      style={{ width: "136px", height: "180px" }}
    >
      {/* ── Continuous L-Shaped SVG Rail Container ── */}
      {/* 
        Geometry:
        - Width: 136px, Height: 180px
        - Horizontal track: 48px height, 2 buttons (Palette, Theme)
        - Vertical track: 48px width, 3 buttons (Mail, Calendar, Notes)
        - Outer top-right corner: Smooth 28px convex curve
        - Inner elbow corner: Smooth 20px concave fillet (zero sharp angles)
        - Left & Bottom caps: 24px semi-circle rounded bulbs
      */}
      <svg
        class="absolute inset-0 w-[136px] h-[180px] pointer-events-none drop-shadow-[0_4px_16px_rgba(0,0,0,0.06)] dark:drop-shadow-[0_4px_20px_rgba(0,0,0,0.45)] transition-colors duration-200"
        viewBox="0 0 136 180"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M 24,48 A 24,24 0 0,1 24,0 L 108,0 A 28,28 0 0,1 136,28 L 136,156 A 24,24 0 0,1 88,156 L 88,68 A 20,20 0 0,0 68,48 L 24,48 Z"
          class="fill-white dark:fill-[#18191D] stroke-[#E2DFD8] dark:stroke-[#2E3138] transition-colors duration-200"
          stroke-width="1.2"
        />
      </svg>

      {/* ── Morphing Sliding Highlight Pill in vertical arm ── */}
      <div
        data-testid="right-bar-morphing-pill"
        class="absolute left-[94px] w-9 h-9 rounded-xl bg-[#F3ECE8] dark:bg-[#2D2522] border border-[#9E725F]/30 shadow-2xs pointer-events-none transition-all duration-250 ease-[cubic-bezier(0.2,0,0,1)] z-0"
        style={{
          top:
            props.activeModule === "mail"
              ? "54px"
              : props.activeModule === "calendar"
              ? "96px"
              : props.activeModule === "notes"
              ? "138px"
              : "54px",
          opacity: props.activeModule ? "1" : "0",
          transform: props.activeModule ? "scale(1)" : "scale(0.95)",
        }}
      />

      {/* ── 1. PALETTE (Appearance Customizer) ── */}
      <div class="absolute left-[6px] top-[6px]">
        <button
          type="button"
          onClick={() => props.onToggleCustomizer?.()}
          onMouseEnter={() => setHoveredItem("palette")}
          onMouseLeave={() => setHoveredItem(null)}
          data-testid="top-bar-appearance-btn"
          data-testid-secondary="right-bar-appearance-btn"
          title="Customize Appearance & Themes"
          aria-label="Customize Appearance & Themes"
          aria-expanded={props.isCustomizerOpen}
          class={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150 ease-out cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/40 active:scale-95 ${
            props.isCustomizerOpen
              ? "bg-[#F3ECE8] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#E2B7A3] font-semibold border border-[#9E725F]/40 shadow-2xs"
              : "text-[#6E7075] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 border border-transparent"
          }`}
        >
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <circle cx="13.5" cy="6.5" r="1.5" />
            <circle cx="17.5" cy="10.5" r="1.5" />
            <circle cx="8.5" cy="7.5" r="1.5" />
            <circle cx="6.5" cy="12.5" r="1.5" />
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 9.5 10c.8 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.4-.4-.8-.4-1.4 0-1.1.9-2 2-2h2.3c3.6 0 6.5-2.9 6.5-6.5C23 6 18 2 12 2z" />
          </svg>
          <Show when={props.isCustomizerOpen}>
            <span class="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#9E725F]" />
          </Show>
        </button>

        {/* Hover Tooltip */}
        <Show when={hoveredItem() === "palette"}>
          <div class="absolute left-1/2 -translate-x-1/2 top-full mt-2 px-2.5 py-1 rounded-lg bg-[#1E1F23] text-white text-[11px] font-medium whitespace-nowrap shadow-xl pointer-events-none z-50 animate-fade-in">
            Customize
          </div>
        </Show>
      </div>

      {/* ── 2. THEME SWITCHER (Light / Dark Mode) ── */}
      <div class="absolute left-[48px] top-[6px]">
        <button
          type="button"
          onClick={() => props.onToggleTheme?.()}
          onMouseEnter={() => setHoveredItem("theme")}
          onMouseLeave={() => setHoveredItem(null)}
          data-testid="top-bar-theme-toggle"
          data-testid-secondary="right-bar-theme-toggle"
          aria-label={isDark() ? "Switch to Light Mode" : "Switch to Dark Mode"}
          title={isDark() ? "Switch to Light Mode" : "Switch to Dark Mode"}
          class="w-9 h-9 rounded-xl flex items-center justify-center text-[#6E7075] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 transition-all duration-150 ease-out cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/40 active:scale-95 border border-transparent"
        >
          <Show
            when={isDark()}
            fallback={
              <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            }
          >
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
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
          </Show>
        </button>

        {/* Hover Tooltip */}
        <Show when={hoveredItem() === "theme"}>
          <div class="absolute left-1/2 -translate-x-1/2 top-full mt-2 px-2.5 py-1 rounded-lg bg-[#1E1F23] text-white text-[11px] font-medium whitespace-nowrap shadow-xl pointer-events-none z-50 animate-fade-in">
            {isDark() ? "Light Mode" : "Dark Mode"}
          </div>
        </Show>
      </div>

      {/* ── 3. EMAILS MODULE (Mailbox) ── */}
      <div class="absolute left-[94px] top-[54px]">
        <button
          type="button"
          onClick={() => props.onSwitchModule?.("mail")}
          onMouseEnter={() => setHoveredItem("mail")}
          onMouseLeave={() => setHoveredItem(null)}
          data-testid="right-bar-emails-btn"
          title="Emails (Mailbox)"
          aria-label="Switch to Emails"
          aria-selected={props.activeModule === "mail"}
          class={`relative z-10 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150 ease-out cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/40 active:scale-95 bg-transparent border border-transparent ${
            props.activeModule === "mail"
              ? "text-[#9E725F] dark:text-[#E2B7A3] font-semibold"
              : "text-[#6E7075] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5"
          }`}
        >
          <span data-testid="nav-emails-tab" class="flex items-center justify-center w-full h-full">
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </span>
        </button>

        {/* Hover Tooltip (Pops out to the left or right) */}
        <Show when={hoveredItem() === "mail"}>
          <div class="absolute right-full mr-2.5 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-[#1E1F23] text-white text-[11px] font-medium whitespace-nowrap shadow-xl pointer-events-none z-50 animate-fade-in flex items-center">
            Emails
          </div>
        </Show>
      </div>

      {/* ── 4. CALENDAR MODULE ── */}
      <div class="absolute left-[94px] top-[96px]">
        <button
          type="button"
          onClick={() => props.onSwitchModule?.("calendar")}
          onMouseEnter={() => setHoveredItem("calendar")}
          onMouseLeave={() => setHoveredItem(null)}
          data-testid="right-bar-calendar-btn"
          title="Calendar"
          aria-label="Switch to Calendar"
          aria-selected={props.activeModule === "calendar"}
          class={`relative z-10 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150 ease-out cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/40 active:scale-95 bg-transparent border border-transparent ${
            props.activeModule === "calendar"
              ? "text-[#9E725F] dark:text-[#E2B7A3] font-semibold"
              : "text-[#6E7075] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5"
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

        {/* Hover Tooltip (Matching 'Calendar' pill in reference mockup) */}
        <Show when={hoveredItem() === "calendar"}>
          <div class="absolute right-full mr-2.5 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-[#1E1F23] text-white text-[11px] font-medium whitespace-nowrap shadow-xl pointer-events-none z-50 animate-fade-in flex items-center">
            Calendar
          </div>
        </Show>
      </div>

      {/* ── 5. NOTES MODULE ── */}
      <div class="absolute left-[94px] top-[138px]">
        <button
          type="button"
          onClick={() => props.onSwitchModule?.("notes")}
          onMouseEnter={() => setHoveredItem("notes")}
          onMouseLeave={() => setHoveredItem(null)}
          data-testid="right-bar-notes-btn"
          title="Notes"
          aria-label="Switch to Notes"
          aria-selected={props.activeModule === "notes"}
          class={`relative z-10 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150 ease-out cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/40 active:scale-95 bg-transparent border border-transparent ${
            props.activeModule === "notes"
              ? "text-[#9E725F] dark:text-[#E2B7A3] font-semibold"
              : "text-[#6E7075] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5"
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

        {/* Hover Tooltip */}
        <Show when={hoveredItem() === "notes"}>
          <div class="absolute right-full mr-2.5 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-[#1E1F23] text-white text-[11px] font-medium whitespace-nowrap shadow-xl pointer-events-none z-50 animate-fade-in flex items-center">
            Notes
          </div>
        </Show>
      </div>
    </aside>
  );
};
