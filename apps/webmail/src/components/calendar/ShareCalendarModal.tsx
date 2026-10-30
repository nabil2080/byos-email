import { Component, createSignal, createEffect, For, Show, onMount, onCleanup } from "solid-js";
import { UserCalendar, CalendarShare, fetchCalendarShares, shareCalendar, updateCalendarShare, revokeCalendarShare, ContactItem } from "../../api";

interface ShareCalendarModalProps {
  isOpen: boolean;
  onClose: () => void;
  calendar: UserCalendar | null;
  mailboxId: string;
  mailboxKey?: Uint8Array | null;
  contacts?: ContactItem[];
  onSharesChanged?: () => void;
}

export const ShareCalendarModal: Component<ShareCalendarModalProps> = (props) => {
  const [granteeEmail, setGranteeEmail] = createSignal("");
  const [permission, setPermission] = createSignal<"read" | "write">("read");
  const [shares, setShares] = createSignal<CalendarShare[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
  const [successMsg, setSuccessMsg] = createSignal<string | null>(null);

  // Load shares when opened
  createEffect(async () => {
    if (!props.isOpen || !props.calendar || !props.mailboxId) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setGranteeEmail("");
    setPermission("read");
    await loadShares();
  });

  async function loadShares() {
    if (!props.calendar) return;
    setIsLoading(true);
    try {
      const data = await fetchCalendarShares(props.mailboxId, props.calendar.id);
      setShares(data);
    } catch (err: any) {
      console.error("[ShareCalendarModal] Failed to load shares:", err);
      setErrorMsg(err.message || "Failed to load shares");
    } finally {
      setIsLoading(false);
    }
  }

  // Handle escape key
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && props.isOpen) {
        props.onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  async function handleAddShare(e: Event) {
    e.preventDefault();
    if (!props.calendar) return;
    const email = granteeEmail().trim().toLowerCase();
    if (!email) {
      setErrorMsg("Please enter a teammate email");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await shareCalendar(props.mailboxId, props.calendar.id, {
        grantee_email: email,
        permission: permission(),
        encrypted_key: "shared_cal_key_envelope_v1",
      });
      setGranteeEmail("");
      setSuccessMsg(`Calendar shared with ${email}`);
      await loadShares();
      props.onSharesChanged?.();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to share calendar");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRevoke(share: CalendarShare) {
    if (!props.calendar) return;
    if (!confirm(`Revoke access for ${share.grantee_email}?`)) return;

    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await revokeCalendarShare(props.mailboxId, props.calendar.id, share.id);
      setSuccessMsg(`Access revoked for ${share.grantee_email}`);
      await loadShares();
      props.onSharesChanged?.();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to revoke share");
    }
  }

  async function handleUpdatePermission(share: CalendarShare, newPerm: "read" | "write") {
    if (!props.calendar || share.permission === newPerm) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await updateCalendarShare(props.mailboxId, props.calendar.id, share.id, {
        permission: newPerm,
      });
      setSuccessMsg(`Updated permission for ${share.grantee_email} to ${newPerm === "write" ? "Can edit" : "Can view"}`);
      await loadShares();
      props.onSharesChanged?.();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to update permission");
    }
  }

  return (
    <Show when={props.isOpen && props.calendar}>
      <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-calendar-modal-title"
      >
        <div class="w-full max-w-md bg-white dark:bg-[#1E1F23] rounded-2xl shadow-xl border border-[#E2DFD8] dark:border-[#2A2D35] flex flex-col overflow-hidden max-h-[90vh]">
          {/* Header */}
          <div class="flex items-center justify-between px-5 py-4 border-b border-[#F0EEE9] dark:border-[#2A2D35]">
            <div class="flex items-center gap-2.5 min-w-0">
              <span
                class="w-3.5 h-3.5 rounded-full flex-shrink-0"
                style={{ "background-color": props.calendar?.color || "#9E725F" }}
              />
              <h3
                id="share-calendar-modal-title"
                class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8] truncate"
              >
                Share "{props.calendar?.name}"
              </h3>
            </div>
            <button
              type="button"
              onClick={() => props.onClose()}
              class="p-1.5 rounded-lg text-[#6F7173] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer"
              aria-label="Close dialog"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div class="p-5 flex flex-col gap-4 overflow-y-auto">
            {/* Feedback messages */}
            <Show when={errorMsg()}>
              <div
                class="p-2.5 rounded-xl bg-[#FDF2F2] dark:bg-[#3B2222] border border-[#F8D7DA] dark:border-[#5C2B2B] text-xs text-[#DC2626] dark:text-[#F87171]"
                data-testid="share-calendar-error"
              >
                {errorMsg()}
              </div>
            </Show>
            <Show when={successMsg()}>
              <div
                class="p-2.5 rounded-xl bg-[#F0FDF4] dark:bg-[#1E3A2B] border border-[#DCFCE7] dark:border-[#2D5A3E] text-xs text-[#16A34A] dark:text-[#4ADE80]"
                data-testid="share-calendar-success"
              >
                {successMsg()}
              </div>
            </Show>

            {/* Invite Form */}
            <form onSubmit={handleAddShare} class="flex flex-col gap-2.5">
              <label class="text-xs font-semibold text-[#2B2C2D] dark:text-[#ECEBE8]">
                Add teammate
              </label>
              <div class="flex gap-2">
                <input
                  type="email"
                  placeholder="name@company.local"
                  value={granteeEmail()}
                  onInput={(e) => setGranteeEmail(e.currentTarget.value)}
                  class="flex-1 px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs text-[#2B2C2D] dark:text-[#ECEBE8] placeholder-[#6F7173] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                  data-testid="share-grantee-email-input"
                  required
                />
                <select
                  value={permission()}
                  onChange={(e) => setPermission(e.currentTarget.value as "read" | "write")}
                  class="px-2.5 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F] cursor-pointer"
                  data-testid="share-permission-select"
                >
                  <option value="read">Can view</option>
                  <option value="write">Can edit</option>
                </select>
                <button
                  type="submit"
                  disabled={isSubmitting()}
                  class="px-3.5 py-2 rounded-xl bg-[#9E725F] hover:bg-[#865E4D] disabled:opacity-50 text-white text-xs font-semibold transition-all cursor-pointer shadow-xs"
                  data-testid="share-submit-btn"
                >
                  {isSubmitting() ? "Sharing…" : "Share"}
                </button>
              </div>
            </form>

            {/* Current Shares List */}
            <div class="flex flex-col gap-2 pt-2 border-t border-[#F0EEE9] dark:border-[#2A2D35]">
              <span class="text-xs font-semibold text-[#2B2C2D] dark:text-[#ECEBE8]">
                People with access
              </span>

              {/* Owner item */}
              <div class="flex items-center justify-between p-2 rounded-xl bg-[#FAF9F5] dark:bg-[#18191D] border border-[#F0EEE9] dark:border-[#2A2D35]">
                <div class="flex flex-col min-w-0">
                  <span class="text-xs font-medium text-[#2B2C2D] dark:text-[#ECEBE8] truncate">
                    Owner (You)
                  </span>
                  <span class="text-[10px] text-[#6F7173] dark:text-[#878A8E]">
                    Full management & permissions
                  </span>
                </div>
                <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#F2E8E2] dark:bg-[#3D2C24] text-[#9E725F] dark:text-[#D4A38F]">
                  Owner
                </span>
              </div>

              {/* Grantees list */}
              <Show
                when={shares().length > 0}
                fallback={
                  <p class="text-[11px] text-[#6F7173] dark:text-[#878A8E] py-2 text-center">
                    This calendar is not shared with anyone else yet.
                  </p>
                }
              >
                <div class="flex flex-col gap-1.5" data-testid="calendar-shares-list">
                  <For each={shares()}>
                    {(share) => (
                      <div class="flex items-center justify-between p-2 rounded-xl bg-[#FAF9F5] dark:bg-[#18191D] border border-[#F0EEE9] dark:border-[#2A2D35] group">
                        <div class="flex flex-col min-w-0">
                          <span
                            class="text-xs font-medium text-[#2B2C2D] dark:text-[#ECEBE8] truncate"
                            data-testid="share-grantee-email"
                          >
                            {share.grantee_email}
                          </span>
                          <span class="text-[10px] text-[#6F7173] dark:text-[#878A8E]">
                            Shared {new Date(share.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <div class="flex items-center gap-2 flex-shrink-0">
                          <select
                            value={share.permission}
                            onChange={(e) => handleUpdatePermission(share, e.currentTarget.value as "read" | "write")}
                            onInput={(e) => handleUpdatePermission(share, e.currentTarget.value as "read" | "write")}
                            class={`text-[10px] font-medium px-2 py-0.5 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] cursor-pointer ${
                              share.permission === "write"
                                ? "bg-[#EFF6FF] dark:bg-[#1E293B] text-[#2563EB] dark:text-[#60A5FA]"
                                : "bg-[#F3F4F6] dark:bg-[#2A2D35] text-[#4B5563] dark:text-[#9CA3AF]"
                            }`}
                            data-testid="share-grantee-permission-select"
                          >
                            <option value="read">Can view</option>
                            <option value="write">Can edit</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => handleRevoke(share)}
                            class="p-1 rounded text-[#DC2626] hover:bg-[#FDF2F2] dark:hover:bg-[#3B2222] transition-colors cursor-pointer text-xs"
                            title="Revoke access"
                            data-testid="share-revoke-btn"
                          >
                            Revoke
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>

          {/* Footer */}
          <div class="flex justify-end px-5 py-3 border-t border-[#F0EEE9] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D]">
            <button
              type="button"
              onClick={() => props.onClose()}
              class="px-4 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] text-xs font-semibold text-[#2B2C2D] dark:text-[#ECEBE8] transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
