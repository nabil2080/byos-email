import { apiBase, getCpHeaders } from "./client";

export interface SearchDomainResult {
  id: string;
  name: string;
  is_verified: boolean;
}

export interface SearchMailboxResult {
  id: string;
  email: string;
  local_part: string;
  domain_name: string;
  mode: string;
  status: string;
}

export interface SearchMemberResult {
  id: string;
  email: string;
  display_name: string;
  role: string;
  is_active: boolean;
}

export interface NavigationItem {
  id: string;
  title: string;
  description: string;
  href: string;
  keywords: string[];
}

export interface OrganizationSearchResponse {
  query: string;
  domains: SearchDomainResult[];
  mailboxes: SearchMailboxResult[];
  members: SearchMemberResult[];
  navigation: NavigationItem[];
}

export const NAVIGATION_DESTINATIONS: NavigationItem[] = [
  {
    id: "nav-overview",
    title: "Overview",
    description: "System overview, organization summary, and quick status metrics",
    href: "/dashboard",
    keywords: ["home", "dashboard", "metrics", "stats", "summary"],
  },
  {
    id: "nav-domains",
    title: "Domains",
    description: "Manage custom domains, DNS verification records, SPF, and DKIM",
    href: "/dashboard/domains",
    keywords: ["domain", "dns", "dkim", "spf", "mx", "verification"],
  },
  {
    id: "nav-mailboxes",
    title: "Mailboxes",
    description: "Provision cryptographic mailboxes, address management, and privacy modes",
    href: "/dashboard/mailboxes",
    keywords: ["mailbox", "inbox", "email", "encryption", "alias", "provision"],
  },
  {
    id: "nav-members",
    title: "Team & Access",
    description: "Organization members, role delegation (Owner, Admin, Member), and invitations",
    href: "/dashboard/members",
    keywords: ["team", "users", "members", "roles", "employees", "invitations", "access"],
  },
  {
    id: "nav-storage",
    title: "Storage Governance",
    description: "Customer-controlled S3 object storage connections and telemetry",
    href: "/dashboard/storage",
    keywords: ["storage", "s3", "minio", "bucket", "governance", "retention"],
  },
  {
    id: "nav-billing",
    title: "Billing & Capacity",
    description: "Seat-based pricing tiers, graduated allocations, and capacity breakdown",
    href: "/dashboard/billing",
    keywords: ["billing", "seats", "pricing", "subscription", "capacity", "plan", "invoice"],
  },
  {
    id: "nav-settings",
    title: "Settings",
    description: "Security policies, administrative controls, and product tour restart",
    href: "/dashboard/settings",
    keywords: ["settings", "preferences", "tour", "reset", "organization"],
  },
  {
    id: "nav-recovery",
    title: "Key Recovery",
    description: "Cryptographic escrow keys, recovery principals, and rotation logs",
    href: "/dashboard/recovery",
    keywords: ["recovery", "keys", "escrow", "principals", "emergency", "rotation"],
  },
  {
    id: "nav-security",
    title: "Security & 2FA",
    description: "Multi-factor authentication, passkey policies, and login session auditing",
    href: "/dashboard/security",
    keywords: ["security", "2fa", "totp", "passkey", "audit", "sessions"],
  },
];

export function filterNavigation(query: string): NavigationItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return NAVIGATION_DESTINATIONS.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.keywords.some((k) => k.toLowerCase().includes(q))
  );
}

export async function searchOrganization(
  orgId: string,
  query: string,
  signal?: AbortSignal
): Promise<OrganizationSearchResponse> {
  const trimmed = query.trim();
  const matchedNav = filterNavigation(trimmed);

  if (!trimmed || !orgId) {
    return {
      query: trimmed,
      domains: [],
      mailboxes: [],
      members: [],
      navigation: matchedNav,
    };
  }

  try {
    const res = await fetch(
      `${apiBase()}/v1/organizations/${encodeURIComponent(orgId)}/search?q=${encodeURIComponent(
        trimmed
      )}&limit=8`,
      {
        method: "GET",
        headers: getCpHeaders({ "Content-Type": "application/json" }),
        credentials: "include",
        signal,
      }
    );

    if (!res.ok) {
      return {
        query: trimmed,
        domains: [],
        mailboxes: [],
        members: [],
        navigation: matchedNav,
      };
    }

    const data = (await res.json()) as {
      domains?: SearchDomainResult[];
      mailboxes?: SearchMailboxResult[];
      members?: SearchMemberResult[];
    };

    return {
      query: trimmed,
      domains: data.domains || [],
      mailboxes: data.mailboxes || [],
      members: data.members || [],
      navigation: matchedNav,
    };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    return {
      query: trimmed,
      domains: [],
      mailboxes: [],
      members: [],
      navigation: matchedNav,
    };
  }
}
