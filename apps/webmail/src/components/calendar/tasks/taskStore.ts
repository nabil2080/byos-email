import { TaskList, TaskItem } from "./taskTypes";
import { utcToZonedParts } from "../../../utils/calendarTimezones";
import { getMailboxKeyFor } from "../../../session_isolation";
import * as WasmCore from "../../../generated/crypto-core/byos_crypto_core.js";
import { bytesToHex, hexToBytes } from "../../../attachment_crypto";
import { base64ToBytes, bytesToBase64 } from "../../../message_crypto";

const LISTS_PREFIX = "byos_calendar_task_lists_";
const TASKS_PREFIX = "byos_calendar_tasks_";
const TASK_AAD_PREFIX = "byos-calendar-tasks-v1";

function getListsKey(mailboxId: string): string {
  return `${LISTS_PREFIX}${mailboxId}`;
}

function getTasksKey(mailboxId: string): string {
  return `${TASKS_PREFIX}${mailboxId}`;
}

export const MAX_TASKS_PER_MAILBOX = 1000;
export const MAX_TASK_LISTS_PER_MAILBOX = 50;
export const MAX_TITLE_LENGTH = 500;
export const MAX_DESCRIPTION_LENGTH = 10000;
export const MAX_TAGS_COUNT = 50;

function resolveTaskMailboxKey(mailboxId: string, key?: Uint8Array | null): Uint8Array | null {
  if (key && key instanceof Uint8Array && key.length === 32) {
    return key;
  }
  return getMailboxKeyFor(mailboxId);
}

function encryptTaskText(
  mailboxKey: Uint8Array,
  mailboxId: string,
  plaintext: string
): string | null {
  if (!WasmCore || typeof WasmCore.wasm_aes_gcm_encrypt !== "function") {
    return null;
  }
  try {
    const textBytes = new TextEncoder().encode(plaintext);
    const aadHex = bytesToHex(new TextEncoder().encode(`${TASK_AAD_PREFIX}:${mailboxId}`));
    const envHex = WasmCore.wasm_aes_gcm_encrypt(
      bytesToHex(mailboxKey),
      bytesToHex(textBytes),
      aadHex
    );
    return bytesToBase64(hexToBytes(envHex));
  } catch (err) {
    console.warn("[taskStore] Failed to encrypt task text with AES-GCM:", err);
    return null;
  }
}

function decryptTaskText(
  mailboxKey: Uint8Array,
  mailboxId: string,
  ciphertextB64: string
): string | null {
  if (!WasmCore || typeof WasmCore.wasm_aes_gcm_decrypt !== "function") {
    return null;
  }
  try {
    const rawBytes = base64ToBytes(ciphertextB64);
    const aadHex = bytesToHex(new TextEncoder().encode(`${TASK_AAD_PREFIX}:${mailboxId}`));
    const decHex = WasmCore.wasm_aes_gcm_decrypt(
      bytesToHex(mailboxKey),
      bytesToHex(rawBytes),
      aadHex
    );
    return new TextDecoder().decode(hexToBytes(decHex));
  } catch (err) {
    console.warn("[taskStore] Failed to decrypt task text with AES-GCM:", err);
    return null;
  }
}

function persistTaskLists(mailboxId: string, lists: TaskList[]): void {
  if (typeof window === "undefined" || !mailboxId) return;
  const bounded = lists.slice(0, MAX_TASK_LISTS_PER_MAILBOX);
  try {
    localStorage.setItem(getListsKey(mailboxId), JSON.stringify(bounded));
  } catch (err) {
    console.warn("[taskStore] Failed to persist task lists:", err);
  }
}

function persistTasks(mailboxId: string, tasks: TaskItem[]): void {
  if (typeof window === "undefined" || !mailboxId) return;
  let bounded = tasks;
  if (bounded.length > MAX_TASKS_PER_MAILBOX) {
    const uncompleted = bounded.filter((t) => !t.completed);
    const completed = bounded.filter((t) => t.completed);
    completed.sort((a, b) => new Date(b.completedAt || b.updatedAt).getTime() - new Date(a.completedAt || a.updatedAt).getTime());
    if (uncompleted.length > MAX_TASKS_PER_MAILBOX) {
      uncompleted.sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
      bounded = uncompleted.slice(0, MAX_TASKS_PER_MAILBOX);
    } else {
      const allowedCompleted = Math.max(0, MAX_TASKS_PER_MAILBOX - uncompleted.length);
      bounded = [...uncompleted, ...completed.slice(0, allowedCompleted)];
    }
  }

  // Scrub plaintext title and description from stored JSON when encrypted fields are present
  const sanitizedForStorage = bounded.map((t) => {
    if (t.encryptedTitle) {
      return {
        ...t,
        title: "(Encrypted Task)",
        description: undefined,
      };
    }
    return t;
  });

  const key = getTasksKey(mailboxId);
  try {
    localStorage.setItem(key, JSON.stringify(sanitizedForStorage));
  } catch (err: any) {
    console.warn("[taskStore] Quota warning, pruning completed tasks:", err);
    try {
      const activeOnly = sanitizedForStorage.filter((t) => !t.completed);
      localStorage.setItem(key, JSON.stringify(activeOnly));
    } catch (fallbackErr) {
      console.error("[taskStore] Storage quota completely exhausted:", fallbackErr);
    }
  }
}

function dispatchTasksUpdated() {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      const EventCtor = (window as any).CustomEvent || (window as any).Event || (globalThis as any).CustomEvent || (globalThis as any).Event;
      if (EventCtor) {
        window.dispatchEvent(new EventCtor("byos_tasks_updated"));
      }
    } catch (e) {
      // Ignore event dispatch failure in non-browser environments
    }
  }
}

/**
 * Retrieves all task lists for a mailbox.
 * Creates a default "My Tasks" list if none exists.
 */
export function getTaskLists(mailboxId: string): TaskList[] {
  if (!mailboxId) return [];
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(getListsKey(mailboxId)) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn("[taskStore] Error loading task lists:", err);
  }

  // Fallback: seed default list
  const defaultList: TaskList = {
    id: `list-default-${mailboxId.slice(0, 8)}`,
    mailboxId,
    name: "My Tasks",
    color: "#9E725F",
    isDefault: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return [defaultList];
}

/**
 * Creates a new task list for a mailbox.
 */
export function createTaskList(mailboxId: string, name: string, color?: string): TaskList {
  if (!mailboxId || !name.trim()) {
    throw new Error("Missing required fields for task list creation");
  }
  const cleanName = name.trim().slice(0, 100);
  const current = getTaskLists(mailboxId);
  if (current.length >= MAX_TASK_LISTS_PER_MAILBOX) {
    throw new Error(`Maximum number of task lists (${MAX_TASK_LISTS_PER_MAILBOX}) reached`);
  }
  const newList: TaskList = {
    id: `list-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    mailboxId,
    name: cleanName,
    color: color || "#9E725F",
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const updated = [...current, newList];
  persistTaskLists(mailboxId, updated);
  dispatchTasksUpdated();
  return newList;
}

/**
 * Updates a task list's name or color.
 */
export function updateTaskList(
  mailboxId: string,
  listId: string,
  updates: Partial<Pick<TaskList, "name" | "color">>
): TaskList {
  const current = getTaskLists(mailboxId);
  const idx = current.findIndex((l) => l.id === listId);
  if (idx === -1) {
    throw new Error(`Task list not found: ${listId}`);
  }

  const cleanUpdates = { ...updates };
  if (cleanUpdates.name) {
    cleanUpdates.name = cleanUpdates.name.trim().slice(0, 100);
  }

  const updatedList: TaskList = {
    ...current[idx],
    ...cleanUpdates,
    updatedAt: new Date().toISOString(),
  };

  current[idx] = updatedList;
  persistTaskLists(mailboxId, current);
  dispatchTasksUpdated();
  return updatedList;
}

/**
 * Deletes a task list and either deletes its tasks or migrates them to the default list.
 */
export function deleteTaskList(mailboxId: string, listId: string): void {
  const current = getTaskLists(mailboxId);
  const target = current.find((l) => l.id === listId);
  if (!target) return;
  if (target.isDefault) {
    throw new Error("Cannot delete default task list");
  }

  const remaining = current.filter((l) => l.id !== listId);
  const defaultList = remaining.find((l) => l.isDefault) || remaining[0];

  persistTaskLists(mailboxId, remaining);

  // Reassign orphan tasks to default list
  const tasks = getTasks(mailboxId);
  let tasksChanged = false;
  const updatedTasks = tasks.map((t) => {
    if (t.listId === listId) {
      tasksChanged = true;
      return { ...t, listId: defaultList ? defaultList.id : "default", updatedAt: new Date().toISOString() };
    }
    return t;
  });

  if (tasksChanged) {
    persistTasks(mailboxId, updatedTasks);
  }
  dispatchTasksUpdated();
}

/**
 * Retrieves all tasks for a mailbox.
 * Decrypts AES-GCM encrypted titles and descriptions when the active mailbox key is available,
 * falling back to legacy plaintext titles/descriptions seamlessly.
 */
export function getTasks(mailboxId: string, mailboxKey?: Uint8Array | null): TaskItem[] {
  if (!mailboxId) return [];
  const activeKey = resolveTaskMailboxKey(mailboxId, mailboxKey);
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(getTasksKey(mailboxId)) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((t: TaskItem) => {
          let resolvedTitle = t.title;
          let resolvedDescription = t.description;

          if (t.encryptedTitle) {
            if (activeKey) {
              const dec = decryptTaskText(activeKey, mailboxId, t.encryptedTitle);
              if (dec !== null) resolvedTitle = dec;
            } else {
              resolvedTitle = "(Encrypted Task - Key Required)";
            }
          }
          if (t.encryptedDescription) {
            if (activeKey) {
              const dec = decryptTaskText(activeKey, mailboxId, t.encryptedDescription);
              if (dec !== null) resolvedDescription = dec;
            } else {
              resolvedDescription = undefined;
            }
          }

          return {
            ...t,
            title: resolvedTitle,
            description: resolvedDescription,
          };
        });
      }
    }
  } catch (err) {
    console.warn("[taskStore] Error loading tasks:", err);
  }
  return [];
}

/**
 * Saves a new task or updates an existing task.
 * Automatically encrypts title and description with AES-GCM when the mailbox key is available,
 * falling back to plaintext storage when no key is present.
 */
export function saveTask(
  mailboxId: string,
  taskData: Omit<TaskItem, "id" | "mailboxId" | "createdAt" | "updatedAt"> & { id?: string },
  mailboxKey?: Uint8Array | null
): TaskItem {
  if (!mailboxId) throw new Error("Mailbox ID required to save task");
  if (!taskData.title || !taskData.title.trim()) {
    throw new Error("Task title cannot be empty");
  }

  const cleanTitle = taskData.title.trim().slice(0, MAX_TITLE_LENGTH);
  const cleanDescription = taskData.description ? taskData.description.slice(0, MAX_DESCRIPTION_LENGTH) : undefined;
  const cleanTags = taskData.tags ? taskData.tags.slice(0, MAX_TAGS_COUNT) : undefined;

  const activeKey = resolveTaskMailboxKey(mailboxId, mailboxKey);
  let encryptedTitle: string | undefined;
  let encryptedDescription: string | undefined;

  if (activeKey) {
    const encT = encryptTaskText(activeKey, mailboxId, cleanTitle);
    if (encT) {
      encryptedTitle = encT;
    }
    if (cleanDescription) {
      const encD = encryptTaskText(activeKey, mailboxId, cleanDescription);
      if (encD) {
        encryptedDescription = encD;
      }
    }
  }

  const current = getTasks(mailboxId, mailboxKey);
  const now = new Date().toISOString();

  let savedTask: TaskItem;

  if (taskData.id) {
    // Update existing task
    const idx = current.findIndex((t) => t.id === taskData.id);
    if (idx === -1) {
      throw new Error(`Task not found: ${taskData.id}`);
    }

    savedTask = {
      ...current[idx],
      ...taskData,
      title: cleanTitle,
      description: cleanDescription,
      tags: cleanTags,
      encryptedTitle: encryptedTitle !== undefined ? encryptedTitle : (activeKey ? undefined : current[idx].encryptedTitle),
      encryptedDescription: encryptedDescription !== undefined ? encryptedDescription : (activeKey ? undefined : current[idx].encryptedDescription),
      updatedAt: now,
    };
    current[idx] = savedTask;
  } else {
    // Create new task
    savedTask = {
      ...taskData,
      id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      mailboxId,
      title: cleanTitle,
      description: cleanDescription,
      tags: cleanTags,
      completed: false,
      encryptedTitle,
      encryptedDescription,
      createdAt: now,
      updatedAt: now,
    };
    current.push(savedTask);
  }

  persistTasks(mailboxId, current);
  dispatchTasksUpdated();
  return savedTask;
}

/**
 * Toggles a task's completion status.
 * If the task is repeating and is being marked completed, automatically spawns
 * the next recurrence task according to its rrule.
 */
export function toggleTaskComplete(mailboxId: string, taskId: string, mailboxKey?: Uint8Array | null): TaskItem {
  const activeKey = resolveTaskMailboxKey(mailboxId, mailboxKey);
  const current = getTasks(mailboxId, mailboxKey);
  const idx = current.findIndex((t) => t.id === taskId);
  if (idx === -1) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const target = current[idx];
  const nextCompleted = !target.completed;
  const nowIso = new Date().toISOString();

  const updated: TaskItem = {
    ...target,
    completed: nextCompleted,
    completedAt: nextCompleted ? nowIso : undefined,
    updatedAt: nowIso,
  };
  current[idx] = updated;

  // Handle repeating task progression when completing
  if (nextCompleted && target.rrule && target.dueDate) {
    const nextDueDate = computeNextTaskDueDate(target.dueDate, target.rrule);
    if (nextDueDate) {
      let nextEncTitle = target.encryptedTitle;
      let nextEncDesc = target.encryptedDescription;
      if (activeKey) {
        nextEncTitle = encryptTaskText(activeKey, mailboxId, target.title) || undefined;
        nextEncDesc = target.description ? (encryptTaskText(activeKey, mailboxId, target.description) || undefined) : undefined;
      }
      const nextTask: TaskItem = {
        ...target,
        id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        completed: false,
        completedAt: undefined,
        dueDate: nextDueDate,
        scheduledDate: target.scheduledDate ? (computeNextTaskDueDate(target.scheduledDate, target.rrule) ?? undefined) : undefined,
        encryptedTitle: nextEncTitle,
        encryptedDescription: nextEncDesc,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      current.push(nextTask);
    }
  }

  persistTasks(mailboxId, current);
  dispatchTasksUpdated();
  return updated;
}

/**
 * Deletes a task by id.
 */
export function deleteTask(mailboxId: string, taskId: string, mailboxKey?: Uint8Array | null): void {
  const current = getTasks(mailboxId, mailboxKey);
  const remaining = current.filter((t) => t.id !== taskId);
  persistTasks(mailboxId, remaining);
  dispatchTasksUpdated();
}

/**
 * Checks whether an uncompleted task is overdue relative to a reference timestamp and timezone.
 */
export function isTaskOverdue(task: TaskItem, referenceTime: Date = new Date(), timeZone: string = "UTC"): boolean {
  if (task.completed) return false;
  if (!task.dueDate) return false;

  const { dateStr, timeStr } = utcToZonedParts(referenceTime, timeZone);

  if (task.dueTime) {
    const taskDueDateTime = `${task.dueDate}T${task.dueTime}`;
    const currentDateTime = `${dateStr}T${timeStr}`;
    return taskDueDateTime < currentDateTime;
  }

  // All-day due date: overdue if dueDate is strictly prior to today's date
  return task.dueDate < dateStr;
}

/**
 * Filters tasks scheduled or due on a given calendar date (YYYY-MM-DD).
 */
export function getTasksForDate(tasks: TaskItem[], targetDate: Date, timeZone: string = "UTC"): TaskItem[] {
  const { dateStr } = utcToZonedParts(targetDate, timeZone);
  return tasks.filter((t) => {
    return t.dueDate === dateStr || t.scheduledDate === dateStr;
  });
}

/**
 * Computes the next occurrence date for a repeating task.
 */
export function computeNextTaskDueDate(currentDateStr: string, rruleStr: string): string | null {
  const [y, m, d] = currentDateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

  const upper = rruleStr.toUpperCase();
  let interval = 1;
  const intervalMatch = upper.match(/INTERVAL=(\d+)/);
  if (intervalMatch) {
    interval = parseInt(intervalMatch[1], 10);
  }

  if (upper.includes("FREQ=DAILY")) {
    date.setUTCDate(date.getUTCDate() + interval);
  } else if (upper.includes("FREQ=WEEKLY")) {
    date.setUTCDate(date.getUTCDate() + 7 * interval);
  } else if (upper.includes("FREQ=MONTHLY")) {
    date.setUTCMonth(date.getUTCMonth() + interval);
  } else if (upper.includes("FREQ=YEARLY")) {
    date.setUTCFullYear(date.getUTCFullYear() + interval);
  } else {
    return null;
  }

  const nextY = date.getUTCFullYear();
  const nextM = String(date.getUTCMonth() + 1).padStart(2, "0");
  const nextD = String(date.getUTCDate()).padStart(2, "0");
  return `${nextY}-${nextM}-${nextD}`;
}
