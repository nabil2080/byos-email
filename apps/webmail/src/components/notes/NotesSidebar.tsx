import { Component, For, Show, createSignal, createEffect } from "solid-js";
import { UserMe, Mailbox, ConnectedAccount } from "../../api";
import { AccountSwitcher } from "../AccountSwitcher";

export type NotesViewFilter = "notes" | "favorites" | "reminders" | "archive" | "bin" | string;

export interface NotesSidebarProps {
  currentUser?: UserMe | null;
  selectedMailbox?: Mailbox | null;
  connectedAccounts?: ConnectedAccount[];
  activeAccountId?: string;
  onSelectAccount?: (account: ConnectedAccount) => void;
  onSelectAllInboxes?: () => void;
  onOpenAddMailbox?: () => void;
  onLogout?: (accountId?: string, logOutAll?: boolean) => void;
  profilePhotoUrl?: string | null;
  photoUrls?: Record<string, string>;
  isUnlocked?: boolean;
  storageError?: string | null;
  accountUnreadCounts?: Record<string, number>;
  unifiedUnreadCount?: number;
  activeView: NotesViewFilter;
  onSelectView: (view: NotesViewFilter) => void;
  onNewNote?: () => void;
  labels: string[];
  onOpenEditLabels: () => void;
  notesCounts?: {
    notes?: number;
    favorites?: number;
    reminders?: number;
    archive?: number;
    bin?: number;
    labelCounts?: Record<string, number>;
  };
  onOpenContacts?: () => void;
  onOpenSettings?: () => void;
  class?: string;
  onCloseMobile?: () => void;
}

export const NotesSidebar: Component<NotesSidebarProps> = (props) => {
  const isSelected = (view: string) => props.activeView === view;

  // Morphing sliding highlight pill tracking active view
  const [navPillStyle, setNavPillStyle] = createSignal<{ top: number; height: number; opacity: number }>({
    top: 0,
    height: 0,
    opacity: 0,
  });
  const viewRefs = new Map<string, HTMLElement>();

  createEffect(() => {
    const view = props.activeView;
    const el = viewRefs.get(view);
    if (el) {
      setNavPillStyle({
        top: el.offsetTop,
        height: el.offsetHeight,
        opacity: 1,
      });
    } else {
      setNavPillStyle((prev) => ({ ...prev, opacity: 0 }));
    }
  });

  const mailboxEmail = () => {
    if (!props.selectedMailbox) return props.currentUser?.email || "byos.email";
    if ((props.selectedMailbox as any)?.email) return (props.selectedMailbox as any).email;
    if ((props.selectedMailbox as any)?.domain_name) {
      return `${props.selectedMailbox.local_part}@${(props.selectedMailbox as any).domain_name}`;
    }
    const domain = props.currentUser?.email?.split("@")[1] || "byos.email";
    return `${props.selectedMailbox.local_part}@${domain}`;
  };

  const isPrivate = () => props.selectedMailbox?.mode === "private";

  return (
    <aside
      data-testid="notes-sidebar"
      class={`w-full md:w-60 md:min-w-[240px] md:max-w-[240px] flex-shrink-0 bg-[#F0EEE9] dark:bg-[#18191D] flex flex-col justify-between select-none h-full relative ${
        props.class || ""
      }`}
    >
      {/* ── TOP SECTION: Brand Header & Account Switcher ── */}
      <div class="p-2 pb-2 relative z-50 overflow-visible space-y-2 flex-shrink-0">
        {/* Top Brand Header matching Sidebar.tsx */}
        <div class="flex items-center justify-between px-1.5 pt-0.5 pb-0.5">
          <div class="flex items-center gap-2">
            <div class="w-6 h-6 rounded-xl bg-[#A27561] flex items-center justify-center text-white font-bold text-xs shadow-2xs tracking-wider ring-1 ring-[#A27561]/30">
              B
            </div>
            <span class="text-sm font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] tracking-tight">BYOS Notes</span>
          </div>
          <Show when={props.onCloseMobile}>
            <button
              type="button"
              onClick={props.onCloseMobile}
              class="md:hidden flex items-center justify-center w-8 h-8 rounded-lg text-[#6F7173] dark:text-[#878A8E] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF] dark:hover:bg-[#26282E] transition cursor-pointer"
              title="Close navigation menu"
              aria-label="Close navigation menu"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Show>
        </div>

        {/* User Identity & Account Switcher (Top-Left) */}
        <AccountSwitcher
          currentEmail={mailboxEmail()}
          isPrivate={isPrivate()}
          connectedAccounts={props.connectedAccounts || []}
          activeAccountId={props.activeAccountId || props.selectedMailbox?.id || ""}
          onSelectAccount={(acc) => {
            props.onSelectAccount?.(acc);
            props.onCloseMobile?.();
          }}
          onSelectAllInboxes={() => {
            props.onSelectAllInboxes?.();
            props.onCloseMobile?.();
          }}
          onOpenAddMailbox={() => {
            props.onOpenAddMailbox?.();
            props.onCloseMobile?.();
          }}
          onSignOut={props.onLogout || (() => {})}
          unreadCounts={props.accountUnreadCounts}
          totalUnifiedUnread={props.unifiedUnreadCount}
          profilePhotoUrl={props.profilePhotoUrl}
          photoUrls={props.photoUrls}
        />

        {/* ── Prominent Refined "+ New Note" Action Button ── */}
        <div class="pt-1">
          <button
            type="button"
            onClick={() => {
              props.onNewNote?.();
              props.onCloseMobile?.();
            }}
            data-testid="notes-new-note-btn"
            class="w-full py-2.5 px-4 bg-[#9E725F] hover:bg-[#865E4D] text-white rounded-xl font-semibold text-xs tracking-wide transition-all shadow-2xs hover:shadow-xs flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99] border border-[#865E4D]/20 focus:outline-none focus:ring-2 focus:ring-[#9E725F]/40"
          >
            <svg class="w-4 h-4 stroke-current fill-none stroke-[2.2]" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>New Note</span>
          </button>
        </div>
      </div>

      {/* ── MIDDLE SCROLLABLE SECTION: Notes Navigation Items ── */}
      <div class="flex-1 min-h-0 overflow-y-auto px-2 py-1 space-y-1 custom-scrollbar relative">
        {/* Morphing Sliding Highlight Pill */}
        <div
          class="absolute left-2 right-2 rounded-xl bg-[#F2E8E2] dark:bg-[#2D2522] shadow-2xs pointer-events-none transition-all duration-250 ease-[cubic-bezier(0.2,0,0,1)] z-0"
          style={{
            top: `${navPillStyle().top}px`,
            height: `${navPillStyle().height}px`,
            opacity: navPillStyle().opacity,
          }}
        />

        {/* 1. All Notes */}
        <button
          ref={(el) => { if (el) viewRefs.set("notes", el); }}
          type="button"
          onClick={() => {
            props.onSelectView("notes");
            props.onCloseMobile?.();
          }}
          data-testid="notes-nav-notes"
          class={`relative z-10 w-full flex items-center justify-between px-3 py-2 text-sm rounded-xl transition-all cursor-pointer bg-transparent min-w-0 ${
            isSelected("notes")
              ? "text-[#A27561] dark:text-[#D4A38F] font-semibold"
              : "text-[#464748] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/50 dark:hover:bg-[#26282E]/50 font-medium"
          }`}
        >
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <svg class="w-4 h-4 flex-shrink-0 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline stroke-linecap="round" stroke-linejoin="round" points="14 2 14 8 20 8" />
              <line stroke-linecap="round" stroke-linejoin="round" x1="16" y1="13" x2="8" y2="13" />
              <line stroke-linecap="round" stroke-linejoin="round" x1="16" y1="17" x2="8" y2="17" />
            </svg>
            <span class="truncate">All Notes</span>
          </div>
          <Show when={props.notesCounts?.notes !== undefined}>
            <span
              class={`text-xs font-mono tabular-nums px-2 py-0.5 rounded-full flex-shrink-0 ${
                isSelected("notes")
                  ? "bg-[#A27561] text-white font-semibold"
                  : "bg-[#E8E5DF] dark:bg-[#2E3138] text-[#3C3D3E] dark:text-[#E2DFD8]"
              }`}
            >
              {props.notesCounts?.notes}
            </span>
          </Show>
        </button>

        {/* 2. Favorites */}
        <button
          ref={(el) => { if (el) viewRefs.set("favorites", el); }}
          type="button"
          onClick={() => {
            props.onSelectView("favorites");
            props.onCloseMobile?.();
          }}
          data-testid="notes-nav-favorites"
          class={`relative z-10 w-full flex items-center justify-between px-3 py-2 text-sm rounded-xl transition-all cursor-pointer bg-transparent min-w-0 ${
            isSelected("favorites")
              ? "text-[#A27561] dark:text-[#D4A38F] font-semibold"
              : "text-[#464748] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/50 dark:hover:bg-[#26282E]/50 font-medium"
          }`}
        >
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <svg class="w-4 h-4 flex-shrink-0 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
              <polygon stroke-linecap="round" stroke-linejoin="round" points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            <span class="truncate">Favorites</span>
          </div>
          <Show when={props.notesCounts?.favorites !== undefined}>
            <span
              class={`text-xs font-mono tabular-nums px-2 py-0.5 rounded-full flex-shrink-0 ${
                isSelected("favorites")
                  ? "bg-[#A27561] text-white font-semibold"
                  : "bg-[#E8E5DF] dark:bg-[#2E3138] text-[#3C3D3E] dark:text-[#E2DFD8]"
              }`}
            >
              {props.notesCounts?.favorites}
            </span>
          </Show>
        </button>

        {/* 3. Reminders */}
        <button
          ref={(el) => { if (el) viewRefs.set("reminders", el); }}
          type="button"
          onClick={() => {
            props.onSelectView("reminders");
            props.onCloseMobile?.();
          }}
          data-testid="notes-nav-reminders"
          class={`relative z-10 w-full flex items-center justify-between px-3 py-2 text-sm rounded-xl transition-all cursor-pointer bg-transparent min-w-0 ${
            isSelected("reminders")
              ? "text-[#A27561] dark:text-[#D4A38F] font-semibold"
              : "text-[#464748] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/50 dark:hover:bg-[#26282E]/50 font-medium"
          }`}
        >
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <svg class="w-4 h-4 flex-shrink-0 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span class="truncate">Reminders</span>
          </div>
          <Show when={props.notesCounts?.reminders !== undefined}>
            <span
              class={`text-xs font-mono tabular-nums px-2 py-0.5 rounded-full flex-shrink-0 ${
                isSelected("reminders")
                  ? "bg-[#A27561] text-white font-semibold"
                  : "bg-[#E8E5DF] dark:bg-[#2E3138] text-[#3C3D3E] dark:text-[#E2DFD8]"
              }`}
            >
              {props.notesCounts?.reminders}
            </span>
          </Show>
        </button>

        {/* ── LABELS SECTION HEADER ── */}
        <div class="pt-3 pb-1 px-3 flex items-center justify-between">
          <span class="text-xs font-semibold text-[#6F7173] dark:text-[#878A8E] uppercase tracking-wider font-mono">
            Labels
          </span>
          {/* 3. Edit labels button matching options */}
          <button
            type="button"
            onClick={() => {
              props.onOpenEditLabels();
              props.onCloseMobile?.();
            }}
            data-testid="notes-nav-edit-labels"
            title="Edit labels"
            class="w-9 h-9 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-[#6F7173] hover:text-[#9E725F] dark:hover:text-[#D4A38F] hover:bg-black/5 dark:hover:bg-white/10 transition cursor-pointer"
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 20h9" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
        </div>

        {/* User Labels */}
        <For each={props.labels}>
          {(lbl, idx) => {
            const dotColors = ["bg-[#9E725F]", "bg-amber-500", "bg-emerald-500", "bg-sky-500", "bg-purple-500", "bg-rose-500"];
            const dotColor = dotColors[idx() % dotColors.length];
            return (
              <button
                ref={(el) => { if (el) viewRefs.set(`label:${lbl}`, el); }}
                type="button"
                onClick={() => {
                  props.onSelectView(`label:${lbl}`);
                  props.onCloseMobile?.();
                }}
                data-testid={`notes-nav-label-${lbl}`}
                class={`relative z-10 w-full flex items-center justify-between px-3 py-2 text-sm rounded-xl transition-all cursor-pointer bg-transparent min-w-0 ${
                  isSelected(`label:${lbl}`)
                    ? "text-[#A27561] dark:text-[#D4A38F] font-semibold"
                    : "text-[#464748] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/50 dark:hover:bg-[#26282E]/50 font-medium"
                }`}
              >
                <div class="flex items-center gap-2.5 min-w-0 flex-1 truncate">
                  <span class={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
                  <span class="truncate">{lbl}</span>
                </div>
                <Show when={props.notesCounts?.labelCounts?.[lbl] !== undefined}>
                  <span
                    class={`text-xs font-mono tabular-nums px-2 py-0.5 rounded-full flex-shrink-0 ${
                      isSelected(`label:${lbl}`)
                        ? "bg-[#A27561] text-white font-semibold"
                        : "bg-[#E8E5DF] dark:bg-[#2E3138] text-[#3C3D3E] dark:text-[#E2DFD8]"
                    }`}
                  >
                    {props.notesCounts?.labelCounts?.[lbl]}
                  </span>
                </Show>
              </button>
            );
          }}
        </For>
        <Show when={!props.labels || props.labels.length === 0}>
          <div class="px-3 py-1 text-xs text-[#878A8E] italic">No labels</div>
        </Show>

        {/* ── SYSTEM SEPARATOR ── */}
        <div class="my-2 border-t border-[#E2DFD8]/80 dark:border-[#2E3138]" />

        {/* 4. Archive */}
        <button
          ref={(el) => { if (el) viewRefs.set("archive", el); }}
          type="button"
          onClick={() => {
            props.onSelectView("archive");
            props.onCloseMobile?.();
          }}
          data-testid="notes-nav-archive"
          class={`relative z-10 w-full flex items-center justify-between px-3 py-2 text-sm rounded-xl transition-all cursor-pointer bg-transparent min-w-0 ${
            isSelected("archive")
              ? "text-[#A27561] dark:text-[#D4A38F] font-semibold"
              : "text-[#464748] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/50 dark:hover:bg-[#26282E]/50 font-medium"
          }`}
        >
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <svg class="w-4 h-4 flex-shrink-0 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
              <polyline stroke-linecap="round" stroke-linejoin="round" points="21 8 21 21 3 21 3 8" />
              <rect stroke-linecap="round" stroke-linejoin="round" x="1" y="3" width="22" height="5" />
              <line stroke-linecap="round" stroke-linejoin="round" x1="10" y1="12" x2="14" y2="12" />
            </svg>
            <span class="truncate">Archive</span>
          </div>
          <Show when={props.notesCounts?.archive !== undefined}>
            <span
              class={`text-xs font-mono tabular-nums px-2 py-0.5 rounded-full flex-shrink-0 ${
                isSelected("archive")
                  ? "bg-[#A27561] text-white font-semibold"
                  : "bg-[#E8E5DF] dark:bg-[#2E3138] text-[#3C3D3E] dark:text-[#E2DFD8]"
              }`}
            >
              {props.notesCounts?.archive}
            </span>
          </Show>
        </button>

        {/* 5. Bin */}
        <button
          ref={(el) => { if (el) viewRefs.set("bin", el); }}
          type="button"
          onClick={() => {
            props.onSelectView("bin");
            props.onCloseMobile?.();
          }}
          data-testid="notes-nav-bin"
          class={`relative z-10 w-full flex items-center justify-between px-3 py-2 text-sm rounded-xl transition-all cursor-pointer bg-transparent min-w-0 ${
            isSelected("bin")
              ? "text-[#A27561] dark:text-[#D4A38F] font-semibold"
              : "text-[#464748] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/50 dark:hover:bg-[#26282E]/50 font-medium"
          }`}
        >
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <svg class="w-4 h-4 flex-shrink-0 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
              <polyline stroke-linecap="round" stroke-linejoin="round" points="3 6 5 6 21 6" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line stroke-linecap="round" stroke-linejoin="round" x1="10" y1="11" x2="10" y2="17" />
              <line stroke-linecap="round" stroke-linejoin="round" x1="14" y1="11" x2="14" y2="17" />
            </svg>
            <span class="truncate">Bin</span>
          </div>
          <Show when={props.notesCounts?.bin !== undefined}>
            <span
              class={`text-xs font-mono tabular-nums px-2 py-0.5 rounded-full flex-shrink-0 ${
                isSelected("bin")
                  ? "bg-[#A27561] text-white font-semibold"
                  : "bg-[#E8E5DF] dark:bg-[#2E3138] text-[#3C3D3E] dark:text-[#E2DFD8]"
              }`}
            >
              {props.notesCounts?.bin}
            </span>
          </Show>
        </button>
      </div>

      {/* ── FIXED BOTTOM: Unified Contacts | Settings | Sign out Capsule Pill ── */}
      <div class="p-2 border-t border-[#E2DFD8]/60 dark:border-[#333336] relative z-40 overflow-visible flex-shrink-0">
        <div class="w-full rounded-full bg-[#EAE7DF]/85 dark:bg-[#1E2025] border border-[#DDD8CE] dark:border-[#2E3138] p-1 flex items-center justify-between shadow-2xs transition-colors">
          {/* Contacts */}
          <div class="relative group flex-1 flex justify-center">
            <button
              type="button"
              onClick={() => {
                props.onOpenContacts?.();
                props.onCloseMobile?.();
              }}
              data-testid="sidebar-contacts-btn"
              data-testid-secondary="contacts-nav-btn"
              aria-label="Contacts"
              class="w-full h-9 min-h-[36px] flex items-center justify-center py-1.5 px-2 rounded-full text-[#5E6063] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 transition-all duration-150 cursor-pointer select-none"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8] flex-shrink-0" viewBox="0 0 24 24">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span class="sr-only">Contacts</span>
            </button>
            <div
              role="tooltip"
              class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:-translate-y-0.5 transition-all duration-150 ease-out z-50 px-2.5 py-1 rounded-lg bg-[#1E2025] dark:bg-[#2A2D35] text-[#F3F4F6] text-xs font-medium shadow-md whitespace-nowrap"
            >
              Contacts
              <div class="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-[#1E2025] dark:border-t-[#2A2D35]" />
            </div>
          </div>

          <div class="w-px h-3.5 bg-[#D2CDC3] dark:bg-[#383B44] flex-shrink-0" />

          {/* Settings */}
          <div class="relative group flex-1 flex justify-center">
            <button
              type="button"
              onClick={() => {
                props.onOpenSettings?.();
                props.onCloseMobile?.();
              }}
              data-testid="sidebar-settings-btn"
              aria-label="Settings"
              class="w-full h-9 min-h-[36px] flex items-center justify-center py-1.5 px-2 rounded-full text-[#5E6063] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 transition-all duration-150 cursor-pointer select-none"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8] flex-shrink-0" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span class="sr-only">Settings</span>
            </button>
            <div
              role="tooltip"
              class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:-translate-y-0.5 transition-all duration-150 ease-out z-50 px-2.5 py-1 rounded-lg bg-[#1E2025] dark:bg-[#2A2D35] text-[#F3F4F6] text-xs font-medium shadow-md whitespace-nowrap"
            >
              Settings
              <div class="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-[#1E2025] dark:border-t-[#2A2D35]" />
            </div>
          </div>

          <div class="w-px h-3.5 bg-[#D2CDC3] dark:bg-[#383B44] flex-shrink-0" />

          {/* Sign out */}
          <div class="relative group flex-1 flex justify-center">
            <button
              type="button"
              onClick={() => props.onLogout?.(props.selectedMailbox?.id, false)}
              data-testid="sidebar-signout-btn"
              aria-label="Sign out"
              class="w-full h-9 min-h-[36px] flex items-center justify-center py-1.5 px-2 rounded-full text-[#5E6063] dark:text-[#A1A1AA] hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 dark:hover:bg-red-500/15 transition-all duration-150 cursor-pointer select-none"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8] flex-shrink-0" viewBox="0 0 24 24">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span class="sr-only">Sign out</span>
            </button>
            <div
              role="tooltip"
              class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:-translate-y-0.5 transition-all duration-150 ease-out z-50 px-2.5 py-1 rounded-lg bg-[#1E2025] dark:bg-[#2A2D35] text-[#F3F4F6] text-xs font-medium shadow-md whitespace-nowrap"
            >
              Sign out
              <div class="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-[#1E2025] dark:border-t-[#2A2D35]" />
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};
