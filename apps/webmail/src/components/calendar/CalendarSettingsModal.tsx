import { Component, Show, onMount, onCleanup } from "solid-js";
import { UserCalendar } from "../../api";
import { CalendarSettingsPanel } from "./settings/CalendarSettingsPanel";
import { DecryptedEventRecord } from "./CalendarSidebar";

interface CalendarSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  mailboxId?: string;
  mailboxKey?: Uint8Array | null;
  events?: DecryptedEventRecord[];
  currentUserEmail?: string;
  initialSectionId?: string;
  calendars?: UserCalendar[];
  onOpenCreateCalendar?: () => void;
  onOpenExploreHolidays?: () => void;
  onOpenSubscribeFromUrl?: () => void;
  onDeleteCalendar?: (calId: string) => Promise<void>;
  onUnsubscribeCalendar?: (cal: UserCalendar) => void;
}

export const CalendarSettingsModal: Component<CalendarSettingsModalProps> = (props) => {
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && props.isOpen) {
        props.onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 z-70 bg-black/50 backdrop-blur-xs flex items-center justify-center p-0 md:p-6 transition-opacity"
        role="dialog"
        aria-label="Calendar Settings"
        aria-modal="true"
        data-testid="calendar-settings-modal"
      >
        <div
          class="w-full h-full md:max-w-4xl md:h-[90vh] md:max-h-[820px] bg-white dark:bg-[#1E1F23] md:rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-[#E2DFD8] dark:border-[#2A2D35]"
          onClick={(e) => e.stopPropagation()}
        >
          <CalendarSettingsPanel
            mailboxId={props.mailboxId}
            mailboxKey={props.mailboxKey}
            events={props.events}
            currentUserEmail={props.currentUserEmail}
            initialSectionId={props.initialSectionId}
            calendars={props.calendars}
            onClose={props.onClose}
            isModal={true}
            onOpenCreateCalendar={props.onOpenCreateCalendar}
            onOpenExploreHolidays={props.onOpenExploreHolidays}
            onOpenSubscribeFromUrl={props.onOpenSubscribeFromUrl}
            onDeleteCalendar={props.onDeleteCalendar}
            onUnsubscribeCalendar={props.onUnsubscribeCalendar}
          />
        </div>
      </div>
    </Show>
  );
};
