/**
 * BYOS Calendar - Category 12: Appointment Scheduling and Booking Pages
 * Manager modal for listing schedules, copying links, pausing/resuming, and viewing bookings.
 */

import { Component, createSignal, onMount, onCleanup, Show, For } from "solid-js";
import { UserCalendar } from "../../../api";
import { AppointmentSchedule, BookedAppointment } from "./appointmentTypes";
import {
  getAppointmentSchedules,
  toggleScheduleActive,
  deleteAppointmentSchedule,
  getBookedAppointments,
  saveBookedAppointment,
} from "./appointmentStore";

interface AppointmentsManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  mailboxId: string;
  calendars?: UserCalendar[];
  primaryTimeZone?: string;
  onOpenNewScheduleModal: () => void;
  onEditSchedule: (schedule: AppointmentSchedule) => void;
  onPreviewBookingPage: (schedule: AppointmentSchedule) => void;
  onCancelBooking?: (booking: BookedAppointment) => void;
}

export const AppointmentsManagerModal: Component<AppointmentsManagerModalProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal<"schedules" | "bookings">("schedules");
  const [schedules, setSchedules] = createSignal<AppointmentSchedule[]>([]);
  const [bookings, setBookings] = createSignal<BookedAppointment[]>([]);
  const [copyFeedback, setCopyFeedback] = createSignal<string | null>(null);

  function loadData() {
    if (!props.mailboxId) return;
    setSchedules(getAppointmentSchedules(props.mailboxId, props.primaryTimeZone || "UTC"));
    setBookings(getBookedAppointments(props.mailboxId));
  }

  onMount(() => {
    loadData();
    const handleUpdate = () => loadData();
    window.addEventListener("byos_appointments_updated", handleUpdate);
    onCleanup(() => window.removeEventListener("byos_appointments_updated", handleUpdate));
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

  function handleToggleActive(scheduleId: string) {
    toggleScheduleActive(props.mailboxId, scheduleId);
    loadData();
  }

  function handleDeleteSchedule(scheduleId: string) {
    if (confirm("Are you sure you want to delete this appointment schedule?")) {
      deleteAppointmentSchedule(props.mailboxId, scheduleId);
      loadData();
    }
  }

  function handleCopyLink(schedule: AppointmentSchedule) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    let link = `${origin}/book/${schedule.slug}`;
    if (!schedule.isPublic && schedule.accessToken) {
      link += `?token=${encodeURIComponent(schedule.accessToken)}`;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(link);
      setCopyFeedback(schedule.id);
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  }

  function handleCancelAppointment(booking: BookedAppointment) {
    if (confirm(`Cancel appointment with ${booking.attendeeName}?`)) {
      const updated: BookedAppointment = {
        ...booking,
        status: "cancelled",
        cancellationReason: "Cancelled by host",
        updatedAt: new Date().toISOString(),
      };
      saveBookedAppointment(props.mailboxId, updated);
      loadData();
      props.onCancelBooking?.(updated);
    }
  }

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-3 md:p-6 transition-opacity"
        role="dialog"
        aria-modal="true"
        aria-label="Appointment Schedules"
        data-testid="appointments-manager-modal"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
      >
        <div
          class="w-full max-w-3xl bg-white dark:bg-[#1E1F23] rounded-2xl shadow-2xl border border-[#E2DFD8] dark:border-[#2A2D35] overflow-hidden flex flex-col max-h-[90vh] h-[640px]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div class="flex items-center justify-between px-6 py-4 border-b border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D]">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-[#9E725F]/15 dark:bg-[#9E725F]/30 flex items-center justify-center text-[#9E725F]">
                <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <path d="M8 2v4M16 2v4M3 10h18" />
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
                </svg>
              </div>
              <div>
                <h3 class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                  Appointment Scheduling
                </h3>
                <p class="text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                  Share public or private booking links with conflict-free calendar integration.
                </p>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <button
                type="button"
                onClick={props.onOpenNewScheduleModal}
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                data-testid="create-schedule-btn"
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2.2]" viewBox="0 0 24 24">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>New Schedule</span>
              </button>
              <button
                type="button"
                onClick={props.onClose}
                class="p-1 rounded-lg text-[#6F7173] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer"
                aria-label="Close modal"
                data-testid="close-appointments-manager-btn"
              >
                <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div class="flex items-center px-6 border-b border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5]/40 dark:bg-[#18191D]/40 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab("schedules")}
              class={`px-4 py-2.5 font-semibold border-b-2 transition-colors cursor-pointer ${
                activeTab() === "schedules"
                  ? "border-[#9E725F] text-[#9E725F] dark:text-[#D1A796]"
                  : "border-transparent text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D]"
              }`}
              data-testid="tab-schedules"
            >
              Booking Schedules ({schedules().length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("bookings")}
              class={`px-4 py-2.5 font-semibold border-b-2 transition-colors cursor-pointer ${
                activeTab() === "bookings"
                  ? "border-[#9E725F] text-[#9E725F] dark:text-[#D1A796]"
                  : "border-transparent text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D]"
              }`}
              data-testid="tab-bookings"
            >
              Booked Appointments ({bookings().filter((b) => b.status === "confirmed").length})
            </button>
          </div>

          {/* Tab Content */}
          <div class="flex-1 overflow-y-auto p-6">
            <Show when={activeTab() === "schedules"}>
              <div class="space-y-3">
                <Show
                  when={schedules().length > 0}
                  fallback={
                    <div class="text-center py-12 text-[#6F7173] dark:text-[#878A8E] text-xs">
                      No appointment schedules configured. Click "New Schedule" to create one.
                    </div>
                  }
                >
                  <For each={schedules()}>
                    {(sched) => (
                      <div
                        class="p-4 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] hover:border-[#9E725F]/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        data-testid="schedule-card"
                      >
                        <div class="space-y-1 min-w-0">
                          <div class="flex items-center gap-2 flex-wrap">
                            <h4 class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8] truncate">
                              {sched.title}
                            </h4>
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FAF9F5] dark:bg-[#2A2D35] text-[#9E725F] border border-[#E2DFD8] dark:border-[#2A2D35]">
                              {sched.durationMinutes}m
                            </span>
                            <span
                              class={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                sched.isActive
                                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                  : "bg-neutral-500/15 text-neutral-600 dark:text-neutral-400"
                              }`}
                              data-testid="schedule-status-badge"
                            >
                              {sched.isActive ? "Active" : "Paused"}
                            </span>
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-neutral-100 dark:bg-neutral-800 text-[#6F7173] dark:text-[#878A8E]">
                              {sched.isPublic ? "Public" : "Private (Token)"}
                            </span>
                          </div>

                          <div class="flex items-center gap-3 text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                            <span>Slug: <strong class="font-mono text-[#2B2C2D] dark:text-[#ECEBE8]">/book/{sched.slug}</strong></span>
                            <span>•</span>
                            <span>{sched.locationType === "video" ? "Video Call" : sched.locationType}</span>
                            <span>•</span>
                            <span>Max {sched.maxDailyAppointments || "unlimited"} / day</span>
                          </div>

                          <Show when={sched.description}>
                            <p class="text-xs text-[#6F7173] dark:text-[#878A8E] line-clamp-1">
                              {sched.description}
                            </p>
                          </Show>
                        </div>

                        {/* Actions */}
                        <div class="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleCopyLink(sched)}
                            class="px-2.5 py-1 text-xs font-semibold rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] transition-colors cursor-pointer"
                            title="Copy booking link"
                            data-testid="copy-booking-link-btn"
                          >
                            {copyFeedback() === sched.id ? "Copied!" : "Copy Link"}
                          </button>

                          <button
                            type="button"
                            onClick={() => props.onPreviewBookingPage(sched)}
                            class="px-2.5 py-1 text-xs font-semibold rounded-lg bg-[#FAF9F5] dark:bg-[#2A2D35] hover:bg-[#F0EEE9] text-[#9E725F] dark:text-[#D1A796] border border-[#E2DFD8] dark:border-[#2A2D35] transition-colors cursor-pointer"
                            title="Preview public booking page"
                            data-testid="preview-booking-page-btn"
                          >
                            Preview
                          </button>

                          <button
                            type="button"
                            onClick={() => handleToggleActive(sched.id)}
                            class="p-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] text-[#6F7173] transition-colors cursor-pointer"
                            title={sched.isActive ? "Pause schedule" : "Activate schedule"}
                            data-testid="toggle-schedule-active-btn"
                          >
                            <Show
                              when={sched.isActive}
                              fallback={
                                <svg class="w-3.5 h-3.5 stroke-emerald-600 fill-none stroke-[2]" viewBox="0 0 24 24">
                                  <polygon points="5 3 19 12 5 21 5 3" />
                                </svg>
                              }
                            >
                              <svg class="w-3.5 h-3.5 stroke-neutral-600 fill-none stroke-[2]" viewBox="0 0 24 24">
                                <rect x="6" y="4" width="4" height="16" />
                                <rect x="14" y="4" width="4" height="16" />
                              </svg>
                            </Show>
                          </button>

                          <button
                            type="button"
                            onClick={() => props.onEditSchedule(sched)}
                            class="p-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] text-[#6F7173] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] transition-colors cursor-pointer"
                            title="Edit schedule"
                            data-testid="edit-schedule-btn"
                          >
                            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                            </svg>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteSchedule(sched.id)}
                            class="p-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] hover:bg-red-50 text-red-600 transition-colors cursor-pointer"
                            title="Delete schedule"
                            data-testid="delete-schedule-item-btn"
                          >
                            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </Show>

            <Show when={activeTab() === "bookings"}>
              <div class="space-y-3">
                <Show
                  when={bookings().length > 0}
                  fallback={
                    <div class="text-center py-12 text-[#6F7173] dark:text-[#878A8E] text-xs">
                      No booked appointments recorded yet.
                    </div>
                  }
                >
                  <For each={bookings()}>
                    {(b) => (
                      <div
                        class="p-3.5 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        data-testid="booked-appointment-row"
                      >
                        <div class="space-y-1 min-w-0">
                          <div class="flex items-center gap-2">
                            <h4 class="text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                              {b.attendeeName}
                            </h4>
                            <span class="text-xs text-[#6F7173]">&lt;{b.attendeeEmail}&gt;</span>
                            <span
                              class={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                b.status === "confirmed"
                                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                  : b.status === "rescheduled"
                                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                  : "bg-rose-500/15 text-rose-700 dark:text-rose-400"
                              }`}
                            >
                              {b.status}
                            </span>
                          </div>
                          <div class="text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                            <span>Start: <strong>{new Date(b.startUtc).toLocaleString()}</strong></span>
                            <span class="mx-1.5">•</span>
                            <span>End: <strong>{new Date(b.endUtc).toLocaleTimeString()}</strong></span>
                          </div>
                          <Show when={b.attendeeNotes}>
                            <p class="text-xs text-[#6F7173] dark:text-[#878A8E] italic">
                              "{b.attendeeNotes}"
                            </p>
                          </Show>
                        </div>

                        <Show when={b.status === "confirmed"}>
                          <div class="shrink-0">
                            <button
                              type="button"
                              onClick={() => handleCancelAppointment(b)}
                              class="px-2.5 py-1 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg border border-rose-200 dark:border-rose-800 transition-colors cursor-pointer"
                              data-testid="cancel-appointment-btn"
                            >
                              Cancel Booking
                            </button>
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
};
