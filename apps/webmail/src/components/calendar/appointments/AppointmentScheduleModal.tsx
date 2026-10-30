/**
 * BYOS Calendar - Category 12: Appointment Scheduling and Booking Pages
 * Modal for creating and editing appointment schedules.
 */

import { Component, createSignal, createEffect, onMount, onCleanup, Show, For } from "solid-js";
import { UserCalendar } from "../../../api";
import {
  AppointmentSchedule,
  AppointmentLocationType,
  AppointmentAvailabilityMode,
  createDefaultAppointmentSchedule,
} from "./appointmentTypes";
import { saveAppointmentSchedule, deleteAppointmentSchedule } from "./appointmentStore";

interface AppointmentScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  scheduleToEdit: AppointmentSchedule | null;
  mailboxId: string;
  calendars?: UserCalendar[];
  primaryTimeZone?: string;
  onSaved?: (schedule: AppointmentSchedule) => void;
  onDeleted?: (scheduleId: string) => void;
}

export const AppointmentScheduleModal: Component<AppointmentScheduleModalProps> = (props) => {
  const [title, setTitle] = createSignal("");
  const [slug, setSlug] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [durationMinutes, setDurationMinutes] = createSignal(30);
  const [locationType, setLocationType] = createSignal<AppointmentLocationType>("video");
  const [locationDetails, setLocationDetails] = createSignal("");
  const [isPublic, setIsPublic] = createSignal(true);
  const [accessToken, setAccessToken] = createSignal("");
  const [isActive, setIsActive] = createSignal(true);
  const [targetCalendarId, setTargetCalendarId] = createSignal("");
  const [availabilityMode, setAvailabilityMode] = createSignal<AppointmentAvailabilityMode>("working_hours");
  const [minNoticeHours, setMinNoticeHours] = createSignal(2);
  const [maxAdvanceDays, setMaxAdvanceDays] = createSignal(14);
  const [bufferBeforeMinutes, setBufferBeforeMinutes] = createSignal(5);
  const [bufferAfterMinutes, setBufferAfterMinutes] = createSignal(5);
  const [maxDailyAppointments, setMaxDailyAppointments] = createSignal(6);
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);

  function generateToken() {
    return `sec-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;
  }

  createEffect(() => {
    if (props.isOpen) {
      setErrorMsg(null);
      if (props.scheduleToEdit) {
        setTitle(props.scheduleToEdit.title);
        setSlug(props.scheduleToEdit.slug);
        setDescription(props.scheduleToEdit.description || "");
        setDurationMinutes(props.scheduleToEdit.durationMinutes);
        setLocationType(props.scheduleToEdit.locationType);
        setLocationDetails(props.scheduleToEdit.locationDetails || "");
        setIsPublic(props.scheduleToEdit.isPublic);
        setAccessToken(props.scheduleToEdit.accessToken || "");
        setIsActive(props.scheduleToEdit.isActive);
        setTargetCalendarId(props.scheduleToEdit.targetCalendarId || (props.calendars?.[0]?.id || ""));
        setAvailabilityMode(props.scheduleToEdit.availabilityMode);
        setMinNoticeHours(props.scheduleToEdit.minNoticeHours);
        setMaxAdvanceDays(props.scheduleToEdit.maxAdvanceDays);
        setBufferBeforeMinutes(props.scheduleToEdit.bufferBeforeMinutes);
        setBufferAfterMinutes(props.scheduleToEdit.bufferAfterMinutes);
        setMaxDailyAppointments(props.scheduleToEdit.maxDailyAppointments || 6);
      } else {
        const def = createDefaultAppointmentSchedule(props.mailboxId, props.primaryTimeZone || "UTC");
        setTitle(def.title);
        setSlug(def.slug);
        setDescription(def.description || "");
        setDurationMinutes(def.durationMinutes);
        setLocationType(def.locationType);
        setLocationDetails(def.locationDetails || "");
        setIsPublic(true);
        setAccessToken(generateToken());
        setIsActive(true);
        setTargetCalendarId(props.calendars?.[0]?.id || "");
        setAvailabilityMode("working_hours");
        setMinNoticeHours(def.minNoticeHours);
        setMaxAdvanceDays(def.maxAdvanceDays);
        setBufferBeforeMinutes(def.bufferBeforeMinutes);
        setBufferAfterMinutes(def.bufferAfterMinutes);
        setMaxDailyAppointments(def.maxDailyAppointments || 6);
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
      setErrorMsg("Schedule title is required");
      return;
    }
    if (!slug().trim()) {
      setErrorMsg("URL slug is required");
      return;
    }

    const cleanSlug = slug()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "-")
      .replace(/-+/g, "-");

    try {
      const saved = saveAppointmentSchedule(props.mailboxId, {
        id: props.scheduleToEdit ? props.scheduleToEdit.id : undefined,
        title: title().trim(),
        slug: cleanSlug,
        description: description().trim() || undefined,
        durationMinutes: durationMinutes(),
        locationType: locationType(),
        locationDetails: locationDetails().trim() || undefined,
        isPublic: isPublic(),
        accessToken: !isPublic() ? (accessToken() || generateToken()) : undefined,
        isActive: isActive(),
        targetCalendarId: targetCalendarId() || undefined,
        inspectedCalendarIds: targetCalendarId() ? [targetCalendarId()] : [],
        availabilityMode: availabilityMode(),
        minNoticeHours: minNoticeHours(),
        maxAdvanceDays: maxAdvanceDays(),
        bufferBeforeMinutes: bufferBeforeMinutes(),
        bufferAfterMinutes: bufferAfterMinutes(),
        maxDailyAppointments: maxDailyAppointments(),
        timeZone: props.primaryTimeZone || "UTC",
      });

      props.onSaved?.(saved);
      props.onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save appointment schedule");
    }
  }

  function handleDelete() {
    if (props.scheduleToEdit) {
      deleteAppointmentSchedule(props.mailboxId, props.scheduleToEdit.id);
      props.onDeleted?.(props.scheduleToEdit.id);
      props.onClose();
    }
  }

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-3 md:p-6 transition-opacity"
        role="dialog"
        aria-modal="true"
        aria-label={props.scheduleToEdit ? "Edit Appointment Schedule" : "New Appointment Schedule"}
        data-testid="appointment-schedule-modal"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
      >
        <div
          class="w-full max-w-xl bg-white dark:bg-[#1E1F23] rounded-2xl shadow-2xl border border-[#E2DFD8] dark:border-[#2A2D35] overflow-hidden flex flex-col max-h-[92vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div class="flex items-center justify-between px-6 py-4 border-b border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D]">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-lg bg-[#9E725F]/15 dark:bg-[#9E725F]/30 flex items-center justify-center text-[#9E725F]">
                <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <div>
                <h3 class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                  {props.scheduleToEdit ? "Edit Appointment Schedule" : "New Appointment Schedule"}
                </h3>
                <p class="text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                  Configure availability windows, booking notice, and privacy boundaries.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              class="p-1 rounded-lg text-[#6F7173] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer"
              aria-label="Close modal"
              data-testid="close-schedule-modal"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSave} class="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
            <Show when={errorMsg()}>
              <div class="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs">
                {errorMsg()}
              </div>
            </Show>

            {/* Title & Slug */}
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                  Schedule Title <span class="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. 30-Minute Consultation"
                  value={title()}
                  onInput={(e) => setTitle(e.currentTarget.value)}
                  class="w-full px-3 py-2 rounded-lg bg-[#FAF9F5] dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] text-xs focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                  data-testid="schedule-title-input"
                  autofocus
                />
              </div>

              <div>
                <label class="block text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                  Booking URL Slug <span class="text-red-500">*</span>
                </label>
                <div class="flex items-center">
                  <span class="px-2 py-2 text-[10px] text-[#6F7173] bg-[#EAE8E2] dark:bg-[#2A2D35] rounded-l-lg border border-r-0 border-[#E2DFD8] dark:border-[#2A2D35]">
                    /book/
                  </span>
                  <input
                    type="text"
                    placeholder="tech-sync"
                    value={slug()}
                    onInput={(e) => setSlug(e.currentTarget.value)}
                    class="flex-1 px-3 py-2 rounded-r-lg bg-[#FAF9F5] dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] text-xs focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                    data-testid="schedule-slug-input"
                  />
                </div>
              </div>
            </div>

            {/* Duration & Location */}
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                  Duration
                </label>
                <select
                  value={durationMinutes()}
                  onChange={(e) => setDurationMinutes(Number(e.currentTarget.value))}
                  class="w-full px-3 py-2 rounded-lg bg-[#FAF9F5] dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                  data-testid="schedule-duration-select"
                >
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={45}>45 minutes</option>
                  <option value={60}>60 minutes (1 hour)</option>
                  <option value={90}>90 minutes (1.5 hours)</option>
                </select>
              </div>

              <div>
                <label class="block text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                  Location Type
                </label>
                <select
                  value={locationType()}
                  onChange={(e) => setLocationType(e.currentTarget.value as AppointmentLocationType)}
                  class="w-full px-3 py-2 rounded-lg bg-[#FAF9F5] dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                  data-testid="schedule-location-select"
                >
                  <option value="video">BYOS Video Call</option>
                  <option value="phone">Phone Call</option>
                  <option value="in_person">In-Person Meeting</option>
                  <option value="custom">Custom Location / URL</option>
                </select>
              </div>
            </div>

            {/* Location Details */}
            <div>
              <label class="block text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                Location Details or Call Link
              </label>
              <input
                type="text"
                placeholder="e.g. Conference Room A, or https://meet.byos.local/room-1"
                value={locationDetails()}
                onInput={(e) => setLocationDetails(e.currentTarget.value)}
                class="w-full px-3 py-2 rounded-lg bg-[#FAF9F5] dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] text-xs focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                data-testid="schedule-location-details-input"
              />
            </div>

            {/* Target Calendar */}
            <div>
              <label class="block text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                Target Calendar for Bookings
              </label>
              <select
                value={targetCalendarId()}
                onChange={(e) => setTargetCalendarId(e.currentTarget.value)}
                class="w-full px-3 py-2 rounded-lg bg-[#FAF9F5] dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                data-testid="schedule-target-calendar-select"
              >
                <For each={props.calendars || []}>
                  {(cal) => <option value={cal.id}>{cal.name}</option>}
                </For>
              </select>
            </div>

            {/* Availability Mode & Limits */}
            <div class="p-3.5 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5]/60 dark:bg-[#18191D]/60 space-y-3">
              <h4 class="text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                Availability & Scheduling Limits
              </h4>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                    Availability Mode
                  </label>
                  <select
                    value={availabilityMode()}
                    onChange={(e) => setAvailabilityMode(e.currentTarget.value as AppointmentAvailabilityMode)}
                    class="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                    data-testid="schedule-availability-mode-select"
                  >
                    <option value="working_hours">Inherit Working Hours</option>
                    <option value="custom">Custom Weekday Windows (09:00 - 17:00)</option>
                  </select>
                </div>

                <div>
                  <label class="block text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                    Max Daily Appointments
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={maxDailyAppointments()}
                    onInput={(e) => setMaxDailyAppointments(Number(e.currentTarget.value))}
                    class="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                    data-testid="schedule-max-daily-input"
                  />
                </div>
              </div>

              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                <div>
                  <label class="block text-[10px] text-[#6F7173] dark:text-[#878A8E] mb-0.5">
                    Min Notice (Hours)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={168}
                    value={minNoticeHours()}
                    onInput={(e) => setMinNoticeHours(Number(e.currentTarget.value))}
                    class="w-full px-2 py-1 rounded bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] text-xs text-[#2B2C2D] dark:text-[#ECEBE8]"
                    data-testid="schedule-min-notice-input"
                  />
                </div>

                <div>
                  <label class="block text-[10px] text-[#6F7173] dark:text-[#878A8E] mb-0.5">
                    Max Advance (Days)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={maxAdvanceDays()}
                    onInput={(e) => setMaxAdvanceDays(Number(e.currentTarget.value))}
                    class="w-full px-2 py-1 rounded bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] text-xs text-[#2B2C2D] dark:text-[#ECEBE8]"
                    data-testid="schedule-max-advance-input"
                  />
                </div>

                <div>
                  <label class="block text-[10px] text-[#6F7173] dark:text-[#878A8E] mb-0.5">
                    Buffer Before (Mins)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={bufferBeforeMinutes()}
                    onInput={(e) => setBufferBeforeMinutes(Number(e.currentTarget.value))}
                    class="w-full px-2 py-1 rounded bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] text-xs text-[#2B2C2D] dark:text-[#ECEBE8]"
                    data-testid="schedule-buffer-before-input"
                  />
                </div>

                <div>
                  <label class="block text-[10px] text-[#6F7173] dark:text-[#878A8E] mb-0.5">
                    Buffer After (Mins)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={bufferAfterMinutes()}
                    onInput={(e) => setBufferAfterMinutes(Number(e.currentTarget.value))}
                    class="w-full px-2 py-1 rounded bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] text-xs text-[#2B2C2D] dark:text-[#ECEBE8]"
                    data-testid="schedule-buffer-after-input"
                  />
                </div>
              </div>
            </div>

            {/* Privacy & Link Access Control */}
            <div class="p-3.5 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5]/60 dark:bg-[#18191D]/60 space-y-2.5">
              <div class="flex items-center justify-between">
                <div>
                  <span class="text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                    Public Booking Link
                  </span>
                  <p class="text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                    Anyone with the link can view available slots and book.
                  </p>
                </div>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isPublic()}
                    onChange={(e) => setIsPublic(e.currentTarget.checked)}
                    class="sr-only peer"
                    data-testid="schedule-public-checkbox"
                  />
                  <div class="w-9 h-5 bg-neutral-200 peer-focus:outline-none rounded-full peer dark:bg-neutral-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#9E725F]"></div>
                </label>
              </div>

              <Show when={!isPublic()}>
                <div class="pt-2 border-t border-[#E2DFD8] dark:border-[#2A2D35]">
                  <label class="block text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                    Private Access Token
                  </label>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      readonly
                      value={accessToken()}
                      class="flex-1 px-2.5 py-1.5 rounded-lg bg-neutral-100 dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2A2D35] font-mono text-xs text-[#2B2C2D] dark:text-[#ECEBE8]"
                      data-testid="schedule-token-input"
                    />
                    <button
                      type="button"
                      onClick={() => setAccessToken(generateToken())}
                      class="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#6F7173] hover:text-[#9E725F]"
                    >
                      Regenerate
                    </button>
                  </div>
                </div>
              </Show>

              <div class="flex items-center justify-between pt-2 border-t border-[#E2DFD8] dark:border-[#2A2D35]">
                <div>
                  <span class="text-xs font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                    Active / Accepting Bookings
                  </span>
                  <p class="text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                    Pause or revoke this link at any time without deleting it.
                  </p>
                </div>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isActive()}
                    onChange={(e) => setIsActive(e.currentTarget.checked)}
                    class="sr-only peer"
                    data-testid="schedule-active-toggle"
                  />
                  <div class="w-9 h-5 bg-neutral-200 peer-focus:outline-none rounded-full peer dark:bg-neutral-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#9E725F]"></div>
                </label>
              </div>
            </div>

            {/* Description */}
            <div>
              <label class="block text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1">
                Booking Page Description / Instructions
              </label>
              <textarea
                rows={2}
                placeholder="Include agenda outline, preparation instructions, or topics..."
                value={description()}
                onInput={(e) => setDescription(e.currentTarget.value)}
                class="w-full px-3 py-2 rounded-lg bg-[#FAF9F5] dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F] resize-none"
                data-testid="schedule-description-input"
              />
            </div>

            {/* Footer */}
            <div class="flex items-center justify-between pt-3 border-t border-[#E2DFD8] dark:border-[#2A2D35]">
              <Show when={props.scheduleToEdit} fallback={<div />}>
                <button
                  type="button"
                  onClick={handleDelete}
                  class="px-3 py-1.5 text-xs font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-colors cursor-pointer"
                  data-testid="delete-schedule-btn"
                >
                  Delete Schedule
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
                  data-testid="save-schedule-btn"
                >
                  Save Schedule
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
};
