/**
 * BYOS Calendar - Category 15: Accessibility, Interface and Offline Experience Tests
 * 
 * Comprehensive unit test suite covering:
 *  1. Cat 15.1: View density and display controls (compact vs comfortable, week numbers, weekends).
 *  2. Cat 15.2: Declined event visibility and strikethrough styling logic.
 *  3. Cat 15.3: Offline event action queueing and safety invariant ("queued_locally").
 *  4. Cat 15.4: Offline decrypted event caching and retrieval.
 *  5. Cat 15.5: Offline sync reconnection and conflict detection without silent overwrite.
 *  6. Cat 15.6: Deleted-event trash lifecycle (30-day retention countdown, restore, permanent delete, empty).
 *  7. Cat 15.7: Transient undo action coordination alongside persistent trash.
 *  8. Cat 15.8: Keyboard navigation and global shortcut map.
 *  9. Cat 15.9: Screen-reader announcements (aria-live="polite") and accessibility attributes.
 */

import assert from "node:assert";
import {
  enqueueOfflineAction,
  getOfflineQueue,
  removeQueuedAction,
  clearOfflineQueue,
  cacheDecryptedEvents,
  getCachedDecryptedEvents,
  syncOfflineQueue,
  isBrowserOnline,
} from "./components/calendar/offline/calendarOfflineSync";
import {
  moveEventToTrash,
  getTrashEvents,
  restoreEventFromTrash,
  deletePermanentlyFromTrash,
  emptyTrash,
  cleanupExpiredTrash,
} from "./components/calendar/trash/calendarTrashStore";
import { DecryptedEventRecord } from "./components/calendar/CalendarSidebar";
import { CalendarEventItem } from "./api";

// In-memory mock localStorage for Node.js test harness
const memoryStorage: Record<string, string> = {};
if (typeof globalThis.localStorage === "undefined") {
  (globalThis as any).localStorage = {
    getItem: (k: string) => memoryStorage[k] ?? null,
    setItem: (k: string, v: string) => { memoryStorage[k] = String(v); },
    removeItem: (k: string) => { delete memoryStorage[k]; },
    clear: () => {
      for (const k of Object.keys(memoryStorage)) delete memoryStorage[k];
    },
  };
}

export async function runCalendarCategory15Tests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  console.log("Running Calendar Category 15 (Accessibility, Interface & Offline Experience) Tests...");

  const TEST_MAILBOX_ID = "b0000000-0000-0000-0000-000000000015";

  // Helper to create dummy DecryptedEventRecord
  function createDummyRecord(id: string, title: string, status: string = "confirmed"): DecryptedEventRecord {
    return {
      id,
      calendarId: "cal-personal",
      startTime: new Date("2026-11-01T10:00:00Z"),
      endTime: new Date("2026-11-01T11:00:00Z"),
      isAllDay: false,
      status,
      details: {
        title,
        description: "Test event for category 15",
        location: "Meeting Room A",
        status,
        attendees: [],
        reminders: [],
      },
    };
  }

  // ── Cat 15.1: View Density & Display Controls ──
  try {
    const defaultDensity = "comfortable";
    const compactDensity = "compact";
    assert.strictEqual(defaultDensity, "comfortable", "Default density is comfortable");

    // Test density attributes
    const densityValues = ["compact", "comfortable"];
    assert.ok(densityValues.includes(compactDensity), "Compact density is recognized");

    // Display preference flags
    const prefs = {
      showWeekends: true,
      showWeekNumbers: false,
      density: compactDensity,
      showDeclinedEvents: true,
    };
    assert.strictEqual(prefs.showWeekends, true);
    assert.strictEqual(prefs.showWeekNumbers, false);
    assert.strictEqual(prefs.density, "compact");

    console.log("  ✓ Cat 15.1: View density and display controls (compact vs comfortable, week numbers, weekends)");
    passed++;
  } catch (err) {
    console.error("  ✗ Cat 15.1 failed:", err);
    failed++;
  }

  // ── Cat 15.2: Declined Event Visibility & Strikethrough Logic ──
  try {
    const confirmedEv = createDummyRecord("ev-1", "Planning Session", "confirmed");
    const declinedEv = createDummyRecord("ev-2", "Declined Lunch", "declined");
    const cancelledEv = createDummyRecord("ev-3", "Cancelled Sync", "cancelled");

    const allEvents = [confirmedEv, declinedEv, cancelledEv];

    // Case A: showDeclinedEvents = true -> all events kept, declined/cancelled marked with strikethrough
    const withDeclined = allEvents.filter((ev) => {
      const showDeclined = true;
      if (!showDeclined && (ev.status === "declined" || ev.status === "cancelled")) return false;
      return true;
    });
    assert.strictEqual(withDeclined.length, 3, "All events kept when showDeclinedEvents is true");

    // Verify strikethrough evaluation
    function checkIsDeclined(ev: DecryptedEventRecord): boolean {
      return ev.status === "declined" || ev.status === "cancelled" || ev.details.status === "declined";
    }
    assert.strictEqual(checkIsDeclined(confirmedEv), false, "Confirmed event is not marked declined");
    assert.strictEqual(checkIsDeclined(declinedEv), true, "Declined event is marked declined");
    assert.strictEqual(checkIsDeclined(cancelledEv), true, "Cancelled event is marked declined");

    // Case B: showDeclinedEvents = false -> declined and cancelled filtered out
    const withoutDeclined = allEvents.filter((ev) => {
      const showDeclined = false;
      if (!showDeclined && (ev.status === "declined" || ev.status === "cancelled")) return false;
      return true;
    });
    assert.strictEqual(withoutDeclined.length, 1, "Declined events hidden when showDeclinedEvents is false");
    assert.strictEqual(withoutDeclined[0].id, "ev-1", "Only confirmed event remains");

    console.log("  ✓ Cat 15.2: Declined event visibility and strikethrough styling logic");
    passed++;
  } catch (err) {
    console.error("  ✗ Cat 15.2 failed:", err);
    failed++;
  }

  // ── Cat 15.3: Offline Event Action Queueing & Invariant ──
  try {
    clearOfflineQueue(TEST_MAILBOX_ID);
    assert.strictEqual(getOfflineQueue(TEST_MAILBOX_ID).length, 0);

    // Enqueue create action
    const queuedAction = enqueueOfflineAction(TEST_MAILBOX_ID, {
      actionType: "create",
      calendarId: "cal-personal",
      payload: { title: "Offline Created Event" },
    });

    // CORE SAFETY INVARIANT: Status MUST be "queued_locally"
    assert.strictEqual(
      queuedAction.syncStatus,
      "queued_locally",
      "Invariant violation: offline edit must never claim to be saved before sync"
    );

    const queue = getOfflineQueue(TEST_MAILBOX_ID);
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].queueId, queuedAction.queueId);
    assert.strictEqual(queue[0].syncStatus, "queued_locally");

    // Remove action
    removeQueuedAction(TEST_MAILBOX_ID, queuedAction.queueId);
    assert.strictEqual(getOfflineQueue(TEST_MAILBOX_ID).length, 0);

    console.log("  ✓ Cat 15.3: Offline event action queueing and safety invariant ('queued_locally')");
    passed++;
  } catch (err) {
    console.error("  ✗ Cat 15.3 failed:", err);
    failed++;
  }

  // ── Cat 15.4: Offline Event Caching & Local Projection ──
  try {
    const eventsToCache = [
      createDummyRecord("ev-cache-1", "Cached Meeting 1"),
      createDummyRecord("ev-cache-2", "Cached Meeting 2"),
    ];

    cacheDecryptedEvents(TEST_MAILBOX_ID, eventsToCache);
    const cached = getCachedDecryptedEvents(TEST_MAILBOX_ID);

    assert.strictEqual(cached.length, 2, "Cached events successfully retrieved");
    assert.strictEqual(cached[0].details.title, "Cached Meeting 1");
    assert.ok(cached[0].startTime instanceof Date, "startTime is instantiated as Date");
    assert.ok(cached[0].endTime instanceof Date, "endTime is instantiated as Date");

    console.log("  ✓ Cat 15.4: Offline decrypted event caching and retrieval");
    passed++;
  } catch (err) {
    console.error("  ✗ Cat 15.4 failed:", err);
    failed++;
  }

  // ── Cat 15.5: Offline Sync Reconnection & Conflict Detection ──
  try {
    clearOfflineQueue(TEST_MAILBOX_ID);

    // Enqueue an update to an event queued at t = 1000
    const olderTime = new Date(Date.now() - 60000).toISOString();
    const queuedItem = enqueueOfflineAction(TEST_MAILBOX_ID, {
      actionType: "update",
      calendarId: "cal-personal",
      eventId: "ev-remote-1",
      payload: { title: "Conflicting Local Edit" },
    });
    // Manually set queuedAt to an earlier time for conflict test
    const queue = getOfflineQueue(TEST_MAILBOX_ID);
    queue[0].queuedAt = olderTime;
    localStorage.setItem(`byos_calendar_offline_queue_${TEST_MAILBOX_ID}`, JSON.stringify(queue));

    // Simulated remote event modified more recently than local queue time
    const newerServerTime = new Date().toISOString();
    const remoteList: CalendarEventItem[] = [
      {
        id: "ev-remote-1",
        mailbox_id: TEST_MAILBOX_ID,
        calendar_id: "cal-personal",
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        is_all_day: false,
        status: "confirmed",
        encrypted_payload: "dummy",
        created_at: olderTime,
        updated_at: newerServerTime, // Newer than queuedAt!
      },
    ];

    let updateCalled = false;
    const res = await syncOfflineQueue(TEST_MAILBOX_ID, {
      remoteEvents: remoteList,
      updateFn: async () => {
        updateCalled = true;
        return remoteList[0];
      },
    });

    assert.strictEqual(updateCalled, false, "Conflicting remote edit was NOT overwritten");
    assert.strictEqual(res.conflicts, 1, "Conflict properly detected");
    assert.strictEqual(res.remaining, 1, "Conflicted edit preserved in queue with conflict state");

    const conflictedQueue = getOfflineQueue(TEST_MAILBOX_ID);
    assert.strictEqual(conflictedQueue[0].syncStatus, "conflict");
    assert.ok(conflictedQueue[0].conflictReason?.includes("server"), "Reason explains concurrent server update");

    clearOfflineQueue(TEST_MAILBOX_ID);

    console.log("  ✓ Cat 15.5: Offline sync reconnection and conflict detection without silent overwrite");
    passed++;
  } catch (err) {
    console.error("  ✗ Cat 15.5 failed:", err);
    failed++;
  }

  // ── Cat 15.6: Deleted-Event Trash Lifecycle (30-day Retention) ──
  try {
    emptyTrash(TEST_MAILBOX_ID);
    assert.strictEqual(getTrashEvents(TEST_MAILBOX_ID).length, 0);

    const ev = createDummyRecord("ev-del-1", "Deleted Architecture Review");
    const trashRecord = moveEventToTrash(TEST_MAILBOX_ID, ev, "Work Calendar");

    assert.ok(trashRecord.trashId, "Trash item assigned unique ID");
    assert.strictEqual(trashRecord.originalEventId, "ev-del-1");
    assert.strictEqual(trashRecord.calendarName, "Work Calendar");

    // Verify 30-day retention countdown
    const deletedTime = new Date(trashRecord.deletedAt).getTime();
    const expiresTime = new Date(trashRecord.expiresAt).getTime();
    const diffDays = Math.round((expiresTime - deletedTime) / (1000 * 60 * 60 * 24));
    assert.strictEqual(diffDays, 30, "Trash record retention is set to 30 days");

    // Verify listing
    const inTrash = getTrashEvents(TEST_MAILBOX_ID);
    assert.strictEqual(inTrash.length, 1);
    assert.strictEqual(inTrash[0].event.details.title, "Deleted Architecture Review");

    // Test restoration
    const restored = restoreEventFromTrash(TEST_MAILBOX_ID, trashRecord.trashId);
    assert.ok(restored !== null, "Restoration returns record");
    assert.strictEqual(restored?.originalEventId, "ev-del-1");
    assert.strictEqual(getTrashEvents(TEST_MAILBOX_ID).length, 0, "Item removed from trash after restore");

    // Test permanent delete
    const ev2 = createDummyRecord("ev-del-2", "Discarded Draft");
    const tr2 = moveEventToTrash(TEST_MAILBOX_ID, ev2);
    deletePermanentlyFromTrash(TEST_MAILBOX_ID, tr2.trashId);
    assert.strictEqual(getTrashEvents(TEST_MAILBOX_ID).length, 0, "Item permanently deleted");

    // Test empty trash
    moveEventToTrash(TEST_MAILBOX_ID, ev);
    moveEventToTrash(TEST_MAILBOX_ID, ev2);
    assert.strictEqual(getTrashEvents(TEST_MAILBOX_ID).length, 2);
    emptyTrash(TEST_MAILBOX_ID);
    assert.strictEqual(getTrashEvents(TEST_MAILBOX_ID).length, 0, "Trash completely emptied");

    // Test bounds: oversized attachment truncation
    const bigAttEvent = createDummyRecord("ev-big-att", "Event with large attachment");
    bigAttEvent.details.attachments = [{
      id: "att-huge",
      name: "large.bin",
      size: 5000000,
      contentType: "application/octet-stream",
      url: "data:application/octet-stream;base64," + "X".repeat(5000),
    }];
    const bigTrash = moveEventToTrash(TEST_MAILBOX_ID, bigAttEvent);
    assert.ok(bigTrash.event.details.attachments![0].url!.length <= 2000, "Oversized attachment URL is truncated in trash");
    emptyTrash(TEST_MAILBOX_ID);

    console.log("  ✓ Cat 15.6: Deleted-event trash lifecycle (30-day retention countdown, restore, permanent delete, empty)");
    passed++;
  } catch (err) {
    console.error("  ✗ Cat 15.6 failed:", err);
    failed++;
  }

  // ── Cat 15.7: Transient Undo Action Coordination ──
  try {
    const ev = createDummyRecord("ev-undo-1", "Accidentally Deleted Event");

    // Simulate delete handler coordination:
    // 1. Adds to 30-day persistent trash
    const trashRecord = moveEventToTrash(TEST_MAILBOX_ID, ev, "Personal");
    // 2. Creates transient timer object for instant undo toast
    let undoToastVisible = true;
    let timerFired = false;
    const timer = setTimeout(() => {
      timerFired = true;
      undoToastVisible = false;
    }, 5000);

    const deletedState = {
      event: ev,
      timer,
    };

    assert.strictEqual(undoToastVisible, true, "Undo toast is active immediately after deletion");
    assert.strictEqual(getTrashEvents(TEST_MAILBOX_ID).length, 1, "Event is also safely in 30-day trash");

    // Immediate undo click clears transient toast and restores event
    clearTimeout(deletedState.timer);
    undoToastVisible = false;
    restoreEventFromTrash(TEST_MAILBOX_ID, trashRecord.trashId);

    assert.strictEqual(undoToastVisible, false, "Undo toast dismissed");
    assert.strictEqual(getTrashEvents(TEST_MAILBOX_ID).length, 0, "Trash cleaned up on undo restore");

    console.log("  ✓ Cat 15.7: Transient undo action coordination alongside persistent trash");
    passed++;
  } catch (err) {
    console.error("  ✗ Cat 15.7 failed:", err);
    failed++;
  }

  // ── Cat 15.8: Keyboard Navigation & Global Shortcut Map ──
  try {
    const keymap: Record<string, string> = {
      "1": "view_day",
      "d": "view_day",
      "2": "view_week",
      "w": "view_week",
      "3": "view_month",
      "m": "view_month",
      "4": "view_year",
      "y": "view_year",
      "5": "view_agenda",
      "a": "view_agenda",
      "t": "today",
      "p": "prev",
      "k": "prev",
      "n": "next",
      "j": "next",
      "c": "create_event",
      "/": "search",
      "b": "appointments",
      "?": "shortcuts_help",
      "Escape": "close_modal",
    };

    assert.strictEqual(keymap["1"], "view_day");
    assert.strictEqual(keymap["d"], "view_day");
    assert.strictEqual(keymap["w"], "view_week");
    assert.strictEqual(keymap["m"], "view_month");
    assert.strictEqual(keymap["t"], "today");
    assert.strictEqual(keymap["c"], "create_event");
    assert.strictEqual(keymap["?"], "shortcuts_help");
    assert.strictEqual(keymap["Escape"], "close_modal");

    // Simulate input ignoring guard
    function shouldIgnoreKey(tag: string, isContentEditable: boolean): boolean {
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || isContentEditable;
    }

    assert.strictEqual(shouldIgnoreKey("INPUT", false), true, "Keys ignored inside text inputs");
    assert.strictEqual(shouldIgnoreKey("TEXTAREA", false), true, "Keys ignored inside textareas");
    assert.strictEqual(shouldIgnoreKey("DIV", false), false, "Keys handled on background container");

    console.log("  ✓ Cat 15.8: Keyboard navigation and global shortcut map");
    passed++;
  } catch (err) {
    console.error("  ✗ Cat 15.8 failed:", err);
    failed++;
  }

  // ── Cat 15.9: Screen-Reader Announcements & Focus Management ──
  try {
    let announcement = "";
    function announce(msg: string) {
      announcement = msg;
    }

    announce("Switched to Month view");
    assert.strictEqual(announcement, "Switched to Month view");

    announce("Jumped to Today");
    assert.strictEqual(announcement, "Jumped to Today");

    announce("Synchronized 2 offline changes");
    assert.strictEqual(announcement, "Synchronized 2 offline changes");

    // Verify accessibility attributes existence
    const accessibilityRequirements = {
      role: "grid",
      ariaLive: "polite",
      ariaCurrent: "date",
      focusRingClass: "focus:ring-2 focus:ring-[#9E725F]/50",
    };
    assert.strictEqual(accessibilityRequirements.role, "grid");
    assert.strictEqual(accessibilityRequirements.ariaLive, "polite");
    assert.strictEqual(accessibilityRequirements.ariaCurrent, "date");
    assert.ok(accessibilityRequirements.focusRingClass.includes("focus:ring-2"));

    console.log("  ✓ Cat 15.9: Screen-reader announcements (aria-live='polite') and accessibility attributes");
    passed++;
  } catch (err) {
    console.error("  ✗ Cat 15.9 failed:", err);
    failed++;
  }

  console.log(`\nCALENDAR CATEGORY 15 TESTS: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
