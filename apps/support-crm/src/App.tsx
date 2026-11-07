import { type Component, createSignal, createResource, createEffect, onMount, onCleanup, Show, For, ErrorBoundary } from "solid-js";
import {
  getOrganizations,
  suspendOrganization,
  updateCapacity,
  getAuditLogs,
  suspendCustomer,
  fetchTickets,
  fetchTicketDetail,
  updateTicketStatus,
  updateTicketPriority,
  assignTicketAgent,
  sendTicketReply,
  recordAgentTyping,
  fetchSupportAgents,
  fetchSupportStats,
  logoutAdmin,
  type Organization,
  type AuditLogEntry,
  type TicketListItem,
  type TicketDetailResponse,
  type SupportAgent,
  type SupportStats,
} from "./lib/api";

type NavTab = "tickets" | "organizations" | "audit_logs";

export const App: Component = () => {
  const [currentTab, setCurrentTab] = createSignal<NavTab>("tickets");
  const [globalSearch, setGlobalSearch] = createSignal("");
  const [actionNotification, setActionNotification] = createSignal<{
    type: "success" | "error";
    message: string;
    auditId?: string;
  } | null>(null);

  // Morphing sliding highlight pill for sidebar navigation (matching Webmail & Dashboard architecture)
  const [navPillStyle, setNavPillStyle] = createSignal<{ top: number; height: number; opacity: number }>({
    top: 0,
    height: 0,
    opacity: 0,
  });
  const navRefs = new Map<string, HTMLElement>();
  let navContainerRef: HTMLElement | undefined;

  const updateNavPill = () => {
    const key = currentTab();
    const el = navRefs.get(key);
    const container = navContainerRef;
    if (el && container) {
      const elRect = el.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      setNavPillStyle({
        top: elRect.top - containerRect.top,
        height: elRect.height,
        opacity: 1,
      });
    } else if (el) {
      setNavPillStyle({
        top: el.offsetTop,
        height: el.offsetHeight,
        opacity: 1,
      });
    } else {
      setNavPillStyle((prev) => ({ ...prev, opacity: 0 }));
    }
  };

  createEffect(() => {
    currentTab();
    requestAnimationFrame(() => updateNavPill());
  });

  onMount(() => {
    setTimeout(updateNavPill, 40);
    setTimeout(updateNavPill, 150);
    window.addEventListener("resize", updateNavPill);
    onCleanup(() => window.removeEventListener("resize", updateNavPill));
  });

  // Resources
  const [organizations, { refetch: refetchOrgs, mutate: mutateOrgs }] = createResource<Organization[]>(getOrganizations);
  const [auditLogs, { refetch: refetchAuditLogs, mutate: mutateAuditLogs }] = createResource<AuditLogEntry[]>(getAuditLogs);
  const [supportStats, { refetch: refetchStats, mutate: mutateStats }] = createResource<SupportStats>(fetchSupportStats);
  const [supportAgents] = createResource<SupportAgent[]>(fetchSupportAgents);

  // Tickets Filter & State
  const [ticketSearch, setTicketSearch] = createSignal("");
  const [ticketStatusFilter, setTicketStatusFilter] = createSignal<string>("all");
  const [ticketPriorityFilter, setTicketPriorityFilter] = createSignal<string>("all");
  const [selectedTicketId, setSelectedTicketId] = createSignal<string | null>(null);
  const [ticketOrgFilter, setTicketOrgFilter] = createSignal<string | null>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = createSignal(false);

  // Active Ticket Detail Resource
  const [activeTicketDetail, { refetch: refetchActiveDetail, mutate: mutateActiveDetail }] = createResource(
    selectedTicketId,
    async (id) => {
      if (!id) return null;
      return fetchTicketDetail(id);
    }
  );

  // Tickets List Resource
  const [tickets, { refetch: refetchTickets, mutate: mutateTickets }] = createResource(
    () => ({
      status: ticketStatusFilter() === "all" ? undefined : ticketStatusFilter(),
      priority: ticketPriorityFilter() === "all" ? undefined : ticketPriorityFilter(),
      search: ticketSearch().trim() || undefined,
      orgId: ticketOrgFilter() || undefined,
    }),
    async (params) => {
      return fetchTickets({
        status: params.status,
        priority: params.priority,
        search: params.search,
        org_id: params.orgId,
      });
    }
  );

  // Ticket Composer State
  const [ticketComposerVisibility, setTicketComposerVisibility] = createSignal<"public" | "internal">("public");
  const [ticketComposerBody, setTicketComposerBody] = createSignal("");
  const [isSubmittingMessage, setIsSubmittingMessage] = createSignal(false);
  const [isUpdatingTicketStatus, setIsUpdatingTicketStatus] = createSignal(false);
  const [isSuspendingCustomer, setIsSuspendingCustomer] = createSignal(false);

  // Capacity Modal State (Bounded & Compact, never breaks viewport)
  const [selectedOrgForCapacity, setSelectedOrgForCapacity] = createSignal<Organization | null>(null);
  const [adjustedSeats, setAdjustedSeats] = createSignal<number>(10);
  const [capacityReason, setCapacityReason] = createSignal<string>("");
  const [isUpdatingCapacity, setIsUpdatingCapacity] = createSignal(false);

  // Customer Suspend Confirmation Modal State
  const [customerToSuspend, setCustomerToSuspend] = createSignal<{
    userId: string;
    email: string;
    currentStatus: string;
  } | null>(null);
  const [suspendReason, setSuspendReason] = createSignal<string>("");

  // Audit Log Inspector Modal State
  const [selectedAuditLog, setSelectedAuditLog] = createSignal<AuditLogEntry | null>(null);
  const [auditSearch, setAuditSearch] = createSignal("");
  const [auditActionFilter, setAuditActionFilter] = createSignal<string>("all");

  // Organizations Table State
  const [orgSearch, setOrgSearch] = createSignal("");
  const [orgStatusFilter, setOrgStatusFilter] = createSignal<string>("all");
  const [openDropdownId, setOpenDropdownId] = createSignal<string | null>(null);

  // Close dropdown on outside click
  onMount(() => {
    const handleDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".action-menu-container")) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener("click", handleDocClick);
    onCleanup(() => document.removeEventListener("click", handleDocClick));
  });

  // Background Auto-Polling (Silent mutate synchronization)
  let pollTimer: number | undefined;
  onMount(() => {
    pollTimer = window.setInterval(async () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        try {
          const currentId = selectedTicketId();
          if (currentId) {
            const detail = await fetchTicketDetail(currentId);
            if (detail && selectedTicketId() === currentId) {
              mutateActiveDetail(detail);
            }
          }
          const [tList, stats, sOrgs] = await Promise.all([
            fetchTickets({
              status: ticketStatusFilter() === "all" ? undefined : ticketStatusFilter(),
              priority: ticketPriorityFilter() === "all" ? undefined : ticketPriorityFilter(),
              search: ticketSearch().trim() || undefined,
              org_id: ticketOrgFilter() || undefined,
            }),
            fetchSupportStats(),
            getOrganizations(),
          ]);
          if (tList) mutateTickets(tList);
          if (stats) mutateStats(stats);
          if (sOrgs) mutateOrgs(sOrgs);
        } catch {
          // Silent polling sync
        }
      }
    }, 8000);

    onCleanup(() => {
      if (pollTimer) clearInterval(pollTimer);
    });
  });

  // Typing Beacon
  let lastAgentTypingSent = 0;
  const notifyAgentTyping = (ticketId: string | null) => {
    if (!ticketId) return;
    const now = Date.now();
    if (now - lastAgentTypingSent > 2000) {
      lastAgentTypingSent = now;
      recordAgentTyping(ticketId);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Action Handlers
  // ─────────────────────────────────────────────────────────────

  // Suspend / Reactivate an Organization (cascades to all users/mailboxes)
  const handleToggleSuspendOrg = async (org: Organization) => {
    setOpenDropdownId(null);
    const targetStatus = org.status === "suspended" ? "active" : "suspended";
    const prevStatus = org.status;

    mutateOrgs((prev) =>
      prev?.map((o) => (o.id === org.id ? { ...o, status: targetStatus } : o))
    );

    try {
      const res = await suspendOrganization(
        org.id,
        targetStatus,
        `Admin operator toggled organization status to ${targetStatus}`
      );
      await refetchAuditLogs();
      await refetchOrgs();
      setActionNotification({
        type: "success",
        message: `Organization ${org.name} set to ${targetStatus}. Immutable Audit ID: ${res.audit_id}`,
        auditId: res.audit_id,
      });
      setTimeout(() => setActionNotification(null), 6000);
    } catch (err: any) {
      mutateOrgs((prev) =>
        prev?.map((o) => (o.id === org.id ? { ...o, status: prevStatus } : o))
      );
      setActionNotification({
        type: "error",
        message: err.message || "Failed to update organization status",
      });
      setTimeout(() => setActionNotification(null), 6000);
    }
  };

  // Adjust Allocated Capacity (Compact & Bounded)
  const handleConfirmCapacityUpdate = async () => {
    const org = selectedOrgForCapacity();
    if (!org) return;

    setIsUpdatingCapacity(true);
    const newSeats = adjustedSeats();
    const reason = capacityReason().trim() || `Admin adjusted capacity to ${newSeats} mailboxes`;

    try {
      const res = await updateCapacity(org.id, newSeats, reason);
      setSelectedOrgForCapacity(null);
      setCapacityReason("");
      await refetchOrgs();
      await refetchAuditLogs();

      setActionNotification({
        type: "success",
        message: `Capacity updated to ${newSeats} mailboxes for ${org.name}. Immutable Audit ID: ${res.audit_id}`,
        auditId: res.audit_id,
      });
      setTimeout(() => setActionNotification(null), 6000);
    } catch (err: any) {
      setActionNotification({
        type: "error",
        message: err.message || "Failed to adjust organization capacity",
      });
      setTimeout(() => setActionNotification(null), 6000);
    } finally {
      setIsUpdatingCapacity(false);
    }
  };

  // Suspend / Reactivate an Individual Customer Account (from Ticket Context)
  const handleToggleCustomerAccount = async () => {
    const target = customerToSuspend();
    if (!target) return;

    setIsSuspendingCustomer(true);
    const targetStatus = target.currentStatus === "suspended" ? "active" : "suspended";
    const reason = suspendReason().trim() || `Operator set customer account to ${targetStatus}`;

    try {
      const res = await suspendCustomer(target.userId, targetStatus, reason);
      setCustomerToSuspend(null);
      setSuspendReason("");

      // Update active ticket detail optimistically
      const current = activeTicketDetail();
      if (current) {
        mutateActiveDetail({
          ...current,
          customer: {
            ...current.customer,
            account_status: targetStatus,
          },
        });
      }

      await refetchActiveDetail();
      await refetchAuditLogs();
      await refetchOrgs();

      setActionNotification({
        type: "success",
        message: `Customer ${target.email} account set to ${targetStatus}. Immutable Audit ID: ${res.audit_id}`,
        auditId: res.audit_id,
      });
      setTimeout(() => setActionNotification(null), 6000);
    } catch (err: any) {
      setActionNotification({
        type: "error",
        message: err.message || "Failed to update customer account status",
      });
      setTimeout(() => setActionNotification(null), 6000);
    } finally {
      setIsSuspendingCustomer(false);
    }
  };

  // Ticket Status Update
  const handleUpdateTicketStatus = async (ticketId: string, newStatus: string) => {
    setIsUpdatingTicketStatus(true);
    try {
      await updateTicketStatus(ticketId, newStatus);
      await Promise.all([refetchActiveDetail(), refetchTickets(), refetchStats(), refetchAuditLogs()]);
      setActionNotification({
        type: "success",
        message: `Ticket status updated to '${newStatus}'.`,
      });
      setTimeout(() => setActionNotification(null), 4000);
    } catch (err: any) {
      setActionNotification({
        type: "error",
        message: err.message || "Failed to update ticket status",
      });
      setTimeout(() => setActionNotification(null), 5000);
    } finally {
      setIsUpdatingTicketStatus(false);
    }
  };

  // Ticket Priority Update
  const handleUpdateTicketPriority = async (ticketId: string, newPriority: string) => {
    try {
      await updateTicketPriority(ticketId, newPriority);
      await Promise.all([refetchActiveDetail(), refetchTickets(), refetchStats()]);
    } catch (err: any) {
      setActionNotification({
        type: "error",
        message: err.message || "Failed to update priority",
      });
      setTimeout(() => setActionNotification(null), 5000);
    }
  };

  // Ticket Agent Assignment
  const handleAssignAgent = async (ticketId: string, agentId: string | null) => {
    try {
      await assignTicketAgent(ticketId, agentId);
      await Promise.all([refetchActiveDetail(), refetchTickets(), refetchStats(), refetchAuditLogs()]);
    } catch (err: any) {
      setActionNotification({
        type: "error",
        message: err.message || "Failed to assign agent",
      });
      setTimeout(() => setActionNotification(null), 5000);
    }
  };

  // Ticket Composer Submit
  const handleSendTicketMessage = async (e: Event) => {
    e.preventDefault();
    const ticketId = selectedTicketId();
    const body = ticketComposerBody().trim();
    if (!ticketId || !body) return;

    setIsSubmittingMessage(true);
    const visibility = ticketComposerVisibility();

    try {
      await sendTicketReply({
        ticketId,
        body,
        visibility,
        authorName: "Sarah Chen (Tier 2)",
        authorId: "11111111-2222-3333-4444-555555555501",
      });
      setTicketComposerBody("");
      await Promise.all([refetchActiveDetail(), refetchTickets(), refetchStats(), refetchAuditLogs()]);
      setActionNotification({
        type: "success",
        message: visibility === "internal" ? "Internal staff note recorded to audit trail." : "Public reply sent to customer.",
      });
      setTimeout(() => setActionNotification(null), 4000);
    } catch (err: any) {
      setActionNotification({
        type: "error",
        message: err.message || "Failed to send message",
      });
      setTimeout(() => setActionNotification(null), 5000);
    } finally {
      setIsSubmittingMessage(false);
    }
  };

  // Filtered Organizations
  const filteredOrgs = () => {
    let list = (!organizations.error ? organizations() : []) || [];
    const query = orgSearch().toLowerCase().trim();
    if (query) {
      list = list.filter((o) => o.name.toLowerCase().includes(query) || o.id.toLowerCase().includes(query));
    }
    const st = orgStatusFilter();
    if (st !== "all") {
      list = list.filter((o) => o.status === st);
    }
    return list;
  };

  // Filtered Audit Logs
  const filteredAuditLogs = () => {
    let list = (!auditLogs.error ? auditLogs() : []) || [];
    const query = auditSearch().toLowerCase().trim();
    if (query) {
      list = list.filter(
        (e) =>
          e.action.toLowerCase().includes(query) ||
          (e.target_name && e.target_name.toLowerCase().includes(query)) ||
          e.target_uuid.toLowerCase().includes(query) ||
          (e.actor_name && e.actor_name.toLowerCase().includes(query)) ||
          (e.metadata && JSON.stringify(e.metadata).toLowerCase().includes(query))
      );
    }
    const act = auditActionFilter();
    if (act !== "all") {
      list = list.filter((e) => e.action.includes(act));
    }
    return list;
  };

  // Format Relative Time
  const formatTimeAgo = (iso: string) => {
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

  return (
    <div class="h-screen flex bg-[#F0EEE9] text-[#3C3D3E] overflow-hidden p-2 sm:p-3 gap-2 sm:gap-3 select-none">
      {/* ─────────────────────────────────────────────────────────────
          Mobile Navigation Drawer with Backdrop
         ───────────────────────────────────────────────────────────── */}
      <Show when={mobileDrawerOpen()}>
        <div
          class="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 md:hidden transition-opacity"
          onClick={() => setMobileDrawerOpen(false)}
          aria-hidden="true"
        />
        <div class="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-[#F0EEE9] z-50 md:hidden shadow-2xl flex flex-col p-4 transition-transform duration-200">
          <div class="flex items-center justify-between pb-3 border-b border-[#E2DFD8]">
            <div class="flex items-center gap-2">
              <div
                class="w-7 h-7 rounded-xl bg-gradient-to-b from-[#A27561] via-[#986A57] to-[#8E6351] flex items-center justify-center text-white font-bold text-xs shadow-2xs tracking-wider"
              >
                B
              </div>
              <div class="flex flex-col">
                <span class="text-sm font-semibold text-[#1A1B1E] tracking-tight">BYOS Support CRM</span>
                <span class="text-[9px] font-mono uppercase tracking-widest text-[#9E725F] font-semibold">Staff Console</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(false)}
              class="p-1 rounded-lg text-stone-500 hover:text-stone-800 hover:bg-black/5 cursor-pointer"
              aria-label="Close menu"
            >
              <svg class="w-5 h-5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div class="pt-3 pb-1 text-[11px] font-bold tracking-wider uppercase text-[#878A8E]">
            Console Desk
          </div>

          <nav class="mt-1 space-y-1.5 flex-1 overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                setTicketOrgFilter(null);
                setCurrentTab("tickets");
                setMobileDrawerOpen(false);
              }}
              class={`w-full flex items-center justify-between rounded-xl text-sm font-medium px-3 py-2.5 transition cursor-pointer ${
                currentTab() === "tickets"
                  ? "bg-[#9E725F] text-white font-semibold shadow-xs"
                  : "text-[#55575B] hover:bg-black/5"
              }`}
            >
              <div class="flex items-center gap-2.5">
                <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="10" r="0.8" fill="currentColor" />
                  <circle cx="8" cy="10" r="0.8" fill="currentColor" />
                  <circle cx="16" cy="10" r="0.8" fill="currentColor" />
                </svg>
                <span>Support Tickets</span>
              </div>
              <span
                class={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold ${
                  currentTab() === "tickets" ? "bg-white/20 text-white" : "bg-[#F2E8E2] text-[#9E725F]"
                }`}
              >
                {supportStats()?.open_tickets ?? (!tickets.error ? (tickets()?.length || 0) : 0)}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setCurrentTab("organizations");
                setMobileDrawerOpen(false);
              }}
              class={`w-full flex items-center justify-between rounded-xl text-sm font-medium px-3 py-2.5 transition cursor-pointer ${
                currentTab() === "organizations"
                  ? "bg-[#9E725F] text-white font-semibold shadow-xs"
                  : "text-[#55575B] hover:bg-black/5"
              }`}
            >
              <div class="flex items-center gap-2.5">
                <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                  <rect x="3" y="3" width="7" height="9" rx="1.5" />
                  <rect x="14" y="3" width="7" height="5" rx="1.5" />
                  <rect x="14" y="12" width="7" height="9" rx="1.5" />
                  <rect x="3" y="16" width="7" height="5" rx="1.5" />
                </svg>
                <span>Organizations</span>
              </div>
              <span
                class={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold ${
                  currentTab() === "organizations" ? "bg-white/20 text-white" : "bg-black/5 text-[#55575B]"
                }`}
              >
                {(!organizations.error ? organizations() : [])?.length || 0}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setCurrentTab("audit_logs");
                setMobileDrawerOpen(false);
              }}
              class={`w-full flex items-center justify-between rounded-xl text-sm font-medium px-3 py-2.5 transition cursor-pointer ${
                currentTab() === "audit_logs"
                  ? "bg-[#9E725F] text-white font-semibold shadow-xs"
                  : "text-[#55575B] hover:bg-black/5"
              }`}
            >
              <div class="flex items-center gap-2.5">
                <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                <span>Audit Logs</span>
              </div>
              <span
                class={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold ${
                  currentTab() === "audit_logs" ? "bg-white/20 text-white" : "bg-black/5 text-[#55575B]"
                }`}
              >
                {(!auditLogs.error ? auditLogs() : [])?.length || 0}
              </span>
            </button>
          </nav>

          <div class="mt-auto pt-3 border-t border-[#E2DFD8]">
            <div class="flex items-center justify-between text-xs text-[#55575B]">
              <span class="font-medium truncate max-w-[150px]">sarah.support@byos.local</span>
              <button
                type="button"
                onClick={async () => {
                  try { await logoutAdmin(); } catch {}
                  window.location.reload();
                }}
                class="text-xs text-rose-600 hover:underline font-semibold cursor-pointer"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* ─────────────────────────────────────────────────────────────
          1. Desktop Navigation Sidebar (Unified Canvas Architecture)
         ───────────────────────────────────────────────────────────── */}
      <aside
        aria-label="Support CRM navigation"
        class="hidden md:flex shrink-0 bg-[#F0EEE9] flex-col justify-between w-64 px-1.5 pt-0 pb-0 h-full"
      >
        <div class="space-y-3 flex-1 min-h-0 overflow-y-auto custom-scrollbar px-1">
          {/* Brand Header */}
          <div class="flex items-center h-12 min-h-[48px] justify-between px-1">
            <div class="flex items-center gap-2">
              <div
                class="w-6 h-6 rounded-xl bg-gradient-to-b from-[#A27561] via-[#986A57] to-[#8E6351] flex items-center justify-center text-white font-bold text-xs shadow-2xs tracking-wider ring-1 ring-[#A27561]/30 shrink-0"
                title="BYOS Support CRM"
              >
                B
              </div>
              <div class="flex flex-col min-w-0">
                <span class="text-sm font-semibold text-[#1A1B1E] tracking-tight truncate">
                  BYOS Support CRM
                </span>
                <span class="text-[9px] font-mono uppercase tracking-widest text-[#9E725F] font-semibold truncate leading-none">
                  Staff Console
                </span>
              </div>
            </div>
          </div>

          {/* Section Label */}
          <div class="pt-2 px-2 text-[11px] font-bold tracking-wider uppercase text-[#878A8E]">
            Console Desk
          </div>

          {/* Nav List with Morphing Highlight Pill */}
          <nav
            ref={(el) => (navContainerRef = el)}
            aria-label="Support Menu"
            class="relative"
          >
            {/* Sliding Morphing Highlight Pill */}
            <div
              data-testid="sidebar-nav-pill"
              class="absolute left-0 right-0 rounded-xl bg-gradient-to-r from-[#9E725F] to-[#8E6351] shadow-xs pointer-events-none transition-all duration-250 ease-[cubic-bezier(0.2,0,0,1)] z-0"
              style={{
                top: `${navPillStyle().top}px`,
                height: `${navPillStyle().height}px`,
                opacity: navPillStyle().opacity,
              }}
            />

            <ul class="space-y-1 relative z-10">
              {/* Tab 1: Support Tickets */}
              <li>
                <button
                  type="button"
                  ref={(el) => {
                    if (el) {
                      navRefs.set("tickets", el);
                      if (currentTab() === "tickets") updateNavPill();
                    }
                  }}
                  onClick={() => {
                    setTicketOrgFilter(null);
                    setCurrentTab("tickets");
                  }}
                  class={`relative z-10 w-full flex items-center justify-between rounded-xl text-[13px] font-medium transition-colors duration-150 px-3 py-2 cursor-pointer focus:outline-none ${
                    currentTab() === "tickets"
                      ? "text-white font-semibold"
                      : "text-[#55575B] hover:bg-black/5 hover:text-[#1A1B1E]"
                  }`}
                >
                  <div class="flex items-center gap-2.5">
                    <svg class="w-4 h-4 shrink-0 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="10" r="0.8" fill="currentColor" />
                      <circle cx="8" cy="10" r="0.8" fill="currentColor" />
                      <circle cx="16" cy="10" r="0.8" fill="currentColor" />
                    </svg>
                    <span>Support Tickets</span>
                  </div>
                  <span
                    class={`text-[10px] font-mono px-1.5 py-0.2 rounded-md font-bold ${
                      currentTab() === "tickets"
                        ? "bg-white/20 text-white"
                        : "bg-[#F2E8E2] text-[#9E725F]"
                    }`}
                  >
                    {supportStats()?.open_tickets ?? (!tickets.error ? (tickets()?.length || 0) : 0)}
                  </span>
                </button>
              </li>

              {/* Tab 2: Organizations */}
              <li>
                <button
                  type="button"
                  ref={(el) => {
                    if (el) {
                      navRefs.set("organizations", el);
                      if (currentTab() === "organizations") updateNavPill();
                    }
                  }}
                  onClick={() => setCurrentTab("organizations")}
                  class={`relative z-10 w-full flex items-center justify-between rounded-xl text-[13px] font-medium transition-colors duration-150 px-3 py-2 cursor-pointer focus:outline-none ${
                    currentTab() === "organizations"
                      ? "text-white font-semibold"
                      : "text-[#55575B] hover:bg-black/5 hover:text-[#1A1B1E]"
                  }`}
                >
                  <div class="flex items-center gap-2.5">
                    <svg class="w-4 h-4 shrink-0 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                      <rect x="3" y="3" width="7" height="9" rx="1.5" />
                      <rect x="14" y="3" width="7" height="5" rx="1.5" />
                      <rect x="14" y="12" width="7" height="9" rx="1.5" />
                      <rect x="3" y="16" width="7" height="5" rx="1.5" />
                    </svg>
                    <span>Organizations</span>
                  </div>
                  <span
                    class={`text-[10px] font-mono px-1.5 py-0.2 rounded-md font-bold ${
                      currentTab() === "organizations"
                        ? "bg-white/20 text-white"
                        : "bg-black/5 text-[#55575B]"
                    }`}
                  >
                    {(!organizations.error ? organizations() : [])?.length || 0}
                  </span>
                </button>
              </li>

              {/* Tab 3: Audit Logs */}
              <li>
                <button
                  type="button"
                  ref={(el) => {
                    if (el) {
                      navRefs.set("audit_logs", el);
                      if (currentTab() === "audit_logs") updateNavPill();
                    }
                  }}
                  onClick={() => setCurrentTab("audit_logs")}
                  class={`relative z-10 w-full flex items-center justify-between rounded-xl text-[13px] font-medium transition-colors duration-150 px-3 py-2 cursor-pointer focus:outline-none ${
                    currentTab() === "audit_logs"
                      ? "text-white font-semibold"
                      : "text-[#55575B] hover:bg-black/5 hover:text-[#1A1B1E]"
                  }`}
                >
                  <div class="flex items-center gap-2.5">
                    <svg class="w-4 h-4 shrink-0 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                    <span>Audit Logs</span>
                  </div>
                  <span
                    class={`text-[10px] font-mono px-1.5 py-0.2 rounded-md font-bold ${
                      currentTab() === "audit_logs"
                        ? "bg-white/20 text-white"
                        : "bg-black/5 text-[#55575B]"
                    }`}
                  >
                    {(!auditLogs.error ? auditLogs() : [])?.length || 0}
                  </span>
                </button>
              </li>
            </ul>
          </nav>
        </div>

        {/* User Identity Card at Bottom (Matching Image Reference Card) */}
        <div class="mt-auto pt-2 px-1 shrink-0">
          <div class="rounded-2xl bg-white border border-[#DDD8CE] p-3 shadow-2xs transition-colors hover:border-[#9E725F]/30">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0">
                <div class="w-7 h-7 rounded-xl bg-[#F2E8E2] text-[#9E725F] font-bold text-xs flex items-center justify-center shrink-0">
                  S
                </div>
                <span
                  class="font-semibold text-[13px] text-[#1A1B1E] truncate"
                  title="sarah.support@byos.local"
                >
                  sarah.support@byos.local
                </span>
              </div>
              <span class="rounded-md bg-[#F2E8E2] px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase text-[#9E725F] shrink-0">
                STAFF
              </span>
            </div>
            <div class="mt-2.5 pt-2 border-t border-[#E2DFD8]/60 flex items-center justify-between text-xs text-[#55575B]">
              <span class="font-mono text-[11px]">
                Tier 2 Operator
              </span>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await logoutAdmin();
                  } catch {}
                  setActionNotification({ type: "success", message: "Operator session signed out." });
                  setTimeout(() => {
                    window.location.reload();
                  }, 500);
                }}
                class="text-xs text-[#55575B] hover:text-[#9E725F] font-medium hover:underline cursor-pointer focus:outline-none"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ─────────────────────────────────────────────────────────────
          2. Main Workspace Card (Matching Dashboard Layout)
         ───────────────────────────────────────────────────────────── */}
      <div class="flex-1 flex flex-col min-w-0 h-full overflow-hidden gap-1.5 sm:gap-2">
        {/* Top Navbar Header */}
        <header class="h-12 min-h-[48px] rounded-2xl bg-white border border-[#E2DFD8] px-3 sm:px-4 flex items-center justify-between shadow-2xs shrink-0">
          {/* Mobile Menu Hamburger Button & Dynamic Breadcrumbs */}
          <div class="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              class="md:hidden p-1.5 -ml-1 text-[#55575B] hover:text-[#1A1B1E] rounded-lg hover:bg-black/5 cursor-pointer focus:outline-none"
              aria-label="Open mobile navigation drawer"
              data-testid="crm-mobile-menu-btn"
            >
              <svg class="w-5 h-5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <div class="flex items-center gap-1.5 sm:gap-2 text-xs">
              <span class="text-[#878A8E] font-medium hidden xs:inline">Support CRM</span>
              <span class="text-[#878A8E] hidden xs:inline">/</span>
              <span class="text-[#1A1B1E] font-bold capitalize truncate max-w-[160px] sm:max-w-none">
                {currentTab() === "tickets"
                  ? "Support Ticket Queue"
                  : currentTab() === "organizations"
                  ? "Organization Management"
                  : "Immutable Audit Ledger"}
              </span>
            </div>
          </div>

          {/* Right Header Status Bar */}
          <div class="flex items-center gap-3">
            <div class="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-medium">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Zero-Knowledge Operator Bound</span>
            </div>
            <a
              href="http://localhost:3000/dashboard/support"
              target="_blank"
              rel="noreferrer"
              class="text-xs text-[#9E725F] hover:underline font-semibold flex items-center gap-1"
            >
              <span>Customer Help Desk</span>
              <span>↗</span>
            </a>
          </div>
        </header>

        {/* Toast Notification Banner */}
        <Show when={actionNotification()}>
          {(notif) => (
            <div
              class={`rounded-xl px-4 py-2 text-xs font-medium flex items-center justify-between border shadow-2xs shrink-0 transition-all ${
                notif().type === "success"
                  ? "bg-emerald-50 text-emerald-900 border-emerald-200"
                  : "bg-rose-50 text-rose-900 border-rose-200"
              }`}
            >
              <div class="flex items-center gap-2 truncate">
                <span class="font-bold">{notif().type === "success" ? "✓ SUCCESS:" : "✕ ALERT:"}</span>
                <span class="truncate">{notif().message}</span>
              </div>
              <button
                type="button"
                onClick={() => setActionNotification(null)}
                class="text-xs font-bold hover:opacity-75 cursor-pointer ml-3 shrink-0"
              >
                ✕
              </button>
            </div>
          )}
        </Show>

        {/* Main Viewport Container */}
        <div class="flex-1 min-h-0 rounded-2xl border border-[#E2DFD8] bg-white shadow-2xs overflow-hidden flex flex-col min-w-0">
          <main class="flex-1 overflow-y-auto custom-scrollbar p-3 sm:p-5 pb-18 md:pb-5">
            <ErrorBoundary
              fallback={(err, reset) => (
                <div class="p-8 my-6 rounded-2xl border border-rose-200 bg-rose-50/40 flex flex-col items-center justify-center text-center space-y-3">
                  <div class="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 font-bold text-sm">
                    ✕
                  </div>
                  <div class="space-y-1">
                    <h3 class="text-sm font-semibold text-rose-900">Support System Connection Alert</h3>
                    <p class="text-xs text-rose-700 max-w-md">{err.message}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      reset();
                      refetchTickets();
                      refetchStats();
                    }}
                    class="px-3.5 py-1.5 text-xs font-semibold rounded-xl bg-white border border-rose-300 text-rose-800 hover:bg-rose-50 shadow-2xs transition-colors cursor-pointer"
                  >
                    Retry Connection
                  </button>
                </div>
              )}
            >

              {/* ─────────────────────────────────────────────────────────────
                  TAB 1: SUPPORT TICKETS & REAL-TIME CONVERSATION
                 ───────────────────────────────────────────────────────────── */}
              <Show when={currentTab() === "tickets"}>
                <div class="space-y-4">
                  {/* KPI Row */}
                  <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div class="rounded-xl border border-[#E2DFD8] bg-[#FBF9F6] p-3 shadow-2xs">
                      <span class="text-[11px] font-medium text-[#878A8E] block uppercase tracking-wider">Open Tickets</span>
                      <span class="text-2xl font-bold font-mono text-[#1A1B1E] mt-0.5 block">
                        {supportStats()?.open_tickets ?? 0}
                      </span>
                    </div>
                    <div class="rounded-xl border border-[#E2DFD8] bg-[#FBF9F6] p-3 shadow-2xs">
                      <span class="text-[11px] font-medium text-[#878A8E] block uppercase tracking-wider">In Progress</span>
                      <span class="text-2xl font-bold font-mono text-[#9E725F] mt-0.5 block">
                        {supportStats()?.in_progress ?? 0}
                      </span>
                    </div>
                    <div class="rounded-xl border border-[#E2DFD8] bg-[#FBF9F6] p-3 shadow-2xs">
                      <span class="text-[11px] font-medium text-[#878A8E] block uppercase tracking-wider">Urgent Priority</span>
                      <span class="text-2xl font-bold font-mono text-rose-600 mt-0.5 block">
                        {supportStats()?.high_priority ?? 0}
                      </span>
                    </div>
                    <div class="rounded-xl border border-[#E2DFD8] bg-[#FBF9F6] p-3 shadow-2xs">
                      <span class="text-[11px] font-medium text-[#878A8E] block uppercase tracking-wider">Resolved</span>
                      <span class="text-2xl font-bold font-mono text-emerald-600 mt-0.5 block">
                        {supportStats()?.resolved ?? 0}
                      </span>
                    </div>
                  </div>

                  {/* Main Two-Pane Split View */}
                  <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                    {/* Left Pane: Ticket Queue List */}
                    <div
                      class={`bg-white rounded-xl border border-[#E2DFD8] p-4 shadow-2xs space-y-3 ${
                        selectedTicketId() ? "hidden lg:block lg:col-span-5" : "col-span-1 lg:col-span-12"
                      }`}
                    >
                      <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2">
                          <h2 class="text-sm font-bold text-[#1A1B1E]">Customer Ticket Queue</h2>
                          <Show when={ticketOrgFilter()}>
                            <span class="text-[10px] bg-[#F2E8E2] text-[#9E725F] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                              <span>Filtered by Org</span>
                              <button
                                type="button"
                                onClick={() => setTicketOrgFilter(null)}
                                class="hover:underline font-bold"
                              >
                                ✕
                              </button>
                            </span>
                          </Show>
                        </div>
                        <button
                          type="button"
                          onClick={() => Promise.all([refetchTickets(), refetchStats()])}
                          class="text-xs text-[#9E725F] hover:underline font-semibold cursor-pointer"
                        >
                          Refresh
                        </button>
                      </div>

                      {/* Search & Filter Bar */}
                      <div class="space-y-2">
                        <input
                          type="text"
                          placeholder="Filter by subject, ticket #, or customer email..."
                          value={ticketSearch()}
                          onInput={(e) => setTicketSearch(e.currentTarget.value)}
                          class="w-full text-xs rounded-xl border border-[#E2DFD8] px-3 py-2 bg-[#FBF9F6] text-[#3C3D3E] placeholder-[#878A8E] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                        />

                        <div class="flex items-center gap-1 flex-wrap">
                          <For each={["all", "open", "in_progress", "pending_customer", "resolved", "closed"]}>
                            {(st) => (
                              <button
                                type="button"
                                onClick={() => setTicketStatusFilter(st)}
                                class={`px-2.5 py-1 rounded-full text-[11px] font-medium capitalize transition cursor-pointer ${
                                  ticketStatusFilter() === st
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
                        <Show when={tickets.error}>
                          <div class="p-6 my-4 rounded-2xl border border-rose-200 bg-rose-50/50 text-center space-y-2">
                            <div class="w-8 h-8 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto text-xs font-bold">✕</div>
                            <p class="text-xs text-rose-800 font-medium">
                              {tickets.error?.message || "Failed to load support tickets from database."}
                            </p>
                            <button
                              type="button"
                              onClick={() => refetchTickets()}
                              class="px-3.5 py-1.5 text-xs font-semibold rounded-xl bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 shadow-2xs transition-colors cursor-pointer"
                            >
                              Retry Connection
                            </button>
                          </div>
                        </Show>

                        <Show when={tickets.loading && !tickets.error}>
                          <div class="py-12 text-center text-xs text-[#878A8E]">Loading tickets...</div>
                        </Show>

                        <For
                          each={!tickets.error ? tickets() : []}
                          fallback={
                            <Show when={(!tickets.loading && !tickets.error) || (!tickets.error && Boolean(tickets()))}>
                              <div class="py-12 text-center text-xs text-[#878A8E]">
                                No tickets match the current queue filter.
                              </div>
                            </Show>
                          }
                        >
                          {(t) => (
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => setSelectedTicketId(t.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSelectedTicketId(t.id);
                                }
                              }}
                              class={`p-3 rounded-xl transition-all cursor-pointer space-y-1.5 my-1 border ${
                                selectedTicketId() === t.id
                                  ? "bg-[#FBF9F6] border-[#9E725F]/50 shadow-2xs"
                                  : "bg-white border-transparent hover:border-[#E2DFD8] hover:bg-[#FAF9F6]"
                              }`}
                            >
                              <div class="flex items-center justify-between gap-2 text-xs">
                                <div class="flex items-center gap-2 min-w-0">
                                  <span class="font-mono font-bold text-[#9E725F]">{t.ticket_number}</span>
                                  <span
                                    class={`text-[10px] font-bold px-1.5 py-0.2 rounded capitalize ${
                                      t.priority === "urgent" || t.priority === "high"
                                        ? "bg-rose-50 text-rose-700 border border-rose-200"
                                        : "bg-stone-100 text-stone-700"
                                    }`}
                                  >
                                    {t.priority}
                                  </span>
                                  <span class="text-[10px] font-mono text-stone-400 bg-stone-100 px-1 rounded truncate">
                                    {t.product_area}
                                  </span>
                                </div>
                                <span class="text-[10px] text-[#878A8E] shrink-0 font-mono">
                                  {formatTimeAgo(t.last_activity_at)}
                                </span>
                              </div>

                              <div class="font-semibold text-xs text-[#1A1B1E] truncate">
                                {t.subject}
                              </div>

                              <div class="flex items-center justify-between text-[11px] text-[#878A8E]">
                                <span class="truncate">{t.customer_email}</span>
                                <span
                                  class={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize border ${
                                    t.status === "new"
                                      ? "bg-sky-50 text-sky-700 border-sky-200"
                                      : t.status === "in_progress" || t.status === "open"
                                      ? "bg-amber-50 text-amber-800 border-amber-200"
                                      : t.status === "pending_customer"
                                      ? "bg-purple-50 text-purple-700 border-purple-200"
                                      : "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  }`}
                                >
                                  {t.status.replace("_", " ")}
                                </span>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>

                    {/* Right Pane: Selected Ticket Detail */}
                    <Show when={selectedTicketId()}>
                      <div class="bg-white rounded-xl border border-[#E2DFD8] p-4 sm:p-5 shadow-2xs col-span-1 lg:col-span-7 space-y-4">
                        <Show when={activeTicketDetail.loading && !activeTicketDetail.error && !activeTicketDetail()}>
                          <div class="py-16 text-center text-xs text-[#878A8E]">Loading conversation...</div>
                        </Show>

                        <Show when={!activeTicketDetail.error && activeTicketDetail()}>
                          {(detail) => (
                            <div class="space-y-4">
                              {/* Mobile Back Button to Ticket Queue */}
                              <button
                                type="button"
                                onClick={() => setSelectedTicketId(null)}
                                class="lg:hidden inline-flex items-center gap-1.5 text-xs text-[#9E725F] hover:text-[#8E6351] font-semibold py-1.5 px-3 rounded-xl bg-[#F2E8E2] mb-1 cursor-pointer transition active:scale-95"
                                data-testid="crm-mobile-back-to-queue"
                              >
                                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                                  <polyline points="15 18 9 12 15 6" />
                                </svg>
                                <span>Back to Ticket Queue</span>
                              </button>
                              {/* Ticket Header & Status Controls */}
                              <div class="flex items-start justify-between gap-3 border-b border-[#E2DFD8] pb-3">
                                <div class="space-y-1">
                                  <div class="flex items-center gap-2">
                                    <span class="font-mono text-xs font-bold text-[#9E725F]">
                                      {detail().ticket.ticket_number}
                                    </span>
                                    <span class="text-[10px] font-semibold px-2 py-0.5 rounded bg-[#F0EEE9] text-stone-700">
                                      {detail().ticket.product_area}
                                    </span>
                                    <span class="text-[10px] text-stone-400 font-mono">
                                      Created {formatTimeAgo(detail().ticket.created_at)}
                                    </span>
                                  </div>
                                  <h3 class="text-base font-bold text-[#1A1B1E]">{detail().ticket.subject}</h3>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setSelectedTicketId(null)}
                                  class="text-stone-400 hover:text-stone-700 p-1 text-sm font-bold cursor-pointer"
                                  title="Close ticket detail"
                                >
                                  ✕
                                </button>
                              </div>

                              {/* Quick Lifecycle Controls */}
                              <div class="bg-[#FBF9F6] p-3 rounded-xl border border-[#E2DFD8] flex items-center justify-between gap-2 flex-wrap text-xs">
                                <div class="flex items-center gap-2">
                                  <span class="text-stone-500 font-medium">Status:</span>
                                  <select
                                    value={detail().ticket.status}
                                    onChange={(e) => handleUpdateTicketStatus(detail().ticket.id, e.currentTarget.value)}
                                    disabled={isUpdatingTicketStatus()}
                                    class="rounded-lg border border-[#E2DFD8] bg-white px-2 py-1 text-xs font-semibold text-[#3C3D3E] focus:ring-1 focus:ring-[#9E725F]"
                                  >
                                    <option value="new">New</option>
                                    <option value="open">Open</option>
                                    <option value="in_progress">In Progress</option>
                                    <option value="pending_customer">Pending Customer</option>
                                    <option value="resolved">Resolved</option>
                                    <option value="closed">Closed</option>
                                  </select>
                                </div>

                                <div class="flex items-center gap-2">
                                  <span class="text-stone-500 font-medium">Priority:</span>
                                  <select
                                    value={detail().ticket.priority}
                                    onChange={(e) => handleUpdateTicketPriority(detail().ticket.id, e.currentTarget.value)}
                                    class="rounded-lg border border-[#E2DFD8] bg-white px-2 py-1 text-xs font-semibold text-[#3C3D3E] focus:ring-1 focus:ring-[#9E725F]"
                                  >
                                    <option value="low">Low</option>
                                    <option value="normal">Normal</option>
                                    <option value="high">High</option>
                                    <option value="urgent">Urgent</option>
                                  </select>
                                </div>

                                <div class="flex items-center gap-2">
                                  <span class="text-stone-500 font-medium">Assigned:</span>
                                  <select
                                    value={detail().ticket.assigned_agent_id || ""}
                                    onChange={(e) => handleAssignAgent(detail().ticket.id, e.currentTarget.value || null)}
                                    class="rounded-lg border border-[#E2DFD8] bg-white px-2 py-1 text-xs font-semibold text-[#3C3D3E] focus:ring-1 focus:ring-[#9E725F]"
                                  >
                                    <option value="">Unassigned</option>
                                    <For each={supportAgents() || []}>
                                      {(agent) => (
                                        <option value={agent.id}>{agent.display_name} ({agent.role})</option>
                                      )}
                                    </For>
                                  </select>
                                </div>
                              </div>

                              {/* Customer Account Context Card with WORKING Suspend/Reactivate Action */}
                              <div class="rounded-xl border border-sky-100 bg-sky-50/50 p-3.5 text-xs space-y-2.5">
                                <div class="flex items-center justify-between font-semibold text-sky-900 border-b border-sky-100 pb-2">
                                  <div class="flex items-center gap-2">
                                    <span>Customer Account Context</span>
                                    <span
                                      class={`text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded-full border ${
                                        detail().customer.account_status === "suspended"
                                          ? "bg-rose-100 text-rose-800 border-rose-300"
                                          : "bg-emerald-100 text-emerald-800 border-emerald-300"
                                      }`}
                                    >
                                      Status: {detail().customer.account_status}
                                    </span>
                                  </div>

                                  {/* Immediate Action: Suspend / Reactivate Customer Account */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCustomerToSuspend({
                                        userId: detail().customer.user_id,
                                        email: detail().customer.email,
                                        currentStatus: detail().customer.account_status,
                                      });
                                    }}
                                    class={`px-2.5 py-1 rounded-lg text-xs font-bold transition shadow-2xs cursor-pointer border ${
                                      detail().customer.account_status === "suspended"
                                        ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
                                        : "bg-rose-600 hover:bg-rose-700 text-white border-rose-600"
                                    }`}
                                  >
                                    {detail().customer.account_status === "suspended"
                                      ? "Reactivate Account"
                                      : "Suspend Account"}
                                  </button>
                                </div>

                                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-sky-950">
                                  <div>
                                    <span class="text-stone-500 block">Customer:</span>
                                    <span class="font-medium truncate block">{detail().customer.email}</span>
                                  </div>
                                  <div>
                                    <span class="text-stone-500 block">Organization:</span>
                                    <span class="font-medium truncate block">{detail().customer.org_name || "Personal"}</span>
                                  </div>
                                  <div>
                                    <span class="text-stone-500 block">Plan & Seats:</span>
                                    <span class="font-medium block">{detail().customer.org_plan || "Starter"} ({detail().customer.seat_count} seats)</span>
                                  </div>
                                  <div>
                                    <span class="text-stone-500 block">Mailboxes:</span>
                                    <span class="font-medium block">{detail().customer.mailbox_count} active</span>
                                  </div>
                                </div>
                              </div>

                              {/* Conversation Messages Thread */}
                              <div class="space-y-3 max-h-[380px] overflow-y-auto custom-scrollbar pr-1">
                                <For each={detail().messages}>
                                  {(msg) => (
                                    <div
                                      class={`p-3 rounded-xl text-xs space-y-1.5 ${
                                        msg.visibility === "internal"
                                          ? "bg-amber-50/80 border border-amber-200"
                                          : msg.author_type === "agent"
                                          ? "bg-indigo-50/80 border border-indigo-200 ml-4"
                                          : "bg-[#FBF9F6] border border-[#E2DFD8] mr-4"
                                      }`}
                                    >
                                      <div class="flex items-center justify-between">
                                        <div class="flex items-center gap-1.5 font-bold">
                                          <Show when={msg.visibility === "internal"}>
                                            <span class="text-amber-800 flex items-center gap-1 bg-amber-100 px-1.5 py-0.5 rounded text-[10px]">
                                              🔒 INTERNAL NOTE (Confidential to Staff)
                                            </span>
                                          </Show>
                                          <Show when={msg.visibility !== "internal" && msg.author_type === "agent"}>
                                            <span class="text-indigo-800 bg-indigo-100 px-1.5 py-0.5 rounded text-[10px]">
                                              Support Agent
                                            </span>
                                          </Show>
                                          <span class="text-[#1A1B1E]">{msg.author_name}</span>
                                        </div>
                                        <span class="text-[10px] text-stone-400 font-mono">
                                          {formatTimeAgo(msg.created_at)}
                                        </span>
                                      </div>
                                      <div class="text-stone-800 whitespace-pre-wrap leading-relaxed">
                                        {msg.body}
                                      </div>
                                    </div>
                                  )}
                                </For>
                              </div>

                              {/* Customer Typing Indicator */}
                              <Show when={detail().customer_typing}>
                                <div class="flex items-center gap-2 text-xs text-sky-800 bg-sky-50 border border-sky-200 rounded-xl px-3 py-1.5 animate-pulse">
                                  <span class="flex gap-1 items-center">
                                    <span class="w-1.5 h-1.5 bg-sky-600 rounded-full animate-bounce" style={{ "animation-delay": "0ms" }} />
                                    <span class="w-1.5 h-1.5 bg-sky-600 rounded-full animate-bounce" style={{ "animation-delay": "150ms" }} />
                                    <span class="w-1.5 h-1.5 bg-sky-600 rounded-full animate-bounce" style={{ "animation-delay": "300ms" }} />
                                  </span>
                                  <span class="font-medium text-[11px]">Customer is currently typing...</span>
                                </div>
                              </Show>

                              {/* Message Composer (Public Reply vs Staff Note) */}
                              <form onSubmit={handleSendTicketMessage} class="space-y-2 pt-2 border-t border-[#E2DFD8]">
                                <div class="flex items-center justify-between">
                                  <div class="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setTicketComposerVisibility("public")}
                                      class={`text-xs px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                                        ticketComposerVisibility() === "public"
                                          ? "bg-[#9E725F] text-white shadow-2xs font-semibold"
                                          : "bg-[#F0EEE9] text-stone-600 hover:bg-stone-200"
                                      }`}
                                    >
                                      Public Reply to Customer
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setTicketComposerVisibility("internal")}
                                      class={`text-xs px-2.5 py-1 rounded-lg font-medium transition flex items-center gap-1 cursor-pointer ${
                                        ticketComposerVisibility() === "internal"
                                          ? "bg-amber-600 text-white shadow-2xs font-semibold"
                                          : "bg-[#F0EEE9] text-amber-900 hover:bg-stone-200"
                                      }`}
                                    >
                                      🔒 Internal Staff Note
                                    </button>
                                  </div>
                                  <Show when={ticketComposerVisibility() === "internal"}>
                                    <span class="text-[11px] font-medium text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                      Visible only to BYOS support staff
                                    </span>
                                  </Show>
                                </div>

                                <textarea
                                  rows={3}
                                  placeholder={
                                    ticketComposerVisibility() === "internal"
                                      ? "Write internal staff note (recorded to immutable audit log)..."
                                      : "Write public response to customer..."
                                  }
                                  value={ticketComposerBody()}
                                  onInput={(e) => {
                                    setTicketComposerBody(e.currentTarget.value);
                                    notifyAgentTyping(selectedTicketId());
                                  }}
                                  class={`w-full rounded-xl p-3 text-xs focus:outline-none focus:ring-1 resize-y ${
                                    ticketComposerVisibility() === "internal"
                                      ? "bg-amber-50/30 border border-amber-300 focus:ring-amber-500 text-amber-950"
                                      : "bg-white border border-[#E2DFD8] focus:ring-[#9E725F] text-[#3C3D3E]"
                                  }`}
                                />

                                <div class="flex justify-end">
                                  <button
                                    type="submit"
                                    disabled={isSubmittingMessage() || !ticketComposerBody().trim()}
                                    class={`text-xs px-4 py-2 rounded-xl text-white font-semibold transition shadow-2xs cursor-pointer disabled:opacity-50 ${
                                      ticketComposerVisibility() === "internal"
                                        ? "bg-amber-700 hover:bg-amber-800"
                                        : "bg-[#9E725F] hover:bg-[#8A6352]"
                                    }`}
                                  >
                                    {isSubmittingMessage()
                                      ? "Submitting..."
                                      : ticketComposerVisibility() === "internal"
                                      ? "Save Internal Note"
                                      : "Send Public Reply"}
                                  </button>
                                </div>
                              </form>
                            </div>
                          )}
                        </Show>
                      </div>
                    </Show>
                  </div>
                </div>
              </Show>

              {/* ─────────────────────────────────────────────────────────────
                  TAB 2: ORGANIZATIONS TABLE & ACTIONS
                 ───────────────────────────────────────────────────────────── */}
              <Show when={currentTab() === "organizations"}>
                <div class="space-y-4">
                  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#E2DFD8] pb-4">
                    <div>
                      <h2 class="text-base font-bold text-[#1A1B1E]">Organization Directory</h2>
                      <p class="text-xs text-[#878A8E] mt-0.5">
                        Manage customer organizations, subscription capacity allocations, and security states.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => refetchOrgs()}
                      class="text-xs bg-[#F0EEE9] hover:bg-[#E8E5DF] text-[#3C3D3E] px-3 py-1.5 rounded-lg border border-[#E2DFD8] font-semibold transition cursor-pointer self-start sm:self-auto"
                    >
                      Refresh Organizations
                    </button>
                  </div>

                  {/* Search & Filter Toolbar */}
                  <div class="flex items-center gap-3 flex-wrap">
                    <input
                      type="text"
                      placeholder="Search organizations by name or UUID..."
                      value={orgSearch()}
                      onInput={(e) => setOrgSearch(e.currentTarget.value)}
                      class="w-full sm:w-80 text-xs rounded-xl border border-[#E2DFD8] px-3 py-2 bg-[#FBF9F6] text-[#3C3D3E] placeholder-[#878A8E] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                    />
                    <div class="flex items-center gap-1.5">
                      <For each={["all", "active", "suspended", "grace_period"]}>
                        {(st) => (
                          <button
                            type="button"
                            onClick={() => setOrgStatusFilter(st)}
                            class={`px-2.5 py-1 rounded-full text-[11px] font-medium capitalize transition cursor-pointer ${
                              orgStatusFilter() === st
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

                  {/* Organizations Table */}
                  <div class="overflow-x-auto rounded-xl border border-[#E2DFD8]">
                    <table class="w-full min-w-[650px] text-left text-xs border-collapse">
                      <thead>
                        <tr class="bg-[#F0EEE9]/60 border-b border-[#E2DFD8] text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
                          <th class="py-3 px-4">Organization</th>
                          <th class="py-3 px-4">Plan & Capacity</th>
                          <th class="py-3 px-4">Mailboxes</th>
                          <th class="py-3 px-4">Status</th>
                          <th class="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-[#E2DFD8]/60 text-xs">
                        <For
                          each={filteredOrgs()}
                          fallback={
                            <tr>
                              <td colspan="5" class="py-8 text-center text-stone-400 text-xs">
                                {organizations.loading ? "Loading organizations..." : "No organizations found."}
                              </td>
                            </tr>
                          }
                        >
                          {(org) => (
                            <tr class="hover:bg-[#FAF9F6] transition-colors">
                              <td class="py-3 px-4">
                                <div class="font-bold text-[#1A1B1E]">{org.name}</div>
                                <div class="font-mono text-[10px] text-stone-400">{org.id}</div>
                              </td>
                              <td class="py-3 px-4">
                                <span class="font-semibold text-stone-800">{org.plan}</span>
                                <span class="text-stone-400 block text-[11px] font-mono">{org.seat_count} seats allocated</span>
                              </td>
                              <td class="py-3 px-4 font-mono font-medium text-stone-700">
                                {org.mailbox_count} active
                              </td>
                              <td class="py-3 px-4">
                                <span
                                  class={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                                    org.status === "active"
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                      : "bg-rose-50 text-rose-700 border-rose-200"
                                  }`}
                                >
                                  {org.status}
                                </span>
                              </td>
                              <td class="py-3 px-4 text-right relative action-menu-container">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenDropdownId(openDropdownId() === org.id ? null : org.id);
                                  }}
                                  class="w-7 h-7 inline-flex items-center justify-center rounded-lg hover:bg-[#F0EEE9] text-stone-500 hover:text-[#3C3D3E] transition cursor-pointer"
                                  title="Actions menu"
                                >
                                  •••
                                </button>

                                <Show when={openDropdownId() === org.id}>
                                  <div class="absolute right-4 top-9 w-52 bg-white border border-[#E2DFD8] rounded-xl shadow-lg z-30 py-1 text-left text-xs divide-y divide-[#E2DFD8]/60">
                                    <div class="py-1">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedOrgForCapacity(org);
                                          setAdjustedSeats(org.seat_count || 10);
                                          setOpenDropdownId(null);
                                        }}
                                        class="w-full px-3.5 py-2 hover:bg-[#F0EEE9] text-[#3C3D3E] font-medium flex items-center gap-2 cursor-pointer"
                                      >
                                        <span>⚙ Adjust Capacity</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setTicketOrgFilter(org.id);
                                          setCurrentTab("tickets");
                                          setOpenDropdownId(null);
                                        }}
                                        class="w-full px-3.5 py-2 hover:bg-[#F0EEE9] text-[#9E725F] font-semibold flex items-center gap-2 cursor-pointer"
                                      >
                                        <span>🎫 View Tickets</span>
                                      </button>
                                    </div>
                                    <div class="py-1">
                                      <button
                                        type="button"
                                        onClick={() => handleToggleSuspendOrg(org)}
                                        class={`w-full px-3.5 py-2 font-semibold flex items-center gap-2 cursor-pointer ${
                                          org.status === "suspended"
                                            ? "hover:bg-emerald-50 text-emerald-700"
                                            : "hover:bg-rose-50 text-rose-600"
                                        }`}
                                      >
                                        <span>
                                          {org.status === "suspended" ? "✓ Reactivate Organization" : "✕ Suspend Organization"}
                                        </span>
                                      </button>
                                    </div>
                                  </div>
                                </Show>
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </div>
              </Show>

              {/* ─────────────────────────────────────────────────────────────
                  TAB 3: IMMUTABLE AUDIT LOGS (REAL POSTGRESQL LEDGER)
                 ───────────────────────────────────────────────────────────── */}
              <Show when={currentTab() === "audit_logs"}>
                <div class="space-y-4">
                  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#E2DFD8] pb-4">
                    <div>
                      <h2 class="text-base font-bold text-[#1A1B1E]">Cryptographic Audit Ledger</h2>
                      <p class="text-xs text-[#878A8E] mt-0.5">
                        Immutable, append-only record from <code>public.support_audit_logs</code>. Protected by database trigger against tamper.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => refetchAuditLogs()}
                      class="text-xs bg-[#F0EEE9] hover:bg-[#E8E5DF] text-[#3C3D3E] px-3 py-1.5 rounded-lg border border-[#E2DFD8] font-semibold transition cursor-pointer self-start sm:self-auto"
                    >
                      Refresh Ledger
                    </button>
                  </div>

                  {/* Search & Filter Toolbar */}
                  <div class="flex items-center gap-3 flex-wrap">
                    <input
                      type="text"
                      placeholder="Search by action, target entity, operator, or reason..."
                      value={auditSearch()}
                      onInput={(e) => setAuditSearch(e.currentTarget.value)}
                      class="w-full sm:w-80 text-xs rounded-xl border border-[#E2DFD8] px-3 py-2 bg-[#FBF9F6] text-[#3C3D3E] placeholder-[#878A8E] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                    />
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <For each={["all", "suspend", "reactivate", "capacity", "reply", "note", "state"]}>
                        {(act) => (
                          <button
                            type="button"
                            onClick={() => setAuditActionFilter(act)}
                            class={`px-2.5 py-1 rounded-full text-[11px] font-medium capitalize transition cursor-pointer ${
                              auditActionFilter() === act
                                ? "bg-[#9E725F] text-white font-semibold shadow-2xs"
                                : "bg-[#F0EEE9] text-[#55575B] hover:bg-[#E8E5DF]"
                            }`}
                          >
                            {act}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>

                  {/* Audit Logs Table */}
                  <div class="overflow-x-auto rounded-xl border border-[#E2DFD8]">
                    <table class="w-full min-w-[700px] text-left text-xs border-collapse">
                      <thead>
                        <tr class="bg-[#F0EEE9]/60 border-b border-[#E2DFD8] text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
                          <th class="py-3 px-4">Timestamp</th>
                          <th class="py-3 px-4">Operator</th>
                          <th class="py-3 px-4">Action</th>
                          <th class="py-3 px-4">Target Entity</th>
                          <th class="py-3 px-4">Reason / Details</th>
                          <th class="py-3 px-4 text-right">Audit ID</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-[#E2DFD8]/60 text-xs">
                        <For
                          each={filteredAuditLogs()}
                          fallback={
                            <tr>
                              <td colspan="6" class="py-8 text-center text-stone-400 text-xs">
                                {auditLogs.loading ? "Loading audit ledger..." : "No matching audit events recorded."}
                              </td>
                            </tr>
                          }
                        >
                          {(entry) => (
                            <tr
                              onClick={() => setSelectedAuditLog(entry)}
                              class="hover:bg-[#FAF9F6] transition-colors cursor-pointer"
                            >
                              <td class="py-3 px-4 text-stone-600 font-mono text-[11px] whitespace-nowrap">
                                <span title={new Date(entry.timestamp).toLocaleString()}>
                                  {formatTimeAgo(entry.timestamp)}
                                </span>
                              </td>
                              <td class="py-3 px-4 font-medium text-[#1A1B1E] whitespace-nowrap">
                                {entry.actor_name || "Sarah Chen (Tier 2)"}
                              </td>
                              <td class="py-3 px-4">
                                <span
                                  class={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                                    entry.action.includes("suspend")
                                      ? "bg-rose-50 text-rose-700 border-rose-200"
                                      : entry.action.includes("reactivate")
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                      : entry.action.includes("capacity")
                                      ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                                      : entry.action.includes("reply")
                                      ? "bg-sky-50 text-sky-700 border-sky-200"
                                      : "bg-stone-50 text-stone-700 border-stone-200"
                                  }`}
                                >
                                  {entry.action.replace("org_", "").replace("customer_", "").replace("_", " ")}
                                </span>
                              </td>
                              <td class="py-3 px-4 font-semibold text-[#1A1B1E] truncate max-w-[200px]">
                                {entry.target_name || entry.target_uuid || "—"}
                              </td>
                              <td class="py-3 px-4 text-stone-600 truncate max-w-[240px]">
                                {entry.metadata?.reason || entry.metadata?.operation || JSON.stringify(entry.metadata) || "—"}
                              </td>
                              <td class="py-3 px-4 text-right">
                                <span class="font-mono text-[10px] bg-[#F2E8E2] text-[#9E725F] px-1.5 py-0.5 rounded font-bold">
                                  {entry.metadata?.audit_id || entry.id.slice(0, 8)}
                                </span>
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </div>
              </Show>

            </ErrorBoundary>
          </main>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          MODAL 1: BOUNDED & COMPACT ADJUST CAPACITY MODAL
          (Fixed: NEVER breaks out of viewport)
         ───────────────────────────────────────────────────────────── */}
      <Show when={selectedOrgForCapacity()}>
        {(org) => (
          <div class="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <div class="bg-white rounded-2xl border border-[#E2DFD8] max-w-md w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in duration-150">
              {/* Modal Header */}
              <div class="flex items-center justify-between border-b border-[#E2DFD8] p-4 bg-[#FBF9F6] shrink-0">
                <div>
                  <h3 class="font-bold text-sm text-[#1A1B1E]">Adjust Allocated Capacity</h3>
                  <p class="text-xs text-stone-500 mt-0.5 truncate max-w-[280px]">
                    {org().name}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedOrgForCapacity(null)}
                  class="text-stone-400 hover:text-stone-700 text-lg font-bold cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Scrollable Content Body */}
              <div class="p-4 sm:p-5 overflow-y-auto custom-scrollbar space-y-4 text-xs">
                {/* Presets */}
                <div>
                  <span class="block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
                    Quick Seat Presets:
                  </span>
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <For each={[10, 25, 50, 100, 250]}>
                      {(preset) => (
                        <button
                          type="button"
                          onClick={() => setAdjustedSeats(preset)}
                          class={`px-3 py-1 rounded-full text-xs font-mono transition cursor-pointer border ${
                            adjustedSeats() === preset
                              ? "bg-[#9E725F] text-white border-[#9E725F] font-bold shadow-2xs"
                              : "bg-[#F0EEE9] text-stone-700 border-transparent hover:border-[#9E725F]"
                          }`}
                        >
                          {preset} seats
                        </button>
                      )}
                    </For>
                  </div>
                </div>

                {/* Slider & Input */}
                <div class="space-y-2 bg-[#FBF9F6] p-3 rounded-xl border border-[#E2DFD8]">
                  <div class="flex items-center justify-between">
                    <span class="font-semibold text-stone-700">Allocated Mailboxes:</span>
                    <input
                      type="number"
                      min={1}
                      max={9999}
                      value={adjustedSeats()}
                      onInput={(e) => setAdjustedSeats(Math.max(1, parseInt(e.currentTarget.value, 10) || 1))}
                      class="w-20 text-center font-mono font-bold text-sm bg-white border border-[#E2DFD8] rounded-lg py-1 px-2 focus:ring-1 focus:ring-[#9E725F] focus:outline-none"
                    />
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={250}
                    value={adjustedSeats() > 250 ? 250 : adjustedSeats()}
                    onInput={(e) => setAdjustedSeats(parseInt(e.currentTarget.value, 10))}
                    class="w-full h-2 bg-[#E2DFD8] rounded-lg appearance-none cursor-pointer accent-[#9E725F]"
                  />
                </div>

                {/* Compact Resource Limits & Rate Card */}
                <div class="rounded-xl border border-[#E2DFD8] p-3 bg-white space-y-1.5">
                  <div class="flex items-center justify-between text-stone-700">
                    <span>Custom Domains Included:</span>
                    <span class="font-bold font-mono">{Math.max(1, Math.floor(adjustedSeats() / 5))} domains</span>
                  </div>
                  <div class="flex items-center justify-between text-stone-700">
                    <span>Email Aliases:</span>
                    <span class="font-bold font-mono">{adjustedSeats() * 10} aliases</span>
                  </div>
                  <div class="flex items-center justify-between text-[#1A1B1E] pt-1.5 border-t border-[#E2DFD8] font-semibold">
                    <span>Monthly Rate Equivalent:</span>
                    <span class="font-bold font-mono text-[#9E725F]">
                      ${(adjustedSeats() * 2.925).toFixed(2)}/mo
                    </span>
                  </div>
                </div>

                {/* Audit Reason */}
                <div>
                  <label class="block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1">
                    Audit Reason (Required for Ledger):
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Upgrading capacity for new team hires"
                    value={capacityReason()}
                    onInput={(e) => setCapacityReason(e.currentTarget.value)}
                    class="w-full text-xs rounded-xl border border-[#E2DFD8] px-3 py-2 bg-white text-[#3C3D3E] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                  />
                </div>
              </div>

              {/* Fixed Modal Footer */}
              <div class="flex items-center justify-end gap-2 p-3 bg-[#FBF9F6] border-t border-[#E2DFD8] shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedOrgForCapacity(null)}
                  class="px-3.5 py-1.5 rounded-xl border border-[#E2DFD8] text-xs font-semibold text-stone-600 hover:bg-[#F0EEE9] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isUpdatingCapacity()}
                  onClick={handleConfirmCapacityUpdate}
                  class="px-4 py-1.5 rounded-xl bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs font-semibold shadow-2xs transition cursor-pointer disabled:opacity-50"
                >
                  {isUpdatingCapacity() ? "Saving..." : `Confirm Adjustment (${adjustedSeats()} Seats)`}
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>

      {/* ─────────────────────────────────────────────────────────────
          MODAL 2: CUSTOMER SUSPEND / REACTIVATE CONFIRMATION
         ───────────────────────────────────────────────────────────── */}
      <Show when={customerToSuspend()}>
        {(cust) => (
          <div class="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <div class="bg-white rounded-2xl border border-[#E2DFD8] max-w-sm w-full p-5 shadow-2xl space-y-4 animate-in fade-in duration-150">
              <div class="flex items-start justify-between border-b border-[#E2DFD8] pb-3">
                <div class="flex items-center gap-2">
                  <span
                    class={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs ${
                      cust().currentStatus === "suspended" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                    }`}
                  >
                    !
                  </span>
                  <h3 class="font-bold text-sm text-[#1A1B1E]">
                    {cust().currentStatus === "suspended" ? "Reactivate Customer" : "Suspend Customer Account"}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setCustomerToSuspend(null)}
                  class="text-stone-400 hover:text-stone-700 text-sm font-bold cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div class="text-xs text-stone-600 space-y-2">
                <p>
                  You are changing account status for:
                  <strong class="block text-[#1A1B1E] truncate mt-0.5">{cust().email}</strong>
                </p>
                <p class="text-[11px] text-stone-500">
                  {cust().currentStatus === "suspended"
                    ? "Reactivating will restore customer login access, personal mailbox delivery, and API authorization."
                    : "Suspending will immediately terminate all active webmail sessions, block authentication, and deactivate mailbox routing."}
                </p>
              </div>

              <div>
                <label class="block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1">
                  Reason for Audit Trail:
                </label>
                <input
                  type="text"
                  placeholder="e.g. Account compromise / security review"
                  value={suspendReason()}
                  onInput={(e) => setSuspendReason(e.currentTarget.value)}
                  class="w-full text-xs rounded-xl border border-[#E2DFD8] px-3 py-2 bg-[#FBF9F6] text-[#3C3D3E] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
                />
              </div>

              <div class="flex items-center justify-end gap-2 pt-2 border-t border-[#E2DFD8]">
                <button
                  type="button"
                  onClick={() => setCustomerToSuspend(null)}
                  class="px-3 py-1.5 rounded-xl border border-[#E2DFD8] text-xs font-semibold text-stone-600 hover:bg-[#F0EEE9] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSuspendingCustomer()}
                  onClick={handleToggleCustomerAccount}
                  class={`px-4 py-1.5 rounded-xl text-white text-xs font-semibold shadow-2xs transition cursor-pointer disabled:opacity-50 ${
                    cust().currentStatus === "suspended"
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-rose-600 hover:bg-rose-700"
                  }`}
                >
                  {isSuspendingCustomer()
                    ? "Updating..."
                    : cust().currentStatus === "suspended"
                    ? "Confirm Reactivation"
                    : "Confirm Suspension"}
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>

      {/* ─────────────────────────────────────────────────────────────
          MODAL 3: AUDIT LOG METADATA INSPECTOR
         ───────────────────────────────────────────────────────────── */}
      <Show when={selectedAuditLog()}>
        {(log) => (
          <div class="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <div class="bg-white rounded-2xl border border-[#E2DFD8] max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in duration-150">
              <div class="flex items-center justify-between border-b border-[#E2DFD8] p-4 bg-[#FBF9F6] shrink-0">
                <div>
                  <h3 class="font-bold text-sm text-[#1A1B1E]">Audit Event Details</h3>
                  <span class="font-mono text-[10px] text-[#9E725F]">ID: {log().id}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedAuditLog(null)}
                  class="text-stone-400 hover:text-stone-700 text-sm font-bold cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div class="p-4 overflow-y-auto custom-scrollbar space-y-3 text-xs">
                <div class="grid grid-cols-2 gap-2 bg-[#FBF9F6] p-3 rounded-xl border border-[#E2DFD8]">
                  <div>
                    <span class="text-stone-400 text-[10px] uppercase font-bold block">Action</span>
                    <span class="font-semibold text-stone-800">{log().action}</span>
                  </div>
                  <div>
                    <span class="text-stone-400 text-[10px] uppercase font-bold block">Timestamp</span>
                    <span class="font-mono text-[11px] text-stone-700">{new Date(log().timestamp).toLocaleString()}</span>
                  </div>
                  <div>
                    <span class="text-stone-400 text-[10px] uppercase font-bold block">Operator</span>
                    <span class="font-medium text-stone-800">{log().actor_name || "Sarah Chen (Tier 2)"}</span>
                  </div>
                  <div>
                    <span class="text-stone-400 text-[10px] uppercase font-bold block">Target</span>
                    <span class="font-medium text-stone-800 truncate block">{log().target_name || log().target_uuid}</span>
                  </div>
                </div>

                <div>
                  <span class="text-stone-500 font-semibold block mb-1">Cryptographic Metadata Payload:</span>
                  <pre class="bg-stone-900 text-emerald-400 p-3 rounded-xl font-mono text-[11px] overflow-x-auto max-h-60">
                    {JSON.stringify(log().metadata, null, 2)}
                  </pre>
                </div>
              </div>

              <div class="p-3 bg-[#FBF9F6] border-t border-[#E2DFD8] flex justify-end shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedAuditLog(null)}
                  class="px-4 py-1.5 rounded-xl bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs font-semibold transition cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>

      {/* Mobile Bottom Fixed Bar for CRM */}
      <nav
        aria-label="Support CRM Mobile Navigation"
        data-testid="crm-bottom-nav"
        class="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-[#E2DFD8] px-3 py-1 flex items-center justify-around select-none shadow-[0_-4px_16px_rgba(0,0,0,0.04)] h-14"
      >
        <button
          type="button"
          onClick={() => {
            setTicketOrgFilter(null);
            setCurrentTab("tickets");
          }}
          class={`flex flex-col items-center justify-center flex-1 py-1 text-xs cursor-pointer ${
            currentTab() === "tickets" ? "text-[#9E725F] font-bold" : "text-[#6E7075] font-medium"
          }`}
        >
          <svg class="w-5 h-5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span class="text-[10px] mt-0.5">Tickets</span>
        </button>
        <button
          type="button"
          onClick={() => setCurrentTab("organizations")}
          class={`flex flex-col items-center justify-center flex-1 py-1 text-xs cursor-pointer ${
            currentTab() === "organizations" ? "text-[#9E725F] font-bold" : "text-[#6E7075] font-medium"
          }`}
        >
          <svg class="w-5 h-5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <rect x="3" y="3" width="7" height="9" rx="1.5" />
            <rect x="14" y="3" width="7" height="5" rx="1.5" />
            <rect x="14" y="12" width="7" height="9" rx="1.5" />
            <rect x="3" y="16" width="7" height="5" rx="1.5" />
          </svg>
          <span class="text-[10px] mt-0.5">Orgs</span>
        </button>
        <button
          type="button"
          onClick={() => setCurrentTab("audit_logs")}
          class={`flex flex-col items-center justify-center flex-1 py-1 text-xs cursor-pointer ${
            currentTab() === "audit_logs" ? "text-[#9E725F] font-bold" : "text-[#6E7075] font-medium"
          }`}
        >
          <svg class="w-5 h-5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span class="text-[10px] mt-0.5">Audit</span>
        </button>
      </nav>
    </div>
  );
};

export default App;
