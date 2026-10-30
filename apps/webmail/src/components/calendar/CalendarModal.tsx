import { Component, createSignal, createEffect, For, Show, onMount, onCleanup } from "solid-js";
import { UserCalendar } from "../../api";
import { loadCalendarOverrides } from "./settings/calendarSettingsStore";

export interface CalendarTemplate {
  id: string;
  label: string;
  suggestedName: string;
  suggestedColor: string;
  description: string;
}

export const CALENDAR_TEMPLATES: CalendarTemplate[] = [
  {
    id: "personal",
    label: "Personal",
    suggestedName: "Personal",
    suggestedColor: "#4A607A", // Steel Blue
    description: "Everyday appointments, tasks, and private schedules",
  },
  {
    id: "family",
    label: "Family",
    suggestedName: "Family",
    suggestedColor: "#A87B24", // Warm Amber
    description: "Shared household commitments, family gatherings, and kids' events",
  },
  {
    id: "team",
    label: "Work / Team",
    suggestedName: "Team",
    suggestedColor: "#2E6F40", // Forest Green
    description: "Team syncs, work meetings, office hours, and project milestones",
  },
  {
    id: "project",
    label: "Project",
    suggestedName: "Project",
    suggestedColor: "#B85D38", // Terracotta
    description: "Deadlines, sprint deliverables, and trackable milestones",
  },
  {
    id: "custom",
    label: "Custom",
    suggestedName: "",
    suggestedColor: "#9E725F", // Mocha Mousse
    description: "Blank calendar with your own custom name, purpose, and palette",
  },
];

interface CalendarModalProps {
  isOpen: boolean;
  onClose: () => void;
  calendarToEdit: UserCalendar | null;
  mailboxId?: string;
  onSave: (payload: {
    name: string;
    color: string;
    isDefault: boolean;
    description?: string;
    template?: string;
    defaultReminderMinutes?: number;
  }) => Promise<void>;
  onDelete?: (calendarId: string) => Promise<void>;
  onUnsubscribe?: (calendarId: string, shareId?: string) => Promise<void>;
}

export const PRESET_COLORS = [
  "#9E725F", // Mocha Mousse (Brand)
  "#3C3D3E", // Neutral Charcoal
  "#2E6F40", // Forest Green
  "#2C4C6E", // Deep Navy
  "#B85D38", // Terracotta
  "#6E3860", // Plum
  "#A87B24", // Amber
  "#4A607A", // Steel Blue
];

export const CalendarModal: Component<CalendarModalProps> = (props) => {
  const [selectedTemplate, setSelectedTemplate] = createSignal<string>("custom");
  const [name, setName] = createSignal("");
  const [color, setColor] = createSignal("#9E725F");
  const [description, setDescription] = createSignal("");
  const [defaultReminderMinutes, setDefaultReminderMinutes] = createSignal<number | undefined>(undefined);
  const [isDefault, setIsDefault] = createSignal(false);
  const [isSaving, setIsSaving] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);

  // Safe confirmation modal state (delete / unsubscribe)
  const [confirmAction, setConfirmAction] = createSignal<"delete" | "unsubscribe" | null>(null);

  createEffect(() => {
    if (!props.isOpen) return;
    setErrorMsg(null);
    setConfirmAction(null);

    if (props.calendarToEdit) {
      const cal = props.calendarToEdit;
      setName(cal.name);
      setColor(cal.color || "#9E725F");
      setIsDefault(cal.is_default);

      // Load overrides from local storage if available
      if (props.mailboxId) {
        const overrides = loadCalendarOverrides(props.mailboxId, cal.id);
        setDescription(overrides.description || "");
        setSelectedTemplate(overrides.template || "custom");
        setDefaultReminderMinutes(overrides.defaultReminderMinutes);
      } else {
        setDescription("");
        setSelectedTemplate("custom");
        setDefaultReminderMinutes(undefined);
      }
    } else {
      // Default to "personal" template for friendly start, or "custom"
      setSelectedTemplate("personal");
      const t = CALENDAR_TEMPLATES[0];
      setName(t.suggestedName);
      setColor(t.suggestedColor);
      setDescription(t.description);
      setDefaultReminderMinutes(undefined);
      setIsDefault(false);
    }
  });

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && props.isOpen) {
        if (confirmAction()) {
          setConfirmAction(null);
        } else {
          props.onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  function handleSelectTemplate(tpl: CalendarTemplate) {
    setSelectedTemplate(tpl.id);
    if (!props.calendarToEdit) {
      if (tpl.id !== "custom") {
        setName(tpl.suggestedName);
        setColor(tpl.suggestedColor);
        setDescription(tpl.description);
      } else {
        setName("");
        setColor("#9E725F");
        setDescription("");
      }
    }
  }

  async function handleSave(e: Event) {
    e.preventDefault();
    if (!name().trim()) {
      setErrorMsg("Calendar name is required");
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);
    try {
      await props.onSave({
        name: name().trim(),
        color: color(),
        isDefault: isDefault(),
        description: description().trim(),
        template: selectedTemplate(),
        defaultReminderMinutes: defaultReminderMinutes(),
      });
      props.onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save calendar");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!props.calendarToEdit || !props.onDelete) return;

    setIsSaving(true);
    setErrorMsg(null);
    try {
      await props.onDelete(props.calendarToEdit.id);
      setConfirmAction(null);
      props.onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to delete calendar");
      setConfirmAction(null);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConfirmUnsubscribe() {
    if (!props.calendarToEdit || !props.onUnsubscribe) return;

    setIsSaving(true);
    setErrorMsg(null);
    try {
      await props.onUnsubscribe(props.calendarToEdit.id, props.calendarToEdit.share_id || undefined);
      setConfirmAction(null);
      props.onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to unsubscribe from calendar");
      setConfirmAction(null);
    } finally {
      setIsSaving(false);
    }
  }

  const isShared = () => Boolean(props.calendarToEdit?.is_shared);

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
        onClick={(e) => {
          if (e.target === e.currentTarget && !confirmAction()) props.onClose();
        }}
      >
        <div
          class="w-full max-w-md bg-white dark:bg-[#1E1F23] rounded-2xl shadow-xl border border-[#E2DFD8] dark:border-[#2A2D35] overflow-hidden flex flex-col"
          data-testid="calendar-modal"
        >
          {/* Header */}
          <div class="flex items-center justify-between px-5 py-3.5 border-b border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D]">
            <div class="flex items-center gap-2">
              <span
                class="w-3 h-3 rounded-full flex-shrink-0"
                style={{ "background-color": color() }}
              />
              <h3 class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                {props.calendarToEdit ? (isShared() ? "Calendar Details" : "Edit Calendar") : "New Calendar"}
              </h3>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              class="p-1 rounded-lg text-[#6F7173] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer"
              aria-label="Close"
              data-testid="close-calendar-modal-btn"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSave} class="p-5 flex flex-col gap-4 overflow-y-auto max-h-[75vh] custom-scrollbar">
            <Show when={errorMsg()}>
              <div class="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs font-medium border border-red-200 dark:border-red-800" data-testid="calendar-modal-error">
                {errorMsg()}
              </div>
            </Show>

            {/* Shared Calendar Ownership & Access Banner */}
            <Show when={isShared() && props.calendarToEdit}>
              <div
                class="p-3 rounded-xl bg-[#EFF6FF] dark:bg-[#172554]/50 border border-[#BFDBFE] dark:border-[#1E3A8A] text-xs space-y-1.5"
                data-testid="shared-calendar-info-banner"
              >
                <div class="flex items-center justify-between">
                  <span class="font-bold text-[#1E40AF] dark:text-[#93C5FD] flex items-center gap-1.5">
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                    <span>Shared Calendar</span>
                  </span>
                  <span
                    class={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                      props.calendarToEdit?.permission === "write"
                        ? "bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                    }`}
                    data-testid="calendar-access-badge"
                  >
                    {props.calendarToEdit?.permission === "write" ? "Can edit events" : "Read-only"}
                  </span>
                </div>
                <div class="text-[11px] text-[#3B82F6] dark:text-[#BFDBFE] leading-relaxed">
                  Owned by <strong class="font-semibold">{props.calendarToEdit?.owner_email || "External User"}</strong>.
                  You can customize local appearance or unsubscribe at any time without deleting the owner's calendar.
                </div>
              </div>
            </Show>

            {/* Template Selector (When creating or customizable) */}
            <Show when={!props.calendarToEdit}>
              <div>
                <label class="block text-xs font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1.5">
                  Suggested Template
                </label>
                <div class="flex flex-wrap gap-1.5" data-testid="calendar-template-selector">
                  <For each={CALENDAR_TEMPLATES}>
                    {(tpl) => (
                      <button
                        type="button"
                        onClick={() => handleSelectTemplate(tpl)}
                        class={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                          selectedTemplate() === tpl.id
                            ? "bg-[#F2E8E2] dark:bg-[#3D2E28] border-[#9E725F] text-[#9E725F] dark:text-[#D1A796] shadow-2xs"
                            : "border-[#E2DFD8] dark:border-[#2A2D35] text-[#6F7173] dark:text-[#878A8E] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
                        }`}
                        data-testid={`template-btn-${tpl.id}`}
                      >
                        {tpl.label}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            {/* Name */}
            <div>
              <label class="block text-xs font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                Calendar Name
              </label>
              <input
                type="text"
                placeholder="e.g. Work, Personal, Family"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                class="w-full text-xs px-3 py-2 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#18191D] text-[#2B2C2D] dark:text-[#ECEBE8] placeholder-[#B3B1AC] focus:outline-none focus:ring-2 focus:ring-[#9E725F]"
                data-testid="calendar-name-input"
                required
              />
            </div>

            {/* Description */}
            <div>
              <label class="block text-xs font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                Description (Optional)
              </label>
              <textarea
                placeholder="Add an optional description or purpose for this calendar..."
                value={description()}
                onInput={(e) => setDescription(e.currentTarget.value)}
                rows={2}
                class="w-full text-xs px-3 py-2 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#18191D] text-[#2B2C2D] dark:text-[#ECEBE8] placeholder-[#B3B1AC] focus:outline-none focus:ring-2 focus:ring-[#9E725F] resize-none"
                data-testid="calendar-description-input"
              />
            </div>

            {/* Color Palette */}
            <div>
              <label class="block text-xs font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1.5">
                Calendar Color
              </label>
              <div class="flex items-center gap-2 flex-wrap" data-testid="calendar-color-palette">
                <For each={PRESET_COLORS}>
                  {(c) => (
                    <button
                      type="button"
                      onClick={() => setColor(c)}
                      class={`w-6 h-6 rounded-full transition-transform cursor-pointer flex items-center justify-center ${
                        color() === c ? "scale-110 ring-2 ring-offset-2 ring-[#9E725F]" : "hover:scale-105"
                      }`}
                      style={{ "background-color": c }}
                      data-testid={`color-picker-${c}`}
                    >
                      <Show when={color() === c}>
                        <svg class="w-3.5 h-3.5 text-white stroke-current fill-none stroke-[3]" viewBox="0 0 24 24">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </div>

            {/* Per-Calendar Default Reminders */}
            <div>
              <label class="block text-xs font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                Default Event Reminder
              </label>
              <select
                value={defaultReminderMinutes() !== undefined ? String(defaultReminderMinutes()) : "inherit"}
                onChange={(e) => {
                  const val = e.currentTarget.value;
                  if (val === "inherit") {
                    setDefaultReminderMinutes(undefined);
                  } else {
                    setDefaultReminderMinutes(Number(val));
                  }
                }}
                class="w-full text-xs px-3 py-2 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#18191D] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-2 focus:ring-[#9E725F] cursor-pointer"
                data-testid="calendar-reminder-select"
              >
                <option value="inherit">Use global default (from Settings)</option>
                <option value="0">No reminder</option>
                <option value="5">5 minutes before</option>
                <option value="10">10 minutes before</option>
                <option value="15">15 minutes before</option>
                <option value="30">30 minutes before</option>
                <option value="60">1 hour before</option>
                <option value="1440">1 day before</option>
              </select>
            </div>

            {/* Default Calendar Toggle (Only for Owned Calendars) */}
            <Show when={!isShared()}>
              <div>
                <label class="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isDefault()}
                    onChange={(e) => setIsDefault(e.currentTarget.checked)}
                    class="rounded border-[#E2DFD8] text-[#9E725F] focus:ring-[#9E725F] cursor-pointer"
                    data-testid="calendar-default-checkbox"
                  />
                  <span class="text-xs font-medium text-[#2B2C2D] dark:text-[#ECEBE8]">
                    Set as default calendar for new events
                  </span>
                </label>
              </div>
            </Show>

            {/* Actions */}
            <div class="flex items-center justify-between pt-3 border-t border-[#E2DFD8] dark:border-[#2A2D35] mt-1">
              {/* Left Action: Delete (if Owned) or Unsubscribe (if Shared) */}
              <div>
                <Show when={props.calendarToEdit && !isShared() && props.onDelete && !props.calendarToEdit.is_default}>
                  <button
                    type="button"
                    onClick={() => setConfirmAction("delete")}
                    disabled={isSaving()}
                    class="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                    data-testid="delete-calendar-btn"
                  >
                    Delete Calendar
                  </button>
                </Show>

                <Show when={props.calendarToEdit && isShared() && props.onUnsubscribe}>
                  <button
                    type="button"
                    onClick={() => setConfirmAction("unsubscribe")}
                    disabled={isSaving()}
                    class="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                    data-testid="unsubscribe-calendar-btn"
                  >
                    Unsubscribe
                  </button>
                </Show>
              </div>

              {/* Right Action: Cancel & Save */}
              <div class="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={props.onClose}
                  disabled={isSaving()}
                  class="px-3 py-1.5 text-xs font-semibold text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving()}
                  class="px-4 py-1.5 bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
                  data-testid="save-calendar-btn"
                >
                  {isSaving() ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* ── Safe Delete / Unsubscribe Confirmation Modal ── */}
        <Show when={confirmAction()}>
          <div
            class="fixed inset-0 z-60 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
            data-testid="calendar-confirm-modal-backdrop"
          >
            <div
              class="w-full max-w-sm rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] p-5 shadow-2xl"
              data-testid={confirmAction() === "delete" ? "delete-calendar-confirm-modal" : "unsubscribe-calendar-confirm-modal"}
            >
              <h3 class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                {confirmAction() === "delete"
                  ? `Delete Calendar "${props.calendarToEdit?.name}"?`
                  : `Unsubscribe from "${props.calendarToEdit?.name}"?`}
              </h3>
              <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-2 leading-relaxed">
                {confirmAction() === "delete"
                  ? "All events associated with this calendar will be permanently removed. This action cannot be undone."
                  : `This calendar will be removed from your view. The source calendar and its events will remain completely safe for the owner (${props.calendarToEdit?.owner_email || "the organizer"}).`}
              </p>

              <div class="mt-5 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setConfirmAction(null)}
                  disabled={isSaving()}
                  class="px-3 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] text-xs font-semibold text-[#6F7173] dark:text-[#878A8E] transition-colors cursor-pointer"
                >
                  Cancel
                </button>

                <Show when={confirmAction() === "delete"}>
                  <button
                    type="button"
                    onClick={handleConfirmDelete}
                    disabled={isSaving()}
                    class="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition-colors cursor-pointer shadow-xs"
                    data-testid="confirm-delete-calendar-btn"
                  >
                    {isSaving() ? "Deleting..." : "Delete Permanently"}
                  </button>
                </Show>

                <Show when={confirmAction() === "unsubscribe"}>
                  <button
                    type="button"
                    onClick={handleConfirmUnsubscribe}
                    disabled={isSaving()}
                    class="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition-colors cursor-pointer shadow-xs"
                    data-testid="confirm-unsubscribe-calendar-btn"
                  >
                    {isSaving() ? "Unsubscribing..." : "Unsubscribe"}
                  </button>
                </Show>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
};
