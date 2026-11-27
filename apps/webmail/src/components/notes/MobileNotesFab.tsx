import { Component } from "solid-js";

export interface MobileNotesFabProps {
  onNewNote: () => void;
}

export const MobileNotesFab: Component<MobileNotesFabProps> = (props) => {
  return (
    <button
      type="button"
      onClick={props.onNewNote}
      data-testid="mobile-notes-fab"
      aria-label="Create new note"
      title="Create new note"
      class="lg:hidden fixed bottom-20 right-4 sm:right-6 z-40 w-12 h-12 rounded-2xl bg-[#9E725F] hover:bg-[#865E4D] active:scale-95 text-white shadow-xl shadow-[#9E725F]/35 flex items-center justify-center transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 focus:ring-offset-2"
    >
      <svg
        class="w-6 h-6 stroke-current fill-none stroke-[2.2]"
        viewBox="0 0 24 24"
      >
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
  );
};
