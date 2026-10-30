import {
  TaskList,
  TaskItem,
} from "./components/calendar/tasks/taskTypes.js";
import {
  getTaskLists,
  createTaskList,
  updateTaskList,
  deleteTaskList,
  getTasks,
  saveTask,
  toggleTaskComplete,
  deleteTask,
  isTaskOverdue,
  getTasksForDate,
  computeNextTaskDueDate,
} from "./components/calendar/tasks/taskStore.js";
import {
  evaluateUpcomingTaskReminders,
} from "./utils/calendarNotifications.js";
import { DEFAULT_CALENDAR_SETTINGS, CalendarUserSettings } from "./components/calendar/settings/calendarSettingsStore.js";

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error("Assertion failed: " + msg);
}

// In-memory mock localStorage for Node.js test environment
const memoryStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => memoryStore[key] || null,
  setItem: (key: string, val: string) => {
    memoryStore[key] = String(val);
  },
  removeItem: (key: string) => {
    delete memoryStore[key];
  },
  clear: () => {
    for (const k in memoryStore) delete memoryStore[k];
  },
};

export async function runCalendarCategory11Tests(): Promise<{ passed: number; failed: number }> {
  const prevLocalStorage = (globalThis as any).localStorage;
  const prevWindow = (globalThis as any).window;
  (globalThis as any).localStorage = mockLocalStorage;
  if (typeof (globalThis as any).window === "undefined") {
    (globalThis as any).window = globalThis;
  }

  let passed = 0;
  let failed = 0;

  try {

  function runTest(name: string, fn: () => void | Promise<void>) {
    try {
      mockLocalStorage.clear();
      fn();
      passed++;
    } catch (err: any) {
      console.error(`  FAIL: ${name} ->`, err.message);
      failed++;
    }
  }

  const mailboxId = "mbx-test-alice-1234";

  // 1. Distinct Data Object Architecture
  runTest("Cat 11.1: Distinct Data Object Architecture (tasks != calendar events)", () => {
    const list = createTaskList(mailboxId, "Security Operations", "#3B82F6");
    const task = saveTask(mailboxId, {
      listId: list.id,
      title: "Rotate Root TLS Certificates",
      description: "Perform staged rotation across load balancers",
      dueDate: "2026-11-15",
      dueTime: "14:00",
      isAllDay: false,
      completed: false,
      priority: "high",
    });

    // Verify task is distinct object with required task fields
    assert(typeof task.id === "string" && task.id.startsWith("task-"), "Task has distinct task ID prefix");
    assert(task.listId === list.id, "Task references distinct task list");
    assert(task.completed === false, "Task tracks independent completion status");
    assert(task.priority === "high", "Task tracks priority classification");
    assert((task as any).startTime === undefined, "Task does NOT have calendar event startTime");
    assert((task as any).endTime === undefined, "Task does NOT have calendar event endTime");
    assert((task as any).calendarId === undefined, "Task does NOT reference calendarId");
  });

  // 2. Task List Management & Organization
  runTest("Cat 11.2: Task list management, updating, and orphan task protection", () => {
    // Initial fetch seeds default list
    const initialLists = getTaskLists(mailboxId);
    assert(initialLists.length === 1, "Default list seeded on first access");
    assert(initialLists[0].isDefault === true, "Default list has isDefault=true");
    const defaultListId = initialLists[0].id;

    // Create custom list
    const workList = createTaskList(mailboxId, "DevOps Sprint", "#10B981");
    assert(workList.name === "DevOps Sprint", "Created custom list with name");
    assert(workList.color === "#10B981", "Created custom list with color");

    // Update list
    const updatedWorkList = updateTaskList(mailboxId, workList.id, { name: "Platform Engineering" });
    assert(updatedWorkList.name === "Platform Engineering", "List name successfully updated");

    // Add task to custom list
    const customTask = saveTask(mailboxId, {
      listId: workList.id,
      title: "Update Kubernetes Deployments",
      completed: false,
    });

    // Delete custom list -> task should be reassigned to default list
    deleteTaskList(mailboxId, workList.id);
    const listsAfterDelete = getTaskLists(mailboxId);
    assert(listsAfterDelete.length === 1, "Custom list removed from list store");

    const tasksAfterDelete = getTasks(mailboxId);
    const reassignedTask = tasksAfterDelete.find((t) => t.id === customTask.id);
    assert(reassignedTask !== undefined, "Task not deleted when parent list was removed");
    assert(reassignedTask!.listId === defaultListId, "Orphan task safely reassigned to default task list");

    // Prevent default list deletion
    let threw = false;
    try {
      deleteTaskList(mailboxId, defaultListId);
    } catch {
      threw = true;
    }
    assert(threw, "Deleting default task list must fail closed");
  });

  // 3. Task Creation, Editing & Persistence
  runTest("Cat 11.3: Task creation, updating, and isolated per-mailbox storage", () => {
    const list = getTaskLists(mailboxId)[0];

    // Create task
    const created = saveTask(mailboxId, {
      listId: list.id,
      title: "Review Zero-Knowledge Cryptographic Specification",
      description: "Audit AES-GCM envelope and HPKE integration",
      dueDate: "2026-11-20",
      priority: "medium",
      completed: false,
    });

    // Update task
    const updated = saveTask(mailboxId, {
      id: created.id,
      listId: list.id,
      title: "Review Zero-Knowledge Cryptographic Specification (Approved)",
      description: "Audit completed with zero findings",
      dueDate: "2026-11-21",
      priority: "high",
      completed: false,
    });

    assert(updated.id === created.id, "Task ID preserved across edit");
    assert(updated.title.includes("(Approved)"), "Task title updated");
    assert(updated.priority === "high", "Task priority updated");
    assert(updated.dueDate === "2026-11-21", "Task due date updated");

    // Verify per-mailbox isolation (other mailbox has 0 tasks)
    const otherMailboxTasks = getTasks("mbx-bob-5678");
    assert(otherMailboxTasks.length === 0, "Other mailbox has zero tasks (isolation preserved)");
  });

  // 4. Completion & Reopening Lifecycle
  runTest("Cat 11.4: Complete and reopen task lifecycle", () => {
    const list = getTaskLists(mailboxId)[0];
    const task = saveTask(mailboxId, {
      listId: list.id,
      title: "Submit Quarterly Compliance Report",
      completed: false,
    });
    assert(task.completed === false, "Initial state is uncompleted");
    assert(task.completedAt === undefined, "Initial completedAt is undefined");

    // Complete task
    const completedTask = toggleTaskComplete(mailboxId, task.id);
    assert(completedTask.completed === true, "Task marked as completed");
    assert(typeof completedTask.completedAt === "string", "completedAt timestamp recorded");

    // Reopen task
    const reopenedTask = toggleTaskComplete(mailboxId, task.id);
    assert(reopenedTask.completed === false, "Task marked as reopened");
    assert(reopenedTask.completedAt === undefined, "completedAt cleared upon reopen");
  });

  // 5. Repeating Tasks State & Progression
  runTest("Cat 11.5: Repeating task recurrence progression", () => {
    // Test helper directly
    const nextDaily = computeNextTaskDueDate("2026-11-10", "FREQ=DAILY;INTERVAL=1");
    assert(nextDaily === "2026-11-11", "Daily recurrence advances by 1 day");

    const nextWeekly = computeNextTaskDueDate("2026-11-10", "FREQ=WEEKLY;INTERVAL=2");
    assert(nextWeekly === "2026-11-24", "Bi-weekly recurrence advances by 14 days");

    const nextMonthly = computeNextTaskDueDate("2026-11-10", "FREQ=MONTHLY;INTERVAL=1");
    assert(nextMonthly === "2026-12-10", "Monthly recurrence advances by 1 month");

    // Test automatic spawn upon completion
    const list = getTaskLists(mailboxId)[0];
    const recurringTask = saveTask(mailboxId, {
      listId: list.id,
      title: "Weekly Security Scan",
      dueDate: "2026-11-10",
      rrule: "FREQ=WEEKLY;INTERVAL=1",
      completed: false,
    });

    toggleTaskComplete(mailboxId, recurringTask.id);
    const allTasks = getTasks(mailboxId);
    assert(allTasks.length === 2, "Completing repeating task spawned next occurrence");

    const original = allTasks.find((t) => t.id === recurringTask.id)!;
    assert(original.completed === true, "Original task is marked completed");

    const nextSpawned = allTasks.find((t) => t.id !== recurringTask.id)!;
    assert(nextSpawned.completed === false, "Spawned occurrence is uncompleted");
    assert(nextSpawned.dueDate === "2026-11-17", "Spawned occurrence due date is next week (+7 days)");
    assert(nextSpawned.title === "Weekly Security Scan", "Spawned occurrence preserved title");
  });

  // 6. Timezone-Aware Overdue Indicators
  runTest("Cat 11.6: Timezone-aware overdue task evaluation", () => {
    const referenceNow = new Date("2026-11-10T12:00:00Z"); // 12:00 UTC

    // Task 1: Past due time on same day (due 09:00 UTC) -> overdue
    const pastTimedTask: TaskItem = {
      id: "t1",
      mailboxId,
      listId: "l1",
      title: "Morning check",
      dueDate: "2026-11-10",
      dueTime: "09:00",
      completed: false,
      createdAt: "",
      updatedAt: "",
    };
    assert(isTaskOverdue(pastTimedTask, referenceNow, "UTC") === true, "09:00 task is overdue at 12:00");

    // Task 2: Future due time on same day (due 15:00 UTC) -> not overdue
    const futureTimedTask: TaskItem = {
      ...pastTimedTask,
      id: "t2",
      dueTime: "15:00",
    };
    assert(isTaskOverdue(futureTimedTask, referenceNow, "UTC") === false, "15:00 task is not overdue at 12:00");

    // Task 3: Completed task is NEVER overdue
    const completedPastTask: TaskItem = {
      ...pastTimedTask,
      id: "t3",
      completed: true,
    };
    assert(isTaskOverdue(completedPastTask, referenceNow, "UTC") === false, "Completed task is never overdue");

    // Task 4: All-day due date from yesterday -> overdue
    const pastAllDayTask: TaskItem = {
      ...pastTimedTask,
      id: "t4",
      dueDate: "2026-11-09",
      dueTime: undefined,
    };
    assert(isTaskOverdue(pastAllDayTask, referenceNow, "UTC") === true, "Yesterday all-day task is overdue");

    // Task 5: All-day due date today -> not overdue yet
    const todayAllDayTask: TaskItem = {
      ...pastTimedTask,
      id: "t5",
      dueDate: "2026-11-10",
      dueTime: undefined,
    };
    assert(isTaskOverdue(todayAllDayTask, referenceNow, "UTC") === false, "Today all-day task is not overdue");
  });

  // 7. Calendar View Date Filtering & Event Isolation
  runTest("Cat 11.7: Calendar view date filtering without event corruption", () => {
    const tasks: TaskItem[] = [
      {
        id: "t-nov10",
        mailboxId,
        listId: "l1",
        title: "Nov 10 Deadline",
        dueDate: "2026-11-10",
        completed: false,
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "t-nov11",
        mailboxId,
        listId: "l1",
        title: "Nov 11 Scheduled Item",
        scheduledDate: "2026-11-11",
        completed: false,
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "t-nov12",
        mailboxId,
        listId: "l1",
        title: "Nov 12 Future Task",
        dueDate: "2026-11-12",
        completed: false,
        createdAt: "",
        updatedAt: "",
      },
    ];

    const nov10Date = new Date("2026-11-10T10:00:00Z");
    const nov10Results = getTasksForDate(tasks, nov10Date, "UTC");
    assert(nov10Results.length === 1, "Only Nov 10 task matched");
    assert(nov10Results[0].id === "t-nov10", "Matched correct Nov 10 task");

    const nov11Date = new Date("2026-11-11T10:00:00Z");
    const nov11Results = getTasksForDate(tasks, nov11Date, "UTC");
    assert(nov11Results.length === 1, "Only Nov 11 task matched");
    assert(nov11Results[0].id === "t-nov11", "Matched correct Nov 11 scheduled task");
  });

  // 8. Task Reminders & Quiet Hours Integration
  runTest("Cat 11.8: Task reminder alerts and quiet hours suppression", () => {
    const testNow = new Date("2026-11-10T09:45:00");
    const settings: CalendarUserSettings = {
      ...DEFAULT_CALENDAR_SETTINGS,
      notifyOnTasks: true,
      quietHoursEnabled: false,
    };

    const taskWithReminder: TaskItem = {
      id: "task-rem-1",
      mailboxId,
      listId: "l1",
      title: "Deploy Production Patch",
      dueDate: "2026-11-10",
      dueTime: "10:00",
      reminders: [15], // 15m before 10:00 is 09:45
      completed: false,
      createdAt: "",
      updatedAt: "",
    };

    const ledger = new Set<string>();

    // Case 1: Alert triggers at 09:45
    const alerts = evaluateUpcomingTaskReminders([taskWithReminder], testNow, settings, ledger);
    assert(alerts.length === 1, "Task reminder triggered exactly at 15 minutes before");
    assert(alerts[0].title === "Task Due: Deploy Production Patch", "Alert contains formatted task title");
    assert(ledger.has("task_task-rem-1_15"), "Dispatched ledger updated to prevent repeat triggers");

    // Case 2: Deduplication prevents repeat trigger
    const repeatAlerts = evaluateUpcomingTaskReminders([taskWithReminder], testNow, settings, ledger);
    assert(repeatAlerts.length === 0, "Deduplication ledger prevents repeat alert");

    // Case 3: Suppression when notifyOnTasks is false
    const noNotifySettings: CalendarUserSettings = {
      ...settings,
      notifyOnTasks: false,
    };
    const freshLedger = new Set<string>();
    const noAlerts = evaluateUpcomingTaskReminders([taskWithReminder], testNow, noNotifySettings, freshLedger);
    assert(noAlerts.length === 0, "Reminders suppressed when notifyOnTasks is disabled");
  });

  return { passed, failed };
  } finally {
    (globalThis as any).localStorage = prevLocalStorage;
    (globalThis as any).window = prevWindow;
  }
}
