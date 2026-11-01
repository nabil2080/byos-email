import { Component, createSignal, createEffect, For, Show } from "solid-js";
import { AttachmentItem, ConnectedAccount, MaskedAliasItem, ContactItem } from "../api";
import { AttachmentBadge } from "./AttachmentBadge";
import { RichTextEditor } from "./RichTextEditor";
import { RecipientInput } from "./RecipientInput";
import { isOffline } from "../offline";
import {
  validateAttachmentSendReadiness,
  calculateAggregateProgress,
  formatBytes,
} from "../attachment_upload_pipeline";

export type DrawerMode = "minimized" | "docked" | "maximized";

interface ComposeDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  to: string;
  onToChange: (val: string) => void;
  subject: string;
  onSubjectChange: (val: string) => void;
  body: string;
  onBodyChange: (val: string) => void;
  bodyHtml?: string;
  onBodyHtmlChange?: (val: string) => void;
  attachments: AttachmentItem[];
  onAttachmentSelected: (e: Event) => void;
  onRemoveAttachment: (id: string) => void;
  onCancelAttachment?: (id: string) => void;
  onRetryAttachment?: (id: string) => void;
  onCancelAllUploads?: () => void;
  scheduledTime: string;
  onScheduledTimeChange: (val: string) => void;
  trackOpens?: boolean;
  onTrackOpensChange?: (val: boolean) => void;
  onSend: (e: Event) => void;
  onSaveDraft: () => void;
  status: string | null;
  errorMessage: string | null;
  isEditingDraft: boolean;
  senderAddress: string;
  connectedAccounts?: ConnectedAccount[];
  selectedAccountId?: string;
  onSelectAccount?: (accountId: string) => void;
  isUnified?: boolean;
  aliases?: MaskedAliasItem[];
  fromAlias?: string | null;
  onSelectFromAlias?: (aliasAddress: string | null) => void;
  onUploadInlineImage?: (file: File) => Promise<{ storageRef: string; alt?: string; localUrl?: string }>;
  contacts?: ContactItem[];
  mailboxId?: string;
  cc?: string;
  onCcChange?: (val: string) => void;
  bcc?: string;
  onBccChange?: (val: string) => void;
}

export const ComposeDrawer: Component<ComposeDrawerProps> = (props) => {
  const [drawerMode, setDrawerMode] = createSignal<DrawerMode>("docked");
  const [showScheduleInput, setShowScheduleInput] = createSignal(false);
  const [showCcBcc, setShowCcBcc] = createSignal(false);

  const readiness = () => validateAttachmentSendReadiness(props.attachments);

  const isAnyUploading = () =>
    props.attachments.some(
      (a) =>
        a.uploadStatus === "uploading" ||
        a.uploadStatus === "encrypting" ||
        a.uploadStatus === "preparing",
    );

  const uploadingAttachments = () =>
    props.attachments.filter(
      (a) =>
        a.uploadStatus === "uploading" ||
        a.uploadStatus === "encrypting" ||
        a.uploadStatus === "preparing",
    );

  const aggregateUploadProgress = () =>
    calculateAggregateProgress(uploadingAttachments());

  createEffect(() => {
    if (props.isOpen) {
      if (props.cc || props.bcc) {
        setShowCcBcc(true);
      }
    } else {
      setShowCcBcc(false);
    }
  });

  // Input refs
  let toInputRef: HTMLInputElement | undefined;
  let subjectInputRef: HTMLInputElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  let fromSelectRef: HTMLSelectElement | undefined;

  createEffect(() => {
    if (toInputRef && toInputRef.value !== props.to) {
      toInputRef.value = props.to;
    }
  });

  createEffect(() => {
    if (subjectInputRef && subjectInputRef.value !== props.subject) {
      subjectInputRef.value = props.subject;
    }
  });

  createEffect(() => {
    const targetVal = props.fromAlias
      ? `alias:${props.fromAlias}`
      : `account:${props.selectedAccountId || props.connectedAccounts?.[0]?.id || ""}`;
    if (fromSelectRef && fromSelectRef.value !== targetVal) {
      fromSelectRef.value = targetVal;
    }
  });

  function toggleMinimize(e?: Event) {
    e?.stopPropagation();
    setDrawerMode((prev) => (prev === "minimized" ? "docked" : "minimized"));
  }

  function toggleMaximize(e?: Event) {
    e?.stopPropagation();
    setDrawerMode((prev) => (prev === "maximized" ? "docked" : "maximized"));
  }

  function handleClose() {
    props.onClose();
    setDrawerMode("docked");
  }

  return (
    <Show when={props.isOpen}>
      {/* Backdrop only when maximized */}
      <Show when={drawerMode() === "maximized"}>
        <div
          onClick={() => setDrawerMode("docked")}
          class="fixed inset-0 bg-black/30 backdrop-blur-xs z-40 transition-opacity"
        ></div>
      </Show>

      {/* Main Compose Drawer Container with tactile spring cubic-bezier */}
      <div
        class={`fixed z-50 bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] shadow-2xl flex flex-col overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          drawerMode() === "minimized"
            ? "bottom-0 right-6 sm:right-10 w-80 h-12 rounded-t-xl cursor-pointer"
            : drawerMode() === "docked"
            ? "inset-0 w-full h-full rounded-none md:inset-auto md:bottom-0 md:right-10 md:w-[580px] md:h-[560px] md:max-w-[calc(100vw-24px)] md:max-h-[calc(100vh-64px)] md:rounded-t-2xl"
            : "inset-0 w-full h-full rounded-none md:inset-x-0 md:top-8 md:bottom-6 md:mx-auto md:w-[860px] md:max-w-[95vw] md:h-[calc(100vh-56px)] md:rounded-2xl"
        }`}
        onClick={() => {
          if (drawerMode() === "minimized") setDrawerMode("docked");
        }}
      >
        {/* Drawer Title Bar / Controls */}
        <header class="h-12 bg-[#2B2C2D] dark:bg-[#18191D] text-white px-4 flex items-center justify-between flex-shrink-0 select-none cursor-default border-b border-[#1E1F20] dark:border-[#2E3138]">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span class="text-xs font-semibold tracking-wide truncate">
              {props.isEditingDraft
                ? `Edit Draft: ${props.subject || "(no subject)"}`
                : props.subject || "New Message"}
            </span>
          </div>

          <div class="flex items-center gap-1.5 flex-shrink-0 text-stone-300">
            {/* Minimize / Expand button */}
            <button
              type="button"
              onClick={toggleMinimize}
              title={drawerMode() === "minimized" ? "Expand" : "Minimize"}
              class="hidden md:flex w-7 h-7 rounded-lg hover:bg-stone-700/70 dark:hover:bg-[#26282E] items-center justify-center text-xs transition cursor-pointer text-stone-300 hover:text-white"
            >
              <Show
                when={drawerMode() === "minimized"}
                fallback={
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                }
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </Show>
            </button>

            {/* Maximize / Restore button */}
            <button
              type="button"
              onClick={toggleMaximize}
              title={drawerMode() === "maximized" ? "Restore to Dock" : "Maximize"}
              class="hidden md:flex w-7 h-7 rounded-lg hover:bg-stone-700/70 dark:hover:bg-[#26282E] items-center justify-center text-xs transition cursor-pointer text-stone-300 hover:text-white"
            >
              <Show
                when={drawerMode() === "maximized"}
                fallback={
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                    <polyline points="15 3 21 3 21 9" />
                    <polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                }
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <rect x="4" y="8" width="12" height="12" rx="2" />
                  <path d="M8 4h10a2 2 0 0 1 2 2v10" />
                </svg>
              </Show>
            </button>

            {/* Close button */}
            <button
              type="button"
              onClick={handleClose}
              data-testid="compose-close-btn"
              title="Save draft & Close (Esc)"
              class="w-8 h-8 rounded-lg hover:bg-stone-700/70 dark:hover:bg-[#26282E] flex items-center justify-center text-xs transition cursor-pointer text-stone-300 hover:text-white"
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </header>

        {/* Drawer Body (Visible when not minimized) */}
        <Show when={drawerMode() !== "minimized"}>
          <form onSubmit={props.onSend} class="flex flex-col flex-1 min-h-0 bg-white dark:bg-[#1E2025]">
            {/* Header Fields (From, To, Subject) */}
            <div class="px-4 py-2 border-b border-[#E2DFD8] dark:border-[#2E3138] space-y-2 flex-shrink-0 bg-[#FAF9F7] dark:bg-[#18191D]">
              {/* From Row */}
              <div class="flex items-center gap-2 text-xs">
                <span class="w-16 text-[#55575B] dark:text-[#A1A1AA] font-medium">From:</span>
                <Show
                  when={(props.connectedAccounts?.length || 0) > 1 || (props.aliases?.length || 0) > 0}
                  fallback={
                    <span class="font-mono text-[#1A1B1E] dark:text-[#F3F4F6] font-medium select-all">
                      {props.senderAddress}
                    </span>
                  }
                >
                  <select
                    ref={fromSelectRef}
                    disabled={isOffline()}
                    title={isOffline() ? "Switch accounts online to change sender." : undefined}
                    value={props.fromAlias ? `alias:${props.fromAlias}` : `account:${props.selectedAccountId || props.connectedAccounts?.[0]?.id || ""}`}
                    onChange={(e) => {
                      if (isOffline()) return;
                      const val = e.currentTarget.value;
                      if (val.startsWith("alias:")) {
                        props.onSelectFromAlias?.(val.slice(6));
                      } else if (val.startsWith("account:")) {
                        props.onSelectFromAlias?.(null);
                        props.onSelectAccount?.(val.slice(8));
                      } else {
                        props.onSelectFromAlias?.(null);
                        props.onSelectAccount?.(val);
                      }
                    }}
                    class={`font-mono text-xs bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] rounded-lg px-2 py-1 text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-1 focus:ring-[#A27561] ${
                      isOffline() ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                    }`}
                    aria-label="Sender account"
                    data-testid="compose-from-select"
                  >
                    <For each={props.connectedAccounts}>
                      {(acc) => (
                        <option
                          value={`account:${acc.id}`}
                          selected={!props.fromAlias && (props.selectedAccountId ? props.selectedAccountId === acc.id : acc.id === props.connectedAccounts?.[0]?.id)}
                        >
                          {acc.email}
                        </option>
                      )}
                    </For>
                    <Show when={!props.connectedAccounts || props.connectedAccounts.length === 0}>
                      <option value={`account:${props.selectedAccountId || ""}`} selected={!props.fromAlias}>
                        {props.senderAddress}
                      </option>
                    </Show>
                    <Show when={props.fromAlias && !props.aliases?.some((a) => a.alias_address === props.fromAlias)}>
                      <option value={`alias:${props.fromAlias}`} selected={true}>
                        {props.fromAlias} (alias)
                      </option>
                    </Show>
                    <Show when={props.aliases && props.aliases.length > 0}>
                      <For each={props.aliases}>
                        {(al) => (
                          <option value={`alias:${al.alias_address}`} selected={props.fromAlias === al.alias_address}>
                            {al.alias_address} (alias)
                          </option>
                        )}
                      </For>
                    </Show>
                  </select>
                </Show>
                <Show when={isOffline()}>
                  <span
                    class="text-[11px] text-[#A27561] dark:text-[#D4A38F] flex items-center gap-1 font-sans"
                    title="Switch accounts online to change sender."
                    data-testid="offline-from-lock"
                  >
                    <svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <span>Switch accounts online to change sender.</span>
                  </span>
                </Show>
                <span class="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-[#F3ECE8] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F] font-bold">
                  Sovereign Outbound
                </span>
              </div>

              {/* To Row with Autocomplete & Chips */}
              <div class="flex items-start justify-between gap-2">
                <div class="flex-1 min-w-0">
                  <RecipientInput
                    id="composeToInput"
                    label="To"
                    placeholder="recipient@example.com"
                    value={props.to}
                    onChange={props.onToChange}
                    contacts={props.contacts}
                    mailboxId={props.mailboxId}
                    required
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowCcBcc(!showCcBcc())}
                  class="text-[11px] font-medium text-[#A27561] hover:underline pt-1.5 select-none cursor-pointer flex-shrink-0"
                  data-testid="toggle-cc-bcc-btn"
                >
                  {showCcBcc() ? "Hide Cc/Bcc" : "Cc/Bcc"}
                </button>
              </div>

              {/* Optional Cc / Bcc Rows */}
              <Show when={showCcBcc()}>
                <div class="border-t border-[#E2DFD8]/60 dark:border-[#2E3138] pt-2">
                  <RecipientInput
                    label="Cc"
                    placeholder="cc@example.com"
                    value={props.cc || ""}
                    onChange={props.onCcChange || (() => {})}
                    contacts={props.contacts}
                    mailboxId={props.mailboxId}
                  />
                </div>
                <div class="border-t border-[#E2DFD8]/60 dark:border-[#2E3138] pt-2">
                  <RecipientInput
                    label="Bcc"
                    placeholder="bcc@example.com"
                    value={props.bcc || ""}
                    onChange={props.onBccChange || (() => {})}
                    contacts={props.contacts}
                    mailboxId={props.mailboxId}
                  />
                </div>
              </Show>

              {/* Subject Row */}
              <div class="flex items-center gap-2 text-xs border-t border-[#E2DFD8]/60 dark:border-[#2E3138] pt-2">
                <label for="composeSubjectInput" class="w-16 text-[#55575B] dark:text-[#A1A1AA] font-medium">
                  Subject:
                </label>
                <input
                  id="composeSubjectInput"
                  ref={subjectInputRef}
                  type="text"
                  placeholder="Message subject"
                  value={props.subject}
                  onInput={(e) => props.onSubjectChange(e.currentTarget.value)}
                  required
                  class="flex-1 bg-transparent text-xs font-medium text-[#1A1B1E] dark:text-[#F3F4F6] placeholder-[#878A8E] dark:placeholder-[#71717A] focus:outline-none py-1"
                />
              </div>

              {/* Scheduled Send Bar (optional toggle) */}
              <Show when={showScheduleInput() || Boolean(props.scheduledTime)}>
                <div class="flex items-center gap-2 text-xs border-t border-[#E2DFD8]/60 dark:border-[#2E3138] pt-2 bg-amber-50/70 dark:bg-amber-950/40 -mx-4 px-4 py-2">
                  <span class="w-16 text-amber-900 dark:text-amber-200 font-medium">Schedule:</span>
                  <input
                    type="datetime-local"
                    value={props.scheduledTime}
                    onInput={(e) => props.onScheduledTimeChange(e.currentTarget.value)}
                    class="bg-white dark:bg-[#1E2025] border border-amber-300 dark:border-amber-700 rounded-lg px-2 py-1 text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      props.onScheduledTimeChange("");
                      setShowScheduleInput(false);
                    }}
                    class="text-xs text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 underline ml-2 cursor-pointer"
                  >
                    Clear & Send Immediately
                  </button>
                </div>
              </Show>
            </div>

            {/* Aggregate Upload Progress Banner */}
            <Show when={isAnyUploading()}>
              <div
                data-testid="aggregate-upload-banner"
                class="px-4 py-2 bg-[#F2E8E2] dark:bg-[#2C2420] border-b border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-between gap-3 text-xs flex-shrink-0"
              >
                <div class="flex items-center gap-2 flex-1 min-w-0">
                  <div class="w-3.5 h-3.5 border-2 border-[#9E725F] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  <span class="font-medium text-[#3C3D3E] dark:text-[#F3F4F6] truncate">
                    Uploading {uploadingAttachments().length} {uploadingAttachments().length === 1 ? "file" : "files"}
                    <Show when={aggregateUploadProgress().totalBytes > 0}>
                      {" "}({formatBytes(aggregateUploadProgress().completedBytes)} / {formatBytes(aggregateUploadProgress().totalBytes)}, {aggregateUploadProgress().percent}%)
                    </Show>
                  </span>
                  <div class="flex-1 max-w-[140px] h-1.5 bg-[#E2DFD8] dark:bg-[#3C3D3E] rounded-full overflow-hidden hidden sm:block">
                    <div
                      class="h-full bg-[#9E725F] transition-all duration-200"
                      style={{ width: `${aggregateUploadProgress().percent}%` }}
                    />
                  </div>
                </div>
                <Show when={props.onCancelAllUploads}>
                  <button
                    type="button"
                    data-testid="cancel-all-uploads"
                    onClick={props.onCancelAllUploads}
                    class="text-xs font-medium text-rose-600 dark:text-rose-400 hover:text-rose-700 hover:underline px-2 py-0.5 rounded cursor-pointer"
                    aria-label="Cancel all attachment uploads"
                  >
                    Cancel All
                  </button>
                </Show>
              </div>
            </Show>

            {/* Attachments Pills List */}
            <Show when={props.attachments.length > 0}>
              <div class="px-4 py-2 bg-[#F8F7F4] dark:bg-[#18191D] border-b border-[#E2DFD8] dark:border-[#2E3138] flex flex-wrap gap-2 flex-shrink-0">
                <For each={props.attachments}>
                  {(att) => (
                    <div
                      data-testid="compose-attachment-pill"
                      class={`relative overflow-hidden flex flex-col gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1E2025] border text-xs font-mono shadow-2xs transition-colors ${
                        att.uploadStatus === "failed"
                          ? "border-rose-300 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20 text-rose-800 dark:text-rose-200"
                          : att.uploadStatus === "cancelled"
                          ? "border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200"
                          : "border-[#E2DFD8] dark:border-[#2E3138] text-[#1A1B1E] dark:text-[#F3F4F6]"
                      }`}
                    >
                      <div class="flex items-center gap-1.5">
                        <AttachmentBadge filename={att.filename} contentType={att.content_type} size="xs" showLabel={false} />
                        <span class="truncate max-w-[140px] font-medium" title={att.filename}>{att.filename}</span>
                        <span class="text-[10px] text-[#6F7173] dark:text-[#A1A1AA]">
                          ({Math.round((att.byte_size ?? att.size_bytes ?? 0) / 1024)} KB)
                        </span>

                        {/* Status badges */}
                        <Show when={att.uploadStatus === "encrypting"}>
                          <span class="text-[10px] px-1.5 py-0.5 rounded bg-[#F2E8E2] dark:bg-[#2C2420] text-[#9E725F] dark:text-[#D4A38F] font-sans flex items-center gap-1">
                            <div class="w-2 h-2 border border-[#9E725F] border-t-transparent rounded-full animate-spin" />
                            Encrypting…
                          </span>
                        </Show>

                        <Show when={att.uploadStatus === "uploading"}>
                          <span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-sans flex items-center gap-1">
                            <div class="w-2 h-2 border border-blue-600 border-t-transparent rounded-full animate-spin" />
                            {att.uploadProgress && att.uploadProgress.totalBytes > 0
                              ? `${formatBytes(att.uploadProgress.completedBytes)}/${formatBytes(att.uploadProgress.totalBytes)} (${att.uploadProgress.percent}%)`
                              : "Uploading…"}
                          </span>
                        </Show>

                        <Show when={att.uploadStatus === "completed"}>
                          <span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-sans flex items-center gap-0.5" title="Upload complete">
                            <svg class="w-3 h-3 stroke-current fill-none stroke-[2.5]" viewBox="0 0 24 24">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </span>
                        </Show>

                        <Show when={att.uploadStatus === "failed"}>
                          <span class="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-sans" title={att.uploadError || "Upload failed"}>
                            Failed
                          </span>
                        </Show>

                        <Show when={att.uploadStatus === "cancelled"}>
                          <span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 font-sans">
                            Cancelled
                          </span>
                        </Show>

                        {/* Actions: Cancel while in-flight */}
                        <Show when={att.uploadStatus === "uploading" || att.uploadStatus === "encrypting" || att.uploadStatus === "preparing"}>
                          <button
                            type="button"
                            data-testid="cancel-attachment-upload"
                            onClick={() => props.onCancelAttachment?.(att.id)}
                            class="text-rose-500 hover:text-rose-700 p-0.5 ml-0.5 cursor-pointer rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 transition focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                            title="Cancel upload"
                            aria-label={`Cancel upload of ${att.filename}`}
                          >
                            <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </Show>

                        {/* Actions: Retry when failed or cancelled */}
                        <Show when={att.uploadStatus === "failed" || att.uploadStatus === "cancelled"}>
                          <button
                            type="button"
                            data-testid="retry-attachment-upload"
                            onClick={() => props.onRetryAttachment?.(att.id)}
                            class="text-[#9E725F] hover:text-[#865E4D] p-0.5 ml-0.5 cursor-pointer rounded hover:bg-[#F2E8E2] dark:hover:bg-[#2C2420] transition focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                            title="Retry upload"
                            aria-label={`Retry upload of ${att.filename}`}
                          >
                            <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                            </svg>
                          </button>
                        </Show>

                        {/* Actions: Remove attachment */}
                        <Show when={att.uploadStatus !== "uploading" && att.uploadStatus !== "encrypting" && att.uploadStatus !== "preparing"}>
                          <button
                            type="button"
                            data-testid="remove-attachment-btn"
                            onClick={() => props.onRemoveAttachment(att.id)}
                            class="text-rose-500 hover:text-rose-700 p-0.5 ml-0.5 cursor-pointer rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 transition focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                            title="Remove attachment"
                            aria-label={`Remove ${att.filename}`}
                          >
                            <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </Show>
                      </div>

                      {/* Progress bar along bottom of pill if uploading */}
                      <Show when={att.uploadStatus === "uploading" && att.uploadProgress}>
                        <div class="w-full h-1 bg-blue-100 dark:bg-blue-950/50 rounded-full overflow-hidden mt-0.5">
                          <div
                            class="h-full bg-blue-500 transition-all duration-200"
                            style={{ width: `${att.uploadProgress?.percent ?? 0}%` }}
                          />
                        </div>
                      </Show>

                      {/* Error message detail if failed */}
                      <Show when={att.uploadStatus === "failed" && att.uploadError}>
                        <div class="text-[10px] text-rose-600 dark:text-rose-400 font-sans truncate max-w-[220px]">
                          {att.uploadError}
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Error or Status message */}
            <Show when={props.errorMessage}>
              <div class="mx-4 mt-2 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between">
                <span>{props.errorMessage}</span>
              </div>
            </Show>

            <Show when={props.status}>
              <div class="mx-4 mt-2 p-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-200 text-xs flex items-center gap-2">
                <div class="w-3 h-3 border-2 border-amber-600 border-t-transparent rounded-full animate-spin"></div>
                <span>{props.status}</span>
              </div>
            </Show>

            {/* Message Body Rich Editor */}
            <div class="flex-1 min-h-0 flex flex-col">
              <RichTextEditor
                value={props.bodyHtml || props.body}
                placeholder="Write your encrypted message here…"
                onChange={({ html, text }) => {
                  props.onBodyChange(text);
                  props.onBodyHtmlChange?.(html);
                }}
                onUploadInlineImage={props.onUploadInlineImage}
                class="flex-1 border-0 rounded-none bg-white dark:bg-[#1E2025]"
                contentClass="p-4"
                minHeight="220px"
              />
            </div>

            {/* Hidden Attachment Input */}
            <input
              ref={fileInputRef}
              type="file"
              data-testid="compose-file-input"
              onChange={props.onAttachmentSelected}
              class="hidden"
            />

            {/* Bottom Action Footer */}
            <footer class="h-14 border-t border-[#E2DFD8] dark:border-[#2E3138] px-4 bg-[#FAF9F6] dark:bg-[#18191D] flex items-center justify-between flex-shrink-0">
              <div class="flex items-center gap-2">
                {/* Send Button Group */}
                <button
                  type="submit"
                  data-testid="compose-send-btn"
                  disabled={Boolean(props.status) || !readiness().canSend}
                  class="px-4 py-2.5 rounded-xl bg-[#A27561] hover:bg-[#8F6452] text-white text-[13px] font-semibold tracking-wide transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50 cursor-pointer active:scale-[0.98]"
                  title={
                    props.status
                      ? undefined
                      : !readiness().canSend
                      ? readiness().reason
                      : undefined
                  }
                >
                  <Show when={props.status || isAnyUploading()}>
                    <div class="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  </Show>
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                  <span>
                    {isAnyUploading()
                      ? "Uploading Attachments…"
                      : props.scheduledTime
                      ? "Schedule Encrypted Send"
                      : "Send Encrypted"}
                  </span>
                </button>

                {/* Schedule Send Trigger */}
                <button
                  type="button"
                  onClick={() => setShowScheduleInput(!showScheduleInput())}
                  title="Schedule send for later"
                  class="p-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs text-[#55575B] dark:text-[#A1A1AA] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] transition cursor-pointer flex items-center justify-center"
                >
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </button>

                {/* Attach File Button */}
                <button
                  type="button"
                  onClick={() => fileInputRef?.click()}
                  title="Attach file"
                  class="p-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs text-[#55575B] dark:text-[#A1A1AA] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] transition flex items-center gap-1 cursor-pointer"
                >
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                  <span class="text-[11px] font-medium hidden sm:inline">Attach</span>
                </button>

                {/* Open Tracking Toggle Button */}
                <button
                  type="button"
                  onClick={() => props.onTrackOpensChange?.(!props.trackOpens)}
                  title={props.trackOpens ? "Email open tracking is enabled" : "Track when recipient opens this email"}
                  class={`p-2 rounded-xl border transition flex items-center gap-1.5 cursor-pointer text-xs ${
                    props.trackOpens
                      ? "border-[#A27561] bg-[#F3ECE8] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F] font-bold shadow-2xs"
                      : "border-[#E2DFD8] dark:border-[#2E3138] text-[#55575B] dark:text-[#A1A1AA] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E]"
                  }`}
                >
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <span class="text-[11px] font-medium hidden sm:inline">
                    {props.trackOpens ? "Tracking On" : "Track Opens"}
                  </span>
                </button>
              </div>

              {/* Save Draft / Discard */}
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  onClick={props.onSaveDraft}
                  class="px-3 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] text-xs font-medium text-[#55575B] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] transition cursor-pointer"
                >
                  Save Draft
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  class="p-2 text-[#878A8E] hover:text-rose-600 transition text-xs cursor-pointer flex items-center justify-center"
                  title="Discard"
                >
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </footer>
          </form>
        </Show>
      </div>
    </Show>
  );
};
