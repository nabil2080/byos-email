import { Component, createSignal, createResource, Show, For, onMount, onCleanup } from "solid-js";
import {
  fetchCustomerTickets,
  fetchCustomerTicketDetail,
  createCustomerTicket,
  addCustomerTicketReply,
  recordCustomerTyping,
  type CustomerTicketListItem,
  type CustomerTicketDetail,
  type CreateTicketPayload,
} from "../../lib/api/support";

const PRODUCT_AREAS = [
  { value: "mail", label: "Mail & Webmail" },
  { value: "domains", label: "Domains & DNS" },
  { value: "storage", label: "Storage & Cloud Sync" },
  { value: "org_mgmt", label: "Organization & Members" },
  { value: "billing", label: "Billing & Subscription" },
  { value: "security", label: "Security & Passkeys" },
  { value: "bug_report", label: "Bug Report" },
  { value: "feature_request", label: "Feature Request" },
  { value: "other", label: "Other" },
];

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

export const SupportPage: Component = () => {
  const [selectedTicketId, setSelectedTicketId] = createSignal<string | null>(null);
  const [showCreateModal, setShowCreateModal] = createSignal(false);
  const [searchFilter, setSearchFilter] = createSignal("");
  const [statusFilter, setStatusFilter] = createSignal<string>("all");

  // Create Ticket Form State
  const [createSubject, setCreateSubject] = createSignal("");
  const [createProductArea, setCreateProductArea] = createSignal("mail");
  const [createPriority, setCreatePriority] = createSignal("normal");
  const [createBody, setCreateBody] = createSignal("");
  const [isSubmittingTicket, setIsSubmittingTicket] = createSignal(false);
  const [formError, setFormError] = createSignal<string | null>(null);

  // Reply Form State
  const [replyBody, setReplyBody] = createSignal("");
  const [isSubmittingReply, setIsSubmittingReply] = createSignal(false);
  const [replyError, setReplyError] = createSignal<string | null>(null);

  // Dynamic Auto-Polling & Typing Indicator Beacon
  let lastTypingSent = 0;
  const notifyCustomerTyping = (ticketId: string | null) => {
    if (!ticketId) return;
    const now = Date.now();
    if (now - lastTypingSent > 2000) {
      lastTypingSent = now;
      recordCustomerTyping(ticketId);
    }
  };

  // Notifications
  const [notification, setNotification] = createSignal<{ type: "success" | "error"; message: string } | null>(null);

  // Resources (with mutate support for silent background synchronization)
  const [ticketsData, { refetch: refetchTickets, mutate: mutateTickets }] = createResource(fetchCustomerTickets);

  const [activeTicket, { refetch: refetchActiveTicket, mutate: mutateActiveTicket }] = createResource(
    selectedTicketId,
    async (id) => {
      if (!id) return null;
      try {
        return await fetchCustomerTicketDetail(id);
      } catch (err: any) {
        setNotification({ type: "error", message: `Failed to load ticket: ${err.message}` });
        return null;
      }
    }
  );

  // Silent Background Auto-Polling (Zero UI flickering or reload disruption)
  let pollTimer: number | undefined;
  onMount(() => {
    pollTimer = window.setInterval(async () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        try {
          const currentId = selectedTicketId();
          if (currentId) {
            const detail = await fetchCustomerTicketDetail(currentId);
            if (detail && selectedTicketId() === currentId) {
              mutateActiveTicket(detail);
            }
          }
          const list = await fetchCustomerTickets();
          if (list) {
            mutateTickets(list);
          }
        } catch {
          // Silent background sync failure - keep current UI state without flickering
        }
      }
    }, 10000);
  });

  onCleanup(() => {
    if (pollTimer !== undefined) clearInterval(pollTimer);
  });

  const filteredTickets = () => {
    if (ticketsData.error) return [];
    const list = ticketsData()?.tickets || [];
    const search = searchFilter().toLowerCase().trim();
    const st = statusFilter();

    return list.filter((t) => {
      if (st !== "all" && t.status !== st) return false;
      if (search) {
        const matchesSubject = t.subject.toLowerCase().includes(search);
        const matchesNumber = t.ticket_number.toLowerCase().includes(search);
        const matchesSnippet = t.snippet.toLowerCase().includes(search);
        if (!matchesSubject && !matchesNumber && !matchesSnippet) return false;
      }
      return true;
    });
  };

  const handleCreateTicketSubmit = async (e: Event) => {
    e.preventDefault();
    setFormError(null);

    const subject = createSubject().trim();
    const body = createBody().trim();

    if (!subject) {
      setFormError("Subject is required.");
      return;
    }
    if (!body) {
      setFormError("Please provide details for your support request.");
      return;
    }

    setIsSubmittingTicket(true);
    try {
      const payload: CreateTicketPayload = {
        subject,
        product_area: createProductArea(),
        category: "issue",
        priority: createPriority(),
        body,
      };

      const result = await createCustomerTicket(payload);
      setCreateSubject("");
      setCreateBody("");
      setCreateProductArea("mail");
      setCreatePriority("normal");
      setShowCreateModal(false);

      await refetchTickets();
      setSelectedTicketId(result.ticket.id);

      setNotification({
        type: "success",
        message: `Support ticket ${result.ticket.ticket_number} created successfully. Our team will review it promptly.`,
      });
      setTimeout(() => setNotification(null), 5000);
    } catch (err: any) {
      setFormError(err.message || "Failed to create support ticket.");
    } finally {
      setIsSubmittingTicket(false);
    }
  };

  const handleReplySubmit = async (e: Event) => {
    e.preventDefault();
    setReplyError(null);

    const ticketId = selectedTicketId();
    const body = replyBody().trim();
    if (!ticketId || !body) return;

    setIsSubmittingReply(true);
    try {
      await addCustomerTicketReply(ticketId, body);
      setReplyBody("");
      await refetchActiveTicket();
      await refetchTickets();
      setNotification({
        type: "success",
        message: "Your reply has been sent to our support team.",
      });
      setTimeout(() => setNotification(null), 4000);
    } catch (err: any) {
      setReplyError(err.message || "Failed to send reply.");
    } finally {
      setIsSubmittingReply(false);
    }
  };

  const statusBadgeClass = (status: string) => {
    switch (status) {
      case "new":
        return "bg-sky-50 text-sky-700 border-sky-200";
      case "in_progress":
      case "open":
        return "bg-amber-50 text-amber-800 border-amber-200";
      case "pending_customer":
        return "bg-purple-50 text-purple-700 border-purple-200";
      case "resolved":
      case "closed":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      default:
        return "bg-stone-50 text-stone-600 border-stone-200";
    }
  };

  const priorityBadgeClass = (priority: string) => {
    switch (priority) {
      case "urgent":
      case "high":
        return "bg-rose-50 text-rose-700 border-rose-200";
      case "low":
        return "bg-stone-50 text-stone-600 border-stone-200";
      default:
        return "bg-stone-100 text-stone-700 border-stone-200";
    }
  };

  return (
    <div class="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Toast Notification */}
      <Show when={notification()}>
        <div
          class={`rounded-xl p-3 text-xs flex items-center justify-between border shadow-2xs transition-all ${
            notification()!.type === "success"
              ? "bg-emerald-50 text-emerald-900 border-emerald-200"
              : "bg-rose-50 text-rose-900 border-rose-200"
          }`}
        >
          <span>{notification()!.message}</span>
          <button
            type="button"
            onClick={() => setNotification(null)}
            class="text-xs font-bold hover:opacity-75 cursor-pointer ml-3"
          >
            ✕
          </button>
        </div>
      </Show>

      {/* Header */}
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E2DFD8] pb-5">
        <div>
          <h1 class="text-xl sm:text-2xl font-bold text-[#1A1B1E] tracking-tight">Help & Support</h1>
          <p class="text-xs sm:text-sm text-[#6F7173] mt-1">
            Need assistance with your mailboxes, custom domains, or encryption keys? Create a request below.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          data-testid="btn-open-new-ticket"
          class="inline-flex items-center justify-center gap-2 bg-[#9E725F] hover:bg-[#865E4D] text-white px-4 py-2.5 rounded-xl font-semibold text-xs transition shadow-2xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/40"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>New Support Ticket</span>
        </button>
      </div>

      {/* Main Layout: Ticket Queue List & Selected Ticket View */}
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Ticket List Column */}
        <div
          class={`bg-white rounded-2xl border border-[#E2DFD8] p-4 sm:p-5 shadow-2xs space-y-4 ${
            selectedTicketId() ? "lg:col-span-5" : "lg:col-span-12"
          }`}
        >
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <h2 class="text-sm font-bold text-[#1A1B1E]">My Support Requests</h2>
            <button
              type="button"
              onClick={() => refetchTickets()}
              class="text-xs text-[#9E725F] hover:underline font-medium cursor-pointer"
            >
              Refresh
            </button>
          </div>

          {/* Search & Filter Bar */}
          <div class="space-y-2">
            <input
              type="text"
              placeholder="Search by subject or ticket #..."
              value={searchFilter()}
              onInput={(e) => setSearchFilter(e.currentTarget.value)}
              class="w-full text-xs rounded-xl border border-[#E2DFD8] px-3 py-2 bg-[#FBF9F6] text-[#3C3D3E] placeholder-[#878A8E] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
            />
            <div class="flex items-center gap-1.5 flex-wrap">
              <For each={["all", "open", "in_progress", "resolved", "closed"]}>
                {(st) => (
                  <button
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    class={`px-2.5 py-1 rounded-full text-[11px] font-medium capitalize transition cursor-pointer ${
                      statusFilter() === st
                        ? "bg-[#9E725F] text-white font-semibold shadow-2xs"
                        : "bg-[#F0EEE9] text-[#55575B] hover:bg-[#E8E5DF]"
                    }`}
                  >
                    {st.replace("_", " ")}
                  </button>
                )}
              </For>
            </div>
          </div>

          {/* Tickets List */}
          <div class="divide-y divide-[#E2DFD8]/60 max-h-[580px] overflow-y-auto custom-scrollbar">
            <Show when={ticketsData.error}>
              <div class="p-6 my-2 rounded-2xl border border-rose-200 bg-rose-50/50 text-center space-y-2">
                <p class="text-xs text-rose-800 font-medium">Failed to load support tickets.</p>
                <button
                  type="button"
                  onClick={() => refetchTickets()}
                  class="px-3 py-1.5 text-xs font-semibold rounded-xl bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 cursor-pointer"
                >
                  Retry Connection
                </button>
              </div>
            </Show>

            <Show when={ticketsData.loading && !ticketsData.error && !ticketsData()}>
              <div class="py-12 text-center text-xs text-[#878A8E]">Loading support tickets...</div>
            </Show>

            <For
              each={filteredTickets()}
              fallback={
                <Show when={(!ticketsData.loading && !ticketsData.error) || (!ticketsData.error && Boolean(ticketsData()))}>
                  <div class="py-12 text-center text-xs text-[#878A8E] space-y-2">
                    <p>No support requests found.</p>
                    <button
                      type="button"
                      onClick={() => setShowCreateModal(true)}
                      class="text-[#9E725F] hover:underline font-semibold"
                    >
                      Submit your first ticket
                    </button>
                  </div>
                </Show>
              }
            >
              {(ticket) => {
                const isSelected = () => selectedTicketId() === ticket.id;
                return (
                  <div
                    onClick={() => setSelectedTicketId(ticket.id)}
                    class={`p-3.5 rounded-xl transition cursor-pointer my-1 space-y-1.5 ${
                      isSelected()
                        ? "bg-[#F2E8E2] border-l-4 border-[#9E725F]"
                        : "hover:bg-[#F9F8F6] border-l-4 border-transparent"
                    }`}
                  >
                    <div class="flex items-center justify-between gap-2">
                      <span class="font-mono text-xs font-bold text-[#9E725F]">{ticket.ticket_number}</span>
                      <div class="flex items-center gap-1.5">
                        <span
                          class={`text-[10px] font-bold px-1.5 py-0.2 rounded border uppercase ${priorityBadgeClass(
                            ticket.priority
                          )}`}
                        >
                          {ticket.priority}
                        </span>
                        <span
                          class={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase ${statusBadgeClass(
                            ticket.status
                          )}`}
                        >
                          {ticket.status.replace("_", " ")}
                        </span>
                      </div>
                    </div>
                    <div class="font-bold text-xs sm:text-sm text-[#1A1B1E] truncate">{ticket.subject}</div>
                    <div class="text-[11px] text-[#6F7173] truncate">{ticket.snippet || "No messages yet"}</div>
                    <div class="text-[10px] text-[#878A8E] flex items-center justify-between pt-1">
                      <span class="capitalize">Area: {ticket.product_area}</span>
                      <span>{new Date(ticket.last_activity_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </div>

        {/* Selected Ticket Thread & Reply Workspace */}
        <Show when={selectedTicketId()}>
          <div class="bg-white rounded-2xl border border-[#E2DFD8] p-4 sm:p-6 shadow-2xs lg:col-span-7 space-y-4">
            <Show when={activeTicket.loading && !activeTicket()}>
              <div class="py-16 text-center text-xs text-[#878A8E]">Loading ticket details...</div>
            </Show>

            <Show when={activeTicket()}>
              {(ticket) => (
                <div class="space-y-5">
                  {/* Top Bar */}
                  <div class="flex items-start justify-between gap-3 border-b border-[#E2DFD8] pb-4">
                    <div class="space-y-1">
                      <div class="flex items-center gap-2">
                        <span class="font-mono text-xs font-bold text-[#9E725F]">{ticket().ticket_number}</span>
                        <span
                          class={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase ${statusBadgeClass(
                            ticket().status
                          )}`}
                        >
                          {ticket().status.replace("_", " ")}
                        </span>
                        <span
                          class={`text-[10px] font-bold px-1.5 py-0.2 rounded border uppercase ${priorityBadgeClass(
                            ticket().priority
                          )}`}
                        >
                          {ticket().priority}
                        </span>
                      </div>
                      <h2 class="text-base sm:text-lg font-bold text-[#1A1B1E]">{ticket().subject}</h2>
                      <div class="text-[11px] text-[#878A8E]">
                        Product Area: <span class="font-medium text-[#3C3D3E] capitalize">{ticket().product_area}</span> •
                        Opened: {new Date(ticket().created_at).toLocaleString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedTicketId(null)}
                      class="text-stone-400 hover:text-stone-700 p-1 font-bold text-sm cursor-pointer"
                      title="Close Ticket View"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Messages Stream */}
                  <div class="space-y-3.5 max-h-[420px] overflow-y-auto custom-scrollbar pr-1">
                    <For each={ticket().messages}>
                      {(msg) => (
                        <div
                          class={`p-3.5 rounded-xl text-xs space-y-1.5 border shadow-2xs ${
                            msg.author_type === "agent"
                              ? "bg-indigo-50/70 border-indigo-200 mr-4"
                              : "bg-[#FBF9F6] border-[#E2DFD8] ml-4"
                          }`}
                        >
                          <div class="flex items-center justify-between">
                            <div class="flex items-center gap-1.5">
                              <div
                                class={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] text-white ${
                                  msg.author_type === "agent" ? "bg-indigo-600" : "bg-[#9E725F]"
                                }`}
                              >
                                {msg.author_type === "agent" ? "S" : "U"}
                              </div>
                              <span class="font-bold text-[#1A1B1E]">{msg.author_name}</span>
                              <Show when={msg.author_type === "agent"}>
                                <span class="text-[9px] bg-indigo-100 text-indigo-800 font-bold px-1.5 py-0.2 rounded uppercase">
                                  Support Agent
                                </span>
                              </Show>
                            </div>
                            <span class="text-[10px] text-[#878A8E]">
                              {new Date(msg.created_at).toLocaleString()}
                            </span>
                          </div>
                          <div class="text-[#2B2C2D] whitespace-pre-wrap leading-relaxed pl-6.5">{msg.body}</div>
                        </div>
                      )}
                    </For>
                  </div>

                  {/* Support Agent Typing Indicator */}
                  <Show when={ticket().agent_typing}>
                    <div class="flex items-center gap-2 text-xs text-[#9E725F] bg-[#9E725F]/5 border border-[#9E725F]/20 rounded-xl px-3.5 py-2 my-1 animate-pulse">
                      <span class="flex gap-1 items-center">
                        <span class="w-1.5 h-1.5 bg-[#9E725F] rounded-full animate-bounce" style={{ "animation-delay": "0ms" }} />
                        <span class="w-1.5 h-1.5 bg-[#9E725F] rounded-full animate-bounce" style={{ "animation-delay": "150ms" }} />
                        <span class="w-1.5 h-1.5 bg-[#9E725F] rounded-full animate-bounce" style={{ "animation-delay": "300ms" }} />
                      </span>
                      <span class="font-medium text-[11px]">Support agent is typing a response...</span>
                    </div>
                  </Show>

                  {/* Reply Composer */}
                  <form onSubmit={handleReplySubmit} class="space-y-3 pt-3 border-t border-[#E2DFD8]">
                    <Show when={replyError()}>
                      <div class="text-xs text-rose-600 font-medium">{replyError()}</div>
                    </Show>

                    <label for="reply-box" class="block text-xs font-semibold text-[#1A1B1E]">
                      Post a Reply:
                    </label>
                    <textarea
                      id="reply-box"
                      rows={3}
                      placeholder="Type your reply to the support team..."
                      value={replyBody()}
                      onInput={(e) => {
                        setReplyBody(e.currentTarget.value);
                        notifyCustomerTyping(selectedTicketId());
                      }}
                      class="w-full rounded-xl border border-[#E2DFD8] p-3 text-xs bg-[#FBF9F6] focus:outline-none focus:ring-1 focus:ring-[#9E725F] text-[#1A1B1E]"
                    />

                    <div class="flex justify-end">
                      <button
                        type="submit"
                        disabled={isSubmittingReply() || !replyBody().trim()}
                        class="bg-[#9E725F] hover:bg-[#865E4D] text-white px-4 py-2 rounded-xl text-xs font-semibold transition shadow-2xs cursor-pointer disabled:opacity-50"
                      >
                        {isSubmittingReply() ? "Sending..." : "Send Reply"}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </Show>
          </div>
        </Show>
      </div>

      {/* New Ticket Modal */}
      <Show when={showCreateModal()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2B2C2D]/50 backdrop-blur-xs">
          <div
            class="bg-white rounded-2xl border border-[#E2DFD8] shadow-2xl max-w-xl w-full p-5 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-ticket-modal-title"
          >
            <div class="flex items-center justify-between border-b border-[#E2DFD8] pb-3">
              <h2 id="new-ticket-modal-title" class="text-base sm:text-lg font-bold text-[#1A1B1E]">
                Open a Support Ticket
              </h2>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                class="text-stone-400 hover:text-stone-700 font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <Show when={formError()}>
              <div class="bg-rose-50 border border-rose-200 text-rose-800 text-xs p-3 rounded-xl font-medium">
                {formError()}
              </div>
            </Show>

            <form onSubmit={handleCreateTicketSubmit} class="space-y-4">
              <div>
                <label for="ticket-subject" class="block text-xs font-bold text-[#3C3D3E] mb-1">
                  Subject *
                </label>
                <input
                  id="ticket-subject"
                  type="text"
                  placeholder="Summary of the issue..."
                  value={createSubject()}
                  onInput={(e) => setCreateSubject(e.currentTarget.value)}
                  class="w-full text-xs rounded-xl border border-[#E2DFD8] px-3 py-2 text-[#1A1B1E] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                  required
                />
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label for="ticket-area" class="block text-xs font-bold text-[#3C3D3E] mb-1">
                    Product Area
                  </label>
                  <select
                    id="ticket-area"
                    value={createProductArea()}
                    onChange={(e) => setCreateProductArea(e.currentTarget.value)}
                    class="w-full text-xs rounded-xl border border-[#E2DFD8] px-3 py-2 text-[#1A1B1E] bg-white focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                  >
                    <For each={PRODUCT_AREAS}>
                      {(area) => <option value={area.value}>{area.label}</option>}
                    </For>
                  </select>
                </div>

                <div>
                  <label for="ticket-priority" class="block text-xs font-bold text-[#3C3D3E] mb-1">
                    Priority
                  </label>
                  <select
                    id="ticket-priority"
                    value={createPriority()}
                    onChange={(e) => setCreatePriority(e.currentTarget.value)}
                    class="w-full text-xs rounded-xl border border-[#E2DFD8] px-3 py-2 text-[#1A1B1E] bg-white focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                  >
                    <For each={PRIORITIES}>
                      {(pr) => <option value={pr.value}>{pr.label}</option>}
                    </For>
                  </select>
                </div>
              </div>

              <div>
                <label for="ticket-description" class="block text-xs font-bold text-[#3C3D3E] mb-1">
                  Detailed Description *
                </label>
                <textarea
                  id="ticket-description"
                  rows={5}
                  placeholder="Explain what happened, steps to reproduce, or any error messages you observed..."
                  value={createBody()}
                  onInput={(e) => setCreateBody(e.currentTarget.value)}
                  class="w-full text-xs rounded-xl border border-[#E2DFD8] p-3 text-[#1A1B1E] focus:outline-none focus:ring-1 focus:ring-[#9E725F] leading-relaxed"
                  required
                />
              </div>

              <div class="text-[11px] text-[#878A8E] bg-[#FBF9F6] p-2.5 rounded-xl border border-[#E2DFD8]">
                🔒 <strong>Zero-Knowledge Safe:</strong> Never submit private mailbox passwords, seed recovery phrases, or raw cryptographic keys in support tickets. BYOS staff will never request your private keys.
              </div>

              <div class="flex items-center justify-end gap-2.5 pt-2 border-t border-[#E2DFD8]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  class="px-4 py-2 rounded-xl text-xs font-medium text-[#55575B] hover:bg-[#F0EEE9] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingTicket()}
                  class="bg-[#9E725F] hover:bg-[#865E4D] text-white px-5 py-2 rounded-xl text-xs font-semibold transition shadow-2xs cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingTicket() ? "Submitting..." : "Submit Ticket"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default SupportPage;
