/**
 * Storage API client – SolidJS dashboard
 * Wraps org-scoped storage connection endpoints.
 * Never handles DEK, never stores credentials, never returns ciphertext to UI.
 */

export type StorageProvider = "s3" | "minio" | "google_drive_mock" | "google_drive";

export interface StorageConnection {
  id: string;
  provider: StorageProvider;
  encrypted: boolean;
  status: "active" | "pending" | "error" | "deleted";
  bucket_name: string;
  created_at: string;
  updated_at: string;
  last_checked?: string | null;
  error_code?: string | null;
}

export interface StorageTestResult {
  status: "ok" | "error";
  code: "verified" | "authentication_failed" | "provider_unavailable" | "configuration_error" | "configuration_changed";
  last_checked?: string;
  message?: string;
}

export interface StorageCreatePayload {
  provider: StorageProvider;
  config: Record<string, unknown>;
}

export interface StorageMigrationStatus {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  objects: number;
  error_code?: string;
  retry_count: number;
}

export interface GoogleDriveAuthorization {
  authorization_url: string;
  state: string;
}

function getAuthHeader(): Record<string, string> {
  // X-User-Id is prototype auth – injected from OrganizationContext / AuthContext
  // In SolidJS dashboard this comes from useAuth().userId()
  const userId = (typeof window !== "undefined" && (window as unknown as { __BYOS_USER_ID?: string }).__BYOS_USER_ID) || "";
  // Fallback: read from injected meta or auth store – not from localStorage
  return userId ? { "X-User-Id": userId } : {};
}

function apiBase(): string {
  return (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE || "http://127.0.0.1:8080";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getAuthHeader(),
    ...(init?.headers as Record<string, string>),
  };
  const res = await fetch(`${apiBase()}${path}`, {
    credentials: "include",
    ...init,
    headers,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Sanitize: never include request body in error
    throw new Error(text || `Request failed ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function getStorageConnection(orgId: string): Promise<StorageConnection> {
  return request<StorageConnection>(`/v1/organizations/${orgId}/storage/connection`, {
    method: "GET",
  });
}

export async function createStorageConnection(
  orgId: string,
  payload: StorageCreatePayload
): Promise<StorageConnection> {
  return request<StorageConnection>(`/v1/organizations/${orgId}/storage/connection`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateStorageConnection(
  orgId: string,
  payload: StorageCreatePayload
): Promise<StorageConnection> {
  return request<StorageConnection>(`/v1/organizations/${orgId}/storage/connection`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function testStorageConnection(orgId: string): Promise<StorageTestResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getAuthHeader(),
  };
  const res = await fetch(`${apiBase()}/v1/organizations/${orgId}/storage/connection/test`, {
    method: "POST",
    headers,
    credentials: "include",
  });
  const body = await res.text().catch(() => "");
  let parsed: StorageTestResult | null = null;
  try {
    parsed = body ? (JSON.parse(body) as StorageTestResult) : null;
  } catch {
    parsed = null;
  }
  if (res.ok) {
    // 200 – test operation completed, even if provider failed (code will be error)
    if (parsed && parsed.code) return parsed;
    // Fallback for 200 with status ok but no code
    return { status: "ok", code: "verified", last_checked: new Date().toISOString() };
  }
  // Non-2xx: preserve structured 409
  if (res.status === 409 && parsed?.code === "configuration_changed") {
    const err = new Error(parsed.message || "Storage configuration changed while the test was running. Please test again.");
    (err as unknown as { code: string; status: number }).code = "configuration_changed";
    (err as unknown as { status: number }).status = 409;
    throw err;
  }
  if (res.status === 403) throw new Error("You don't have permission to test this storage connection.");
  if (res.status === 404) throw new Error("No storage connection found.");
  // Generic sanitized
  const msg = parsed?.message || parsed?.code || `Request failed ${res.status}`;
  throw new Error(msg);
}

export async function deleteStorageConnection(orgId: string): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getAuthHeader(),
  };
  const res = await fetch(`${apiBase()}/v1/organizations/${orgId}/storage/connection`, {
    method: "DELETE",
    headers,
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 404) throw new Error("No active storage connection for this organization");
    if (res.status === 403) throw new Error("You don't have permission to disconnect storage");
    throw new Error(text || `Request failed ${res.status}`);
  }

}

export async function authorizeGoogleDrive(orgId: string): Promise<GoogleDriveAuthorization> {
  return request<GoogleDriveAuthorization>(`/v1/organizations/${orgId}/storage/google-drive/authorize`);
}

export async function getStorageMigrationStatus(orgId: string, migrationId: string): Promise<StorageMigrationStatus> {
  return request<StorageMigrationStatus>(`/v1/organizations/${orgId}/storage/migration/${migrationId}`);
}

export async function retryStorageMigration(orgId: string, migrationId: string): Promise<StorageMigrationStatus> {
  return request<StorageMigrationStatus>(`/v1/organizations/${orgId}/storage/migration/${migrationId}/retry`, {
    method: "POST",
    body: "{}",
  });
}
