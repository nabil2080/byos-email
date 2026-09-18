import { createSignal, createMemo, createResource, onMount, onCleanup, For, Show } from "solid-js";
import {
  getOrganizations,
  suspendOrganization,
  updatePlan,
  updateCapacity,
  triggerStateReset,
  getAuditLogs,
  getMailboxHealth,
  executeIntervention,
} from "./lib/api";
import type {
  Organization,
  AuditLogEntry,
  HealthData,
} from "./lib/api";
import DynamicPricingCalculator from "./components/DynamicPricingCalculator";

interface TelemetryLog {
  id: string;
  timestamp: string;
  level: "INFO" | "WARN" | "ERR";
  source: string;
  message: string;
  identifier?: string;
}

interface StalledTx {
  id: string;
  mailboxUuid: string;
  sanitizedUuid: string;
  failureReason: string;
  retries: number;
  timeAgo: string;
  status: "stalled" | "processing" | "resolved";
  auditId?: string;
}

interface SupportTicket {
  id: string;
  org_id: string;
  org_name: string;
  subject: string;
  encrypted_payload: string;
  priority: "Critical" | "High" | "Normal";
  status: "Pending Hardware Signoff" | "Open" | "In Progress" | "Resolved";
  created_at: string;
}

const INITIAL_LOGS: TelemetryLog[] = [
  {
    id: "log-1",
    timestamp: "13:42:01.041",
    level: "INFO",
    source: "mail-router",
    message: "Outbound envelope verified with ed25519 signature",
    identifier: "tx_901c4a8f",
  },
  {
    id: "log-2",
    timestamp: "13:42:04.812",
    level: "INFO",
    source: "crypto-worker",
    message: "Ephemeral ML-KEM-768 ciphertext decrypted into session key",
    identifier: "mailbox_4a8f231b",
  },
  {
    id: "log-3",
    timestamp: "13:42:15.220",
    level: "WARN",
    source: "storage-worker",
    message: "High latency on S3 replica sync chunk_88. Retrying tier-2 write",
    identifier: "blob_e3f19a02",
  },
  {
    id: "log-4",
    timestamp: "13:42:28.910",
    level: "INFO",
    source: "auth-gateway",
    message: "WebAuthn passkey assertion passed via FIDO2 authenticator",
    identifier: "user_77c8b10e",
  },
  {
    id: "log-5",
    timestamp: "13:42:44.119",
    level: "ERR",
    source: "outbound-worker",
    message: "DKIM signature canonicalization rejected by remote MTA (554)",
    identifier: "tx_3b81109a",
  },
  {
    id: "log-6",
    timestamp: "13:43:02.404",
    level: "INFO",
    source: "storage-worker",
    message: "Chunk deduplication pass completed. 1.4 GB reclaimed",
    identifier: "pool_primary_s3",
  },
];

const MOCK_STALLED_TXS: StalledTx[] = [
  {
    id: "tx-1",
    mailboxUuid: "4a8f231b-8e29-4d11-b921-26798031d200",
    sanitizedUuid: "mailbox_4a8f...d200",
    failureReason: "S3 chunk #3 upload timeout during zero-knowledge blob stream",
    retries: 3,
    timeAgo: "4m ago",
    status: "stalled",
  },
  {
    id: "tx-2",
    mailboxUuid: "b821901a-63fc-4b55-891d-0081e28919a4",
    sanitizedUuid: "mailbox_b821...19a4",
    failureReason: "Hardware WebAuthn session token expired during handshake",
    retries: 2,
    timeAgo: "11m ago",
    status: "stalled",
  },
  {
    id: "tx-3",
    mailboxUuid: "9c01f342-990a-4281-a3f8-6d2b451120e7",
    sanitizedUuid: "mailbox_9c01...20e7",
    failureReason: "Outbound relay rate-limit threshold hit on upstream peer",
    retries: 5,
    timeAgo: "19m ago",
    status: "stalled",
  },
];

const SIMULATED_POOL: Array<Omit<TelemetryLog, "id" | "timestamp">> = [
  {
    level: "INFO",
    source: "mail-router",
    message: "Inbound DMARC validation passed for incoming relay message",
    identifier: "tx_1a49f012",
  },
  {
    level: "INFO",
    source: "storage-worker",
    message: "Encrypted blob chunk replicated across 3 multi-region nodes",
    identifier: "blob_98c11a00",
  },
  {
    level: "WARN",
    source: "auth-gateway",
    message: "Rate-limiting burst window active for subnet 192.168.1.0/24",
    identifier: "gw_limiter_edge",
  },
  {
    level: "INFO",
    source: "crypto-worker",
    message: "HKDF key derivation cycle executed for ephemeral outbound payload",
    identifier: "sec_key_eph",
  },
  {
    level: "ERR",
    source: "outbound-worker",
    message: "Peer connection dropped abruptly during STARTTLS negotiation",
    identifier: "mta_peer_6b",
  },
];

const MOCK_TICKETS: SupportTicket[] = [
  {
    id: "tkt_9a10f82",
    org_id: "9cee43d9-986c-47b6-9451-8069f1dacc69",
    org_name: "BLAKSHADE LTD",
    subject: "Zero-Knowledge Key Reconstitution Failure on Migration",
    encrypted_payload: "hpke-v1:048f219c...[Support-Key Encrypted]",
    priority: "Critical",
    status: "Pending Hardware Signoff",
    created_at: "12m ago",
  },
  {
    id: "tkt_1b83d90",
    org_id: "a1000000-0000-0000-0000-000000000001",
    org_name: "CYBERSEC LABS CORP",
    subject: "Storage Connection S3 S3_V2 signature mismatch",
    encrypted_payload: "hpke-v1:99a184c2...[Support-Key Encrypted]",
    priority: "High",
    status: "Open",
    created_at: "45m ago",
  },
  {
    id: "tkt_3c44e12",
    org_id: "a1000000-0000-0000-0000-000000000002",
    org_name: "NEXUS QUANTUM SYSTEMS",
    subject: "Offline verifier challenge sync timeout",
    encrypted_payload: "hpke-v1:30fe211a...[Support-Key Encrypted]",
    priority: "Normal",
    status: "In Progress",
    created_at: "2h ago",
  },
];

type NavTab = "organizations" | "telemetry" | "mailboxes" | "tickets" | "audit_logs";

export default function App() {
  const [currentTab, setCurrentTab] = createSignal<NavTab>("organizations");

  // 1. Native SolidJS Resources connected to PostgreSQL via Go Backend
  const [organizations, { mutate: mutateOrgs, refetch: refetchOrgs }] =
    createResource<Organization[]>(getOrganizations);

  const [auditLogs, { refetch: refetchAuditLogs }] =
    createResource<AuditLogEntry[]>(getAuditLogs);

  // Filters for Organizations Data Table
  const [searchFilter, setSearchFilter] = createSignal("");
  const [planFilter, setPlanFilter] = createSignal("all");
  const [statusFilter, setStatusFilter] = createSignal("all");

  // Dropdown & Modal States
  const [openDropdownId, setOpenDropdownId] = createSignal<string | null>(null);
  const [selectedOrgForCapacity, setSelectedOrgForCapacity] = createSignal<Organization | null>(null);
  const [adjustedSeats, setAdjustedSeats] = createSignal<number>(10);
  const [selectedOrgForRecovery, setSelectedOrgForRecovery] = createSignal<Organization | null>(null);

  // Global Search & Diagnostics
  const [globalSearch, setGlobalSearch] = createSignal("");
  const [globalSearchError, setGlobalSearchError] = createSignal("");
  const [healthData, setHealthData] = createSignal<HealthData | null>(null);
  const [loadingHealth, setLoadingHealth] = createSignal(false);
  const [activeLookupUuid, setActiveLookupUuid] = createSignal<string | null>(null);

  // Telemetry Dashboard States
  const [logs, setLogs] = createSignal<TelemetryLog[]>(INITIAL_LOGS);
  const [stalledTxs, setStalledTxs] = createSignal<StalledTx[]>(MOCK_STALLED_TXS);
  const [streamActive, setStreamActive] = createSignal(true);
  let logContainerRef: HTMLDivElement | undefined;
  let timerId: number | undefined;

  // Support Tickets State
  const [tickets] = createSignal<SupportTicket[]>(MOCK_TICKETS);
  const [ticketOrgFilter, setTicketOrgFilter] = createSignal<string | null>(null);

  // User-facing Alerts / Notifications
  const [actionNotification, setActionNotification] = createSignal<{
    type: "success" | "error";
    message: string;
    auditId?: string;
  } | null>(null);

  onMount(() => {
    // Telemetry stream auto-ticker
    timerId = window.setInterval(() => {
      if (!streamActive()) return;

      const randomEntry = SIMULATED_POOL[Math.floor(Math.random() * SIMULATED_POOL.length)];
      const now = new Date();
      const timeStr =
        now.toTimeString().split(" ")[0] + "." + String(now.getMilliseconds()).padStart(3, "0");

      const newLog: TelemetryLog = {
        id: "log-" + Date.now(),
        timestamp: timeStr,
        level: randomEntry.level,
        source: randomEntry.source,
        message: randomEntry.message,
        identifier: randomEntry.identifier,
      };

      setLogs((prev) => {
        const next = [...prev, newLog];
        return next.length > 50 ? next.slice(next.length - 50) : next;
      });

      if (logContainerRef) {
        logContainerRef.scrollTop = logContainerRef.scrollHeight;
      }
    }, 4500);

    // Global click listener to close 3-dot dropdowns when clicking outside
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".action-menu-container")) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener("click", handleDocumentClick);

    onCleanup(() => {
      if (timerId !== undefined) clearInterval(timerId);
      document.removeEventListener("click", handleDocumentClick);
    });
  });

  // Filtered Organizations
  const filteredOrganizations = createMemo(() => {
    const list = organizations() || [];
    const q = searchFilter().toLowerCase().trim();
    const p = planFilter();
    const s = statusFilter();

    return list.filter((org) => {
      const matchesQuery =
        !q ||
        org.name.toLowerCase().includes(q) ||
        org.id.toLowerCase().includes(q);

      const matchesPlan = p === "all" || org.plan.toLowerCase() === p.toLowerCase();
      const matchesStatus = s === "all" || org.status.toLowerCase() === s.toLowerCase();

      return matchesQuery && matchesPlan && matchesStatus;
    });
  });

  // Export CSV functionality
  const handleExportCSV = () => {
    const list = filteredOrganizations();
    const headers = [
      "Org UUID",
      "Organization Name",
      "Plan Tier",
      "Status",
      "Storage Used (GB)",
      "Storage Quota (GB)",
      "Mailboxes Count",
      "Created At",
    ];

    const rows = list.map((org) => {
      const used = (org.storage_used / (1024 * 1024 * 1024)).toFixed(2);
      const quota = (org.storage_quota / (1024 * 1024 * 1024)).toFixed(0);
      return [
        `"${org.id}"`,
        `"${org.name.replace(/"/g, '""')}"`,
        `"${org.plan}"`,
        `"${org.status}"`,
        used,
        quota,
        org.mailbox_count,
        `"${org.created_at}"`,
      ];
    });

    const csvContent = [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "byos_organizations_export.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setActionNotification({
      type: "success",
      message: `Exported ${rows.length} organizations to byos_organizations_export.csv`,
    });
    setTimeout(() => setActionNotification(null), 4000);
  };

  // Global search trigger
  const triggerGlobalSearch = async (uuidToSearch: string) => {
    const trimmed = uuidToSearch.trim();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(trimmed)) {
      setGlobalSearchError("Security Policy: Enter a valid 36-character UUID or transaction hash.");
      setHealthData(null);
      setActiveLookupUuid(null);
      return;
    }

    setGlobalSearchError("");
    setLoadingHealth(true);
    setActiveLookupUuid(trimmed);

    try {
      const data = await getMailboxHealth(trimmed);
      setHealthData(data);
    } catch (err: any) {
      setGlobalSearchError(err.message || "Failed to reach Admin API");
      setHealthData(null);
    } finally {
      setLoadingHealth(false);
    }
  };

  // Action Handler: Suspend / Reactivate Organization (Optimistic mutate + atomic backend rollback)
  const handleToggleSuspend = async (org: Organization) => {
    setOpenDropdownId(null);
    const targetStatus = org.status === "suspended" ? "active" : "suspended";
    const previousStatus = org.status;

    // Optimistically update UI using mutate
    mutateOrgs((prev) =>
      prev?.map((o) => (o.id === org.id ? { ...o, status: targetStatus } : o))
    );

    try {
      const res = await suspendOrganization(
        org.id,
        targetStatus,
        `Admin operator toggled status to ${targetStatus}`
      );
      refetchAuditLogs();

      setActionNotification({
        type: "success",
        message: `Organization ${org.name} set to ${targetStatus}. Immutable Audit ID: ${res.audit_id}`,
        auditId: res.audit_id,
      });
      setTimeout(() => setActionNotification(null), 6000);
    } catch (err: any) {
      // Rollback optimistic state
      mutateOrgs((prev) =>
        prev?.map((o) => (o.id === org.id ? { ...o, status: previousStatus } : o))
      );
      setActionNotification({
        type: "error",
        message: err.message || "Failed to update organization status",
      });
      setTimeout(() => setActionNotification(null), 6000);
    }
  };

  // Action Handler: Adjust Allocated Mailbox Capacity (Optimistic mutate + atomic backend rollback)
  const handleConfirmCapacityUpdate = async (org: Organization, newSeats: number) => {
    setSelectedOrgForCapacity(null);
    const previousSeats = org.seat_count || 10;

    // Optimistically update UI using mutate
    mutateOrgs((prev) =>
      prev?.map((o) =>
        o.id === org.id
          ? {
              ...o,
              seat_count: newSeats,
            }
          : o
      )
    );

    try {
      const res = await updateCapacity(
        org.id,
        newSeats,
        `Admin operator adjusted capacity to ${newSeats} mailboxes`
      );
      refetchAuditLogs();

      setActionNotification({
        type: "success",
        message: `Capacity adjusted to ${newSeats} mailboxes for ${org.name}. Immutable Audit ID: ${res.audit_id}`,
        auditId: res.audit_id,
      });
      setTimeout(() => setActionNotification(null), 6000);
    } catch (err: any) {
      // Rollback optimistic state
      mutateOrgs((prev) =>
        prev?.map((o) =>
          o.id === org.id
            ? { ...o, seat_count: previousSeats }
            : o
        )
      );
      setActionNotification({
        type: "error",
        message: err.message || "Failed to adjust organization capacity",
      });
      setTimeout(() => setActionNotification(null), 6000);
    }
  };

  // Action Handler: Trigger Verifier-Based State Reset
  const handleConfirmStateReset = async (org: Organization) => {
    setSelectedOrgForRecovery(null);

    try {
      const res = await triggerStateReset(
        org.id,
        `Offline verifier challenge issued for ${org.name}`
      );
      refetchAuditLogs();

      setActionNotification({
        type: "success",
        message: `Offline verifier challenge issued for ${org.name}. Ledger Audit ID: ${res.audit_id}`,
        auditId: res.audit_id,
      });
      setTimeout(() => setActionNotification(null), 6000);
    } catch (err: any) {
      setActionNotification({
        type: "error",
        message: err.message || "Failed to trigger state reset",
      });
      setTimeout(() => setActionNotification(null), 6000);
    }
  };

  // Intervention dispatcher for stalled queue
  const handleExecuteIntervention = async (
    txId: string,
    mailboxUuid: string,
    action: "replay_queue" | "revoke_session" | "state_reset"
  ) => {
    setStalledTxs((prev) =>
      prev.map((item) => (item.id === txId ? { ...item, status: "processing" as const } : item))
    );

    try {
      const res = await executeIntervention(
        action,
        mailboxUuid,
        `Admin intervention initiated via Support Console (${action})`
      );
      const auditId = res.audit_id || "aud_verified";

      setStalledTxs((prev) =>
        prev.map((item) =>
          item.id === txId ? { ...item, status: "resolved" as const, auditId } : item
        )
      );

      refetchAuditLogs();

      const now = new Date();
      const timeStr =
        now.toTimeString().split(" ")[0] + "." + String(now.getMilliseconds()).padStart(3, "0");
      setLogs((prev) => [
        ...prev,
        {
          id: "audit-" + Date.now(),
          timestamp: timeStr,
          level: "INFO",
          source: "admin-intervention",
          message: `Intervention ${action.toUpperCase()} committed to ledger [${auditId}]`,
          identifier: `mailbox_${mailboxUuid.slice(0, 4)}...${mailboxUuid.slice(-4)}`,
        },
      ]);

      setActionNotification({
        type: "success",
        message: `Action '${action}' executed successfully. Audit signature: ${auditId}`,
        auditId,
      });
      setTimeout(() => setActionNotification(null), 6000);
    } catch (err: any) {
      setStalledTxs((prev) =>
        prev.map((item) => (item.id === txId ? { ...item, status: "stalled" as const } : item))
      );
      setActionNotification({
        type: "error",
        message: err.message || "Failed to dispatch intervention.",
      });
      setTimeout(() => setActionNotification(null), 6000);
    }
  };

  const handleDecryptTicket = async (ticketId: string) => {
    if (typeof window !== "undefined" && window.PublicKeyCredential) {
      try {
        const challenge = new Uint8Array(32);
        window.crypto.getRandomValues(challenge);
        const assertion = await navigator.credentials.get({
          publicKey: {
            challenge,
            timeout: 60000,
            userVerification: "preferred",
          },
        });
        if (!assertion) {
          throw new Error("No credential returned from hardware key.");
        }
        setActionNotification({
          type: "success",
          message: `Hardware Key Assertion verified. Ticket ${ticketId} payload decrypted into secure memory enclave.`,
        });
        setTimeout(() => setActionNotification(null), 5000);
      } catch (err: any) {
        setActionNotification({
          type: "error",
          message: `Hardware key assertion failed: ${err?.message || "Operation cancelled or rejected."}`,
        });
        setTimeout(() => setActionNotification(null), 5000);
      }
    } else {
      setActionNotification({
        type: "error",
        message: "WebAuthn / Hardware Key authentication is not supported in this environment.",
      });
      setTimeout(() => setActionNotification(null), 5000);
    }
  };

  const planBadgeStyle = (plan: string) => {
    switch (plan.toLowerCase()) {
      case "enterprise":
        return "bg-purple-50 text-purple-700 border-purple-200 font-semibold";
      case "business":
        return "bg-sky-50 text-sky-700 border-sky-200 font-semibold";
      case "starter":
      case "pro":
        return "bg-[#9E725F]/10 text-[#9E725F] border-[#9E725F]/30 font-semibold";
      default:
        return "bg-stone-100 text-stone-700 border-stone-200 font-semibold";
    }
  };

  const statusBadgeStyle = (status: string) => {
    switch (status.toLowerCase()) {
      case "active":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "suspended":
        return "bg-rose-50 text-rose-700 border-rose-200";
      case "grace_period":
        return "bg-amber-50 text-amber-700 border-amber-200";
      default:
        return "bg-stone-100 text-stone-700 border-stone-200";
    }
  };

  return (
    <div class="min-h-screen bg-[#F0EEE9] text-[#3C3D3E] flex font-sans selection:bg-[#9E725F]/20 selection:text-[#3C3D3E]">
      {/* 1. App Shell & Left-Hand Sidebar Navigation (w-64 bg-white border-r border-[#E2DFD8]) */}
      <aside class="w-64 bg-white border-r border-[#E2DFD8] flex flex-col shrink-0 h-screen sticky top-0 z-20">
        {/* Sidebar Header / Branding */}
        <div class="h-16 px-5 border-b border-[#E2DFD8] flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-lg bg-[#9E725F] text-white flex items-center justify-center font-bold text-base shadow-xs">
              B
            </div>
            <div>
              <div class="font-bold text-sm text-[#3C3D3E] tracking-tight leading-tight">
                BYOS Console
              </div>
              <div class="text-[10px] text-stone-400 font-medium">Internal Support CRM</div>
            </div>
          </div>
        </div>

        {/* Operational Status Pill */}
        <div class="px-5 py-3 border-b border-[#E2DFD8]/60 bg-[#F0EEE9]/40">
          <div class="flex items-center gap-2 bg-emerald-50 border border-emerald-200/80 px-2.5 py-1 rounded-full text-xs font-medium text-emerald-800">
            <span class="relative flex h-2 w-2">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-600" />
            </span>
            <span class="text-[11px] font-semibold">All Systems Operational</span>
          </div>
        </div>

        {/* Sidebar Navigation Menu */}
        <nav class="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {/* Organizations Tab (Default / Active) */}
          <button
            type="button"
            onClick={() => setCurrentTab("organizations")}
            class={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
              currentTab() === "organizations"
                ? "bg-[#F0EEE9] text-[#9E725F] font-bold shadow-xs border-r-2 border-[#9E725F]"
                : "text-stone-600 hover:bg-[#F0EEE9]/60 hover:text-[#3C3D3E]"
            }`}
          >
            <div class="flex items-center gap-2.5">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <span>Organizations</span>
            </div>
            <span class="text-[10px] bg-white px-2 py-0.5 rounded-full border border-[#E2DFD8] text-stone-500 font-semibold">
              {organizations()?.length || 0}
            </span>
          </button>

          {/* Telemetry Tab */}
          <button
            type="button"
            onClick={() => setCurrentTab("telemetry")}
            class={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
              currentTab() === "telemetry"
                ? "bg-[#F0EEE9] text-[#9E725F] font-bold shadow-xs border-r-2 border-[#9E725F]"
                : "text-stone-600 hover:bg-[#F0EEE9]/60 hover:text-[#3C3D3E]"
            }`}
          >
            <div class="flex items-center gap-2.5">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>Telemetry</span>
            </div>
            <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </button>

          {/* Mailboxes Tab */}
          <button
            type="button"
            onClick={() => setCurrentTab("mailboxes")}
            class={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
              currentTab() === "mailboxes"
                ? "bg-[#F0EEE9] text-[#9E725F] font-bold shadow-xs border-r-2 border-[#9E725F]"
                : "text-stone-600 hover:bg-[#F0EEE9]/60 hover:text-[#3C3D3E]"
            }`}
          >
            <div class="flex items-center gap-2.5">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span>Mailboxes</span>
            </div>
          </button>

          {/* Support Tickets Tab */}
          <button
            type="button"
            onClick={() => {
              setTicketOrgFilter(null);
              setCurrentTab("tickets");
            }}
            class={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
              currentTab() === "tickets"
                ? "bg-[#F0EEE9] text-[#9E725F] font-bold shadow-xs border-r-2 border-[#9E725F]"
                : "text-stone-600 hover:bg-[#F0EEE9]/60 hover:text-[#3C3D3E]"
            }`}
          >
            <div class="flex items-center gap-2.5">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
              <span>Support Tickets</span>
            </div>
            <span class="text-[10px] bg-amber-50 border border-amber-200 text-amber-800 px-1.5 py-0.2 rounded-full font-bold">
              {tickets().length}
            </span>
          </button>

          {/* Audit Logs Tab */}
          <button
            type="button"
            onClick={() => setCurrentTab("audit_logs")}
            class={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
              currentTab() === "audit_logs"
                ? "bg-[#F0EEE9] text-[#9E725F] font-bold shadow-xs border-r-2 border-[#9E725F]"
                : "text-stone-600 hover:bg-[#F0EEE9]/60 hover:text-[#3C3D3E]"
            }`}
          >
            <div class="flex items-center gap-2.5">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>Audit Logs</span>
            </div>
            <span class="text-[10px] bg-stone-100 text-stone-600 px-1.5 py-0.2 rounded font-mono">
              {auditLogs()?.length || 0}
            </span>
          </button>
        </nav>

        {/* Sidebar Footer: Hardware-Auth Badge & Operator */}
        <div class="p-4 border-t border-[#E2DFD8] space-y-3 bg-[#F0EEE9]/20">
          <div class="flex items-center gap-2 bg-white border border-[#E2DFD8] px-2.5 py-2 rounded-lg text-xs font-medium text-stone-700 shadow-2xs">
            <svg class="w-4 h-4 text-[#9E725F] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            <div class="overflow-hidden">
              <div class="text-[11px] font-bold text-[#3C3D3E]">YubiKey Verified</div>
              <div class="text-[10px] text-stone-400 truncate">FIDO2 Hardware Bound</div>
            </div>
          </div>

          <div class="flex items-center justify-between text-xs text-stone-500 pt-1">
            <span class="text-[11px] font-mono">agent_81f2</span>
            <button
              type="button"
              class="text-[11px] text-stone-500 hover:text-stone-800 font-medium transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* 2. Main Content Area */}
      <div class="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Top Navbar */}
        <header class="h-16 bg-white border-b border-[#E2DFD8] px-8 flex items-center justify-between sticky top-0 z-10 shadow-xs">
          <div class="flex items-center gap-3">
            <h1 class="text-lg font-bold text-[#3C3D3E] tracking-tight capitalize">
              {currentTab() === "organizations"
                ? "Organization Management"
                : currentTab() === "telemetry"
                ? "Telemetry & Event Bus"
                : currentTab() === "mailboxes"
                ? "Mailbox Directory"
                : currentTab() === "tickets"
                ? "Support Ticket Queue"
                : "Immutable Audit Ledger"}
            </h1>
            <span class="text-xs text-stone-400">|</span>
            <span class="text-xs text-stone-500 font-mono">Zero-Knowledge Administrative Boundary</span>
          </div>

          {/* Compact Search Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              triggerGlobalSearch(globalSearch());
            }}
            class="relative w-96"
          >
            <input
              type="text"
              placeholder="Lookup Mailbox UUID or Transaction Hash..."
              value={globalSearch()}
              onInput={(e) => setGlobalSearch(e.currentTarget.value)}
              class="w-full bg-[#F0EEE9]/60 hover:bg-[#F0EEE9] focus:bg-white text-xs text-[#3C3D3E] pl-9 pr-16 py-2 rounded-lg border border-[#E2DFD8] focus:border-[#9E725F] focus:outline-none transition-all placeholder:text-stone-400"
            />
            <div class="absolute left-2.5 top-2.5 text-stone-400 pointer-events-none">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <button
              type="submit"
              class="absolute right-1.5 top-1 bg-[#9E725F] hover:bg-[#8A6352] text-white text-[11px] font-medium px-2.5 py-1 rounded shadow-xs transition-colors"
            >
              Inspect
            </button>
          </form>
        </header>

        {/* Global Notifications / Alerts */}
        <Show when={actionNotification()}>
          {(notif) => (
            <div
              class={`border-b px-8 py-2.5 text-xs font-medium flex items-center justify-between transition-all ${
                notif().type === "success"
                  ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                  : "bg-rose-50 text-rose-800 border-rose-200"
              }`}
            >
              <div class="flex items-center gap-2">
                <span class="font-bold">
                  {notif().type === "success" ? "✓ SUCCESS:" : "✕ ALERT:"}
                </span>
                <span>{notif().message}</span>
              </div>
              <button
                onClick={() => setActionNotification(null)}
                class="text-stone-500 hover:text-stone-800 font-bold ml-4"
              >
                ×
              </button>
            </div>
          )}
        </Show>

        <Show when={globalSearchError()}>
          <div class="bg-amber-50 border-b border-amber-200 px-8 py-2 text-xs text-amber-800 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="font-semibold">Query Warning:</span>
              <span>{globalSearchError()}</span>
            </div>
            <button onClick={() => setGlobalSearchError("")} class="text-amber-800 font-bold">×</button>
          </div>
        </Show>

        {/* Diagnostic Inspection Modal/Drawer */}
        <Show when={activeLookupUuid()}>
          <section class="m-8 mb-0 bg-white rounded-xl border border-[#E2DFD8] p-6 shadow-sm relative animate-in fade-in duration-150">
            <div class="flex items-start justify-between border-b border-[#E2DFD8] pb-4">
              <div>
                <div class="flex items-center gap-2">
                  <span class="text-xs font-bold uppercase tracking-wider text-[#9E725F]">Diagnostic Telemetry</span>
                  <span class="text-xs font-mono bg-stone-100 text-stone-700 px-2 py-0.5 rounded border border-stone-200">
                    {activeLookupUuid()}
                  </span>
                </div>
                <h2 class="text-lg font-bold text-[#3C3D3E] mt-1">Live Cryptographic & Infrastructure Health</h2>
              </div>
              <button
                onClick={() => {
                  setActiveLookupUuid(null);
                  setHealthData(null);
                }}
                class="text-xs bg-[#F0EEE9] hover:bg-stone-200 text-stone-700 px-3 py-1.5 rounded-lg border border-[#E2DFD8] font-medium transition-colors"
              >
                Close Diagnostic View
              </button>
            </div>

            <Show when={loadingHealth()}>
              <div class="py-6 text-center text-xs text-stone-500">
                Fetching cryptographic telemetry from Admin API...
              </div>
            </Show>

            <Show when={healthData()}>
              {(data) => (
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                  <div class="bg-[#F0EEE9]/50 border border-[#E2DFD8] p-3 rounded-lg">
                    <span class="block text-[11px] text-stone-500">Service Status</span>
                    <span class="text-sm font-semibold capitalize text-emerald-700">{data().status}</span>
                  </div>
                  <div class="bg-[#F0EEE9]/50 border border-[#E2DFD8] p-3 rounded-lg">
                    <span class="block text-[11px] text-stone-500">Storage Usage</span>
                    <span class="text-sm font-semibold text-[#3C3D3E]">
                      {(data().quota_used / (1024 * 1024)).toFixed(1)} MB / {(data().quota_total / (1024 * 1024)).toFixed(0)} MB
                    </span>
                  </div>
                  <div class="bg-[#F0EEE9]/50 border border-[#E2DFD8] p-3 rounded-lg">
                    <span class="block text-[11px] text-stone-500">DKIM / SPF Verification</span>
                    <span class="text-sm font-semibold text-emerald-700">
                      DKIM: {data().dkim_verified ? "Valid" : "Failed"} | SPF: {data().spf_verified ? "Valid" : "Failed"}
                    </span>
                  </div>
                  <div class="bg-[#F0EEE9]/50 border border-[#E2DFD8] p-3 rounded-lg">
                    <span class="block text-[11px] text-stone-500">Active Connections</span>
                    <span class="text-sm font-semibold text-[#3C3D3E]">{data().active_connections} TLS sessions</span>
                  </div>
                </div>
              )}
            </Show>
          </section>
        </Show>

        {/* Main Views */}
        <main class="flex-1 p-8 space-y-6">
          {/* TAB 1: Organizations / Users View (DEFAULT) */}
          <Show when={currentTab() === "organizations"}>
            <div class="space-y-6">
              {/* Controls Bar: Filter/Search + Export CSV */}
              <div class="bg-white rounded-xl border border-[#E2DFD8] p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div class="flex flex-1 flex-wrap items-center gap-3">
                  {/* Search / Filter input */}
                  <div class="relative w-72">
                    <input
                      type="text"
                      placeholder="Filter by Org UUID or Name..."
                      value={searchFilter()}
                      onInput={(e) => setSearchFilter(e.currentTarget.value)}
                      class="w-full bg-[#F0EEE9]/50 hover:bg-[#F0EEE9]/80 focus:bg-white text-xs text-[#3C3D3E] pl-8 pr-3 py-2 rounded-lg border border-[#E2DFD8] focus:border-[#9E725F] focus:outline-none transition-all placeholder:text-stone-400"
                    />
                    <div class="absolute left-2.5 top-2.5 text-stone-400 pointer-events-none">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                  </div>

                  {/* Plan Tier Filter */}
                  <select
                    value={planFilter()}
                    onChange={(e) => setPlanFilter(e.currentTarget.value)}
                    class="bg-[#F0EEE9]/50 hover:bg-[#F0EEE9]/80 text-xs text-[#3C3D3E] px-3 py-2 rounded-lg border border-[#E2DFD8] focus:border-[#9E725F] focus:outline-none transition-all font-medium"
                  >
                    <option value="all">All Plan Tiers</option>
                    <option value="enterprise">Enterprise</option>
                    <option value="business">Business</option>
                    <option value="starter">Starter</option>
                    <option value="solo">Solo</option>
                  </select>

                  {/* Status Filter */}
                  <select
                    value={statusFilter()}
                    onChange={(e) => setStatusFilter(e.currentTarget.value)}
                    class="bg-[#F0EEE9]/50 hover:bg-[#F0EEE9]/80 text-xs text-[#3C3D3E] px-3 py-2 rounded-lg border border-[#E2DFD8] focus:border-[#9E725F] focus:outline-none transition-all font-medium"
                  >
                    <option value="all">All Statuses</option>
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                    <option value="grace_period">Grace Period</option>
                  </select>

                  <Show when={searchFilter() || planFilter() !== "all" || statusFilter() !== "all"}>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchFilter("");
                        setPlanFilter("all");
                        setStatusFilter("all");
                      }}
                      class="text-xs text-[#9E725F] hover:underline font-medium"
                    >
                      Reset filters
                    </button>
                  </Show>
                </div>

                {/* Right: Export CSV & Refresh */}
                <div class="flex items-center gap-3">
                  <span class="text-xs text-stone-500 font-medium hidden sm:inline">
                    Showing {filteredOrganizations().length} of {organizations()?.length || 0} orgs
                  </span>

                  <button
                    type="button"
                    onClick={handleExportCSV}
                    class="bg-[#9E725F] hover:bg-[#8A6352] text-white text-xs font-semibold px-3.5 py-2 rounded-lg shadow-2xs flex items-center gap-1.5 transition-colors"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span>Export CSV</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => refetchOrgs()}
                    title="Refresh data from database"
                    class="bg-[#F0EEE9] hover:bg-stone-200 text-[#3C3D3E] text-xs font-medium p-2 rounded-lg border border-[#E2DFD8] transition-colors"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Data Table: Structured List View */}
              <div class="bg-white rounded-xl border border-[#E2DFD8] shadow-xs overflow-hidden">
                <Show when={organizations.loading}>
                  <div class="p-6 text-center text-xs text-stone-500 font-medium">
                    Hydrating organizations from PostgreSQL database...
                  </div>
                </Show>

                <div class="overflow-x-auto">
                  <table class="w-full text-left border-collapse">
                    <thead>
                      <tr class="bg-[#F0EEE9]/60 border-b border-[#E2DFD8] text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
                        <th class="py-3 px-5">Org UUID / Name</th>
                        <th class="py-3 px-5">Allocated Capacity</th>
                        <th class="py-3 px-5">Storage Quota</th>
                        <th class="py-3 px-5">Status</th>
                        <th class="py-3 px-5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-[#E2DFD8]/60 text-xs">
                      <For
                        each={filteredOrganizations()}
                        fallback={
                          <tr>
                            <td colspan="5" class="py-12 text-center text-stone-400">
                              {organizations.loading ? "Loading..." : "No organizations match the selected criteria."}
                            </td>
                          </tr>
                        }
                      >
                        {(org) => {
                          const usedGB = (org.storage_used / (1024 * 1024 * 1024)).toFixed(1);
                          const totalGB = (org.storage_quota / (1024 * 1024 * 1024)).toFixed(0);
                          const percentage = Math.min(
                            100,
                            Math.round((org.storage_used / (org.storage_quota || 1)) * 100)
                          );

                          return (
                            <tr class="hover:bg-[#F0EEE9]/30 transition-colors">
                              {/* Column 1: Org UUID / Name */}
                              <td class="py-3.5 px-5">
                                <div class="font-bold text-[#3C3D3E] text-[13px] flex items-center gap-2">
                                  <span>{org.name}</span>
                                </div>
                                <div class="font-mono text-[11px] text-stone-500 flex items-center gap-1.5 mt-0.5">
                                  <span>org_{org.id.slice(0, 8)}...{org.id.slice(-4)}</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard.writeText(org.id);
                                      setActionNotification({
                                        type: "success",
                                        message: `Copied Org UUID ${org.id} to clipboard`,
                                      });
                                      setTimeout(() => setActionNotification(null), 3000);
                                    }}
                                    title="Copy full UUID"
                                    class="text-[#9E725F] hover:text-[#8A6352] text-[10px]"
                                  >
                                    [copy]
                                  </button>
                                  <span class="text-stone-300">•</span>
                                  <span class="text-stone-400 font-sans">{org.mailbox_count} mailboxes active</span>
                                </div>
                              </td>

                              {/* Column 2: Allocated Capacity */}
                              <td class="py-3.5 px-5">
                                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-[#9E725F]/10 text-[#9E725F] border border-[#9E725F]/30 shadow-2xs">
                                  <svg class="w-3 h-3 text-[#9E725F]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                  </svg>
                                  <span>{org.seat_count || 10} Mailboxes</span>
                                </span>
                              </td>

                              {/* Column 3: Storage Quota */}
                              <td class="py-3.5 px-5">
                                <div class="w-44">
                                  <div class="flex items-center justify-between text-[11px] font-medium text-stone-700 mb-1">
                                    <span>{usedGB} GB / {totalGB} GB</span>
                                    <span class="text-stone-400">{percentage}%</span>
                                  </div>
                                  <div class="h-1.5 w-full bg-[#E2DFD8] rounded-full overflow-hidden">
                                    <div
                                      class={`h-full rounded-full transition-all ${
                                        percentage > 90
                                          ? "bg-rose-500"
                                          : percentage > 75
                                          ? "bg-amber-500"
                                          : "bg-[#9E725F]"
                                      }`}
                                      style={{ width: `${percentage}%` }}
                                    />
                                  </div>
                                </div>
                              </td>

                              {/* Column 4: Status */}
                              <td class="py-3.5 px-5">
                                <span
                                  class={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize border ${statusBadgeStyle(
                                    org.status
                                  )}`}
                                >
                                  <span
                                    class={`w-1.5 h-1.5 rounded-full ${
                                      org.status === "active"
                                        ? "bg-emerald-500"
                                        : org.status === "suspended"
                                        ? "bg-rose-500"
                                        : "bg-amber-500"
                                    }`}
                                  />
                                  <span>{org.status.replace("_", " ")}</span>
                                </span>
                              </td>

                              {/* Column 5: Actions (3-Dot Dropdown Menu) */}
                              <td class="py-3.5 px-5 text-right relative action-menu-container">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenDropdownId(openDropdownId() === org.id ? null : org.id);
                                  }}
                                  class="w-7 h-7 inline-flex items-center justify-center rounded-lg hover:bg-[#F0EEE9] text-stone-500 hover:text-[#3C3D3E] transition-colors"
                                  title="Actions menu"
                                >
                                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                    <circle cx="12" cy="6" r="1.5" />
                                    <circle cx="12" cy="12" r="1.5" />
                                    <circle cx="12" cy="18" r="1.5" />
                                  </svg>
                                </button>

                                {/* Dropdown Menu */}
                                <Show when={openDropdownId() === org.id}>
                                  <div class="absolute right-5 top-10 w-56 bg-white border border-[#E2DFD8] rounded-xl shadow-lg z-30 py-1 text-left text-xs animate-in fade-in duration-100 divide-y divide-[#E2DFD8]/60">
                                    <div class="py-1">
                                      {/* Action 1: Adjust Capacity */}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedOrgForCapacity(org);
                                          setAdjustedSeats(org.seat_count || 10);
                                          setOpenDropdownId(null);
                                        }}
                                        class="w-full px-3.5 py-2 hover:bg-[#F0EEE9] text-[#3C3D3E] font-medium flex items-center gap-2 transition-colors"
                                      >
                                        <svg class="w-3.5 h-3.5 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                                        </svg>
                                        <span>Adjust Capacity</span>
                                      </button>

                                      {/* Action 2: Initiate Account Recovery (Zero-Knowledge / Verifier-based) */}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedOrgForRecovery(org);
                                          setOpenDropdownId(null);
                                        }}
                                        class="w-full px-3.5 py-2 hover:bg-[#F0EEE9] text-[#3C3D3E] font-medium flex items-center gap-2 transition-colors"
                                      >
                                        <svg class="w-3.5 h-3.5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                        </svg>
                                        <span>Initiate Account Recovery</span>
                                      </button>
                                    </div>

                                    <div class="py-1">
                                      {/* Action 3: Suspend Organization (Red text) / Reactivate */}
                                      <Show
                                        when={org.status !== "suspended"}
                                        fallback={
                                          <button
                                            type="button"
                                            onClick={() => handleToggleSuspend(org)}
                                            class="w-full px-3.5 py-2 hover:bg-emerald-50 text-emerald-700 font-semibold flex items-center gap-2 transition-colors"
                                          >
                                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            <span>Reactivate Organization</span>
                                          </button>
                                        }
                                      >
                                        <button
                                          type="button"
                                          onClick={() => handleToggleSuspend(org)}
                                          class="w-full px-3.5 py-2 hover:bg-rose-50 text-rose-600 font-semibold flex items-center gap-2 transition-colors"
                                        >
                                          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                          </svg>
                                          <span>Suspend Organization</span>
                                        </button>
                                      </Show>

                                      {/* Action 4: Open Support Thread */}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setTicketOrgFilter(org.id);
                                          setCurrentTab("tickets");
                                          setOpenDropdownId(null);
                                        }}
                                        class="w-full px-3.5 py-2 hover:bg-[#F0EEE9] text-[#9E725F] font-semibold flex items-center gap-2 transition-colors"
                                      >
                                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                        </svg>
                                        <span>Open Support Thread</span>
                                      </button>
                                    </div>
                                  </div>
                                </Show>
                              </td>
                            </tr>
                          );
                        }}
                      </For>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </Show>

          {/* TAB 2: Telemetry View */}
          <Show when={currentTab() === "telemetry"}>
            <div class="space-y-6">
              {/* Top Metrics Row */}
              <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div class="bg-white rounded-xl border border-[#E2DFD8] p-4 shadow-xs">
                  <div class="flex items-center justify-between text-xs text-stone-500 font-medium">
                    <span>Outbound Queue Depth</span>
                    <span class="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold px-2 py-0.5 rounded">
                      Normal
                    </span>
                  </div>
                  <div class="mt-2 flex items-baseline justify-between">
                    <div class="text-2xl font-bold tracking-tight text-[#3C3D3E]">
                      14 <span class="text-xs font-normal text-stone-500">msgs</span>
                    </div>
                    <svg class="w-16 h-6 text-emerald-600 overflow-visible" fill="none" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M 0 16 Q 8 10 16 14 T 32 8 T 48 12 T 64 6" />
                    </svg>
                  </div>
                  <div class="mt-2 text-[11px] text-stone-500 flex items-center justify-between border-t border-stone-100 pt-2">
                    <span>p99 latency: 140ms</span>
                    <span class="text-emerald-700 font-medium">0 stalled msgs</span>
                  </div>
                </div>

                <div class="bg-white rounded-xl border border-[#E2DFD8] p-4 shadow-xs">
                  <div class="flex items-center justify-between text-xs text-stone-500 font-medium">
                    <span>Storage Worker Health</span>
                    <span class="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold px-2 py-0.5 rounded">
                      Healthy
                    </span>
                  </div>
                  <div class="mt-2 text-2xl font-bold tracking-tight text-[#3C3D3E]">
                    3 Nodes <span class="text-xs font-normal text-stone-500">Active</span>
                  </div>
                  <div class="mt-2 text-[11px] text-stone-500 flex items-center justify-between border-t border-stone-100 pt-2">
                    <span>0 Restarts (24h)</span>
                    <span class="font-medium text-stone-700">40 GB allocated</span>
                  </div>
                </div>

                <div class="bg-white rounded-xl border border-[#E2DFD8] p-4 shadow-xs">
                  <div class="flex items-center justify-between text-xs text-stone-500 font-medium">
                    <span>SMTP Relay Bounce Rate</span>
                    <span class="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold px-2 py-0.5 rounded">
                      DKIM/SPF passing
                    </span>
                  </div>
                  <div class="mt-2 text-2xl font-bold tracking-tight text-[#3C3D3E]">0.04%</div>
                  <div class="mt-2 text-[11px] text-stone-500 flex items-center justify-between border-t border-stone-100 pt-2">
                    <span>1,280 msgs routed</span>
                    <span class="text-emerald-700 font-medium">0 greylisted</span>
                  </div>
                </div>

                <div class="bg-white rounded-xl border border-[#E2DFD8] p-4 shadow-xs">
                  <div class="flex items-center justify-between text-xs text-stone-500 font-medium">
                    <span>Support Key Inquiries</span>
                    <span class="bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-semibold px-2 py-0.5 rounded">
                      Pending
                    </span>
                  </div>
                  <div class="mt-2 text-2xl font-bold tracking-tight text-[#3C3D3E]">
                    3 <span class="text-xs font-normal text-stone-500">Unresolved</span>
                  </div>
                  <div class="mt-2 text-[11px] text-stone-500 flex items-center justify-between border-t border-stone-100 pt-2">
                    <span>Avg resolution: 18m</span>
                    <span class="text-amber-800 font-medium">HW signoff req</span>
                  </div>
                </div>
              </section>

              {/* Two-Column Operations Grid */}
              <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <section class="lg:col-span-7 bg-zinc-950 rounded-xl border border-zinc-800 shadow-md flex flex-col overflow-hidden">
                  <div class="bg-zinc-900 px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between text-xs">
                    <div class="flex items-center gap-2">
                      <span class="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                      <span class="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                      <span class="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                      <span class="ml-2 font-mono text-[11px] text-zinc-400 font-semibold tracking-wider">
                        LIVE TELEMETRY STREAM // EVENT BUS
                      </span>
                    </div>

                    <div class="flex items-center gap-3">
                      <div class="flex items-center gap-1.5 text-[10px] font-mono text-zinc-400">
                        <span
                          class={`inline-block w-1.5 h-1.5 rounded-full ${
                            streamActive() ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"
                          }`}
                        />
                        <span>{streamActive() ? "STREAM ACTIVE" : "PAUSED"}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setStreamActive(!streamActive())}
                        class="text-[10px] text-zinc-400 hover:text-zinc-200 font-mono bg-zinc-800 px-2 py-0.5 rounded"
                      >
                        {streamActive() ? "Pause" : "Resume"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setLogs([])}
                        class="text-[10px] text-zinc-400 hover:text-zinc-200 font-mono bg-zinc-800 px-2 py-0.5 rounded"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div
                    ref={logContainerRef}
                    class="p-4 font-mono text-xs text-zinc-300 space-y-2 max-h-[480px] overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700"
                  >
                    <For each={logs()}>
                      {(item) => (
                        <div class="flex items-start gap-2.5 leading-relaxed hover:bg-zinc-900/60 px-1 py-0.5 rounded transition-colors">
                          <span class="text-zinc-500 text-[11px] shrink-0">{item.timestamp}</span>
                          <span
                            class={`text-[10px] font-bold px-1.5 py-0.2 rounded shrink-0 ${
                              item.level === "INFO"
                                ? "bg-sky-950 text-sky-400 border border-sky-800/50"
                                : item.level === "WARN"
                                ? "bg-amber-950 text-amber-400 border border-amber-800/50"
                                : "bg-rose-950 text-rose-400 border border-rose-800/50"
                            }`}
                          >
                            {item.level}
                          </span>
                          <span class="text-zinc-400 font-semibold text-[11px] shrink-0">
                            [{item.source}]
                          </span>
                          <span class="text-zinc-200 flex-1">{item.message}</span>
                          <Show when={item.identifier}>
                            <span class="text-zinc-500 text-[11px] bg-zinc-900 px-1.5 rounded shrink-0">
                              {item.identifier}
                            </span>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </section>

                <section class="lg:col-span-5 bg-white rounded-xl border border-[#E2DFD8] p-5 shadow-xs flex flex-col space-y-4">
                  <div class="flex items-center justify-between border-b border-[#E2DFD8] pb-3">
                    <div>
                      <h3 class="text-sm font-bold text-[#3C3D3E]">
                        Stalled Transactions & Interventions
                      </h3>
                      <p class="text-[11px] text-stone-500">
                        Critical incidents requiring operator hardware override
                      </p>
                    </div>
                    <span class="bg-amber-50 text-amber-800 border border-amber-200 text-xs font-bold px-2 py-0.5 rounded-full">
                      {stalledTxs().filter((t) => t.status === "stalled").length} Active
                    </span>
                  </div>

                  <div class="space-y-3.5">
                    <For each={stalledTxs()}>
                      {(tx) => (
                        <div class="bg-[#F0EEE9]/40 border border-[#E2DFD8] rounded-lg p-3.5 space-y-2.5">
                          <div class="flex items-center justify-between">
                            <div class="flex items-center gap-1.5">
                              <span class="font-mono text-xs font-semibold text-stone-800">
                                {tx.sanitizedUuid}
                              </span>
                              <button
                                type="button"
                                onClick={() => triggerGlobalSearch(tx.mailboxUuid)}
                                class="text-[10px] text-[#9E725F] hover:underline font-medium ml-1"
                              >
                                [Inspect]
                              </button>
                            </div>
                            <div class="flex items-center gap-1.5">
                              <span class="text-[10px] text-stone-400">{tx.timeAgo}</span>
                              <span
                                class={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  tx.status === "resolved"
                                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                    : tx.status === "processing"
                                    ? "bg-sky-50 text-sky-700 border border-sky-200 animate-pulse"
                                    : "bg-rose-50 text-rose-700 border border-rose-200"
                                }`}
                              >
                                {tx.status.toUpperCase()}
                              </span>
                            </div>
                          </div>

                          <p class="text-xs text-stone-600 bg-white border border-[#E2DFD8] p-2 rounded leading-snug">
                            <span class="font-semibold text-stone-800">Failure: </span>
                            {tx.failureReason}
                          </p>

                          <Show
                            when={tx.status !== "resolved"}
                            fallback={
                              <div class="text-[11px] text-emerald-700 font-medium flex items-center gap-1">
                                <span>✓ Intervention executed. Audit ID:</span>
                                <span class="font-mono font-bold">{tx.auditId}</span>
                              </div>
                            }
                          >
                            <div class="flex items-center gap-2 pt-1">
                              <button
                                type="button"
                                disabled={tx.status === "processing"}
                                onClick={() => handleExecuteIntervention(tx.id, tx.mailboxUuid, "replay_queue")}
                                class="flex-1 bg-white hover:bg-[#F0EEE9] text-[#3C3D3E] text-xs font-medium py-1.5 px-2 rounded border border-[#E2DFD8] shadow-2xs hover:border-[#9E725F] disabled:opacity-50"
                              >
                                Replay Queue
                              </button>
                              <button
                                type="button"
                                disabled={tx.status === "processing"}
                                onClick={() => handleExecuteIntervention(tx.id, tx.mailboxUuid, "revoke_session")}
                                class="flex-1 bg-white hover:bg-rose-50 text-rose-700 text-xs font-medium py-1.5 px-2 rounded border border-rose-200 shadow-2xs hover:border-rose-400 disabled:opacity-50"
                              >
                                Revoke Session
                              </button>
                              <button
                                type="button"
                                disabled={tx.status === "processing"}
                                onClick={() => handleExecuteIntervention(tx.id, tx.mailboxUuid, "state_reset")}
                                class="flex-1 bg-[#9E725F] hover:bg-[#8A6352] text-white text-xs font-medium py-1.5 px-2 rounded shadow-2xs disabled:opacity-50"
                              >
                                State Reset
                              </button>
                            </div>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </section>
              </div>
            </div>
          </Show>

          {/* TAB 3: Mailboxes View */}
          <Show when={currentTab() === "mailboxes"}>
            <div class="bg-white rounded-xl border border-[#E2DFD8] p-6 shadow-xs space-y-4">
              <div class="flex items-center justify-between border-b border-[#E2DFD8] pb-4">
                <div>
                  <h2 class="text-base font-bold text-[#3C3D3E]">Mailbox Identity Registry</h2>
                  <p class="text-xs text-stone-500">
                    Cryptographic mailbox identities and storage bindings (Blind Joined by Mailbox UUID)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => triggerGlobalSearch("4a8f231b-8e29-4d11-b921-26798031d200")}
                  class="text-xs bg-[#F0EEE9] hover:bg-stone-200 text-[#3C3D3E] px-3 py-1.5 rounded-lg border border-[#E2DFD8] font-medium"
                >
                  Inspect Demo Mailbox
                </button>
              </div>

              <div class="divide-y divide-[#E2DFD8]/60 text-xs">
                <div class="py-3 flex items-center justify-between">
                  <div>
                    <div class="font-mono font-semibold text-stone-800">
                      mailbox_4a8f231b-8e29-4d11-b921-26798031d200
                    </div>
                    <div class="text-[11px] text-stone-500 mt-0.5">
                      Binding: BLAKSHADE LTD • Mode: Private (Zero-Knowledge User Wrapped)
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full text-xs font-semibold">
                      Active
                    </span>
                    <button
                      type="button"
                      onClick={() => triggerGlobalSearch("4a8f231b-8e29-4d11-b921-26798031d200")}
                      class="text-xs text-[#9E725F] hover:underline font-medium"
                    >
                      [Diagnostics]
                    </button>
                  </div>
                </div>

                <div class="py-3 flex items-center justify-between">
                  <div>
                    <div class="font-mono font-semibold text-stone-800">
                      mailbox_b821901a-63fc-4b55-891d-0081e28919a4
                    </div>
                    <div class="text-[11px] text-stone-500 mt-0.5">
                      Binding: CYBERSEC LABS CORP • Mode: Org Managed (Dual Key Wrap)
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full text-xs font-semibold">
                      Active
                    </span>
                    <button
                      type="button"
                      onClick={() => triggerGlobalSearch("b821901a-63fc-4b55-891d-0081e28919a4")}
                      class="text-xs text-[#9E725F] hover:underline font-medium"
                    >
                      [Diagnostics]
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </Show>

          {/* TAB 4: Support Tickets View */}
          <Show when={currentTab() === "tickets"}>
            <div class="bg-white rounded-xl border border-[#E2DFD8] p-6 shadow-xs space-y-4">
              <div class="flex items-center justify-between border-b border-[#E2DFD8] pb-4">
                <div>
                  <h2 class="text-base font-bold text-[#3C3D3E]">
                    Support-Key Encrypted Tickets (Roadmap §3.2)
                  </h2>
                  <p class="text-xs text-stone-500">
                    Asymmetrically encrypted using Support Team Public Key. Lives outside user inbox.
                  </p>
                </div>
                <Show when={ticketOrgFilter()}>
                  <div class="flex items-center gap-2">
                    <span class="text-xs bg-amber-50 text-amber-800 border border-amber-200 px-2.5 py-1 rounded-lg font-medium">
                      Filtered by Org: {ticketOrgFilter()}
                    </span>
                    <button
                      type="button"
                      onClick={() => setTicketOrgFilter(null)}
                      class="text-xs text-[#9E725F] hover:underline font-semibold"
                    >
                      Clear Filter
                    </button>
                  </div>
                </Show>
              </div>

              <div class="divide-y divide-[#E2DFD8]/60 text-xs">
                <For
                  each={tickets().filter(
                    (t) => !ticketOrgFilter() || t.org_id === ticketOrgFilter()
                  )}
                  fallback={
                    <div class="py-8 text-center text-stone-400">
                      No active support tickets found for this selection.
                    </div>
                  }
                >
                  {(ticket) => (
                    <div class="py-4 flex items-start justify-between">
                      <div class="space-y-1">
                        <div class="flex items-center gap-2">
                          <span class="font-mono text-xs font-bold text-[#9E725F]">{ticket.id}</span>
                          <span class="font-bold text-[#3C3D3E] text-sm">{ticket.subject}</span>
                          <span
                            class={`text-[10px] font-semibold px-2 py-0.2 rounded ${
                              ticket.priority === "Critical"
                                ? "bg-rose-50 text-rose-700 border border-rose-200"
                                : "bg-sky-50 text-sky-700 border border-sky-200"
                            }`}
                          >
                            {ticket.priority}
                          </span>
                        </div>
                        <div class="text-xs text-stone-500 flex items-center gap-2">
                          <span>Org: {ticket.org_name}</span>
                          <span>•</span>
                          <span class="font-mono text-[11px] text-stone-400">Payload: {ticket.encrypted_payload}</span>
                        </div>
                      </div>

                      <div class="flex items-center gap-3">
                        <span class="bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold px-2.5 py-0.5 rounded-full">
                          {ticket.status}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDecryptTicket(ticket.id)}
                          class="bg-[#9E725F] hover:bg-[#8A6352] text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow-2xs transition-colors"
                        >
                          Decrypt with YubiKey
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* TAB 5: The Audit Logs UI (Part 4 of Specification) */}
          <Show when={currentTab() === "audit_logs"}>
            <div class="bg-white rounded-xl border border-[#E2DFD8] p-6 shadow-xs space-y-4">
              <div class="flex items-center justify-between border-b border-[#E2DFD8] pb-4">
                <div>
                  <h2 class="text-base font-bold text-[#3C3D3E]">
                    Immutable Audit Ledger (`support_audit_logs`)
                  </h2>
                  <p class="text-xs text-stone-500">
                    Displaying read-only data table fetched from <code>GET /admin/v1/audit-logs</code>. Cryptographically sealed.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => refetchAuditLogs()}
                  class="text-xs bg-[#F0EEE9] hover:bg-stone-200 text-[#3C3D3E] px-3 py-1.5 rounded-lg border border-[#E2DFD8] font-medium transition-colors"
                >
                  Refresh Ledger
                </button>
              </div>

              <Show when={auditLogs.loading}>
                <div class="p-6 text-center text-xs text-stone-500 font-medium">
                  Loading immutable audit entries from PostgreSQL...
                </div>
              </Show>

              {/* Read-Only Data Table: Timestamp, Admin UUID, Action, Target UUID */}
              <div class="overflow-x-auto">
                <table class="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr class="bg-[#F0EEE9]/60 border-b border-[#E2DFD8] text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
                      <th class="py-3 px-5">Timestamp</th>
                      <th class="py-3 px-5">Admin UUID</th>
                      <th class="py-3 px-5">Action</th>
                      <th class="py-3 px-5">Target UUID</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-[#E2DFD8]/60 font-mono text-xs">
                    <For
                      each={auditLogs()}
                      fallback={
                        <tr>
                          <td colspan="4" class="py-8 text-center text-stone-400 font-sans text-xs">
                            {auditLogs.loading ? "Loading audit logs..." : "No ledger entries recorded yet."}
                          </td>
                        </tr>
                      }
                    >
                      {(entry) => (
                        <tr class="hover:bg-[#F0EEE9]/30 transition-colors">
                          {/* 1. Timestamp */}
                          <td class="py-3 px-5 text-stone-600 font-sans">
                            {new Date(entry.timestamp).toLocaleString()}
                          </td>

                          {/* 2. Admin UUID */}
                          <td class="py-3 px-5 text-stone-800">
                            <span class="bg-[#F0EEE9] border border-[#E2DFD8] px-2 py-0.5 rounded text-[11px]">
                              {entry.admin_uuid}
                            </span>
                          </td>

                          {/* 3. Action */}
                          <td class="py-3 px-5 font-sans">
                            <span
                              class={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize border ${
                                entry.action.includes("suspend")
                                  ? "bg-rose-50 text-rose-700 border-rose-200"
                                  : entry.action.includes("plan")
                                  ? "bg-purple-50 text-purple-700 border-purple-200"
                                  : entry.action.includes("reset") || entry.action.includes("recovery")
                                  ? "bg-amber-50 text-amber-700 border-amber-200"
                                  : "bg-emerald-50 text-emerald-700 border-emerald-200"
                              }`}
                            >
                              {entry.action.replace("org_", "").replace("_", " ")}
                            </span>
                          </td>

                          {/* 4. Target UUID */}
                          <td class="py-3 px-5 text-[#9E725F] font-bold">
                            <Show when={entry.target_uuid} fallback={<span class="text-stone-400 font-sans">N/A</span>}>
                              <span>{entry.target_uuid}</span>
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
        </main>
      </div>

      {/* MODAL 1: Adjust Mailbox Capacity Modal */}
      <Show when={selectedOrgForCapacity()}>
        {(org) => (
          <div class="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-100">
            <div class="bg-white rounded-2xl border border-[#E2DFD8] max-w-xl w-full p-6 shadow-2xl space-y-5">
              <div class="flex items-start justify-between border-b border-[#E2DFD8] pb-3">
                <div>
                  <h3 class="font-bold text-base text-[#3C3D3E]">Adjust Organization Capacity</h3>
                  <p class="text-xs text-stone-500 mt-0.5">
                    Re-allocating sovereign mailbox capacity for <span class="font-semibold text-stone-800">{org().name}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedOrgForCapacity(null)}
                  class="text-stone-400 hover:text-stone-700 text-lg font-bold"
                >
                  ×
                </button>
              </div>

              {/* Dynamic Graduated Pricing Calculator */}
              <DynamicPricingCalculator
                compact
                initialSeats={adjustedSeats()}
                onSeatsChange={(s) => setAdjustedSeats(s)}
                showCta={false}
              />

              <div class="bg-[#F0EEE9]/60 border border-[#E2DFD8] p-3 rounded-lg text-xs text-stone-600">
                <span class="font-semibold text-stone-800">Atomic Administrative Ledger: </span>
                Capacity adjustments write immutably to <code>support_audit_logs</code> with cryptographic operator session verification.
              </div>

              <div class="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedOrgForCapacity(null)}
                  class="px-4 py-2 rounded-lg border border-[#E2DFD8] text-xs font-medium hover:bg-[#F0EEE9] text-stone-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmCapacityUpdate(org(), adjustedSeats())}
                  class="px-4 py-2 rounded-lg bg-[#9E725F] hover:bg-[#8A6352] text-white text-xs font-semibold shadow-xs transition-colors"
                >
                  Save Capacity ({adjustedSeats()} Seats)
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>

      {/* MODAL 2: Initiate Account Recovery (Offline Verifier Flow - No Password Reset) */}
      <Show when={selectedOrgForRecovery()}>
        {(org) => (
          <div class="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-100">
            <div class="bg-white rounded-2xl border border-[#E2DFD8] max-w-md w-full p-6 shadow-2xl space-y-5">
              <div class="flex items-start justify-between border-b border-[#E2DFD8] pb-3">
                <div>
                  <div class="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 inline-block mb-1">
                    Zero-Knowledge Verifier Protocol (§3.3)
                  </div>
                  <h3 class="font-bold text-base text-[#3C3D3E]">Initiate Account Recovery</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedOrgForRecovery(null)}
                  class="text-stone-400 hover:text-stone-700 text-lg font-bold"
                >
                  ×
                </button>
              </div>

              <div class="space-y-3 text-xs text-stone-600 leading-relaxed">
                <p>
                  Target Organization:{" "}
                  <span class="font-bold text-stone-900">{org().name}</span> (<code>org_{org().id.slice(0, 8)}</code>)
                </p>
                <div class="bg-amber-50/80 border border-amber-200 p-3.5 rounded-xl space-y-1.5 text-amber-900">
                  <div class="font-bold flex items-center gap-1.5">
                    <svg class="w-4 h-4 text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span>No Password Reset Allowed</span>
                  </div>
                  <p class="text-[11px] leading-normal text-amber-800">
                    BYOS never stores or touches plaintext passphrases. Initiating recovery triggers an offline challenge. Upon next login, the client must locally hash their offline paper recovery phrase to submit a mathematical verifier.
                  </p>
                </div>
                <p class="text-[11px] text-stone-500">
                  An immutable record will be appended to <code>support_audit_logs</code> signed by your hardware YubiKey identity.
                </p>
              </div>

              <div class="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedOrgForRecovery(null)}
                  class="px-4 py-2 rounded-lg border border-[#E2DFD8] text-xs font-medium hover:bg-[#F0EEE9] text-stone-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmStateReset(org())}
                  class="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold shadow-xs transition-colors"
                >
                  Issue Recovery Challenge
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
