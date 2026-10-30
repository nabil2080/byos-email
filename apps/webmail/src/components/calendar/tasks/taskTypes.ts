export type TaskPriority = "none" | "low" | "medium" | "high";

export interface TaskList {
  id: string;
  mailboxId: string;
  name: string;
  color?: string;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskItem {
  id: string;
  mailboxId: string;
  listId: string;
  title: string;
  description?: string;
  dueDate?: string; // "YYYY-MM-DD"
  dueTime?: string; // "HH:mm"
  isAllDay?: boolean;
  scheduledDate?: string; // "YYYY-MM-DD"
  scheduledTime?: string; // "HH:mm"
  rrule?: string; // RRULE string e.g. "FREQ=DAILY;INTERVAL=1"
  completed: boolean;
  completedAt?: string;
  reminders?: number[]; // minutes before due date/time
  priority?: TaskPriority;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  encryptedTitle?: string;
  encryptedDescription?: string;
}

export interface TaskFilterOptions {
  listId?: string;
  completed?: boolean;
  date?: string; // "YYYY-MM-DD"
  onlyOverdue?: boolean;
}
