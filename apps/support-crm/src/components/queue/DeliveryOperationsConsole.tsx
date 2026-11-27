import {
  type Component,
  createSignal,
  createResource,
  createMemo,
  Show,
  For,
  onMount,
  onCleanup,
  ErrorBoundary,
} from "solid-js";
import {
  fetchQueueOverview,
  fetchQueueMessages,
  fetchQueueMessageDetail,
  fetchQueueAlerts,
  reconcileQueueMessage,
  type QueueOverviewResponse,
  type QueueMessageItem,
  type QueueMessageDetailResponse,
  type QueueAlertsResponse,
  type ReconcileRequest,
} from "../../lib/api";

interface Props {
  onNotification?: (notif: { type: "success" | "error"; message: string; auditId?: string }) => void;
}

export const DeliveryOperationsConsole: Component<Props> = (props) => {
  // Filters & Pagination State
  const [statusFilter, setStatusFilter] = createSignal<string>("all");
  const [recipientSearch, setRecipientSearch] = createSignal<string>("");
  const [pageOffset, setPageOffset] = createSignal<number>(0);
  const [pageSize, setPageSize] = createSignal<number>(25);
  const [selectedMessageId, setSelectedMessageId] = createSignal<string | null>(null);

  // Reconciliation Modal / Action Form State
  const [activeActionTab, setActiveActionTab] = createSignal<"overview" | "timeline" | "reconcile" | "audit">("overview");
  const [reconcileAction, setReconcileAction] = createSignal<"add_note" | "resolve_accepted" | "authorize_retry" | "resolve_bounced">("add_note");
  const [operatorReason, setOperatorReason] = createSignal<string>("");
  const [evidenceCategory, setEvidenceCategory] = createSignal<string>("");
  const [evidenceReference, setEvidenceReference] = createSignal<string>("");
  const [duplicateRiskAck, setDuplicateRiskAck] = createSignal<boolean>(false);
  const [isSubmittingReconciliation, setIsSubmittingReconciliation] = createSignal<boolean>(false);
  const [reconcileError, setReconcileError] = createSignal<string | null>(null);

  // Resources
  const [overview, { refetch: refetchOverview }] = createResource<QueueOverviewResponse>(fetchQueueOverview);
  const [alerts, { refetch: refetchAlerts }] = createResource<QueueAlertsResponse>(fetchQueueAlerts);

  const [messageList, { refetch: refetchMessages }] = createResource(
    () => ({
      status: statusFilter(),
      recipient: recipientSearch().trim() || undefined,
      limit: pageSize(),
      offset: pageOffset(),
    }),
    async (params) => {
      return fetchQueueMessages({
        status: params.status === "all" ? undefined : params.status,
        recipient: params.recipient,
        limit: params.limit,
        offset: params.offset,
      });
    }
  );

  const [messageDetail, { refetch: refetchDetail, mutate: mutateDetail }] = createResource(
    selectedMessageId,
    async (id) => {
      if (!id) return null;
      return fetchQueueMessageDetail(id);
    }
  );

  // Controlled Refresh
  const [isRefreshing, setIsRefreshing] = createSignal<boolean>(false);
  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([refetchOverview(), refetchAlerts(), refetchMessages()]);
      if (selectedMessageId()) {
        await refetchDetail();
      }
      props.onNotification?.({
        type: "success",
        message: "Queue telemetry refreshed successfully.",
      });
    } catch (err: any) {
      props.onNotification?.({
        type: "error",
        message: err.message || "Failed to refresh queue telemetry.",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  // Auto-refresh interval (every 15s when page is active)
  let pollTimer: number | undefined;
  onMount(() => {
    pollTimer = window.setInterval(async () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        try {
          await Promise.all([refetchOverview(), refetchAlerts(), refetchMessages()]);
          if (selectedMessageId()) {
            await refetchDetail();
          }
        } catch {
          // Silent polling sync
        }
      }
    }, 15000);

    onCleanup(() => {
      if (pollTimer) clearInterval(pollTimer);
    });
  });

  // Reset pagination on filter change
  const handleFilterChange = (st: string) => {
    setStatusFilter(st);
    setPageOffset(0);
  };

  const handleSearchChange = (val: string) => {
    setRecipientSearch(val);
    setPageOffset(0);
  };

  // Open Message Detail
  const handleSelectMessage = (id: string, initialTab: "overview" | "timeline" | "reconcile" | "audit" = "overview") => {
    setSelectedMessageId(id);
    setActiveActionTab(initialTab);
    setReconcileError(null);
    setOperatorReason("");
    setEvidenceCategory("");
    setEvidenceReference("");
    setDuplicateRiskAck(false);
  };

  const handleCloseDetail = () => {
    setSelectedMessageId(null);
    setReconcileError(null);
  };

  // Execute Reconciliation
  const handleExecuteReconciliation = async (e: Event) => {
    e.preventDefault();
    const id = selectedMessageId();
    if (!id) return;

    const action = reconcileAction();
    const reason = operatorReason().trim();
    if (!reason) {
      setReconcileError("Operator reason is strictly required for all actions.");
      return;
    }

    if (action === "resolve_accepted") {
      if (!evidenceCategory().trim() || !evidenceReference().trim()) {
        setReconcileError("Authoritative acceptance reconciliation requires both an Evidence Category and Evidence Reference.");
        return;
      }
    }

    if (action === "authorize_retry") {
      if (!duplicateRiskAck()) {
        setReconcileError("You must explicitly acknowledge the duplicate delivery risk to authorize retransmission.");
        return;
      }
      if (!evidenceCategory().trim() || !evidenceReference().trim()) {
        setReconcileError("Retransmission authorization requires both an Evidence Category and Evidence Reference.");
        return;
      }
    }

    if (action === "resolve_bounced") {
      if (!evidenceCategory().trim() || !evidenceReference().trim()) {
        setReconcileError("Marking a message as bounced requires both an authoritative Evidence Category and Evidence Reference.");
        return;
      }
    }

    setIsSubmittingReconciliation(true);
    setReconcileError(null);

    const idempotencyKey = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `idemp-${Date.now()}`;

    const payload: ReconcileRequest = {
      action,
      operator_reason: reason,
      evidence_category: evidenceCategory().trim() || undefined,
      evidence_reference: evidenceReference().trim() || undefined,
      duplicate_risk_acknowledged: action === "authorize_retry" ? duplicateRiskAck() : undefined,
      idempotency_key: idempotencyKey,
    };

    try {
      const res = await reconcileQueueMessage(id, payload);
      const replayNotice = res.idempotent_replay ? " (Idempotent Replay)" : "";
      props.onNotification?.({
        type: "success",
        message: `Action '${res.action}' applied to ${res.delivery_id.slice(0, 8)}... Result: ${res.resulting_status}.${replayNotice} Immutable Audit ID: ${res.audit_id}`,
        auditId: res.audit_id,
      });

      // Refresh data
      await Promise.all([refetchDetail(), refetchMessages(), refetchOverview()]);
      setActiveActionTab("audit");
    } catch (err: any) {
      const errMsg = err.message || "Reconciliation request failed.";
      let displayError = errMsg;
      if (errMsg.includes("active worker lease") || errMsg.includes("lease held")) {
        displayError = "Active worker lease held: The message is currently owned by an active processing worker. Please refresh the record and investigate again.";
      } else if (errMsg.includes("manual retry limit reached") || errMsg.includes("absolute manual retry limit")) {
        displayError = "Manual retry limit reached: The maximum allowed operator retries have been consumed for this message.";
      } else if (errMsg.includes("idempotency key conflict")) {
        displayError = `Idempotency Conflict: ${errMsg}`;
      }
      setReconcileError(displayError);
      props.onNotification?.({
        type: "error",
        message: displayError,
      });
    } finally {
      setIsSubmittingReconciliation(false);
    }
  };

  // Helper formatting functions
  const formatAgeSeconds = (sec?: number) => {
    if (sec === undefined || sec === null || sec < 0) return "—";
    if (sec === 0) return "0s";
    if (sec < 60) return `${Math.floor(sec)}s`;
    const mins = Math.floor(sec / 60);
    const remSec = Math.floor(sec % 60);
    if (mins < 60) return `${mins}m ${remSec}s`;
    const hrs = Math.floor(mins / 60);
    const remMin = mins % 60;
    if (hrs < 24) return `${hrs}h ${remMin}m`;
    const days = Math.floor(hrs / 24);
    return `${days}d ${hrs % 24}h`;
  };

  const formatIsoDate = (iso?: string) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    } catch {
      return iso;
    }
  };

  const formatRelativeTime = (iso?: string) => {
    if (!iso) return "—";
    try {
      const ms = Date.now() - new Date(iso).getTime();
      const mins = Math.floor(ms / 60000);
      if (mins < 1) return "just now";
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      const days = Math.floor(hrs / 24);
      return `${days}d ago`;
    } catch {
      return iso;
    }
  };

  // Status badge styling
  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "delivered":
        return "bg-emerald-50 text-emerald-800 border-emerald-200";
      case "processing":
        return "bg-amber-50 text-amber-800 border-amber-200";
      case "outcome_unknown":
        return "bg-purple-50 text-purple-800 border-purple-200 font-bold";
      case "pending":
        return "bg-stone-100 text-stone-800 border-stone-200";
      case "bounced":
        return "bg-rose-50 text-rose-800 border-rose-200 font-bold";
      case "expired":
        return "bg-slate-100 text-slate-700 border-slate-300";
      default:
        return "bg-stone-100 text-stone-800 border-stone-200";
    }
  };

  return (
    <div class="space-y-4">
      {/* ─────────────────────────────────────────────────────────────
          1. System Health Status Banner & Queue Latency Metrics
         ───────────────────────────────────────────────────────────── */}
      <div class="rounded-2xl border border-[#E2DFD8] bg-[#FBF9F6] p-4 shadow-2xs space-y-3">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#E2DFD8]/60">
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2">
              <span
                class={`w-2.5 h-2.5 rounded-full ${
                  overview()?.status === "healthy"
                    ? "bg-emerald-500 animate-pulse"
                    : overview()?.status === "degraded"
                    ? "bg-amber-500 animate-pulse"
                    : "bg-rose-500 animate-pulse"
                }`}
              />
              <span class="text-xs font-bold uppercase tracking-wider text-[#1A1B1E]">
                Queue Status:{" "}
                <span
                  class={
                    overview()?.status === "healthy"
                      ? "text-emerald-700"
                      : overview()?.status === "degraded"
                      ? "text-amber-700"
                      : "text-rose-700 font-bold"
                  }
                >
                  {overview()?.status ?? "CONNECTING..."}
                </span>
              </span>
            </div>

            <Show when={overview()?.counts?.outcome_unknown && overview()!.counts.outcome_unknown > 0}>
              <span class="text-[11px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 font-mono font-bold border border-purple-200">
                ⚠ {overview()!.counts.outcome_unknown} Outcome Unknown
              </span>
            </Show>
          </div>

          <div class="flex items-center gap-2 text-xs text-[#878A8E]">
            <span class="font-mono text-[11px]">
              Refreshed: {overview()?.timestamp ? formatIsoDate(overview()!.timestamp) : "—"}
            </span>
            <button
              type="button"
              disabled={isRefreshing()}
              onClick={handleManualRefresh}
              class="px-2.5 py-1 rounded-lg bg-white border border-[#E2DFD8] text-[#55575B] hover:text-[#1A1B1E] hover:bg-stone-50 font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
            >
              {isRefreshing() ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {/* Aggregate Status Cards */}
        <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
          {/* Card: Pending */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => handleFilterChange("pending")}
            class={`rounded-xl border p-2.5 transition cursor-pointer ${
              statusFilter() === "pending"
                ? "bg-[#9E725F]/10 border-[#9E725F]"
                : "bg-white border-[#E2DFD8] hover:border-stone-400"
            }`}
          >
            <span class="text-[10px] font-bold text-[#878A8E] block uppercase tracking-wider">Pending</span>
            <span class="text-xl font-bold font-mono text-[#1A1B1E] mt-0.5 block">
              {overview()?.counts?.pending ?? 0}
            </span>
            <span class="text-[10px] text-stone-500 font-mono block mt-0.5 truncate">
              Oldest: {formatAgeSeconds(overview()?.oldest_age_seconds?.pending)}
            </span>
          </div>

          {/* Card: Processing */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => handleFilterChange("processing")}
            class={`rounded-xl border p-2.5 transition cursor-pointer ${
              statusFilter() === "processing"
                ? "bg-amber-100/40 border-amber-500"
                : "bg-white border-[#E2DFD8] hover:border-stone-400"
            }`}
          >
            <span class="text-[10px] font-bold text-[#878A8E] block uppercase tracking-wider">Processing</span>
            <span class="text-xl font-bold font-mono text-amber-700 mt-0.5 block">
              {overview()?.counts?.processing ?? 0}
            </span>
            <span class="text-[10px] text-stone-500 font-mono block mt-0.5 truncate">
              Oldest: {formatAgeSeconds(overview()?.oldest_age_seconds?.processing)}
            </span>
          </div>

          {/* Card: Retry Scheduled */}
          <div
            class="rounded-xl border border-[#E2DFD8] bg-white p-2.5"
            title="Pending messages with previous attempts awaiting next retry backoff window"
          >
            <span class="text-[10px] font-bold text-[#878A8E] block uppercase tracking-wider">Retry Sched</span>
            <span class="text-xl font-bold font-mono text-stone-700 mt-0.5 block">
              {overview()?.counts?.retry_scheduled ?? 0}
            </span>
            <span class="text-[10px] text-stone-400 font-mono block mt-0.5 truncate">Backoff queue</span>
          </div>

          {/* Card: Outcome Unknown (CRITICAL WORKFLOW) */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => handleFilterChange("outcome_unknown")}
            class={`rounded-xl border p-2.5 transition cursor-pointer ${
              statusFilter() === "outcome_unknown"
                ? "bg-purple-100 border-purple-500 ring-2 ring-purple-300"
                : overview()?.counts?.outcome_unknown && overview()!.counts.outcome_unknown > 0
                ? "bg-purple-50/70 border-purple-300 hover:border-purple-500"
                : "bg-white border-[#E2DFD8] hover:border-stone-400"
            }`}
          >
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-bold text-purple-900 block uppercase tracking-wider">Unknown</span>
              <span class="w-2 h-2 rounded-full bg-purple-600" />
            </div>
            <span class="text-xl font-bold font-mono text-purple-900 mt-0.5 block">
              {overview()?.counts?.outcome_unknown ?? 0}
            </span>
            <span class="text-[10px] text-purple-700 font-mono block mt-0.5 truncate font-medium">
              Oldest: {formatAgeSeconds(overview()?.oldest_age_seconds?.outcome_unknown)}
            </span>
          </div>

          {/* Card: Delivered */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => handleFilterChange("delivered")}
            class={`rounded-xl border p-2.5 transition cursor-pointer ${
              statusFilter() === "delivered"
                ? "bg-emerald-50 border-emerald-500"
                : "bg-white border-[#E2DFD8] hover:border-stone-400"
            }`}
          >
            <span class="text-[10px] font-bold text-[#878A8E] block uppercase tracking-wider">Delivered</span>
            <span class="text-xl font-bold font-mono text-emerald-700 mt-0.5 block">
              {overview()?.counts?.delivered ?? 0}
            </span>
            <span class="text-[10px] text-emerald-600 font-mono block mt-0.5 truncate font-medium">
              24h: {overview()?.counts?.delivered_24h ?? 0}
            </span>
          </div>

          {/* Card: Bounced */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => handleFilterChange("bounced")}
            class={`rounded-xl border p-2.5 transition cursor-pointer ${
              statusFilter() === "bounced"
                ? "bg-rose-50 border-rose-500"
                : "bg-white border-[#E2DFD8] hover:border-stone-400"
            }`}
          >
            <span class="text-[10px] font-bold text-[#878A8E] block uppercase tracking-wider">Bounced</span>
            <span class="text-xl font-bold font-mono text-rose-700 mt-0.5 block">
              {overview()?.counts?.bounced ?? 0}
            </span>
            <span class="text-[10px] text-rose-600 font-mono block mt-0.5 truncate font-medium">
              24h: {overview()?.counts?.bounced_24h ?? 0}
            </span>
          </div>

          {/* Card: Expired */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => handleFilterChange("expired")}
            class={`rounded-xl border p-2.5 transition cursor-pointer ${
              statusFilter() === "expired"
                ? "bg-slate-100 border-slate-500"
                : "bg-white border-[#E2DFD8] hover:border-stone-400"
            }`}
          >
            <span class="text-[10px] font-bold text-[#878A8E] block uppercase tracking-wider">Expired</span>
            <span class="text-xl font-bold font-mono text-slate-700 mt-0.5 block">
              {overview()?.counts?.expired ?? 0}
            </span>
            <span class="text-[10px] text-slate-500 font-mono block mt-0.5 truncate font-medium">
              24h: {overview()?.counts?.expired_24h ?? 0}
            </span>
          </div>
        </div>

        {/* Alerts Section (if any alerts detected) */}
        <Show when={alerts()?.alerts && alerts()!.alerts.length > 0}>
          <div class="mt-2 space-y-1.5">
            <For each={alerts()!.alerts}>
              {(alt) => (
                <div
                  class={`rounded-xl p-2.5 text-xs border flex items-center justify-between gap-3 ${
                    alt.severity === "critical"
                      ? "bg-rose-50 border-rose-200 text-rose-900"
                      : "bg-amber-50 border-amber-200 text-amber-900"
                  }`}
                >
                  <div class="flex items-center gap-2">
                    <span class="font-bold uppercase tracking-wider text-[10px] px-1.5 py-0.5 rounded bg-white/70 border border-current">
                      {alt.severity}
                    </span>
                    <span class="font-medium">{alt.message}</span>
                  </div>
                  <span class="font-mono text-[11px] font-bold shrink-0">
                    {alt.count} affected
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          2. Delivery Records Table & Filters
         ───────────────────────────────────────────────────────────── */}
      <div class="rounded-2xl border border-[#E2DFD8] bg-white p-4 shadow-2xs space-y-3">
        {/* Table Filter Toolbar */}
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
          {/* Status Tabs */}
          <div class="flex items-center gap-1 flex-wrap">
            <For each={["all", "outcome_unknown", "pending", "processing", "delivered", "bounced", "expired"]}>
              {(st) => (
                <button
                  type="button"
                  onClick={() => handleFilterChange(st)}
                  class={`px-2.5 py-1 rounded-full text-[11px] font-medium capitalize transition cursor-pointer ${
                    statusFilter() === st
                      ? st === "outcome_unknown"
                        ? "bg-purple-700 text-white font-bold shadow-2xs"
                        : "bg-[#9E725F] text-white font-semibold shadow-2xs"
                      : st === "outcome_unknown"
                      ? "bg-purple-100 text-purple-900 font-semibold hover:bg-purple-200"
                      : "bg-[#F0EEE9] text-[#55575B] hover:bg-[#E8E5DF]"
                  }`}
                >
                  {st.replace("_", " ")}
                </button>
              )}
            </For>
          </div>

          {/* Search Box */}
          <div class="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search recipient (e.g. user@domain)..."
              value={recipientSearch()}
              onInput={(e) => handleSearchChange(e.currentTarget.value)}
              class="text-xs rounded-xl border border-[#E2DFD8] px-3 py-1.5 bg-[#FBF9F6] text-[#3C3D3E] placeholder-[#878A8E] focus:outline-none focus:ring-1 focus:ring-[#9E725F] w-64 max-w-full"
            />
            <Show when={recipientSearch() || statusFilter() !== "all"}>
              <button
                type="button"
                onClick={() => {
                  setStatusFilter("all");
                  setRecipientSearch("");
                  setPageOffset(0);
                }}
                class="text-xs text-[#9E725F] hover:underline font-semibold cursor-pointer shrink-0"
              >
                Reset
              </button>
            </Show>
          </div>
        </div>

        {/* Table View */}
        <div class="overflow-x-auto custom-scrollbar border border-[#E2DFD8] rounded-xl">
          <table class="w-full text-left border-collapse text-xs">
            <thead>
              <tr class="bg-[#FBF9F6] border-b border-[#E2DFD8] text-[#878A8E] font-bold uppercase tracking-wider text-[10px]">
                <th class="p-2.5">Reference</th>
                <th class="p-2.5">Recipient</th>
                <th class="p-2.5">State</th>
                <th class="p-2.5">SMTP Phase</th>
                <th class="p-2.5">Attempts</th>
                <th class="p-2.5">Updated</th>
                <th class="p-2.5">Lease</th>
                <th class="p-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#E2DFD8]/60 font-mono">
              <Show when={messageList.error}>
                <tr>
                  <td colspan="8" class="p-6 text-center text-rose-700 bg-rose-50/50">
                    Failed to query queue records: {messageList.error?.message}
                  </td>
                </tr>
              </Show>

              <Show when={messageList.loading && !messageList.error}>
                <tr>
                  <td colspan="8" class="p-6 text-center text-[#878A8E]">
                    Loading outbound queue records...
                  </td>
                </tr>
              </Show>

              <For
                each={!messageList.error ? messageList()?.messages : []}
                fallback={
                  <Show when={!messageList.loading && !messageList.error}>
                    <tr>
                      <td colspan="8" class="p-8 text-center text-[#878A8E] font-sans text-xs">
                        No delivery envelopes match current criteria.
                      </td>
                    </tr>
                  </Show>
                }
              >
                {(msg) => (
                  <tr
                    class={`hover:bg-[#FAF9F6] transition-colors ${
                      selectedMessageId() === msg.id ? "bg-[#F2E8E2]/30 font-semibold" : ""
                    }`}
                  >
                    {/* Reference (Delivery ID) */}
                    <td class="p-2.5 font-bold text-[#1A1B1E] truncate max-w-[120px]" title={msg.delivery_id}>
                      {msg.delivery_id.slice(0, 8)}...
                    </td>

                    {/* Recipient */}
                    <td class="p-2.5 font-sans font-medium text-[#3C3D3E] truncate max-w-[180px]" title={msg.recipient}>
                      {msg.recipient}
                    </td>

                    {/* State Badge */}
                    <td class="p-2.5">
                      <span
                        class={`inline-block px-2 py-0.5 rounded-full text-[10px] border capitalize ${getStatusBadgeClass(
                          msg.status
                        )}`}
                      >
                        {msg.status.replace("_", " ")}
                      </span>
                    </td>

                    {/* SMTP Phase */}
                    <td class="p-2.5 text-[11px] text-stone-600 truncate max-w-[130px]" title={msg.smtp_phase || "None"}>
                      {msg.smtp_phase ? (
                        <span class="bg-stone-100 text-stone-700 px-1.5 py-0.5 rounded text-[10px]">
                          {msg.smtp_phase}
                        </span>
                      ) : (
                        <span class="text-stone-400">—</span>
                      )}
                    </td>

                    {/* Attempts */}
                    <td class="p-2.5 text-stone-700 text-[11px]">
                      {msg.attempts} / {msg.max_attempts}
                    </td>

                    {/* Updated */}
                    <td class="p-2.5 text-stone-500 font-sans text-[11px]" title={formatIsoDate(msg.created_at)}>
                      {formatRelativeTime(msg.failed_at || msg.delivered_at || msg.created_at)}
                    </td>

                    {/* Lease Status */}
                    <td class="p-2.5 text-[11px]">
                      <Show
                        when={msg.is_lease_active}
                        fallback={
                          msg.lease_token ? (
                            <span class="text-rose-600 font-sans text-[10px] font-semibold" title="Lease expired">
                              Expired
                            </span>
                          ) : (
                            <span class="text-stone-400">—</span>
                          )
                        }
                      >
                        <span
                          class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-bold"
                          title={`Worker: ${msg.lease_owner || "unknown"}`}
                        >
                          Active
                        </span>
                      </Show>
                    </td>

                    {/* Action */}
                    <td class="p-2.5 text-right font-sans">
                      <button
                        type="button"
                        onClick={() => handleSelectMessage(msg.id, msg.status === "outcome_unknown" ? "reconcile" : "overview")}
                        class={`px-2.5 py-1 text-xs rounded-lg font-semibold transition cursor-pointer shadow-2xs ${
                          msg.status === "outcome_unknown"
                            ? "bg-purple-700 text-white hover:bg-purple-800"
                            : "bg-white border border-[#E2DFD8] text-[#55575B] hover:text-[#1A1B1E] hover:bg-stone-50"
                        }`}
                      >
                        {msg.status === "outcome_unknown" ? "Investigate" : "Details"}
                      </button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div class="flex items-center justify-between text-xs text-[#878A8E] pt-1">
          <span>
            Showing {pageOffset() + 1}–{Math.min(pageOffset() + pageSize(), messageList()?.total || 0)} of{" "}
            {messageList()?.total || 0} messages
          </span>

          <div class="flex items-center gap-2">
            <button
              type="button"
              disabled={pageOffset() === 0}
              onClick={() => setPageOffset((prev) => Math.max(0, prev - pageSize()))}
              class="px-2.5 py-1 rounded-lg border border-[#E2DFD8] bg-white text-[#55575B] hover:bg-stone-50 font-semibold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={pageOffset() + pageSize() >= (messageList()?.total || 0)}
              onClick={() => setPageOffset((prev) => prev + pageSize())}
              class="px-2.5 py-1 rounded-lg border border-[#E2DFD8] bg-white text-[#55575B] hover:bg-stone-50 font-semibold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          3. Message Detail & Investigation Slide-out Panel
         ───────────────────────────────────────────────────────────── */}
      <Show when={selectedMessageId() && messageDetail()}>
        {(det) => {
          const msg = () => det().message;
          const logs = () => det().delivery_logs || [];
          const audits = () => det().audit_trail || [];

          return (
            <div class="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-6 transition-opacity">
              <div class="bg-white rounded-2xl border border-[#E2DFD8] shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
                {/* Modal Header */}
                <div class="p-4 border-b border-[#E2DFD8] flex items-center justify-between gap-3 bg-[#FBF9F6]">
                  <div class="flex items-center gap-3">
                    <div class="flex flex-col">
                      <div class="flex items-center gap-2">
                        <span class="text-sm font-bold text-[#1A1B1E] font-mono">
                          Envelope: {msg().delivery_id}
                        </span>
                        <span
                          class={`px-2 py-0.5 rounded-full text-[10px] font-mono border capitalize ${getStatusBadgeClass(
                            msg().status
                          )}`}
                        >
                          {msg().status.replace("_", " ")}
                        </span>
                      </div>
                      <span class="text-xs text-[#878A8E] font-sans">
                        Recipient: <strong class="text-[#3C3D3E]">{msg().recipient}</strong>
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleCloseDetail}
                    class="p-1.5 rounded-lg text-stone-500 hover:text-stone-800 hover:bg-black/5 cursor-pointer"
                    aria-label="Close modal"
                  >
                    ✕
                  </button>
                </div>

                {/* Subnav Tabs */}
                <div class="flex items-center gap-2 px-4 pt-3 border-b border-[#E2DFD8] bg-white">
                  <button
                    type="button"
                    onClick={() => setActiveActionTab("overview")}
                    class={`pb-2 px-2 text-xs font-semibold border-b-2 cursor-pointer transition ${
                      activeActionTab() === "overview"
                        ? "border-[#9E725F] text-[#9E725F]"
                        : "border-transparent text-stone-500 hover:text-stone-800"
                    }`}
                  >
                    Metadata
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveActionTab("timeline")}
                    class={`pb-2 px-2 text-xs font-semibold border-b-2 cursor-pointer transition ${
                      activeActionTab() === "timeline"
                        ? "border-[#9E725F] text-[#9E725F]"
                        : "border-transparent text-stone-500 hover:text-stone-800"
                    }`}
                  >
                    Attempt History ({logs().length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveActionTab("reconcile")}
                    class={`pb-2 px-2 text-xs font-semibold border-b-2 cursor-pointer transition ${
                      activeActionTab() === "reconcile"
                        ? "border-purple-600 text-purple-700"
                        : msg().status === "outcome_unknown"
                        ? "border-transparent text-purple-700 font-bold hover:text-purple-900"
                        : "border-transparent text-stone-500 hover:text-stone-800"
                    }`}
                  >
                    Investigation & Actions
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveActionTab("audit")}
                    class={`pb-2 px-2 text-xs font-semibold border-b-2 cursor-pointer transition ${
                      activeActionTab() === "audit"
                        ? "border-[#9E725F] text-[#9E725F]"
                        : "border-transparent text-stone-500 hover:text-stone-800"
                    }`}
                  >
                    Audit Trail ({audits().length})
                  </button>
                </div>

                {/* Modal Body */}
                <div class="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
                  {/* TAB 1: METADATA & TELEMETRY */}
                  <Show when={activeActionTab() === "overview"}>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                      {/* Identity & Delivery Context */}
                      <div class="rounded-xl border border-[#E2DFD8] p-3.5 space-y-2 bg-[#FBF9F6]">
                        <h4 class="font-sans font-bold text-stone-800 uppercase tracking-wider text-[11px]">
                          Identity & Scope
                        </h4>
                        <div>
                          <span class="text-stone-400 block text-[10px]">QUEUE ID</span>
                          <span class="text-stone-800 select-all">{msg().id}</span>
                        </div>
                        <div>
                          <span class="text-stone-400 block text-[10px]">DELIVERY ID</span>
                          <span class="text-stone-800 select-all">{msg().delivery_id}</span>
                        </div>
                        <div>
                          <span class="text-stone-400 block text-[10px]">DOMAIN ID</span>
                          <span class="text-stone-800 select-all">{msg().domain_id}</span>
                        </div>
                        <div>
                          <span class="text-stone-400 block text-[10px]">MAILBOX ID</span>
                          <span class="text-stone-800 select-all">{msg().mailbox_id}</span>
                        </div>
                      </div>

                      {/* Scheduling & Execution */}
                      <div class="rounded-xl border border-[#E2DFD8] p-3.5 space-y-2 bg-[#FBF9F6]">
                        <h4 class="font-sans font-bold text-stone-800 uppercase tracking-wider text-[11px]">
                          Lifecycle & Attempts
                        </h4>
                        <div class="grid grid-cols-2 gap-2">
                          <div>
                            <span class="text-stone-400 block text-[10px]">CREATED AT</span>
                            <span class="text-stone-800">{formatIsoDate(msg().created_at)}</span>
                          </div>
                          <div>
                            <span class="text-stone-400 block text-[10px]">EXPIRES AT</span>
                            <span class="text-stone-800">{formatIsoDate(msg().expires_at)}</span>
                          </div>
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                          <div>
                            <span class="text-stone-400 block text-[10px]">ATTEMPTS</span>
                            <span class="text-stone-800 font-bold">{msg().attempts} / {msg().max_attempts}</span>
                          </div>
                          <div>
                            <span class="text-stone-400 block text-[10px]">NEXT ATTEMPT</span>
                            <span class="text-stone-800">{formatIsoDate(msg().next_attempt_at)}</span>
                          </div>
                        </div>
                        <div class="grid grid-cols-2 gap-2 pt-1 border-t border-[#E2DFD8]/60">
                          <div>
                            <span class="text-stone-400 block text-[10px]">MANUAL RETRIES</span>
                            <span class="text-stone-800 font-bold">
                              {msg().manual_retry_count ?? 0} / {msg().max_manual_retries ?? 1}
                            </span>
                          </div>
                          <div>
                            <span class="text-stone-400 block text-[10px]">RETRY ALLOWANCE</span>
                            <span class={`font-bold ${(msg().manual_retry_count ?? 0) >= (msg().max_manual_retries ?? 1) ? "text-rose-600" : "text-emerald-700"}`}>
                              {(msg().manual_retry_count ?? 0) >= (msg().max_manual_retries ?? 1) ? "Budget Exhausted" : "1 Available"}
                            </span>
                          </div>
                        </div>
                        <div>
                          <span class="text-stone-400 block text-[10px]">LAST SMTP CODE / ERROR</span>
                          <span class="text-stone-800">
                            {msg().last_smtp_code ? `${msg().last_smtp_code} - ` : ""}
                            {msg().last_error || "No recorded errors"}
                          </span>
                        </div>
                      </div>

                      {/* Worker Lease Details */}
                      <div class="rounded-xl border border-[#E2DFD8] p-3.5 space-y-2 bg-[#FBF9F6] md:col-span-2">
                        <h4 class="font-sans font-bold text-stone-800 uppercase tracking-wider text-[11px]">
                          Worker Lease & Fencing
                        </h4>
                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <span class="text-stone-400 block text-[10px]">LEASE OWNER</span>
                            <span class="text-stone-800">{msg().lease_owner || "None"}</span>
                          </div>
                          <div>
                            <span class="text-stone-400 block text-[10px]">LEASE TOKEN</span>
                            <span class="text-stone-800 select-all truncate block">
                              {msg().lease_token || "None"}
                            </span>
                          </div>
                          <div>
                            <span class="text-stone-400 block text-[10px]">LEASE EXPIRES</span>
                            <span class="text-stone-800">
                              {msg().lease_expires_at ? formatIsoDate(msg().lease_expires_at) : "None"}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Reconciled Information (if any) */}
                      <Show when={msg().reconciled_at}>
                        <div class="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5 space-y-1 md:col-span-2">
                          <h4 class="font-sans font-bold text-emerald-900 uppercase tracking-wider text-[11px]">
                            Prior Operator Reconciliation
                          </h4>
                          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <div>
                              <span class="text-emerald-700 block text-[10px]">RECONCILED AT</span>
                              <span class="text-emerald-950 font-bold">{formatIsoDate(msg().reconciled_at)}</span>
                            </div>
                            <div>
                              <span class="text-emerald-700 block text-[10px]">RECONCILED BY</span>
                              <span class="text-emerald-950 font-bold">{msg().reconciled_by}</span>
                            </div>
                            <div>
                              <span class="text-emerald-700 block text-[10px]">REASON</span>
                              <span class="text-emerald-950">{msg().reconciliation_reason}</span>
                            </div>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </Show>

                  {/* TAB 2: ATTEMPT HISTORY (DELIVERY LOG) */}
                  <Show when={activeActionTab() === "timeline"}>
                    <div class="space-y-3">
                      <h4 class="text-xs font-bold text-stone-800 uppercase tracking-wider">
                        Chronological Attempt & State Log
                      </h4>
                      <Show
                        when={logs().length > 0}
                        fallback={
                          <div class="py-8 text-center text-xs text-stone-400 font-mono">
                            No delivery attempts logged yet for this envelope.
                          </div>
                        }
                      >
                        <div class="space-y-2">
                          <For each={logs()}>
                            {(l, idx) => (
                              <div class="p-3 rounded-xl border border-[#E2DFD8] bg-[#FBF9F6] text-xs font-mono space-y-1">
                                <div class="flex items-center justify-between text-[11px]">
                                  <div class="flex items-center gap-2">
                                    <span class="font-bold text-stone-700">Attempt #{idx() + 1}</span>
                                    <span
                                      class={`px-2 py-0.2 rounded-full text-[10px] border capitalize ${getStatusBadgeClass(
                                        l.status
                                      )}`}
                                    >
                                      {l.status}
                                    </span>
                                    <Show when={l.smtp_phase}>
                                      <span class="bg-stone-200 text-stone-700 px-1 rounded text-[10px]">
                                        Phase: {l.smtp_phase}
                                      </span>
                                    </Show>
                                  </div>
                                  <span class="text-stone-400">{formatIsoDate(l.attempted_at)}</span>
                                </div>
                                <div class="text-stone-800 pt-1">
                                  {l.smtp_code ? <strong class="text-stone-900">{l.smtp_code}: </strong> : ""}
                                  {l.smtp_message || "No SMTP message recorded"}
                                </div>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  </Show>

                  {/* TAB 3: INVESTIGATION & RECONCILIATION */}
                  <Show when={activeActionTab() === "reconcile"}>
                    <div class="space-y-4">
                      {/* Prominent Warning for outcome_unknown */}
                      <Show when={msg().status === "outcome_unknown"}>
                        <div class="rounded-xl border border-purple-300 bg-purple-50/80 p-4 space-y-2">
                          <div class="flex items-center gap-2 text-purple-900 font-bold text-xs uppercase tracking-wide">
                            <span>⚠</span>
                            <span>Uncertain SMTP Acceptance Boundary</span>
                          </div>
                          <p class="text-xs text-purple-950 font-sans leading-relaxed">
                            The remote mail server's acceptance has not been conclusively established from the available durable evidence. Retrying may result in duplicate delivery.
                          </p>

                          {/* Evidence Classification Card */}
                          <div class="mt-2 pt-2 border-t border-purple-200/70 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono">
                            <div>
                              <span class="text-purple-700 block text-[10px]">LAST SMTP PHASE:</span>
                              <span class="font-bold text-purple-950">{msg().smtp_phase || "None recorded"}</span>
                            </div>
                            <div>
                              <span class="text-purple-700 block text-[10px]">EVIDENCE STATUS:</span>
                              <span class="font-bold text-purple-950">
                                {msg().smtp_phase === "accepted_by_mta"
                                  ? "DURABLE CONFIRMED ACCEPTANCE"
                                  : msg().smtp_phase === "terminator_in_flight"
                                  ? "AMBIGUOUS (Terminator in Flight)"
                                  : "INSUFFICIENT (Pre-Data / Disconnect)"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </Show>

                      {/* Error Alert inside modal */}
                      <Show when={reconcileError()}>
                        <div class="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
                          ✕ {reconcileError()}
                        </div>
                      </Show>

                      {/* Action Selector */}
                      <form onSubmit={handleExecuteReconciliation} class="space-y-4 font-sans text-xs">
                        <div class="space-y-2">
                          <label class="block font-bold text-stone-700 uppercase tracking-wider text-[11px]">
                            Operator Action
                          </label>
                          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <button
                              type="button"
                              onClick={() => setReconcileAction("add_note")}
                              class={`p-2.5 rounded-xl border text-left cursor-pointer transition ${
                                reconcileAction() === "add_note"
                                  ? "bg-stone-800 text-white border-stone-800"
                                  : "bg-[#FBF9F6] border-[#E2DFD8] text-stone-700 hover:bg-stone-100"
                              }`}
                            >
                              <span class="font-bold block text-[11px]">Add Note</span>
                              <span class="text-[10px] opacity-80 block mt-0.5">Audit log only</span>
                            </button>

                            <button
                              type="button"
                              disabled={msg().status !== "outcome_unknown"}
                              onClick={() => setReconcileAction("resolve_accepted")}
                              class={`p-2.5 rounded-xl border text-left cursor-pointer transition disabled:opacity-40 disabled:cursor-not-allowed ${
                                reconcileAction() === "resolve_accepted"
                                  ? "bg-emerald-700 text-white border-emerald-700"
                                  : "bg-[#FBF9F6] border-[#E2DFD8] text-emerald-800 hover:bg-emerald-50"
                              }`}
                            >
                              <span class="font-bold block text-[11px]">Confirm Accepted</span>
                              <span class="text-[10px] opacity-80 block mt-0.5">Requires evidence</span>
                            </button>

                            <button
                              type="button"
                              disabled={msg().status !== "outcome_unknown" || (msg().manual_retry_count ?? 0) >= (msg().max_manual_retries ?? 1)}
                              onClick={() => setReconcileAction("authorize_retry")}
                              class={`p-2.5 rounded-xl border text-left cursor-pointer transition disabled:opacity-40 disabled:cursor-not-allowed ${
                                reconcileAction() === "authorize_retry"
                                  ? "bg-amber-700 text-white border-amber-700"
                                  : "bg-[#FBF9F6] border-[#E2DFD8] text-amber-800 hover:bg-amber-50"
                              }`}
                            >
                              <span class="font-bold block text-[11px]">Authorize Retry</span>
                              <span class="text-[10px] opacity-80 block mt-0.5">
                                {(msg().manual_retry_count ?? 0) >= (msg().max_manual_retries ?? 1)
                                  ? "Limit reached"
                                  : "Retransmit email"}
                              </span>
                            </button>

                            <button
                              type="button"
                              disabled={msg().status !== "outcome_unknown"}
                              onClick={() => setReconcileAction("resolve_bounced")}
                              class={`p-2.5 rounded-xl border text-left cursor-pointer transition disabled:opacity-40 disabled:cursor-not-allowed ${
                                reconcileAction() === "resolve_bounced"
                                  ? "bg-rose-700 text-white border-rose-700"
                                  : "bg-[#FBF9F6] border-[#E2DFD8] text-rose-800 hover:bg-rose-50"
                              }`}
                            >
                              <span class="font-bold block text-[11px]">Mark Bounced</span>
                              <span class="text-[10px] opacity-80 block mt-0.5">Requires bounce proof</span>
                            </button>
                          </div>
                        </div>

                        {/* Retry limit notice if retry is exhausted */}
                        <Show when={(msg().manual_retry_count ?? 0) >= (msg().max_manual_retries ?? 1)}>
                          <div class="p-3 rounded-xl border border-stone-300 bg-stone-100 text-stone-700 text-xs">
                            <strong>Manual Retry Limit Reached:</strong> This message has consumed its allowed operator retry budget ({msg().manual_retry_count ?? 0} of {msg().max_manual_retries ?? 1}). Additional retries cannot be authorized.
                          </div>
                        </Show>

                        {/* Additional fields for resolve_accepted, authorize_retry, and resolve_bounced */}
                        <Show when={reconcileAction() === "resolve_accepted" || reconcileAction() === "authorize_retry" || reconcileAction() === "resolve_bounced"}>
                          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl border border-stone-200 bg-[#FBF9F6]">
                            <div>
                              <label class="block text-[11px] font-bold text-stone-700 mb-1 uppercase tracking-wide">
                                Evidence Category *
                              </label>
                              <select
                                value={evidenceCategory()}
                                onChange={(e) => setEvidenceCategory(e.currentTarget.value)}
                                class="w-full text-xs rounded-xl border border-[#E2DFD8] px-3 py-2 bg-white text-stone-800 focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                              >
                                <option value="">Select Category...</option>
                                <Show
                                  when={reconcileAction() === "resolve_bounced"}
                                  fallback={
                                    <>
                                      <option value="mta_log_receipt">MTA Log Receipt</option>
                                      <option value="postmaster_confirmation">Postmaster Confirmation</option>
                                      <option value="recipient_inbound_log">Recipient Inbound Log</option>
                                      <option value="trace_absence_verification">Trace Absence Verification</option>
                                      <option value="manual_investigation_evidence">Manual Investigation Evidence</option>
                                    </>
                                  }
                                >
                                  <option value="smtp_5xx_rejection">Permanent SMTP 5xx Rejection</option>
                                  <option value="dsn_bounce_report">DSN Bounce Report / NDR</option>
                                  <option value="mta_rejection_log">Remote MTA Rejection Log</option>
                                  <option value="operator_verified_ndr">Operator-Verified Bounce Record</option>
                                </Show>
                              </select>
                            </div>

                            <div>
                              <label class="block text-[11px] font-bold text-stone-700 mb-1 uppercase tracking-wide">
                                Evidence Reference *
                              </label>
                              <input
                                type="text"
                                placeholder={
                                  reconcileAction() === "resolve_bounced"
                                    ? "e.g. SMTP 550 User Unknown, NDR Ticket #912, DSN ID"
                                    : "e.g. Queue ID 4X9kL01, Ticket #1024, MX Log Ref"
                                }
                                value={evidenceReference()}
                                onInput={(e) => setEvidenceReference(e.currentTarget.value)}
                                class="w-full text-xs rounded-xl border border-[#E2DFD8] px-3 py-2 bg-white text-stone-800 focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                              />
                            </div>
                            <div class="sm:col-span-2 text-[11px] text-stone-500 bg-stone-50 p-2.5 rounded-xl border border-stone-200">
                              <em>External evidence reference supplied by an authorized operator. BYOS has not independently verified the referenced external record.</em>
                            </div>
                          </div>
                        </Show>

                        {/* Explicit Duplicate Risk Acknowledgment for authorize_retry */}
                        <Show when={reconcileAction() === "authorize_retry"}>
                          <div class="p-3.5 rounded-xl border border-amber-300 bg-amber-50 space-y-2.5">
                            <div class="flex items-start gap-2 text-amber-900 font-bold text-xs">
                              <span>⚠</span>
                              <span>The original message may already have been accepted by the remote mail server. Retrying could result in duplicate delivery.</span>
                            </div>
                            <label class="flex items-start gap-2.5 cursor-pointer select-none pt-1 border-t border-amber-200">
                              <input
                                type="checkbox"
                                checked={duplicateRiskAck()}
                                onChange={(e) => setDuplicateRiskAck(e.currentTarget.checked)}
                                class="mt-0.5 rounded text-amber-600 focus:ring-amber-500 cursor-pointer"
                              />
                              <span class="text-xs text-amber-950 font-medium leading-relaxed">
                                <strong>Duplicate Delivery Acknowledgment:</strong> I understand that retransmitting an email whose remote acceptance was not durably confirmed carries the risk of sending a duplicate copy to the recipient. I have verified that retransmission is authorized and justified.
                              </span>
                            </label>
                          </div>
                        </Show>

                        {/* Mandatory Written Operator Reason */}
                        <div class="space-y-1">
                          <label class="block font-bold text-stone-700 uppercase tracking-wider text-[11px]">
                            Written Operator Justification *
                          </label>
                          <textarea
                            rows={3}
                            placeholder="Enter the factual basis and detailed justification for this action..."
                            value={operatorReason()}
                            onInput={(e) => setOperatorReason(e.currentTarget.value)}
                            class="w-full text-xs rounded-xl border border-[#E2DFD8] p-3 bg-white text-stone-800 focus:outline-none focus:ring-1 focus:ring-[#9E725F] leading-relaxed"
                          />
                        </div>

                        {/* Submit Button */}
                        <div class="flex items-center justify-end gap-2 pt-2 border-t border-[#E2DFD8]">
                          <button
                            type="button"
                            onClick={handleCloseDetail}
                            class="px-4 py-2 text-xs rounded-xl border border-[#E2DFD8] bg-white text-stone-600 hover:bg-stone-50 font-semibold cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={isSubmittingReconciliation()}
                            class={`px-4 py-2 text-xs rounded-xl font-bold shadow-2xs transition-colors cursor-pointer disabled:opacity-50 ${
                              reconcileAction() === "resolve_accepted"
                                ? "bg-emerald-700 hover:bg-emerald-800 text-white"
                                : reconcileAction() === "authorize_retry"
                                ? "bg-amber-700 hover:bg-amber-800 text-white"
                                : reconcileAction() === "resolve_bounced"
                                ? "bg-rose-700 hover:bg-rose-800 text-white"
                                : "bg-stone-800 hover:bg-stone-900 text-white"
                            }`}
                          >
                            {isSubmittingReconciliation()
                              ? "Applying..."
                              : reconcileAction() === "resolve_accepted"
                              ? "Confirm Acceptance & Transition to Delivered"
                              : reconcileAction() === "authorize_retry"
                              ? "Authorize Retransmission"
                              : reconcileAction() === "resolve_bounced"
                              ? "Resolve as Bounced"
                              : "Record Investigation Note"}
                          </button>
                        </div>
                      </form>
                    </div>
                  </Show>

                  {/* TAB 4: AUDIT TRAIL */}
                  <Show when={activeActionTab() === "audit"}>
                    <div class="space-y-3">
                      <h4 class="text-xs font-bold text-stone-800 uppercase tracking-wider">
                        Immutable Operator Audit History
                      </h4>
                      <Show
                        when={audits().length > 0}
                        fallback={
                          <div class="py-8 text-center text-xs text-stone-400 font-mono">
                            No operator actions have been performed on this envelope.
                          </div>
                        }
                      >
                        <div class="space-y-2">
                          <For each={audits()}>
                            {(a) => (
                              <div class="p-3 rounded-xl border border-[#E2DFD8] bg-[#FBF9F6] text-xs font-mono space-y-1.5">
                                <div class="flex items-center justify-between text-[11px]">
                                  <div class="flex items-center gap-2">
                                    <span class="font-bold text-stone-900 px-1.5 py-0.2 rounded bg-stone-200">
                                      {a.action}
                                    </span>
                                    <span class="text-stone-500 font-sans">
                                      by <strong>{a.actor_email}</strong> ({a.actor_role})
                                    </span>
                                  </div>
                                  <span class="text-stone-400">{formatIsoDate(a.created_at)}</span>
                                </div>
                                <div class="text-stone-700 text-[11px] font-sans">
                                  <strong>Transition:</strong> {a.previous_status} ➔ {a.resulting_status}
                                </div>
                                <div class="text-stone-800 font-sans text-xs bg-white p-2 rounded-lg border border-[#E2DFD8]/60">
                                  {a.operator_reason}
                                </div>
                                <Show when={a.evidence_category || a.evidence_reference}>
                                  <div class="text-stone-500 text-[10px] flex items-center gap-2">
                                    <span>Category: <strong>{a.evidence_category || "None"}</strong></span>
                                    <span>•</span>
                                    <span>Ref: <strong class="select-all">{a.evidence_reference || "None"}</strong></span>
                                  </div>
                                </Show>
                                <div class="flex flex-wrap items-center gap-2 pt-1 text-[10px]">
                                  <span class={`px-2 py-0.5 rounded font-mono font-bold ${
                                    a.evidence_provenance === "independent_verified"
                                      ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                      : "bg-amber-100 text-amber-900 border border-amber-200"
                                  }`}>
                                    Provenance: {a.evidence_provenance === "independent_verified" ? "Independently Verified" : "Operator-attested external evidence (unverified by BYOS)"}
                                  </span>
                                  <Show when={a.idempotency_key}>
                                    <span class="text-stone-400 font-mono" title={a.idempotency_key}>
                                      Key: {a.idempotency_key!.slice(0, 8)}...
                                    </span>
                                  </Show>
                                  <Show when={a.request_fingerprint}>
                                    <span class="text-stone-400 font-mono" title={a.request_fingerprint}>
                                      Fingerprint: {a.request_fingerprint!.slice(0, 10)}...
                                    </span>
                                  </Show>
                                </div>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          );
        }}
      </Show>
    </div>
  );
};
