import { Component, createSignal, Show } from "solid-js";

export interface MobileCalendarHeaderProps {
  periodTitle: string;
  selectedDate?: Date;
  onSelectDate?: (d: Date) => void;
  onToday: () => void;
  onOpenSidebar: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  profilePhotoUrl?: string | null;
  currentUserEmail?: string;
}

export const MobileCalendarHeader: Component<MobileCalendarHeaderProps> = (props) => {
  const [isSearchOpen, setIsSearchOpen] = createSignal(false);

  const todayDateNum = () => new Date().getDate();

  return (
    <header
      class="md:hidden relative flex items-center justify-between px-2.5 py-2 h-14 bg-[#F0EEE9] dark:bg-[#18191D] border-b border-[#E2DFD8] dark:border-[#2A2D35] flex-shrink-0 select-none z-30"
      data-testid="mobile-calendar-header"
    >
      <Show
        when={isSearchOpen()}
        fallback={
          <>
            {/* ── Left Cluster: Hamburger + Period Title ── */}
            <div class="flex items-center gap-1.5 min-w-0 flex-1">
              {/* Hamburger Button */}
              <button
                type="button"
                onClick={props.onOpenSidebar}
                class="flex items-center justify-center w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl text-[#3C3D3E] dark:text-[#ECEBE8] hover:bg-[#E8E5DF] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer flex-shrink-0"
                aria-label="Open navigation drawer"
                title="Open navigation drawer"
                data-testid="calendar-sidebar-toggle-btn"
              >
                <svg class="w-5 h-5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <line x1="3" y1="7" x2="21" y2="7" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="17" x2="21" y2="17" />
                </svg>
              </button>

              {/* Period Title */}
              <h2
                class="text-sm font-bold truncate max-w-[180px] sm:max-w-[240px] text-[#3C3D3E] dark:text-[#ECEBE8] px-1"
                data-testid="calendar-period-title"
              >
                <span>{props.periodTitle}</span>
              </h2>
            </div>

            {/* ── Right Cluster: Search Toggle + Dynamic Today + Avatar ── */}
            <div class="flex items-center gap-1 flex-shrink-0">
              {/* Search Toggle Button */}
              <button
                type="button"
                onClick={() => setIsSearchOpen(true)}
                class="flex items-center justify-center w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl text-[#3C3D3E] dark:text-[#ECEBE8] hover:bg-[#E8E5DF] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer"
                title="Search events"
                aria-label="Search events"
                data-testid="calendar-mobile-search-toggle-btn"
              >
                <svg class="w-4.5 h-4.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </button>

              {/* Dynamic Google Calendar Today Page Button */}
              <button
                type="button"
                onClick={props.onToday}
                class="relative flex flex-col items-center justify-center w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl hover:bg-[#E8E5DF] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer text-[#3C3D3E] dark:text-[#ECEBE8]"
                title="Go to Today"
                aria-label="Go to Today"
                data-testid="calendar-today-btn"
              >
                <div class="w-5.5 h-5.5 rounded-[4px] border border-[#3C3D3E] dark:border-[#ECEBE8] flex flex-col overflow-hidden bg-white dark:bg-[#1E1F23]">
                  <div class="h-1 bg-[#9E725F]" />
                  <div class="flex-1 flex items-center justify-center text-xs font-bold leading-none font-mono text-[#3C3D3E] dark:text-[#ECEBE8]">
                    {todayDateNum()}
                  </div>
                </div>
              </button>
            </div>
          </>
        }
      >
        {/* Expanded Search Bar */}
        <div class="flex items-center gap-2 w-full">
          <button
            type="button"
            onClick={() => {
              setIsSearchOpen(false);
              props.onSearchChange("");
            }}
            class="flex items-center justify-center w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl text-[#3C3D3E] dark:text-[#ECEBE8] hover:bg-[#E8E5DF] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer flex-shrink-0"
            aria-label="Close search"
          >
            <svg class="w-5 h-5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
          <div class="flex-1 relative flex items-center">
            <input
              type="text"
              placeholder="Search calendar…"
              value={props.searchQuery}
              onInput={(e) => props.onSearchChange(e.currentTarget.value)}
              class="w-full pl-2 pr-7 py-2 bg-white dark:bg-[#1E1F23] rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] text-sm text-[#3C3D3E] dark:text-[#ECEBE8] placeholder-[#6F7173] outline-none focus:border-[#9E725F]"
              data-testid="calendar-search-input"
              autofocus
            />
            <Show when={props.searchQuery}>
              <button
                type="button"
                onClick={() => props.onSearchChange("")}
                class="absolute right-2 text-[#6F7173] hover:text-[#3C3D3E] dark:hover:text-[#ECEBE8] cursor-pointer"
                aria-label="Clear search"
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </Show>
          </div>
        </div>
      </Show>
    </header>
  );
};
