import { Component, createSignal, createEffect, For, Show, onMount, onCleanup } from "solid-js";
import { UserCalendar, ContactItem } from "../../api";
import { RecipientInput } from "../RecipientInput";
import { DecryptedEventRecord } from "./CalendarSidebar";
import {
  CalendarEventPlaintext,
  CalendarAttachment,
  CalendarGuestPermissions,
  CalendarReminder,
  CalendarEventType,
} from "../../calendar_crypto";
import { parseRRule, buildRRuleString } from "../../utils/calendarRrule";
import { SUPPORTED_TIMEZONES, zonedTimeToUtc, utcToZonedParts } from "../../utils/calendarTimezones";
import { generateVideoMeetingUrl } from "./integrations/calendarIntegrationsStore";

export const EVENT_COLOR_PALETTE = [
  { id: "default", label: "Calendar default", hex: "default" },
  { id: "copper", label: "Copper", hex: "#9E725F" },
  { id: "forest", label: "Forest", hex: "#4B6B58" },
  { id: "slate", label: "Slate Blue", hex: "#4A6B82" },
  { id: "amber", label: "Amber Gold", hex: "#C88A35" },
  { id: "berry", label: "Berry", hex: "#8C3B4A" },
  { id: "plum", label: "Deep Plum", hex: "#684A75" },
  { id: "olive", label: "Olive", hex: "#74704B" },
  { id: "charcoal", label: "Charcoal", hex: "#3C3F48" },
];

export const EVENT_TEMPLATES = [
  { id: "custom", label: "None (Custom)" },
  { id: "sync_30", label: "1:1 Sync (30m, Private)" },
  { id: "standup_15", label: "Team Standup (15m)" },
  { id: "focus_60", label: "Focus Time (1h, Private)" },
  { id: "workshop_120", label: "Planning Workshop (2h)" },
  { id: "ooo_day", label: "Out of Office (All day)" },
];

export const EVENT_REMINDER_OPTIONS = [
  { value: -1, label: "Use calendar default" },
  { value: 0, label: "At event start" },
  { value: 5, label: "5 minutes before" },
  { value: 10, label: "10 minutes before" },
  { value: 15, label: "15 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 1440, label: "1 day before" },
  { value: -2, label: "No reminder" },
];

interface EventModalProps {
  isOpen: boolean;
  onClose: () => void;
  isLocked?: boolean;
  eventToEdit: DecryptedEventRecord | null;
  defaultStartDate?: Date;
  defaultEndDate?: Date;
  defaultDurationMinutes?: number;
  defaultCalendarId?: string;
  defaultTimeZone?: string;
  defaultVisibility?: "default" | "public" | "private" | "confidential";
  defaultGuestPermissions?: {
    modifyEvent?: boolean;
    inviteOthers?: boolean;
    seeGuestList?: boolean;
  };
  defaultReminderMinutes?: number;
  calendars: UserCalendar[];
  contacts?: ContactItem[];
  onSave: (payload: {
    calendarId: string;
    startTime: Date;
    endTime: Date;
    isAllDay: boolean;
    rrule?: string;
    status: string;
    sendInvitations?: boolean;
    details: CalendarEventPlaintext;
    editScope?: "occurrence" | "series";
  }) => Promise<void>;
  onDelete?: (eventId: string, deleteScope?: "occurrence" | "series") => Promise<void>;
  onDuplicate?: (ev: DecryptedEventRecord) => Promise<void> | void;
  onCopyToCalendar?: (ev: DecryptedEventRecord, targetCalendarId: string) => Promise<void> | void;
  onHideHoliday?: (feedId: string, eventId: string) => void;
}

export const EventModal: Component<EventModalProps> = (props) => {
  const [selectedTemplate, setSelectedTemplate] = createSignal("custom");
  const [title, setTitle] = createSignal("");
  const [calendarId, setCalendarId] = createSignal("");
  const [color, setColor] = createSignal("default");
  const [visibility, setVisibility] = createSignal<"default" | "public" | "private" | "confidential">("default");
  const [eventType, setEventType] = createSignal<CalendarEventType>("default");
  const [workingLocation, setWorkingLocation] = createSignal<string>("office");
  const [autoDeclineMode, setAutoDeclineMode] = createSignal<"none" | "new_invitations" | "all_invitations">("none");
  const [autoDeclineMessage, setAutoDeclineMessage] = createSignal<string>(
    "I am currently out of the office and unable to attend."
  );
  const [eventTimeZone, setEventTimeZone] = createSignal(props.defaultTimeZone || "UTC");
  const [isAllDay, setIsAllDay] = createSignal(false);
  const [startDateStr, setStartDateStr] = createSignal("");
  const [startTimeStr, setStartTimeStr] = createSignal("09:00");
  const [endDateStr, setEndDateStr] = createSignal("");
  const [endTimeStr, setEndTimeStr] = createSignal("10:00");
  const [recurrenceFreq, setRecurrenceFreq] = createSignal<string>("none");
  const [recurrenceInterval, setRecurrenceInterval] = createSignal<number>(1);
  const [recurrenceByDay, setRecurrenceByDay] = createSignal<string[]>([]);
  const [recurrenceEndType, setRecurrenceEndType] = createSignal<"never" | "count" | "until">("never");
  const [recurrenceCount, setRecurrenceCount] = createSignal<number>(10);
  const [recurrenceUntil, setRecurrenceUntil] = createSignal<string>("");
  const [showCustomRecurrence, setShowCustomRecurrence] = createSignal(false);
  const [editScope, setEditScope] = createSignal<"occurrence" | "series">("occurrence");

  const WEEKDAY_OPTIONS = [
    { code: "SU", label: "S", title: "Sunday" },
    { code: "MO", label: "M", title: "Monday" },
    { code: "TU", label: "T", title: "Tuesday" },
    { code: "WE", label: "W", title: "Wednesday" },
    { code: "TH", label: "T", title: "Thursday" },
    { code: "FR", label: "F", title: "Friday" },
    { code: "SA", label: "S", title: "Saturday" },
  ];

  function toggleWeekday(code: string) {
    if (isReadOnly()) return;
    setRecurrenceByDay((prev) => {
      if (prev.includes(code)) {
        if (prev.length <= 1) return prev;
        return prev.filter((d) => d !== code);
      } else {
        return [...prev, code];
      }
    });
  }
  const [location, setLocation] = createSignal("");
  const [meetingUrl, setMeetingUrl] = createSignal("");
  const [sourceEmailId, setSourceEmailId] = createSignal<string | undefined>(undefined);
  const [sourceMessageSubject, setSourceMessageSubject] = createSignal<string | undefined>(undefined);
  const [sourceCategory, setSourceCategory] = createSignal<string | undefined>(undefined);
  const [sourceConfirmationCode, setSourceConfirmationCode] = createSignal<string | undefined>(undefined);
  const [sourceProvider, setSourceProvider] = createSignal<string | undefined>(undefined);
  const [attendeesRaw, setAttendeesRaw] = createSignal("");
  const [guestModify, setGuestModify] = createSignal(false);
  const [guestInvite, setGuestInvite] = createSignal(true);
  const [guestSeeList, setGuestSeeList] = createSignal(true);
  const [showGuestPermissions, setShowGuestPermissions] = createSignal(false);
  const [reminderMinutes, setReminderMinutes] = createSignal<number>(-1);
  const [remindersList, setRemindersList] = createSignal<CalendarReminder[]>([]);

  function addReminderRow() {
    if (isReadOnly()) return;
    setRemindersList((prev) => [...prev, { minutesBefore: 10, method: "notification" }]);
    if (reminderMinutes() === -2) {
      setReminderMinutes(10);
    }
  }

  function removeReminderRow(index: number) {
    if (isReadOnly()) return;
    setRemindersList((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      if (updated.length === 0) {
        setReminderMinutes(-2);
      } else {
        setReminderMinutes(updated[0].minutesBefore);
      }
      return updated;
    });
  }

  function updateReminderRow(index: number, minutesBefore: number, method?: "notification" | "email") {
    if (isReadOnly()) return;
    if (minutesBefore === -2) {
      setRemindersList([]);
      setReminderMinutes(-2);
      return;
    }
    setRemindersList((prev) => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = {
          minutesBefore,
          method: method || updated[index].method || "notification",
        };
      }
      if (index === 0) {
        setReminderMinutes(minutesBefore);
      }
      return updated;
    });
  }
  const [attachments, setAttachments] = createSignal<CalendarAttachment[]>([]);
  const [copyTargetCalId, setCopyTargetCalId] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [status, setStatus] = createSignal("busy");
  const [sendInvitations, setSendInvitations] = createSignal(true);
  const [isSaving, setIsSaving] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);

  let titleInputRef: HTMLInputElement | undefined;

  const selectedCalendar = () => props.calendars.find((c) => c.id === calendarId());
  const isReadOnly = () => {
    if (props.eventToEdit?.isHoliday) return true;
    const cal = selectedCalendar();
    return Boolean(cal?.is_shared && cal?.permission === "read");
  };

  function toDateInputVal(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function toTimeInputVal(d: Date): string {
    const hours = String(d.getHours()).padStart(2, "0");
    const mins = String(d.getMinutes()).padStart(2, "0");
    return `${hours}:${mins}`;
  }

  // Populate form on open or eventToEdit change
  createEffect(() => {
    if (!props.isOpen) return;
    setErrorMsg(null);
    setSelectedTemplate("custom");
    setCopyTargetCalId("");

    const ev = props.eventToEdit;
    if (ev) {
      setTitle(ev.details.title || "");
      setCalendarId(ev.calendarId);
      setColor(ev.details.color || "default");
      setVisibility(ev.details.visibility || props.defaultVisibility || "default");
      setGuestModify(ev.details.guestPermissions?.modifyEvent ?? props.defaultGuestPermissions?.modifyEvent ?? false);
      setGuestInvite(ev.details.guestPermissions?.inviteOthers ?? props.defaultGuestPermissions?.inviteOthers ?? true);
      setGuestSeeList(ev.details.guestPermissions?.seeGuestList ?? props.defaultGuestPermissions?.seeGuestList ?? true);
      if (ev.details.reminders && ev.details.reminders.length > 0) {
        setRemindersList([...ev.details.reminders]);
        setReminderMinutes(ev.details.reminders[0].minutesBefore);
      } else if (ev.details.reminders && ev.details.reminders.length === 0) {
        setRemindersList([]);
        setReminderMinutes(-2);
      } else {
        setRemindersList([{ minutesBefore: -1, method: "notification" }]);
        setReminderMinutes(-1);
      }
      setAttachments(ev.details.attachments ? [...ev.details.attachments] : []);
      setIsAllDay(ev.isAllDay);
      const tz = ev.details.timezone || props.defaultTimeZone || "UTC";
      setEventTimeZone(tz);
      if (ev.isAllDay) {
        setStartDateStr(toDateInputVal(ev.startTime));
        setStartTimeStr("09:00");
        setEndDateStr(toDateInputVal(ev.endTime));
        setEndTimeStr("10:00");
      } else {
        const startZoned = utcToZonedParts(ev.startTime, tz);
        const endZoned = utcToZonedParts(ev.endTime, tz);
        setStartDateStr(startZoned.dateStr);
        setStartTimeStr(startZoned.timeStr);
        setEndDateStr(endZoned.dateStr);
        setEndTimeStr(endZoned.timeStr);
      }
      setLocation(ev.details.location || "");
      setMeetingUrl(ev.details.meetingUrl || "");
      setSourceEmailId(ev.details.sourceEmailId);
      setSourceMessageSubject(ev.details.sourceMessageSubject);
      setSourceCategory(ev.details.sourceCategory);
      setSourceConfirmationCode(ev.details.sourceConfirmationCode);
      setSourceProvider(ev.details.sourceProvider);
      const emails = (ev.details.attendees || []).map((a) => a.email).join(", ");
      setAttendeesRaw(emails);
      setDescription(ev.details.description || "");
      setStatus(ev.status || "busy");
      setEventType(ev.details.eventType || (ev.status === "out_of_office" ? "out_of_office" : "default"));
      setWorkingLocation(ev.details.workingLocation || "office");
      setAutoDeclineMode(ev.details.autoDeclineMode || (ev.status === "out_of_office" ? "new_invitations" : "none"));
      setAutoDeclineMessage(ev.details.autoDeclineMessage || "I am currently out of the office and unable to attend.");

      // Set recurrence rules
      if (ev.rrule) {
        const rule = parseRRule(ev.rrule);
        if (rule) {
          setRecurrenceFreq(rule.freq.toLowerCase());
          setRecurrenceInterval(rule.interval || 1);
          setRecurrenceByDay(rule.byDay || []);
          if (rule.count !== undefined && rule.count > 0) {
            setRecurrenceEndType("count");
            setRecurrenceCount(rule.count);
          } else if (rule.until) {
            setRecurrenceEndType("until");
            setRecurrenceUntil(toDateInputVal(rule.until));
          } else {
            setRecurrenceEndType("never");
          }
          setShowCustomRecurrence(true);
        } else {
          setRecurrenceFreq("none");
          setRecurrenceInterval(1);
          setRecurrenceByDay([]);
          setRecurrenceEndType("never");
          setShowCustomRecurrence(false);
        }
      } else {
        setRecurrenceFreq("none");
        setRecurrenceInterval(1);
        setRecurrenceByDay([]);
        setRecurrenceEndType("never");
        setShowCustomRecurrence(false);
      }
      setEditScope(ev.isOccurrence ? "occurrence" : "series");
    } else {
      // New event defaults
      setTitle("");
      setColor("default");
      setVisibility(props.defaultVisibility || "default");
      setGuestModify(props.defaultGuestPermissions?.modifyEvent ?? false);
      setGuestInvite(props.defaultGuestPermissions?.inviteOthers ?? true);
      setGuestSeeList(props.defaultGuestPermissions?.seeGuestList ?? true);
      const defReminder = props.defaultReminderMinutes !== undefined ? props.defaultReminderMinutes : -1;
      setReminderMinutes(defReminder);
      setRemindersList(defReminder === -2 ? [] : [{ minutesBefore: defReminder, method: "notification" }]);
      setAttachments([]);
      const targetTz = props.defaultTimeZone || "UTC";
      setEventTimeZone(targetTz);

      const configuredDefaultCal = props.defaultCalendarId
        ? props.calendars.find((c) => c.id === props.defaultCalendarId && (!c.is_shared || c.permission === "write"))
        : undefined;
      const defaultCal =
        configuredDefaultCal ||
        props.calendars.find((c) => c.is_default && (!c.is_shared || c.permission === "write")) ||
        props.calendars.find((c) => !c.is_shared || c.permission === "write") ||
        props.calendars[0];
      setCalendarId(defaultCal?.id || "");
      setIsAllDay(false);

      const durationMs = (props.defaultDurationMinutes || 60) * 60 * 1000;
      const start = props.defaultStartDate || new Date();
      const end = props.defaultEndDate || new Date(start.getTime() + durationMs);
      const startZoned = utcToZonedParts(start, targetTz);
      const endZoned = utcToZonedParts(end, targetTz);
      setStartDateStr(startZoned.dateStr);
      setStartTimeStr(startZoned.timeStr);
      setEndDateStr(endZoned.dateStr);
      setEndTimeStr(endZoned.timeStr);

      setLocation("");
      setMeetingUrl("");
      setSourceEmailId(undefined);
      setSourceMessageSubject(undefined);
      setSourceCategory(undefined);
      setSourceConfirmationCode(undefined);
      setSourceProvider(undefined);
      setAttendeesRaw("");
      setDescription("");
      setStatus("busy");
      setEventType("default");
      setWorkingLocation("office");
      setAutoDeclineMode("none");
      setAutoDeclineMessage("I am currently out of the office and unable to attend.");
      setRecurrenceFreq("none");
      setRecurrenceInterval(1);
      const startDayCode = WEEKDAY_OPTIONS[start.getDay()]?.code || "MO";
      setRecurrenceByDay([startDayCode]);
      setRecurrenceEndType("never");
      setRecurrenceCount(10);
      setRecurrenceUntil(toDateInputVal(new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000)));
      setShowCustomRecurrence(false);
      setEditScope("series");
    }

    setTimeout(() => titleInputRef?.focus(), 50);
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

  function setDurationMinutes(mins: number) {
    const [sy, sm, sd] = startDateStr().split("-").map(Number);
    const [sh, smin] = startTimeStr().split(":").map(Number);
    const targetTz = eventTimeZone() || props.defaultTimeZone || "UTC";
    const startUtc = zonedTimeToUtc(sy, sm, sd, sh, smin, targetTz);
    const endUtc = new Date(startUtc.getTime() + mins * 60 * 1000);
    const endZoned = utcToZonedParts(endUtc, targetTz);
    setEndDateStr(endZoned.dateStr);
    setEndTimeStr(endZoned.timeStr);
  }

  function handleSelectTemplate(tplId: string) {
    setSelectedTemplate(tplId);
    if (tplId === "sync_30") {
      setTitle("1:1 Sync");
      setIsAllDay(false);
      setStatus("busy");
      setVisibility("private");
      setDurationMinutes(30);
    } else if (tplId === "standup_15") {
      setTitle("Team Standup");
      setIsAllDay(false);
      setStatus("busy");
      setVisibility("default");
      setDurationMinutes(15);
    } else if (tplId === "focus_60") {
      setTitle("Focus Time");
      setIsAllDay(false);
      setStatus("busy");
      setVisibility("private");
      setColor("#4B6B58");
      setDurationMinutes(60);
    } else if (tplId === "workshop_120") {
      setTitle("Planning Workshop");
      setIsAllDay(false);
      setStatus("busy");
      setVisibility("default");
      setDurationMinutes(120);
    } else if (tplId === "ooo_day") {
      setTitle("Out of Office");
      setIsAllDay(true);
      setStatus("out_of_office");
      setVisibility("public");
    }
  }

  function handleAddAttachment(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const files = Array.from(input.files);
    const newAtts: CalendarAttachment[] = files.map((file) => ({
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: file.name,
      size: file.size,
      contentType: file.type || "application/octet-stream",
    }));
    setAttachments((prev) => [...prev, ...newAtts]);
    input.value = "";
  }

  function handleRemoveAttachment(attId: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== attId));
  }

  async function handleDuplicate() {
    if (!props.eventToEdit || !props.onDuplicate) return;
    try {
      setIsSaving(true);
      await props.onDuplicate(props.eventToEdit);
      props.onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to duplicate event");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCopyToCalendar(targetCalId: string) {
    if (!props.eventToEdit || !props.onCopyToCalendar || !targetCalId) return;
    try {
      setIsSaving(true);
      await props.onCopyToCalendar(props.eventToEdit, targetCalId);
      props.onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to copy event to calendar");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSave(e: Event) {
    e.preventDefault();
    if (isReadOnly()) {
      setErrorMsg("Cannot create or modify events on a read-only calendar");
      return;
    }
    if (props.isLocked) {
      setErrorMsg("Mailbox is locked. Unlock your mailbox to create or edit events.");
      return;
    }
    if (!title().trim()) {
      setErrorMsg("Event title is required");
      return;
    }
    if (!calendarId()) {
      setErrorMsg("Please select a calendar");
      return;
    }

    let start: Date;
    let end: Date;

    if (isAllDay()) {
      const [sy, sm, sd] = startDateStr().split("-").map(Number);
      start = new Date(Date.UTC(sy, sm - 1, sd, 0, 0, 0));

      const [ey, em, ed] = (endDateStr() || startDateStr()).split("-").map(Number);
      end = new Date(Date.UTC(ey, em - 1, ed, 23, 59, 59));
    } else {
      const [sy, sm, sd] = startDateStr().split("-").map(Number);
      const [sh, smin] = startTimeStr().split(":").map(Number);
      const [ey, em, ed] = (endDateStr() || startDateStr()).split("-").map(Number);
      const [eh, emin] = endTimeStr().split(":").map(Number);

      const targetTz = eventTimeZone() || props.defaultTimeZone || "UTC";
      start = zonedTimeToUtc(sy, sm, sd, sh, smin, targetTz);
      end = zonedTimeToUtc(ey, em, ed, eh, emin, targetTz);
    }

    if (end < start) {
      setErrorMsg("End time cannot be earlier than start time");
      return;
    }

    let rruleStr: string | undefined = undefined;
    if (recurrenceFreq() !== "none") {
      const parsedFreq = recurrenceFreq().toUpperCase() as ParsedRRule["freq"];
      const ruleObj: ParsedRRule = {
        freq: parsedFreq,
        interval: Math.max(1, recurrenceInterval() || 1),
      };
      if (parsedFreq === "WEEKLY" && recurrenceByDay().length > 0) {
        ruleObj.byDay = recurrenceByDay();
      }
      if (recurrenceEndType() === "count" && recurrenceCount() > 0) {
        ruleObj.count = recurrenceCount();
      } else if (recurrenceEndType() === "until" && recurrenceUntil()) {
        const [uy, um, ud] = recurrenceUntil().split("-").map(Number);
        ruleObj.until = new Date(Date.UTC(uy, um - 1, ud, 23, 59, 59));
      }
      rruleStr = buildRRuleString(ruleObj);
    }

    const attendees = attendeesRaw()
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((email) => ({
        email,
        status: "needs-action" as const,
      }));

    let finalReminders: CalendarReminder[] | undefined = undefined;
    if (remindersList().length === 0 || reminderMinutes() === -2) {
      finalReminders = [];
    } else {
      const valid = remindersList().filter((r) => r.minutesBefore >= 0);
      if (valid.length > 0) {
        finalReminders = valid;
      } else {
        finalReminders = undefined;
      }
    }

    let effectiveStatus = status();
    if (eventType() === "out_of_office") {
      effectiveStatus = "out_of_office";
    } else if (eventType() === "focus_time") {
      effectiveStatus = "busy";
    } else if (eventType() === "working_location") {
      effectiveStatus = "free";
    }

    const details: CalendarEventPlaintext = {
      title: title().trim(),
      description: description().trim(),
      location: location().trim(),
      meetingUrl: meetingUrl().trim(),
      sourceEmailId: sourceEmailId(),
      sourceMessageSubject: sourceMessageSubject(),
      sourceCategory: sourceCategory() as any,
      sourceConfirmationCode: sourceConfirmationCode(),
      sourceProvider: sourceProvider(),
      color: color() !== "default" ? color() : undefined,
      visibility: visibility(),
      eventType: eventType(),
      workingLocation: eventType() === "working_location" ? workingLocation() : undefined,
      autoDeclineMode: eventType() === "out_of_office" ? autoDeclineMode() : undefined,
      autoDeclineMessage: eventType() === "out_of_office" ? autoDeclineMessage() : undefined,
      guestPermissions: {
        modifyEvent: guestModify(),
        inviteOthers: guestInvite(),
        seeGuestList: guestSeeList(),
      },
      attachments: attachments().length > 0 ? attachments() : undefined,
      attendees,
      reminders: finalReminders,
      timezone: eventTimeZone() || props.defaultTimeZone || "UTC",
    };

    setIsSaving(true);
    setErrorMsg(null);
    try {
      await props.onSave({
        calendarId: calendarId(),
        startTime: start,
        endTime: end,
        isAllDay: isAllDay(),
        rrule: !props.eventToEdit || editScope() === "series" ? rruleStr : undefined,
        status: effectiveStatus,
        sendInvitations: sendInvitations(),
        details,
        editScope: editScope(),
      });
      props.onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save event");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!props.eventToEdit || !props.onDelete) return;
    if (isReadOnly()) {
      setErrorMsg("Cannot delete events from a read-only calendar");
      return;
    }
    const isRecurring = Boolean(props.eventToEdit.rrule || props.eventToEdit.isOccurrence);
    const confirmMsg = isRecurring
      ? editScope() === "occurrence"
        ? "Delete only this occurrence from the recurring series?"
        : "Delete the entire recurring series and all its occurrences?"
      : "Are you sure you want to delete this event?";
    if (!confirm(confirmMsg)) return;

    setIsSaving(true);
    try {
      await props.onDelete(props.eventToEdit.id, editScope());
      props.onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to delete event");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
      >
        <div
          class="w-full max-w-lg bg-white dark:bg-[#1E1F23] rounded-2xl shadow-xl border border-[#E2DFD8] dark:border-[#2A2D35] overflow-hidden flex flex-col max-h-[90vh]"
          data-testid="event-modal"
        >
          {/* Header */}
          <div class="flex items-center justify-between px-5 py-3 border-b border-[#E2DFD8]/70 dark:border-[#2A2D35]/70 bg-[#FAF9F5] dark:bg-[#18191D]">
            <h3 class="text-xs font-bold uppercase tracking-wider text-[#6F7173] dark:text-[#878A8E]">
              {props.eventToEdit ? "Edit Event" : "Create Event"}
            </h3>
            <button
              type="button"
              onClick={props.onClose}
              class="p-1.5 rounded-full text-[#6F7173] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer"
              aria-label="Close"
              data-testid="close-event-modal"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Form Content */}
          <form onSubmit={handleSave} class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4 custom-scrollbar">
            <Show when={errorMsg()}>
              <div class="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs font-medium border border-red-200 dark:border-red-800" data-testid="event-modal-error">
                {errorMsg()}
              </div>
            </Show>

            <Show when={props.isLocked && !errorMsg()}>
              <div class="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-xs font-medium border border-amber-200 dark:border-amber-800" data-testid="locked-mailbox-warning">
                Mailbox is locked. Unlock your mailbox to create or edit events.
              </div>
            </Show>

            <Show when={props.eventToEdit?.isHoliday}>
              <div class="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex flex-col gap-1.5" data-testid="holiday-detail-banner">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-1.5">
                    <span class="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                      Public Holiday & Observance
                    </span>
                    <Show when={props.eventToEdit?.holidayMeta?.dateType === "fixed"}>
                      <span class="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-emerald-200/80 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-200">
                        Fixed Date
                      </span>
                    </Show>
                  </div>
                  <span class="text-[10px] text-emerald-700 dark:text-emerald-300">
                    {props.eventToEdit?.holidayMeta?.provider || "Authoritative Provider"}
                  </span>
                </div>
                <Show when={props.eventToEdit?.holidayMeta?.regionalDifferences}>
                  <p class="text-[11px] text-emerald-800 dark:text-emerald-200">
                    {props.eventToEdit?.holidayMeta?.regionalDifferences}
                  </p>
                </Show>
              </div>
            </Show>

            {/* Event Title (Google Calendar / Tuta Archetype) */}
            <div class="relative">
              <input
                ref={titleInputRef}
                type="text"
                placeholder="Add title"
                value={title()}
                onInput={(e) => setTitle(e.currentTarget.value)}
                disabled={isReadOnly()}
                class="w-full text-lg sm:text-xl font-medium px-1 py-1.5 border-b-2 border-[#E2DFD8] dark:border-[#2A2D35] focus:border-[#9E725F] bg-transparent text-[#2B2C2D] dark:text-[#ECEBE8] placeholder-[#9E9E9E] dark:placeholder-[#6F7173] outline-none transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                data-testid="event-title-input"
                required
              />
            </div>

            {/* Event Type Pills */}
            <div
              class="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 rounded-xl bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8]/80 dark:border-[#2A2D35]/80 shrink-0 min-h-[38px]"
              data-testid="event-type-tabs"
            >
              <button
                type="button"
                onClick={() => {
                  setEventType("default");
                  if (status() === "out_of_office") setStatus("busy");
                }}
                disabled={isReadOnly()}
                class={`flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed ${
                  eventType() === "default"
                    ? "bg-white dark:bg-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] shadow-xs border border-[#E2DFD8] dark:border-[#383C44]"
                    : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#24262B] border border-transparent"
                }`}
                data-testid="event-type-tab-default"
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <span>Event</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setEventType("focus_time");
                  if (!title() || title() === "Out of office" || title() === "Working Location") setTitle("Focus time");
                  setStatus("busy");
                  setVisibility("private");
                }}
                disabled={isReadOnly()}
                class={`flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed ${
                  eventType() === "focus_time"
                    ? "bg-[#3D5A80] dark:bg-[#4A607A] text-white shadow-xs border border-transparent"
                    : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#24262B] border border-transparent"
                }`}
                data-testid="event-type-tab-focus"
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="6" />
                  <circle cx="12" cy="12" r="2" />
                </svg>
                <span>Focus time</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setEventType("out_of_office");
                  if (!title() || title() === "Focus time" || title() === "Working Location") setTitle("Out of office");
                  setStatus("out_of_office");
                  setAutoDeclineMode("new_invitations");
                }}
                disabled={isReadOnly()}
                class={`flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed ${
                  eventType() === "out_of_office"
                    ? "bg-[#8C3B4A] dark:bg-[#A84B5D] text-white shadow-xs border border-transparent"
                    : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#24262B] border border-transparent"
                }`}
                data-testid="event-type-tab-ooo"
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                  <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                  <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                </svg>
                <span>Out of office</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setEventType("working_location");
                  if (!title() || title() === "Focus time" || title() === "Out of office") setTitle("Working Location");
                  setIsAllDay(true);
                  setStatus("free");
                }}
                disabled={isReadOnly()}
                class={`flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed ${
                  eventType() === "working_location"
                    ? "bg-[#9E725F] dark:bg-[#865E4D] text-white shadow-xs border border-transparent"
                    : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] border border-transparent"
                }`}
                data-testid="event-type-tab-location"
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span>Working location</span>
              </button>
            </div>

            {/* Event Template Minimal Inline Dropdown */}
            <Show when={!props.eventToEdit}>
              <div class="flex items-center gap-2 px-1">
                <span class="text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] shrink-0">Template:</span>
                <select
                  value={selectedTemplate()}
                  onChange={(e) => handleSelectTemplate(e.currentTarget.value)}
                  disabled={isReadOnly()}
                  class="text-xs px-2.5 py-1 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F] cursor-pointer"
                  data-testid="event-template-select"
                >
                  <For each={EVENT_TEMPLATES}>
                    {(tpl) => <option value={tpl.id}>{tpl.label}</option>}
                  </For>
                </select>
              </div>
            </Show>

            {/* Out of Office Settings Card (Category 10) */}
            <Show when={eventType() === "out_of_office"}>
              <div
                class="p-3.5 rounded-xl bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-2 animate-in fade-in duration-100"
                data-testid="ooo-options-panel"
              >
                <div class="flex items-center gap-2">
                  <svg class="w-4 h-4 text-[#8C3B4A] stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                  </svg>
                  <span class="text-xs font-bold text-[#8C3B4A] dark:text-[#D48B97]">Out of Office Settings</span>
                </div>
                <label class="flex items-center gap-2 cursor-pointer text-xs text-[#2B2C2D] dark:text-[#ECEBE8]">
                  <input
                    type="checkbox"
                    checked={autoDeclineMode() !== "none"}
                    onChange={(e) => setAutoDeclineMode(e.currentTarget.checked ? "new_invitations" : "none")}
                    disabled={isReadOnly()}
                    class="rounded border-[#E2DFD8] text-[#8C3B4A] focus:ring-[#8C3B4A]"
                    data-testid="ooo-auto-decline-checkbox"
                  />
                  <span>Automatically decline new invitations during this time</span>
                </label>
                <Show when={autoDeclineMode() !== "none"}>
                  <textarea
                    rows={2}
                    value={autoDeclineMessage()}
                    onInput={(e) => setAutoDeclineMessage(e.currentTarget.value)}
                    disabled={isReadOnly()}
                    class="w-full text-xs px-2.5 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#8C3B4A] resize-none"
                    data-testid="ooo-decline-message-input"
                  />
                </Show>
              </div>
            </Show>

            {/* Working Location Settings Card (Category 10) */}
            <Show when={eventType() === "working_location"}>
              <div
                class="p-3 rounded-xl bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] flex items-center justify-between gap-3 animate-in fade-in duration-100"
                data-testid="working-location-panel"
              >
                <div class="flex items-center gap-2 shrink-0">
                  <svg class="w-4 h-4 text-[#9E725F] stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <label class="text-xs font-bold text-[#9E725F] dark:text-[#D1A796]">Working Location</label>
                </div>
                <select
                  value={workingLocation()}
                  onChange={(e) => setWorkingLocation(e.currentTarget.value)}
                  disabled={isReadOnly()}
                  class="flex-1 max-w-xs text-xs px-2.5 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                  data-testid="working-location-select"
                >
                  <option value="office">Office</option>
                  <option value="home">Home</option>
                  <option value="remote">Remote</option>
                  <option value="custom">Other (Custom)</option>
                </select>
              </div>
            </Show>

            {/* Email Provenance Card (Category 13) */}
            <Show when={sourceEmailId() || sourceConfirmationCode()}>
              <div
                class="p-3 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#1E1F23] flex items-center justify-between gap-3"
                data-testid="event-email-provenance-card"
              >
                <div class="min-w-0">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-[10px] font-bold uppercase tracking-wider text-[#9E725F] dark:text-[#D1A796]">
                      Source Email
                    </span>
                    <Show when={sourceCategory()}>
                      <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#F0EEE9] dark:bg-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] capitalize">
                        {sourceCategory()}
                      </span>
                    </Show>
                    <Show when={sourceProvider()}>
                      <span class="text-[10px] text-[#6F7173] dark:text-[#878A8E]">
                        via {sourceProvider()}
                      </span>
                    </Show>
                  </div>
                  <p class="text-xs font-semibold text-[#2B2C2D] dark:text-[#ECEBE8] truncate max-w-sm mt-0.5">
                    {sourceMessageSubject() || "Linked message"}
                  </p>
                  <Show when={sourceConfirmationCode()}>
                    <p class="text-[11px] text-[#6F7173] dark:text-[#878A8E] mt-0.5">
                      Confirmation Code: <span class="font-mono font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">{sourceConfirmationCode()}</span>
                    </p>
                  </Show>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    props.onClose();
                    if (typeof window !== "undefined") {
                      window.dispatchEvent(
                        new CustomEvent("byos_open_email_message", {
                          detail: { messageId: sourceEmailId() },
                        })
                      );
                    }
                  }}
                  class="px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#9E725F] dark:text-[#D1A796] hover:bg-[#9E725F]/10 border border-[#9E725F]/30 transition flex items-center gap-1 flex-shrink-0 cursor-pointer"
                  data-testid="open-source-email-btn"
                >
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                  <span>Open Email</span>
                </button>
              </div>
            </Show>

            {/* Recurring Series / Occurrence Scope Choice */}
            <Show when={props.eventToEdit && (props.eventToEdit.rrule || props.eventToEdit.isOccurrence)}>
              <div class="flex items-center justify-between p-3 rounded-xl bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35]" data-testid="recurring-scope-container">
                <div class="text-xs">
                  <span class="font-semibold text-[#2B2C2D] dark:text-[#ECEBE8]">Recurring Event</span>
                  <p class="text-[11px] text-[#6F7173] dark:text-[#878A8E]">Apply changes to:</p>
                </div>
                <div class="flex items-center gap-1 bg-[#F0EEE9] dark:bg-[#2A2D35] p-1 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setEditScope("occurrence")}
                    class={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                      editScope() === "occurrence"
                        ? "bg-white dark:bg-[#1E1F23] text-[#2B2C2D] dark:text-[#ECEBE8] shadow-xs"
                        : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8]"
                    }`}
                    data-testid="scope-occurrence-btn"
                  >
                    Only this event
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditScope("series")}
                    class={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                      editScope() === "series"
                        ? "bg-white dark:bg-[#1E1F23] text-[#2B2C2D] dark:text-[#ECEBE8] shadow-xs"
                        : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8]"
                    }`}
                    data-testid="scope-series-btn"
                  >
                    Entire series
                  </button>
                </div>
              </div>
            </Show>

            {/* ── Time & Date Card (Tuta / Google Archetype) ── */}
            <div class="p-3 sm:p-3.5 rounded-2xl bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] flex flex-col gap-2.5">
              {/* Header row: Clock Icon + All day toggle */}
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <svg class="w-4 h-4 text-[#6F7173] dark:text-[#878A8E] stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span class="text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">Date & Time</span>
                </div>
                <label class="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isAllDay()}
                    onChange={(e) => setIsAllDay(e.currentTarget.checked)}
                    disabled={isReadOnly()}
                    class="rounded border-[#E2DFD8] text-[#9E725F] focus:ring-[#9E725F] cursor-pointer"
                    data-testid="event-allday-checkbox"
                  />
                  <span class="text-xs font-medium text-[#6F7173] dark:text-[#878A8E]">All Day</span>
                </label>
              </div>

              {/* From Row */}
              <div class="flex items-center gap-2">
                <span class="w-12 text-xs font-medium text-[#6F7173] dark:text-[#878A8E] shrink-0">From</span>
                <input
                  type="date"
                  value={startDateStr()}
                  onInput={(e) => setStartDateStr(e.currentTarget.value)}
                  disabled={isReadOnly()}
                  class="flex-1 min-w-0 text-xs px-2.5 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] text-[#2B2C2D] dark:text-[#ECEBE8] outline-none focus:border-[#9E725F]"
                  data-testid="event-start-date"
                  required
                />
                <Show when={!isAllDay()}>
                  <input
                    type="time"
                    value={startTimeStr()}
                    onInput={(e) => setStartTimeStr(e.currentTarget.value)}
                    disabled={isReadOnly()}
                    class="w-24 sm:w-28 text-xs px-2.5 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] text-[#2B2C2D] dark:text-[#ECEBE8] outline-none focus:border-[#9E725F]"
                    data-testid="event-start-time"
                    required
                  />
                </Show>
              </div>

              {/* To Row */}
              <div class="flex items-center gap-2">
                <span class="w-12 text-xs font-medium text-[#6F7173] dark:text-[#878A8E] shrink-0">To</span>
                <input
                  type="date"
                  value={endDateStr()}
                  onInput={(e) => setEndDateStr(e.currentTarget.value)}
                  disabled={isReadOnly()}
                  class="flex-1 min-w-0 text-xs px-2.5 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] text-[#2B2C2D] dark:text-[#ECEBE8] outline-none focus:border-[#9E725F]"
                  data-testid="event-end-date"
                  required
                />
                <Show when={!isAllDay()}>
                  <input
                    type="time"
                    value={endTimeStr()}
                    onInput={(e) => setEndTimeStr(e.currentTarget.value)}
                    disabled={isReadOnly()}
                    class="w-24 sm:w-28 text-xs px-2.5 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] text-[#2B2C2D] dark:text-[#ECEBE8] outline-none focus:border-[#9E725F]"
                    data-testid="event-end-time"
                    required
                  />
                </Show>
              </div>

              {/* Timezone & Recurrence selectors in one clean row */}
              <div class="pt-2 border-t border-[#E2DFD8]/60 dark:border-[#2A2D35]/60 flex items-center justify-between gap-2 flex-wrap">
                <div class="flex items-center gap-1.5 flex-1 min-w-[140px]">
                  <select
                    value={eventTimeZone()}
                    onChange={(e) => setEventTimeZone(e.currentTarget.value)}
                    disabled={isReadOnly()}
                    class="w-full text-xs px-2 py-1 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] text-[#6F7173] dark:text-[#878A8E] focus:outline-none focus:ring-1 focus:ring-[#9E725F] cursor-pointer"
                    data-testid="event-timezone-select"
                  >
                    <For each={SUPPORTED_TIMEZONES}>
                      {(tz) => <option value={tz.id}>{tz.label}</option>}
                    </For>
                  </select>
                </div>

                <div class="flex items-center gap-1.5 flex-1 min-w-[140px]">
                  <select
                    value={recurrenceFreq()}
                    onChange={(e) => {
                      const val = e.currentTarget.value;
                      setRecurrenceFreq(val);
                      if (val === "weekly" && recurrenceByDay().length === 0) {
                        const startDay = startDateStr() ? new Date(`${startDateStr()}T00:00:00Z`).getUTCDay() : 1;
                        const dayCode = WEEKDAY_OPTIONS[startDay]?.code || "MO";
                        setRecurrenceByDay([dayCode]);
                      }
                      setShowCustomRecurrence(val !== "none");
                    }}
                    disabled={isReadOnly()}
                    class="w-full text-xs px-2 py-1 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] text-[#6F7173] dark:text-[#878A8E] focus:outline-none focus:ring-1 focus:ring-[#9E725F] cursor-pointer"
                    data-testid="event-repeat-select"
                  >
                    <option value="none">Does not repeat</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Annually</option>
                  </select>
                </div>
              </div>

              {/* Custom Recurrence Panel (Category 07) */}
              <Show when={recurrenceFreq() !== "none" && showCustomRecurrence()}>
                <div
                  class="mt-1 p-3 rounded-xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-2.5 animate-in fade-in duration-100"
                  data-testid="custom-recurrence-panel"
                >
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">Custom Recurrence</span>
                    <button
                      type="button"
                      onClick={() => setShowCustomRecurrence(!showCustomRecurrence())}
                      class="text-[11px] font-medium text-[#9E725F] hover:underline cursor-pointer"
                      data-testid="toggle-custom-recurrence-btn"
                    >
                      Hide
                    </button>
                  </div>

                  {/* Interval */}
                  <div class="flex items-center gap-2 text-xs text-[#2B2C2D] dark:text-[#ECEBE8]">
                    <span>Repeat every</span>
                    <input
                      type="number"
                      min="1"
                      max="99"
                      value={recurrenceInterval()}
                      onInput={(e) => setRecurrenceInterval(Math.max(1, parseInt(e.currentTarget.value, 10) || 1))}
                      disabled={isReadOnly()}
                      class="w-14 text-center text-xs px-2 py-1 rounded-md border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                      data-testid="recurrence-interval-input"
                    />
                    <span>
                      {recurrenceFreq() === "daily"
                        ? recurrenceInterval() > 1 ? "days" : "day"
                        : recurrenceFreq() === "weekly"
                        ? recurrenceInterval() > 1 ? "weeks" : "week"
                        : recurrenceFreq() === "monthly"
                        ? recurrenceInterval() > 1 ? "months" : "month"
                        : recurrenceInterval() > 1 ? "years" : "year"}
                    </span>
                  </div>

                  {/* Weekday Selector (when Weekly) */}
                  <Show when={recurrenceFreq() === "weekly"}>
                    <div class="space-y-1">
                      <span class="block text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E]">Repeat on</span>
                      <div class="flex items-center gap-1.5" data-testid="recurrence-weekdays-container">
                        <For each={WEEKDAY_OPTIONS}>
                          {(day) => {
                            const isSelected = () => recurrenceByDay().includes(day.code);
                            return (
                              <button
                                type="button"
                                title={day.title}
                                onClick={() => toggleWeekday(day.code)}
                                disabled={isReadOnly()}
                                class={`w-7 h-7 rounded-full text-xs font-semibold flex items-center justify-center transition-all cursor-pointer ${
                                  isSelected()
                                    ? "bg-[#9E725F] text-white shadow-2xs"
                                    : "bg-[#FAF9F5] dark:bg-[#18191D] text-[#6F7173] dark:text-[#878A8E] border border-[#E2DFD8] dark:border-[#2A2D35] hover:border-[#9E725F]"
                                }`}
                                data-testid={`recurrence-byday-${day.code}`}
                              >
                                {day.label}
                              </button>
                            );
                          }}
                        </For>
                      </div>
                    </div>
                  </Show>

                  {/* End Condition */}
                  <div class="space-y-1 pt-1 border-t border-[#E2DFD8]/60 dark:border-[#2A2D35]/60">
                    <span class="block text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E]">Ends</span>
                    <div class="space-y-1.5 text-xs text-[#2B2C2D] dark:text-[#ECEBE8]">
                      <label class="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="recurrence-end"
                          checked={recurrenceEndType() === "never"}
                          onChange={() => setRecurrenceEndType("never")}
                          disabled={isReadOnly()}
                          class="accent-[#9E725F]"
                          data-testid="recurrence-end-never"
                        />
                        <span>Never</span>
                      </label>
                      <label class="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="recurrence-end"
                          checked={recurrenceEndType() === "until"}
                          onChange={() => setRecurrenceEndType("until")}
                          disabled={isReadOnly()}
                          class="accent-[#9E725F]"
                          data-testid="recurrence-end-until"
                        />
                        <span class="shrink-0">On</span>
                        <input
                          type="date"
                          value={recurrenceUntil()}
                          onInput={(e) => {
                            setRecurrenceUntil(e.currentTarget.value);
                            setRecurrenceEndType("until");
                          }}
                          disabled={isReadOnly() || recurrenceEndType() !== "until"}
                          class="text-xs px-2 py-0.5 rounded-md border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] disabled:opacity-50"
                          data-testid="recurrence-until-input"
                        />
                      </label>
                      <label class="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="recurrence-end"
                          checked={recurrenceEndType() === "count"}
                          onChange={() => setRecurrenceEndType("count")}
                          disabled={isReadOnly()}
                          class="accent-[#9E725F]"
                          data-testid="recurrence-end-count"
                        />
                        <span class="shrink-0">After</span>
                        <input
                          type="number"
                          min="1"
                          max="999"
                          value={recurrenceCount()}
                          onInput={(e) => {
                            setRecurrenceCount(Math.max(1, parseInt(e.currentTarget.value, 10) || 1));
                            setRecurrenceEndType("count");
                          }}
                          disabled={isReadOnly() || recurrenceEndType() !== "count"}
                          class="w-14 text-center text-xs px-2 py-0.5 rounded-md border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] disabled:opacity-50"
                          data-testid="recurrence-count-input"
                        />
                        <span class="shrink-0">occurrences</span>
                      </label>
                    </div>
                  </div>
                </div>
              </Show>
            </div>

            {/* ── Location & Video Call Row ── */}
            <div class="flex flex-col gap-2 p-3 rounded-2xl bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35]">
              {/* Location */}
              <div class="flex items-center gap-2.5">
                <svg class="w-4 h-4 text-[#6F7173] dark:text-[#878A8E] stroke-current fill-none stroke-[1.8] shrink-0" viewBox="0 0 24 24">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <input
                  type="text"
                  placeholder="Add location"
                  value={location()}
                  onInput={(e) => setLocation(e.currentTarget.value)}
                  disabled={isReadOnly()}
                  class="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] text-[#2B2C2D] dark:text-[#ECEBE8] placeholder-[#9E9E9E] outline-none focus:border-[#9E725F]"
                  data-testid="event-location-input"
                />
              </div>

              {/* Video Call */}
              <div class="flex items-center gap-2.5">
                <svg class="w-4 h-4 text-[#6F7173] dark:text-[#878A8E] stroke-current fill-none stroke-[1.8] shrink-0" viewBox="0 0 24 24">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
                <div class="flex-1 flex items-center gap-2">
                  <input
                    type="url"
                    placeholder="Add video conferencing URL"
                    value={meetingUrl()}
                    onInput={(e) => setMeetingUrl(e.currentTarget.value)}
                    disabled={isReadOnly()}
                    class="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] text-[#2B2C2D] dark:text-[#ECEBE8] placeholder-[#9E9E9E] outline-none focus:border-[#9E725F]"
                    data-testid="event-meeting-url-input"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const url = generateVideoMeetingUrl("byos_room", title());
                      setMeetingUrl(url);
                    }}
                    disabled={isReadOnly()}
                    class="px-2.5 py-1.5 rounded-lg bg-[#FAF9F5] dark:bg-[#18191D] hover:bg-[#F2E8E2] dark:hover:bg-[#3D2E28] border border-[#E2DFD8] dark:border-[#2A2D35] text-[11px] font-semibold text-[#9E725F] dark:text-[#D1A796] shrink-0 transition-colors cursor-pointer"
                    data-testid="add-video-call-btn"
                  >
                    <span>+ Add Video Call</span>
                  </button>
                </div>
              </div>
            </div>

            {/* ── Guests & Attendees ── */}
            <div class="p-3 rounded-2xl bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] flex flex-col gap-2">
              <div class="flex items-start gap-2.5">
                <svg class="w-4 h-4 text-[#6F7173] dark:text-[#878A8E] stroke-current fill-none stroke-[1.8] shrink-0 mt-2" viewBox="0 0 24 24">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <div class="flex-1">
                  <RecipientInput
                    id="event-attendees"
                    label=""
                    value={attendeesRaw()}
                    onChange={setAttendeesRaw}
                    contacts={props.contacts}
                    placeholder="Add guests or email addresses..."
                  />
                </div>
              </div>

              <div class="flex items-center justify-between pt-1 border-t border-[#E2DFD8]/60 dark:border-[#2A2D35]/60 flex-wrap gap-2">
                <label class="flex items-center gap-2 cursor-pointer select-none text-xs text-[#6F7173] dark:text-[#878A8E]">
                  <input
                    type="checkbox"
                    id="send-invitations-checkbox"
                    checked={sendInvitations()}
                    onChange={(e) => setSendInvitations(e.currentTarget.checked)}
                    disabled={isReadOnly()}
                    class="rounded border-[#E2DFD8] text-[#9E725F] focus:ring-[#9E725F] cursor-pointer"
                    data-testid="send-invitations-checkbox"
                  />
                  <span>Send email invitations</span>
                </label>

                <button
                  type="button"
                  onClick={() => setShowGuestPermissions(!showGuestPermissions())}
                  class="text-[11px] font-semibold text-[#9E725F] dark:text-[#D1A796] hover:underline flex items-center gap-1 cursor-pointer"
                  data-testid="toggle-guest-permissions-btn"
                >
                  <span>{showGuestPermissions() ? "Hide permissions" : "Guest permissions"}</span>
                  <svg class={`w-3 h-3 transition-transform ${showGuestPermissions() ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              <Show when={showGuestPermissions()}>
                <div class="p-2.5 rounded-xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-2 text-xs" data-testid="guest-permissions-container">
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={guestModify()}
                      onChange={(e) => setGuestModify(e.currentTarget.checked)}
                      disabled={isReadOnly()}
                      class="rounded border-[#E2DFD8] text-[#9E725F] focus:ring-[#9E725F]"
                      data-testid="guest-permission-modify"
                    />
                    <span class="text-[#2B2C2D] dark:text-[#ECEBE8]">Guests can modify event</span>
                  </label>
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={guestInvite()}
                      onChange={(e) => setGuestInvite(e.currentTarget.checked)}
                      disabled={isReadOnly()}
                      class="rounded border-[#E2DFD8] text-[#9E725F] focus:ring-[#9E725F]"
                      data-testid="guest-permission-invite"
                    />
                    <span class="text-[#2B2C2D] dark:text-[#ECEBE8]">Guests can invite others</span>
                  </label>
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={guestSeeList()}
                      onChange={(e) => setGuestSeeList(e.currentTarget.checked)}
                      disabled={isReadOnly()}
                      class="rounded border-[#E2DFD8] text-[#9E725F] focus:ring-[#9E725F]"
                      data-testid="guest-permission-see-list"
                    />
                    <span class="text-[#2B2C2D] dark:text-[#ECEBE8]">Guests can see guest list</span>
                  </label>
                </div>
              </Show>
            </div>

            {/* ── Description & Attachments ── */}
            <div class="p-3 rounded-2xl bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] flex flex-col gap-2">
              <div class="flex items-start gap-2.5">
                <svg class="w-4 h-4 text-[#6F7173] dark:text-[#878A8E] stroke-current fill-none stroke-[1.8] shrink-0 mt-1" viewBox="0 0 24 24">
                  <line x1="17" y1="10" x2="3" y2="10" />
                  <line x1="21" y1="6" x2="3" y2="6" />
                  <line x1="21" y1="14" x2="3" y2="14" />
                  <line x1="17" y1="18" x2="3" y2="18" />
                </svg>
                <div class="flex-1 flex flex-col gap-2">
                  <textarea
                    rows={2}
                    placeholder="Add description or notes"
                    value={description()}
                    onInput={(e) => setDescription(e.currentTarget.value)}
                    disabled={isReadOnly()}
                    class="w-full text-xs px-2.5 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] text-[#2B2C2D] dark:text-[#ECEBE8] placeholder-[#9E9E9E] outline-none focus:border-[#9E725F] resize-none"
                    data-testid="event-description-input"
                  />

                  {/* Attachment button and list */}
                  <div class="flex items-center justify-between">
                    <label class="text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] hover:text-[#9E725F] cursor-pointer flex items-center gap-1.5 transition-colors">
                      <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                      </svg>
                      <span>Attach file ({attachments().length})</span>
                      <input
                        type="file"
                        multiple
                        onChange={handleAddAttachment}
                        disabled={isReadOnly()}
                        class="hidden"
                        data-testid="add-attachment-input"
                      />
                    </label>
                  </div>

                  <Show when={attachments().length > 0}>
                    <div class="flex flex-col gap-1.5 pt-1" data-testid="attachments-list">
                      <For each={attachments()}>
                        {(att) => (
                          <div class="flex items-center justify-between p-1.5 rounded-lg bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] text-xs" data-testid={`attachment-item-${att.id}`}>
                            <span class="font-medium text-[#2B2C2D] dark:text-[#ECEBE8] truncate">{att.name}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveAttachment(att.id)}
                              disabled={isReadOnly()}
                              class="p-1 text-[#6F7173] hover:text-rose-600 rounded cursor-pointer"
                              title="Remove attachment"
                              data-testid={`remove-attachment-${att.id}`}
                            >
                              <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>
            </div>

            {/* ── Calendar & Settings Metadata ── */}
            <div class="p-3 rounded-2xl bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] flex flex-col gap-2.5">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                {/* Calendar selector */}
                <div class="flex items-center gap-2 flex-1 min-w-[140px]">
                  <svg class="w-4 h-4 text-[#6F7173] dark:text-[#878A8E] stroke-current fill-none stroke-[1.8] shrink-0" viewBox="0 0 24 24">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  <select
                    value={calendarId()}
                    onChange={(e) => setCalendarId(e.currentTarget.value)}
                    class="w-full text-xs px-2.5 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F] cursor-pointer"
                    data-testid="event-calendar-select"
                  >
                    <For each={props.calendars}>
                      {(cal) => (
                        <option value={cal.id}>
                          {cal.name} {cal.is_default ? "(Default)" : ""}
                        </option>
                      )}
                    </For>
                  </select>
                </div>

                {/* Visibility */}
                <div class="flex items-center gap-1.5">
                  <select
                    value={visibility()}
                    onChange={(e) => setVisibility(e.currentTarget.value as any)}
                    disabled={isReadOnly()}
                    class="text-xs px-2.5 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] text-[#6F7173] dark:text-[#878A8E] focus:outline-none focus:ring-1 focus:ring-[#9E725F] cursor-pointer"
                    data-testid="event-visibility-select"
                  >
                    <option value="default">Default visibility</option>
                    <option value="public">Public</option>
                    <option value="private">Private</option>
                    <option value="confidential">Confidential</option>
                  </select>
                </div>

                {/* Status / Show As */}
                <div class="flex items-center gap-1.5">
                  <select
                    value={status()}
                    onChange={(e) => setStatus(e.currentTarget.value)}
                    disabled={isReadOnly()}
                    class="text-xs px-2.5 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] text-[#6F7173] dark:text-[#878A8E] focus:outline-none focus:ring-1 focus:ring-[#9E725F] cursor-pointer"
                    data-testid="event-status-select"
                  >
                    <option value="busy">Busy</option>
                    <option value="free">Free</option>
                    <option value="tentative">Tentative</option>
                    <option value="out_of_office">Out of office</option>
                  </select>
                </div>
              </div>

              {/* Color Swatches */}
              <div class="flex items-center justify-between pt-1 border-t border-[#E2DFD8]/60 dark:border-[#2A2D35]/60 flex-wrap gap-2">
                <div class="flex items-center gap-1.5 flex-wrap" data-testid="event-color-picker">
                  <span class="text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] mr-1">Color:</span>
                  <For each={EVENT_COLOR_PALETTE}>
                    {(c) => {
                      const isSelected = () => color() === c.hex || (c.id === "default" && color() === "default");
                      return (
                        <button
                          type="button"
                          onClick={() => setColor(c.id === "default" ? "default" : c.hex)}
                          disabled={isReadOnly()}
                          class={`w-5 h-5 rounded-full border-2 transition-all flex items-center justify-center cursor-pointer ${
                            isSelected()
                              ? "border-[#2B2C2D] dark:border-white scale-110 shadow-xs"
                              : "border-transparent hover:scale-105 opacity-80 hover:opacity-100"
                          }`}
                          style={{
                            "background-color": c.id === "default" ? selectedCalendar()?.color || "#9E725F" : c.hex,
                          }}
                          title={c.label}
                          data-testid={`event-color-${c.id}`}
                        >
                          <Show when={isSelected()}>
                            <svg class="w-2.5 h-2.5 text-white stroke-current fill-none stroke-[3]" viewBox="0 0 24 24">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </Show>
                        </button>
                      );
                    }}
                  </For>
                </div>

                {/* Reminder Override dropdown */}
                <div class="flex items-center gap-1.5" data-testid="event-reminders-section">
                  <span class="text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E]">Reminder:</span>
                  <select
                    value={reminderMinutes()}
                    onChange={(e) => {
                      const val = Number(e.currentTarget.value);
                      if (remindersList().length > 0) {
                        updateReminderRow(0, val, remindersList()[0].method);
                      } else {
                        setRemindersList([{ minutesBefore: val, method: "notification" }]);
                        setReminderMinutes(val);
                      }
                    }}
                    disabled={isReadOnly()}
                    class="text-xs px-2 py-1 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] text-[#6F7173] dark:text-[#878A8E] cursor-pointer"
                    data-testid="event-reminder-override-select"
                  >
                    <For each={EVENT_REMINDER_OPTIONS}>
                      {(opt) => <option value={opt.value}>{opt.label}</option>}
                    </For>
                  </select>
                  <button
                    type="button"
                    onClick={addReminderRow}
                    disabled={isReadOnly() || remindersList().length >= 5}
                    class="p-1 rounded text-[#9E725F] hover:bg-[#F2E8E2] dark:hover:bg-[#3D2E28] cursor-pointer"
                    title="Add reminder"
                    data-testid="add-reminder-btn"
                  >
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Additional Reminder Rows if > 1 */}
              <Show when={remindersList().length > 1}>
                <div class="space-y-1.5 pt-1 border-t border-[#E2DFD8]/60 dark:border-[#2A2D35]/60">
                  <For each={remindersList().slice(1)}>
                    {(reminder, rawIdx) => {
                      const idx = () => rawIdx() + 1;
                      return (
                        <div class="flex items-center gap-2" data-testid={`reminder-row-${idx()}`}>
                          <select
                            value={reminder.method || "notification"}
                            onChange={(e) =>
                              updateReminderRow(
                                idx(),
                                reminder.minutesBefore,
                                e.currentTarget.value as "notification" | "email"
                              )
                            }
                            disabled={isReadOnly()}
                            class="w-24 text-xs px-2 py-1 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] text-[#2B2C2D] dark:text-[#ECEBE8]"
                            data-testid={`reminder-method-${idx()}`}
                          >
                            <option value="notification">Notification</option>
                            <option value="email">Email</option>
                          </select>
                          <select
                            value={reminder.minutesBefore}
                            onChange={(e) => updateReminderRow(idx(), Number(e.currentTarget.value), reminder.method)}
                            disabled={isReadOnly()}
                            class="flex-1 text-xs px-2 py-1 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] text-[#2B2C2D] dark:text-[#ECEBE8]"
                            data-testid={`reminder-minutes-${idx()}`}
                          >
                            <For each={EVENT_REMINDER_OPTIONS}>
                              {(opt) => <option value={opt.value}>{opt.label}</option>}
                            </For>
                          </select>
                          <button
                            type="button"
                            onClick={() => removeReminderRow(idx())}
                            disabled={isReadOnly()}
                            class="p-1 text-[#6F7173] hover:text-rose-600 rounded cursor-pointer"
                            data-testid={`remove-reminder-${idx()}`}
                          >
                            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </div>

            {/* Actions Footer */}
            <div class="flex items-center justify-between pt-3 border-t border-[#E2DFD8] dark:border-[#2A2D35] mt-auto flex-wrap gap-2">
              <Show
                when={props.eventToEdit && !isReadOnly()}
                fallback={
                  <Show when={props.eventToEdit?.isHoliday && props.onHideHoliday}>
                    <button
                      type="button"
                      onClick={() => {
                        const feedId =
                          props.eventToEdit?.holidayMeta?.feedId ||
                          props.eventToEdit?.calendarId.replace("holiday-", "");
                        const eventId =
                          props.eventToEdit?.holidayMeta?.eventId ||
                          props.eventToEdit?.id.replace("holiday-", "") ||
                          "";
                        if (feedId && eventId) {
                          props.onHideHoliday?.(feedId, eventId);
                        }
                        props.onClose();
                      }}
                      class="px-3 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded-lg transition-colors cursor-pointer border border-amber-300 dark:border-amber-700 flex items-center gap-1.5"
                      data-testid="hide-holiday-btn"
                    >
                      <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                      <span>Hide from calendar</span>
                    </button>
                  </Show>
                }
              >
                <div class="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isSaving()}
                    class="px-2.5 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer"
                    data-testid="delete-event-btn"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={handleDuplicate}
                    disabled={isSaving()}
                    class="px-2.5 py-1.5 text-xs font-semibold text-[#6F7173] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] rounded-lg transition-colors cursor-pointer"
                    data-testid="duplicate-event-btn"
                  >
                    Duplicate
                  </button>
                  <Show when={props.calendars.length > 1}>
                    <select
                      value={copyTargetCalId()}
                      onChange={(e) => {
                        const target = e.currentTarget.value;
                        if (target) {
                          handleCopyToCalendar(target);
                          setCopyTargetCalId("");
                        }
                      }}
                      class="text-xs px-2 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#18191D] text-[#6F7173] cursor-pointer"
                      data-testid="copy-to-calendar-select"
                    >
                      <option value="">Copy to...</option>
                      <For each={props.calendars.filter((c) => c.id !== calendarId() && (!c.is_shared || c.permission === "write"))}>
                        {(c) => <option value={c.id}>{c.name}</option>}
                      </For>
                    </select>
                  </Show>
                </div>
              </Show>

              <div class="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={props.onClose}
                  disabled={isSaving()}
                  class="px-3.5 py-1.5 text-xs font-medium text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving() || isReadOnly()}
                  class={`px-5 py-1.5 text-white text-xs font-semibold rounded-full shadow-xs transition-colors flex items-center gap-1.5 ${
                    isReadOnly()
                      ? "bg-[#B3B1AC] dark:bg-[#464748] cursor-not-allowed opacity-60"
                      : "bg-[#9E725F] hover:bg-[#865E4D] cursor-pointer"
                  }`}
                  data-testid="save-event-btn"
                >
                  <Show when={isSaving()}>
                    <span class="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  </Show>
                  <span>Save</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
};
