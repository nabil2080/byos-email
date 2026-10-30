import { Component, createSignal, createEffect, For, Show, onMount, onCleanup } from "solid-js";
import { TaskItem, TaskList, TaskPriority } from "./taskTypes";
import { getTaskLists, saveTask, deleteTask } from "./taskStore";

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  mailboxId: string;
  taskToEdit?: TaskItem | null;
  initialDueDate?: string;
  initialDueTime?: string;
  onSaved?: (task: TaskItem) => void;
  onDeleted?: (taskId: string) => void;
}

export const TaskModal: Component<TaskModalProps> = (props) => {
  const [title, setTitle] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [listId, setListId] = createSignal("");
  const [dueDate, setDueDate] = createSignal("");
  const [dueTime, setDueTime] = createSignal("");
  const [isAllDay, setIsAllDay] = createSignal(true);
  const [scheduledDate, setScheduledDate] = createSignal("");
  const [recurrence, setRecurrence] = createSignal<string>("none");
  const [priority, setPriority] = createSignal<TaskPriority>("none");
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
  const [lists, setLists] = createSignal<TaskList[]>([]);

  function loadLists() {
    if (props.mailboxId) {
      const allLists = getTaskLists(props.mailboxId);
      setLists(allLists);
      if (!listId() && allLists.length > 0) {
        setListId(allLists[0].id);
      }
    }
  }

  createEffect(() => {
    if (props.isOpen) {
      loadLists();
      setErrorMsg(null);
      if (props.taskToEdit) {
        setTitle(props.taskToEdit.title || "");
        setDescription(props.taskToEdit.description || "");
        setListId(props.taskToEdit.listId || (lists()[0]?.id || ""));
        setDueDate(props.taskToEdit.dueDate || "");
        setDueTime(props.taskToEdit.dueTime || "");
        setIsAllDay(props.taskToEdit.isAllDay ?? !props.taskToEdit.dueTime);
        setScheduledDate(props.taskToEdit.scheduledDate || "");
        setRecurrence(props.taskToEdit.rrule || "none");
        setPriority(props.taskToEdit.priority || "none");
      } else {
        setTitle("");
        setDescription("");
        setDueDate(props.initialDueDate || "");
        setDueTime(props.initialDueTime || "");
        setIsAllDay(!props.initialDueTime);
        setScheduledDate("");
        setRecurrence("none");
        setPriority("none");
        if (lists().length > 0) {
          setListId(lists()[0].id);
        }
      }
    }
  });

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && props.isOpen) {
        props.onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  function handleSave(e: Event) {
    e.preventDefault();
    if (!title().trim()) {
      setErrorMsg("Task title is required");
      return;
    }

    try {
      const saved = saveTask(props.mailboxId, {
        id: props.taskToEdit ? props.taskToEdit.id : undefined,
        listId: listId() || (lists()[0]?.id || "default"),
        title: title().trim(),
        description: description().trim() || undefined,
        dueDate: dueDate() || undefined,
        dueTime: !isAllDay() && dueTime() ? dueTime() : undefined,
        isAllDay: isAllDay(),
        scheduledDate: scheduledDate() || undefined,
        rrule: recurrence() !== "none" ? recurrence() : undefined,
        completed: props.taskToEdit ? props.taskToEdit.completed : false,
        priority: priority(),
      });
      props.onSaved?.(saved);
      props.onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save task");
    }
  }

  function handleDelete() {
    if (props.taskToEdit) {
      deleteTask(props.mailboxId, props.taskToEdit.id);
      props.onDeleted?.(props.taskToEdit.id);
      props.onClose();
    }
  }

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 transition-opacity"
        role="dialog"
        aria-modal="true"
        aria-label={props.taskToEdit ? "Edit Task" : "New Task"}
        data-testid="task-modal"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
      >
        <div
          class="w-full max-w-md bg-white dark:bg-[#1E1F23] rounded-2xl shadow-xl border border-[#E2DFD8] dark:border-[#2A2D35] overflow-hidden flex flex-col max-h-[90vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div class="flex items-center justify-between px-5 py-3.5 border-b border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D]">
            <div class="flex items-center gap-2">
              <svg class="w-4 h-4 text-[#9E725F]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
              <h3 class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                {props.taskToEdit ? "Edit Task" : "New Task"}
              </h3>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              class="p-1 rounded-lg text-[#6F7173] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer"
              aria-label="Close task modal"
              data-testid="close-task-modal"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Form Body */}
          <form onSubmit={handleSave} class="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
            <Show when={errorMsg()}>
              <div class="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs">
                {errorMsg()}
              </div>
            </Show>

            {/* Task Title */}
            <div>
              <label class="block text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                Title <span class="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="What needs to be done?"
                value={title()}
                onInput={(e) => setTitle(e.currentTarget.value)}
                class="w-full px-3 py-2 rounded-lg bg-[#FAF9F5] dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] text-sm focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                data-testid="task-title-input"
                autofocus
              />
            </div>

            {/* Task List Selector */}
            <div>
              <label class="block text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                Task List
              </label>
              <select
                value={listId()}
                onChange={(e) => setListId(e.currentTarget.value)}
                class="w-full px-3 py-1.5 rounded-lg bg-[#FAF9F5] dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                data-testid="task-list-select"
              >
                <For each={lists()}>
                  {(l) => <option value={l.id}>{l.name}</option>}
                </For>
              </select>
            </div>

            {/* Due Date & Time */}
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                  Due Date
                </label>
                <input
                  type="date"
                  value={dueDate()}
                  onInput={(e) => setDueDate(e.currentTarget.value)}
                  class="w-full px-3 py-1.5 rounded-lg bg-[#FAF9F5] dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                  data-testid="task-due-date-input"
                />
              </div>

              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E]">
                    Due Time
                  </label>
                  <label class="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isAllDay()}
                      onChange={(e) => setIsAllDay(e.currentTarget.checked)}
                      class="rounded text-[#9E725F] focus:ring-[#9E725F]"
                      data-testid="task-allday-checkbox"
                    />
                    <span class="text-[10px] text-[#6F7173]">All-day</span>
                  </label>
                </div>
                <input
                  type="time"
                  disabled={isAllDay()}
                  value={dueTime()}
                  onInput={(e) => setDueTime(e.currentTarget.value)}
                  class={`w-full px-3 py-1.5 rounded-lg bg-[#FAF9F5] dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F] ${
                    isAllDay() ? "opacity-40 cursor-not-allowed" : ""
                  }`}
                  data-testid="task-due-time-input"
                />
              </div>
            </div>

            {/* Scheduled Date */}
            <div>
              <label class="block text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                Scheduled Date (Optional)
              </label>
              <input
                type="date"
                value={scheduledDate()}
                onInput={(e) => setScheduledDate(e.currentTarget.value)}
                class="w-full px-3 py-1.5 rounded-lg bg-[#FAF9F5] dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                data-testid="task-scheduled-date-input"
              />
            </div>

            {/* Recurrence & Priority */}
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                  Repeating
                </label>
                <select
                  value={recurrence()}
                  onChange={(e) => setRecurrence(e.currentTarget.value)}
                  class="w-full px-3 py-1.5 rounded-lg bg-[#FAF9F5] dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                  data-testid="task-recurrence-select"
                >
                  <option value="none">Does not repeat</option>
                  <option value="FREQ=DAILY;INTERVAL=1">Daily</option>
                  <option value="FREQ=WEEKLY;INTERVAL=1">Weekly</option>
                  <option value="FREQ=MONTHLY;INTERVAL=1">Monthly</option>
                  <option value="FREQ=YEARLY;INTERVAL=1">Yearly</option>
                </select>
              </div>

              <div>
                <label class="block text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                  Priority
                </label>
                <select
                  value={priority()}
                  onChange={(e) => setPriority(e.currentTarget.value as TaskPriority)}
                  class="w-full px-3 py-1.5 rounded-lg bg-[#FAF9F5] dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                  data-testid="task-priority-select"
                >
                  <option value="none">None</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>

            {/* Description / Notes */}
            <div>
              <label class="block text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                Details & Notes
              </label>
              <textarea
                rows={3}
                placeholder="Add details, checklists, or reference links..."
                value={description()}
                onInput={(e) => setDescription(e.currentTarget.value)}
                class="w-full px-3 py-2 rounded-lg bg-[#FAF9F5] dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F] resize-none"
                data-testid="task-description-input"
              />
            </div>

            {/* Footer Buttons */}
            <div class="flex items-center justify-between pt-2 border-t border-[#E2DFD8] dark:border-[#2A2D35]">
              <Show
                when={props.taskToEdit}
                fallback={<div />}
              >
                <button
                  type="button"
                  onClick={handleDelete}
                  class="px-3 py-1.5 text-xs font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-colors cursor-pointer"
                  data-testid="delete-task-btn"
                >
                  Delete
                </button>
              </Show>

              <div class="flex items-center gap-2">
                <button
                  type="button"
                  onClick={props.onClose}
                  class="px-3 py-1.5 text-xs font-semibold text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="px-4 py-1.5 text-xs font-semibold bg-[#9E725F] hover:bg-[#865E4D] text-white rounded-lg shadow-sm transition-colors cursor-pointer"
                  data-testid="save-task-btn"
                >
                  Save Task
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
};
