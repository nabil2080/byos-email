import { Component, createSignal, createMemo, For, Show, onMount, onCleanup } from "solid-js";
import { TaskItem, TaskList } from "./taskTypes";
import {
  getTaskLists,
  createTaskList,
  getTasks,
  saveTask,
  toggleTaskComplete,
  deleteTask,
  isTaskOverdue,
} from "./taskStore";

interface TasksSidebarPanelProps {
  mailboxId: string;
  isOpen: boolean;
  onClose: () => void;
  onEditTask: (task: TaskItem) => void;
  onOpenNewTaskModal: () => void;
  primaryTimeZone?: string;
}

export const TasksSidebarPanel: Component<TasksSidebarPanelProps> = (props) => {
  const [lists, setLists] = createSignal<TaskList[]>([]);
  const [activeListId, setActiveListId] = createSignal<string>("all");
  const [tasks, setTasks] = createSignal<TaskItem[]>([]);
  const [quickTitle, setQuickTitle] = createSignal("");
  const [filterMode, setFilterMode] = createSignal<"all" | "today" | "upcoming" | "completed">("all");
  const [isAddingList, setIsAddingList] = createSignal(false);
  const [newListName, setNewListName] = createSignal("");

  function loadData() {
    if (!props.mailboxId) return;
    setLists(getTaskLists(props.mailboxId));
    setTasks(getTasks(props.mailboxId));
  }

  onMount(() => {
    loadData();
    const handleUpdate = () => loadData();
    window.addEventListener("byos_tasks_updated", handleUpdate);
    onCleanup(() => window.removeEventListener("byos_tasks_updated", handleUpdate));
  });

  const filteredTasks = createMemo(() => {
    let list = tasks();

    if (activeListId() !== "all") {
      list = list.filter((t) => t.listId === activeListId());
    }

    const todayStr = new Date().toISOString().slice(0, 10);

    switch (filterMode()) {
      case "today":
        return list.filter((t) => !t.completed && (t.dueDate === todayStr || t.scheduledDate === todayStr));
      case "upcoming":
        return list.filter((t) => !t.completed && (t.dueDate ? t.dueDate >= todayStr : true));
      case "completed":
        return list.filter((t) => t.completed);
      default:
        return list;
    }
  });

  const activeCount = createMemo(() => tasks().filter((t) => !t.completed).length);
  const overdueCount = createMemo(() =>
    tasks().filter((t) => isTaskOverdue(t, new Date(), props.primaryTimeZone || "UTC")).length
  );

  function handleQuickAdd(e: Event) {
    e.preventDefault();
    const title = quickTitle().trim();
    if (!title) return;

    let targetListId = activeListId();
    if (targetListId === "all") {
      const defaultList = lists().find((l) => l.isDefault) || lists()[0];
      targetListId = defaultList ? defaultList.id : "default";
    }

    saveTask(props.mailboxId, {
      listId: targetListId,
      title,
      completed: false,
    });
    setQuickTitle("");
  }

  function handleCreateList(e: Event) {
    e.preventDefault();
    if (!newListName().trim()) return;
    const created = createTaskList(props.mailboxId, newListName().trim());
    setNewListName("");
    setIsAddingList(false);
    setActiveListId(created.id);
  }

  const filterTabs: Array<{ key: "all" | "today" | "upcoming" | "completed"; label: string }> = [
    { key: "all", label: "All" },
    { key: "today", label: "Today" },
    { key: "upcoming", label: "Upcoming" },
    { key: "completed", label: "Done" },
  ];

  return (
    <Show when={props.isOpen}>
      <aside
        class="w-80 flex-shrink-0 border-l border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] flex flex-col h-full z-20 shadow-md select-none"
        data-testid="tasks-sidebar-panel"
      >
        {/* Panel Header */}
        <div class="flex items-center justify-between px-4 py-3 border-b border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D]">
          <div class="flex items-center gap-2">
            <svg class="w-4 h-4 text-[#9E725F]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            <h2 class="text-sm font-bold text-[#3C3D3E] dark:text-[#ECEBE8]">Tasks</h2>
            <Show when={activeCount() > 0}>
              <span class="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-[#FAF9F5] dark:bg-[#2A2D35] text-[#9E725F] border border-[#E2DFD8] dark:border-[#2A2D35]">
                {activeCount()}
              </span>
            </Show>
            <Show when={overdueCount() > 0}>
              <span
                class="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-red-500/15 text-red-600 dark:text-red-400"
                title={`${overdueCount()} overdue`}
                data-testid="sidebar-overdue-count"
              >
                {overdueCount()} overdue
              </span>
            </Show>
          </div>

          <div class="flex items-center gap-1">
            <button
              type="button"
              onClick={props.onOpenNewTaskModal}
              class="p-1 rounded-lg text-[#6F7173] hover:text-[#9E725F] dark:hover:text-[#D4A38F] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
              title="New detailed task"
              aria-label="New detailed task"
              data-testid="open-task-modal-btn"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2.2]" viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button
              type="button"
              onClick={props.onClose}
              class="p-1 rounded-lg text-[#6F7173] hover:text-[#3C3D3E] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
              aria-label="Close tasks panel"
              data-testid="close-tasks-sidebar-btn"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* List Selector & Tabs */}
        <div class="px-3 pt-2.5 pb-2 border-b border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5]/40 dark:bg-[#18191D]/40 space-y-2">
          <div class="flex items-center gap-1.5">
            <select
              value={activeListId()}
              onChange={(e) => setActiveListId(e.currentTarget.value)}
              class="flex-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#3C3D3E] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F] cursor-pointer"
              data-testid="active-task-list-select"
            >
              <option value="all">All Task Lists</option>
              <For each={lists()}>
                {(l) => <option value={l.id}>{l.name}</option>}
              </For>
            </select>
            <button
              type="button"
              onClick={() => setIsAddingList(!isAddingList())}
              class="px-2 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#6F7173] hover:text-[#9E725F] transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
              title="Add new task list"
              data-testid="add-task-list-btn"
            >
              + List
            </button>
          </div>

          <Show when={isAddingList()}>
            <form onSubmit={handleCreateList} class="flex items-center gap-1">
              <input
                type="text"
                placeholder="List name..."
                value={newListName()}
                onInput={(e) => setNewListName(e.currentTarget.value)}
                class="flex-1 px-2 py-1 text-xs rounded-md bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#3C3D3E] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                data-testid="new-list-name-input"
                autofocus
              />
              <button
                type="submit"
                class="px-2 py-1 text-xs font-semibold bg-[#9E725F] text-white rounded-md hover:bg-[#865E4D] cursor-pointer"
                data-testid="save-new-list-btn"
              >
                Save
              </button>
            </form>
          </Show>

          {/* Filter Tabs with Morphing Indicator */}
          <div class="relative grid grid-cols-4 gap-1 p-0.5 rounded-lg bg-[#EAE8E2] dark:bg-[#141518] text-[11px] font-semibold text-[#6F7173]">
            {/* Morphing Sliding Pill */}
            <div
              class="absolute top-0.5 bottom-0.5 w-[calc(25%-2px)] rounded bg-white dark:bg-[#1E1F23] shadow-xs pointer-events-none transition-all duration-250 ease-[cubic-bezier(0.2,0,0,1)] z-0"
              style={{
                left:
                  filterMode() === "all"
                    ? "2px"
                    : filterMode() === "today"
                    ? "calc(25% + 1px)"
                    : filterMode() === "upcoming"
                    ? "calc(50% + 1px)"
                    : "calc(75% + 0px)",
              }}
            />
            <For each={filterTabs}>
              {(tab) => (
                <button
                  type="button"
                  onClick={() => setFilterMode(tab.key)}
                  class={`relative z-10 py-1 rounded text-center transition-colors duration-150 cursor-pointer bg-transparent ${
                    filterMode() === tab.key
                      ? "text-[#3C3D3E] dark:text-[#ECEBE8] font-bold"
                      : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#3C3D3E] dark:hover:text-[#ECEBE8]"
                  }`}
                  data-testid={`task-filter-${tab.key}`}
                >
                  {tab.label}
                </button>
              )}
            </For>
          </div>
        </div>

        {/* Quick Add Input */}
        <form onSubmit={handleQuickAdd} class="p-3 border-b border-[#E2DFD8] dark:border-[#2A2D35] flex items-center gap-2">
          <input
            type="text"
            placeholder="Add a task..."
            value={quickTitle()}
            onInput={(e) => setQuickTitle(e.currentTarget.value)}
            class="flex-1 px-3 py-1.5 rounded-lg bg-[#FAF9F5] dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2A2D35] text-xs text-[#3C3D3E] dark:text-[#ECEBE8] placeholder-[#6F7173] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
            data-testid="quick-add-task-input"
          />
          <button
            type="submit"
            disabled={!quickTitle().trim()}
            class="px-3 py-1.5 rounded-lg bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs font-semibold disabled:opacity-40 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
            data-testid="quick-add-task-btn"
          >
            Add
          </button>
        </form>

        {/* Task Items List */}
        <div class="flex-1 overflow-y-auto p-2 space-y-1">
          <Show
            when={filteredTasks().length > 0}
            fallback={
              <div class="flex flex-col items-center justify-center h-48 text-[#6F7173] dark:text-[#878A8E] text-xs gap-1.5">
                <svg class="w-8 h-8 stroke-current fill-none stroke-[1.5] text-[#6F7173]/40" viewBox="0 0 24 24">
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                <span>No tasks in this view</span>
              </div>
            }
          >
            <For each={filteredTasks()}>
              {(task) => {
                const overdue = () => isTaskOverdue(task, new Date(), props.primaryTimeZone || "UTC");
                return (
                  <div
                    class="group flex items-start gap-2.5 p-2 rounded-xl hover:bg-[#FAF9F5] dark:hover:bg-[#18191D] transition-colors border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2A2D35]"
                    data-testid="task-item-row"
                  >
                    {/* Completion Checkbox */}
                    <input
                      type="checkbox"
                      checked={task.completed}
                      onChange={() => toggleTaskComplete(props.mailboxId, task.id)}
                      class="mt-0.5 rounded text-[#9E725F] focus:ring-[#9E725F] cursor-pointer"
                      data-testid="task-checkbox"
                      title={task.completed ? "Reopen task" : "Mark as completed"}
                    />

                    {/* Task Title & Details */}
                    <div
                      class="flex-1 min-w-0 cursor-pointer"
                      onClick={() => props.onEditTask(task)}
                    >
                      <div class="flex items-center gap-1.5">
                        <span
                          class={`text-xs font-medium leading-snug truncate ${
                            task.completed
                              ? "line-through text-[#6F7173] dark:text-[#878A8E]"
                              : "text-[#3C3D3E] dark:text-[#ECEBE8]"
                          }`}
                          data-testid="task-title"
                        >
                          {task.title}
                        </span>
                        <Show when={task.rrule}>
                          <svg class="w-3 h-3 text-[#6F7173] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                          </svg>
                        </Show>
                      </div>

                      {/* Badges / Meta */}
                      <Show when={task.dueDate || (task.priority && task.priority !== "none")}>
                        <div class="flex flex-wrap items-center gap-1.5 mt-1 text-[10px]">
                          <Show when={task.dueDate}>
                            <span
                              class={`px-1.5 py-0.2 rounded font-semibold ${
                                overdue()
                                  ? "bg-red-500/20 text-red-600 dark:text-red-400"
                                  : "bg-[#FAF9F5] dark:bg-[#141518] text-[#6F7173] dark:text-[#878A8E] border border-[#E2DFD8] dark:border-[#2A2D35]"
                              }`}
                              data-testid={overdue() ? "task-overdue-badge" : "task-due-badge"}
                            >
                              {overdue() ? "Overdue: " : "Due: "}
                              {task.dueDate}
                              {task.dueTime ? ` ${task.dueTime}` : ""}
                            </span>
                          </Show>

                          <Show when={task.priority && task.priority !== "none"}>
                            <span
                              class={`px-1.5 py-0.2 rounded font-semibold ${
                                task.priority === "high"
                                  ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                                  : "bg-neutral-500/10 text-neutral-600 dark:text-neutral-400"
                              }`}
                            >
                              {task.priority}
                            </span>
                          </Show>
                        </div>
                      </Show>
                    </div>

                    {/* Quick Delete */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteTask(props.mailboxId, task.id);
                      }}
                      class="opacity-0 group-hover:opacity-100 p-1 rounded text-[#6F7173] hover:text-red-600 transition-opacity cursor-pointer focus:outline-none"
                      title="Delete task"
                      data-testid="quick-delete-task-btn"
                    >
                      <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              }}
            </For>
          </Show>
        </div>
      </aside>
    </Show>
  );
};
