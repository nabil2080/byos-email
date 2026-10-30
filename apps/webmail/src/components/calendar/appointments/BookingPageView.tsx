/**
 * BYOS Calendar - Category 12: Appointment Scheduling and Booking Pages
 * Standalone and embeddable public booking interface.
 */

import { Component, createSignal, createMemo, createEffect, onMount, Show, For } from "solid-js";
import {
  AppointmentSchedule,
  BookedAppointment,
  AvailableSlot,
} from "./appointmentTypes";
import {
  computeAvailableSlots,
  createBookingRecord,
  cancelBookingRecord,
  rescheduleBookingRecord,
} from "./appointmentEngine";
import {
  saveBookedAppointment,
  getBookedAppointments,
  findAppointmentByCancellationToken,
} from "./appointmentStore";
import { DecryptedEventRecord } from "../CalendarSidebar";
import { CalendarSettings, DEFAULT_CALENDAR_SETTINGS } from "../settings/calendarSettingsStore";
import { SUPPORTED_TIMEZONES } from "../../../utils/calendarTimezones";

interface BookingPageViewProps {
  schedule: AppointmentSchedule;
  mailboxId: string;
  existingEvents?: DecryptedEventRecord[];
  settings?: CalendarSettings;
  accessToken?: string;
  cancellationToken?: string;
  initialAppointment?: BookedAppointment;
  hostEmail?: string;
  isEmbed?: boolean;
  onClose?: () => void;
  onBookingConfirmed?: (appointment: BookedAppointment, eventPayload: any) => void;
  onBookingCancelled?: (appointment: BookedAppointment) => void;
}

export const BookingPageView: Component<BookingPageViewProps> = (props) => {
  const [selectedTimeZone, setSelectedTimeZone] = createSignal(
    props.schedule.timeZone || "UTC"
  );

  const [tokenInput, setTokenInput] = createSignal(props.accessToken || "");
  const [tokenAuthorized, setTokenAuthorized] = createSignal(false);

  // Evaluation of private token access
  createEffect(() => {
    if (props.schedule.isPublic) {
      setTokenAuthorized(true);
    } else {
      const match =
        Boolean(props.schedule.accessToken) &&
        (props.accessToken === props.schedule.accessToken || tokenInput() === props.schedule.accessToken);
      setTokenAuthorized(match);
    }
  });

  // Selected date for slot picker
  const [selectedDate, setSelectedDate] = createSignal<string>("");
  const [selectedSlot, setSelectedSlot] = createSignal<AvailableSlot | null>(null);

  // Attendee info form
  const [attendeeName, setAttendeeName] = createSignal("");
  const [attendeeEmail, setAttendeeEmail] = createSignal("");
  const [attendeeNotes, setAttendeeNotes] = createSignal("");
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [bookingError, setBookingError] = createSignal<string | null>(null);

  // Confirmed booking state
  const [confirmedBooking, setConfirmedBooking] = createSignal<BookedAppointment | null>(
    props.initialAppointment || null
  );

  onMount(() => {
    if (!confirmedBooking() && props.cancellationToken) {
      const match = findAppointmentByCancellationToken(props.cancellationToken);
      if (match) {
        setConfirmedBooking(match.appointment);
      }
    }
  });

  // Cancellation and Rescheduling states
  const [isCancelling, setIsCancelling] = createSignal(false);
  const [isRescheduling, setIsRescheduling] = createSignal(false);
  const [cancellationReason, setCancellationReason] = createSignal("");

  const effectiveSettings = createMemo<CalendarSettings>(() => {
    return props.settings || DEFAULT_CALENDAR_SETTINGS;
  });

  // Calculate available slots over next 14 days
  const availableSlots = createMemo<AvailableSlot[]>(() => {
    if (!props.schedule.isActive || !tokenAuthorized()) return [];

    const now = new Date();
    const queryStart = new Date(now);
    const queryEnd = new Date(now.getTime() + props.schedule.maxAdvanceDays * 24 * 60 * 60 * 1000);

    const existingBookings = getBookedAppointments(props.mailboxId, props.schedule.id);

    return computeAvailableSlots(
      props.schedule,
      queryStart,
      queryEnd,
      props.existingEvents || [],
      existingBookings,
      effectiveSettings(),
      now,
      selectedTimeZone()
    );
  });

  // Unique available dates
  const availableDates = createMemo<string[]>(() => {
    const dates = new Set<string>();
    for (const s of availableSlots()) {
      dates.add(s.dateStr);
    }
    return Array.from(dates).sort();
  });

  // Auto-select first available date
  createEffect(() => {
    const dates = availableDates();
    if (dates.length > 0 && (!selectedDate() || !dates.includes(selectedDate()))) {
      setSelectedDate(dates[0]);
    }
  });

  // Slots for currently selected date
  const slotsForSelectedDate = createMemo<AvailableSlot[]>(() => {
    if (!selectedDate()) return [];
    return availableSlots().filter((s) => s.dateStr === selectedDate());
  });

  function handleSlotSelect(slot: AvailableSlot) {
    setSelectedSlot(slot);
    setBookingError(null);
  }

  function handleConfirmBooking(e: Event) {
    e.preventDefault();
    if (!selectedSlot()) return;
    if (!attendeeName().trim() || !attendeeEmail().trim()) {
      setBookingError("Please provide your name and email address.");
      return;
    }

    setIsSubmitting(true);
    setBookingError(null);

    try {
      const slot = selectedSlot()!;
      const existingBookings = getBookedAppointments(props.mailboxId);

      const { appointment, eventPayload } = createBookingRecord(
        props.schedule,
        slot.startUtc,
        {
          name: attendeeName(),
          email: attendeeEmail(),
          notes: attendeeNotes(),
        },
        props.hostEmail || "host@byos.local"
      );

      saveBookedAppointment(props.mailboxId, appointment);
      setConfirmedBooking(appointment);
      props.onBookingConfirmed?.(appointment, eventPayload);
    } catch (err: any) {
      setBookingError(err.message || "Failed to confirm booking.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleCancelAppointment() {
    if (!confirmedBooking()) return;
    const res = cancelBookingRecord(
      confirmedBooking()!,
      confirmedBooking()!.cancellationToken,
      cancellationReason() || "Cancelled by attendee"
    );
    if (res.success && res.cancelledAppointment) {
      saveBookedAppointment(props.mailboxId, res.cancelledAppointment);
      setConfirmedBooking(res.cancelledAppointment);
      setIsCancelling(false);
      props.onBookingCancelled?.(res.cancelledAppointment);
    } else {
      setBookingError(res.error || "Failed to cancel appointment.");
    }
  }

  function handleRescheduleToSlot(newSlot: AvailableSlot) {
    if (!confirmedBooking()) return;
    const existingBookings = getBookedAppointments(props.mailboxId);

    const res = rescheduleBookingRecord(
      confirmedBooking()!,
      confirmedBooking()!.cancellationToken,
      newSlot.startUtc,
      props.schedule,
      props.existingEvents || [],
      existingBookings,
      effectiveSettings()
    );

    if (res.success && res.newAppointment) {
      saveBookedAppointment(props.mailboxId, res.oldAppointment!);
      saveBookedAppointment(props.mailboxId, res.newAppointment);
      setConfirmedBooking(res.newAppointment);
      setSelectedSlot(null);
      setIsRescheduling(false);
      props.onBookingConfirmed?.(res.newAppointment, res.newEventPayload);
    } else {
      setBookingError(res.error || "Failed to reschedule appointment.");
    }
  }

  return (
    <div
      class="w-full max-w-4xl mx-auto bg-white dark:bg-[#1E1F23] rounded-2xl shadow-xl border border-[#E2DFD8] dark:border-[#2A2D35] overflow-hidden flex flex-col my-auto transition-all"
      data-testid="booking-page-container"
    >
      {/* Top Banner / Header */}
      <div class="px-6 py-5 border-b border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-[#9E725F]/15 dark:bg-[#9E725F]/30 flex items-center justify-center text-[#9E725F]">
            <svg class="w-5 h-5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-base font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                {props.schedule.title}
              </h2>
              <span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#FAF9F5] dark:bg-[#2A2D35] text-[#9E725F] border border-[#E2DFD8] dark:border-[#2A2D35]">
                {props.schedule.durationMinutes} min
              </span>
            </div>
            <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-0.5">
              {props.schedule.description || "Select an available time slot below to book your appointment."}
            </p>
          </div>
        </div>

        {/* Timezone Selector & Close */}
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-1.5 text-xs text-[#6F7173] dark:text-[#878A8E]">
            <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <select
              value={selectedTimeZone()}
              onChange={(e) => setSelectedTimeZone(e.currentTarget.value)}
              class="px-2 py-1 rounded-lg bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] text-xs text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none"
              data-testid="booking-timezone-select"
            >
              <For each={SUPPORTED_TIMEZONES}>
                {(tz) => <option value={tz.id}>{tz.label}</option>}
              </For>
            </select>
          </div>

          <Show when={props.onClose}>
            <button
              type="button"
              onClick={props.onClose}
              class="p-1 rounded-lg text-[#6F7173] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer"
              aria-label="Close booking page"
              data-testid="close-booking-page-btn"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </Show>
        </div>
      </div>

      {/* Main Body */}
      <div class="p-6">
        {/* Paused Banner */}
        <Show when={!props.schedule.isActive}>
          <div
            class="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-3"
            data-testid="booking-paused-banner"
          >
            <svg class="w-5 h-5 shrink-0 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
              <strong>Schedule Paused:</strong> This booking schedule has been paused by the host and is currently not accepting new appointments.
            </div>
          </div>
        </Show>

        {/* Private Schedule Access Token Challenge */}
        <Show when={props.schedule.isActive && !props.schedule.isPublic && !tokenAuthorized()}>
          <div
            class="max-w-md mx-auto py-8 text-center space-y-4"
            data-testid="booking-private-token-form"
          >
            <div class="w-12 h-12 mx-auto rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-[#6F7173]">
              <svg class="w-6 h-6 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <div>
              <h3 class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                Private Appointment Schedule
              </h3>
              <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-1">
                This schedule requires an access token to view availability and book appointments.
              </p>
            </div>
            <div class="flex items-center gap-2">
              <input
                type="text"
                placeholder="Enter access token..."
                value={tokenInput()}
                onInput={(e) => setTokenInput(e.currentTarget.value)}
                class="flex-1 px-3 py-2 text-xs rounded-lg bg-[#FAF9F5] dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8]"
                data-testid="booking-token-input"
              />
              <button
                type="button"
                onClick={() => {
                  if (tokenInput() === props.schedule.accessToken) {
                    setTokenAuthorized(true);
                  } else {
                    setBookingError("Invalid access token.");
                  }
                }}
                class="px-4 py-2 text-xs font-semibold bg-[#9E725F] hover:bg-[#865E4D] text-white rounded-lg shadow-xs"
                data-testid="submit-token-btn"
              >
                Access
              </button>
            </div>
            <Show when={bookingError()}>
              <p class="text-xs text-red-600">{bookingError()}</p>
            </Show>
          </div>
        </Show>

        {/* Confirmed Booking View */}
        <Show when={confirmedBooking()}>
          <div
            class="max-w-lg mx-auto py-6 space-y-5 text-center"
            data-testid="booking-confirmed-card"
          >
            <div class="w-14 h-14 mx-auto rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <svg class="w-7 h-7 stroke-current fill-none stroke-[2.5]" viewBox="0 0 24 24">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>

            <Show
              when={confirmedBooking()?.status !== "cancelled"}
              fallback={
                <div data-testid="booking-cancelled-card">
                  <h3 class="text-base font-bold text-red-600 dark:text-red-400">
                    Appointment Cancelled
                  </h3>
                  <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-1">
                    This appointment has been cancelled and the time slot was released.
                  </p>
                </div>
              }
            >
              <div>
                <h3 class="text-lg font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                  Appointment Confirmed!
                </h3>
                <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-1">
                  A calendar invitation and confirmation details have been generated.
                </p>
              </div>

              <div class="p-4 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5]/70 dark:bg-[#18191D]/70 text-left space-y-2 text-xs">
                <div class="flex items-center justify-between">
                  <span class="text-[#6F7173]">Event:</span>
                  <strong class="text-[#2B2C2D] dark:text-[#ECEBE8]">{props.schedule.title}</strong>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-[#6F7173]">Date & Time:</span>
                  <strong class="text-[#2B2C2D] dark:text-[#ECEBE8]">
                    {new Date(confirmedBooking()!.startUtc).toLocaleString([], {
                      dateStyle: "full",
                      timeStyle: "short",
                    })}
                  </strong>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-[#6F7173]">Participant:</span>
                  <span class="text-[#2B2C2D] dark:text-[#ECEBE8]">{confirmedBooking()!.attendeeName} ({confirmedBooking()!.attendeeEmail})</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-[#6F7173]">Location:</span>
                  <span class="text-[#2B2C2D] dark:text-[#ECEBE8]">
                    {props.schedule.locationType === "video" ? (props.schedule.locationDetails || "BYOS Secure Video Call") : props.schedule.locationType}
                  </span>
                </div>
              </div>

              {/* Cancellation & Reschedule controls */}
              <div class="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsRescheduling(true)}
                  class="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] hover:bg-[#F0EEE9] text-[#2B2C2D] dark:text-[#ECEBE8] transition-colors cursor-pointer"
                  data-testid="reschedule-booking-btn"
                >
                  Reschedule
                </button>
                <button
                  type="button"
                  onClick={() => setIsCancelling(true)}
                  class="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200 transition-colors cursor-pointer"
                  data-testid="cancel-booking-btn"
                >
                  Cancel Appointment
                </button>
              </div>

              {/* Inline Reschedule Slot Picker */}
              <Show when={isRescheduling()}>
                <div class="p-4 rounded-xl border border-[#9E725F]/30 bg-[#FAF9F5] dark:bg-[#18191D] text-left space-y-3">
                  <h4 class="text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                    Select New Time Slot to Reschedule:
                  </h4>
                  <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                    <For each={availableSlots()}>
                      {(slot) => (
                        <button
                          type="button"
                          onClick={() => handleRescheduleToSlot(slot)}
                          class="p-2 rounded-lg text-left text-xs bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] hover:border-[#9E725F] hover:bg-[#F2E8E2] dark:hover:bg-[#3D2E28] transition-colors"
                          data-testid="reschedule-slot-btn"
                        >
                          <div class="font-bold">{slot.dateStr}</div>
                          <div class="text-[11px] text-[#6F7173]">{slot.formattedRange}</div>
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              {/* Inline Cancel Confirmation */}
              <Show when={isCancelling()}>
                <div class="p-4 rounded-xl border border-rose-300 bg-rose-50/50 dark:bg-rose-950/20 text-left space-y-3">
                  <h4 class="text-xs font-bold text-rose-700 dark:text-rose-300">
                    Confirm Cancellation
                  </h4>
                  <input
                    type="text"
                    placeholder="Reason for cancellation (optional)..."
                    value={cancellationReason()}
                    onInput={(e) => setCancellationReason(e.currentTarget.value)}
                    class="w-full px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-[#141518] border border-rose-200"
                    data-testid="cancellation-reason-input"
                  />
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCancelAppointment}
                      class="px-3 py-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow-xs"
                      data-testid="confirm-cancel-btn"
                    >
                      Confirm Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCancelling(false)}
                      class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white text-[#6F7173]"
                    >
                      Keep Booking
                    </button>
                  </div>
                </div>
              </Show>
            </Show>
          </div>
        </Show>

        {/* Booking Form (Step 1: Pick Slot, Step 2: Details) */}
        <Show when={props.schedule.isActive && tokenAuthorized() && !confirmedBooking()}>
          <div class="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Left: Date Selection */}
            <div class="md:col-span-5 space-y-3">
              <h3 class="text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8] uppercase tracking-wider">
                1. Select a Date
              </h3>

              <div class="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                <Show
                  when={availableDates().length > 0}
                  fallback={
                    <div class="text-xs text-[#6F7173] dark:text-[#878A8E] py-6 text-center">
                      No open time slots available within the scheduling window.
                    </div>
                  }
                >
                  <For each={availableDates()}>
                    {(date) => {
                      const isSelected = () => selectedDate() === date;
                      const dateObj = new Date(date + "T12:00:00Z");
                      return (
                        <button
                          type="button"
                          onClick={() => setSelectedDate(date)}
                          class={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-left text-xs transition-colors cursor-pointer ${
                            isSelected()
                              ? "bg-[#9E725F] text-white border-[#9E725F] shadow-xs font-bold"
                              : "bg-white dark:bg-[#1E1F23] border-[#E2DFD8] dark:border-[#2A2D35] hover:bg-[#FAF9F5] text-[#2B2C2D] dark:text-[#ECEBE8]"
                          }`}
                          data-testid="booking-date-btn"
                        >
                          <span>
                            {dateObj.toLocaleDateString([], {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                          <span class={`text-[10px] ${isSelected() ? "text-white/80" : "text-[#6F7173]"}`}>
                            {availableSlots().filter((s) => s.dateStr === date).length} slots
                          </span>
                        </button>
                      );
                    }}
                  </For>
                </Show>
              </div>
            </div>

            {/* Right: Slot Selection or Attendee Form */}
            <div class="md:col-span-7 space-y-4">
              <Show
                when={selectedSlot()}
                fallback={
                  <div>
                    <h3 class="text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8] uppercase tracking-wider mb-3">
                      2. Select a Time Slot
                    </h3>

                    <div class="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                      <Show
                        when={slotsForSelectedDate().length > 0}
                        fallback={
                          <div class="col-span-2 text-xs text-[#6F7173] text-center py-8">
                            Select an available date on the left.
                          </div>
                        }
                      >
                        <For each={slotsForSelectedDate()}>
                          {(slot) => (
                            <button
                              type="button"
                              onClick={() => handleSlotSelect(slot)}
                              class="px-3 py-2.5 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] hover:border-[#9E725F] hover:bg-[#F2E8E2]/50 dark:hover:bg-[#3D2E28]/50 text-xs text-[#2B2C2D] dark:text-[#ECEBE8] font-semibold text-center transition-all cursor-pointer"
                              data-testid="booking-slot-btn"
                            >
                              {slot.formattedRange}
                            </button>
                          )}
                        </For>
                      </Show>
                    </div>
                  </div>
                }
              >
                {/* Step 2: Attendee Form */}
                <form onSubmit={handleConfirmBooking} class="space-y-3.5">
                  <div class="flex items-center justify-between pb-2 border-b border-[#E2DFD8] dark:border-[#2A2D35]">
                    <div class="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedSlot(null)}
                        class="p-1 rounded text-[#6F7173] hover:text-[#2B2C2D] cursor-pointer"
                        title="Back to slots"
                        data-testid="back-to-slots-btn"
                      >
                        <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                          <polyline points="15 18 9 12 15 6" />
                        </svg>
                      </button>
                      <div>
                        <h4 class="text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                          {selectedSlot()!.formattedRange}
                        </h4>
                        <p class="text-[10px] text-[#6F7173]">
                          {new Date(selectedSlot()!.startUtc).toLocaleDateString([], {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                          })}
                        </p>
                      </div>
                    </div>
                    <span class="text-[11px] font-bold text-[#9E725F]">
                      {props.schedule.durationMinutes} mins
                    </span>
                  </div>

                  <Show when={bookingError()}>
                    <div class="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-xs">
                      {bookingError()}
                    </div>
                  </Show>

                  <div>
                    <label class="block text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                      Your Full Name <span class="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="Jane Doe"
                      value={attendeeName()}
                      onInput={(e) => setAttendeeName(e.currentTarget.value)}
                      class="w-full px-3 py-2 text-xs rounded-lg bg-[#FAF9F5] dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                      data-testid="booking-name-input"
                      autofocus
                    />
                  </div>

                  <div>
                    <label class="block text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                      Your Email Address <span class="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      placeholder="jane@example.com"
                      value={attendeeEmail()}
                      onInput={(e) => setAttendeeEmail(e.currentTarget.value)}
                      class="w-full px-3 py-2 text-xs rounded-lg bg-[#FAF9F5] dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                      data-testid="booking-email-input"
                    />
                  </div>

                  <div>
                    <label class="block text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                      Notes or Discussion Topics
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Briefly describe what you'd like to discuss..."
                      value={attendeeNotes()}
                      onInput={(e) => setAttendeeNotes(e.currentTarget.value)}
                      class="w-full px-3 py-2 text-xs rounded-lg bg-[#FAF9F5] dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F] resize-none"
                      data-testid="booking-notes-input"
                    />
                  </div>

                  <div class="pt-2">
                    <button
                      type="submit"
                      disabled={isSubmitting()}
                      class="w-full py-2.5 text-xs font-semibold bg-[#9E725F] hover:bg-[#865E4D] text-white rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                      data-testid="confirm-booking-btn"
                    >
                      {isSubmitting() ? "Confirming Booking..." : "Confirm Appointment"}
                    </button>
                  </div>
                </form>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
};
