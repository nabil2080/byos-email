import { apiBase, getCpHeaders } from "./client";

export interface DNSRecord {
  type: string;
  name: string;
  value: string;
  priority?: number;
  status?: string;
}

export interface OnboardingDomain {
  id: string;
  name: string;
  is_verified: boolean;
  verification_token: string;
  dns_records?: DNSRecord[];
}

export interface OnboardingStorage {
  id: string;
  provider: string;
  status: string;
  bucket_name: string;
  error_code?: string;
  last_checked?: string;
}

export interface OnboardingState {
  organization: {
    id: string;
    name: string;
    seat_count: number;
    storage_mode: string;
    completed: boolean;
    current_step: number;
    skipped: boolean;
    completed_at?: string;
  };
  owner: {
    id: string;
    email: string;
    role: string;
  };
  current_step: number;
  completed_steps: number[];
  domain?: OnboardingDomain;
  storage_mode: string;
  storage_connection?: OnboardingStorage;
  mailbox_count: number;
  invited_count: number;
  activated_count: number;
  completed: boolean;
  skipped: boolean;
}

export interface VerificationCheck {
  id: string;
  name: string;
  category: string;
  status: "passed" | "simulated" | "not_tested" | "failed";
  message: string;
  details?: string;
}

export interface VerificationMatrix {
  ready_to_complete: boolean;
  checks: VerificationCheck[];
}

export async function getOnboardingState(): Promise<OnboardingState> {
  const res = await fetch(`${apiBase()}/v1/onboarding/state`, {
    credentials: "include",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch onboarding state (${res.status})`);
  }
  return res.json();
}

export async function setupDomain(domain: string): Promise<any> {
  const res = await fetch(`${apiBase()}/v1/onboarding/step/domain`, {
    method: "POST",
    credentials: "include",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ domain }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to configure domain");
  }
  return res.json();
}

export async function verifyDomain(domainId?: string): Promise<any> {
  const res = await fetch(`${apiBase()}/v1/onboarding/step/domain/verify`, {
    method: "POST",
    credentials: "include",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ domain_id: domainId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Domain DNS verification failed");
  }
  return res.json();
}

export async function selectStorageMode(mode: string): Promise<any> {
  const res = await fetch(`${apiBase()}/v1/onboarding/step/storage`, {
    method: "POST",
    credentials: "include",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ storage_mode: mode }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to select storage mode");
  }
  return res.json();
}

export async function connectStorage(provider: string, config?: Record<string, any>): Promise<any> {
  const res = await fetch(`${apiBase()}/v1/onboarding/step/storage/connect`, {
    method: "POST",
    credentials: "include",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ provider, config: config || {} }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Storage probe connection failed");
  }
  return res.json();
}

export async function createMailboxes(mailboxes: Array<{ local_part: string; name: string }>): Promise<any> {
  const res = await fetch(`${apiBase()}/v1/onboarding/step/mailboxes`, {
    method: "POST",
    credentials: "include",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ mailboxes }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to create mailboxes");
  }
  return res.json();
}

export async function inviteEmployees(invitations: Array<{ email: string; name: string; role: string }>): Promise<any> {
  const res = await fetch(`${apiBase()}/v1/onboarding/step/invite`, {
    method: "POST",
    credentials: "include",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ invitations }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to dispatch invitations");
  }
  return res.json();
}

export async function getVerificationMatrix(): Promise<VerificationMatrix> {
  const res = await fetch(`${apiBase()}/v1/onboarding/state/verify`, {
    credentials: "include",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
  });
  if (!res.ok) {
    throw new Error(`Failed to load verification matrix (${res.status})`);
  }
  return res.json();
}

export async function completeOnboarding(): Promise<any> {
  const res = await fetch(`${apiBase()}/v1/onboarding/complete`, {
    method: "POST",
    credentials: "include",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to complete onboarding");
  }
  return res.json();
}

export async function skipOnboarding(): Promise<any> {
  const res = await fetch(`${apiBase()}/v1/onboarding/skip`, {
    method: "POST",
    credentials: "include",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to skip onboarding");
  }
  return res.json();
}
