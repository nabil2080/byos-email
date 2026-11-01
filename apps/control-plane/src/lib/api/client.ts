export function apiBase(): string {
  return (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE || "";
}

/**
 * Returns request headers for Control Plane API calls.
 * Reusable session authentication tokens are strictly stored in HttpOnly cookies (byos_cp_session),
 * not in JavaScript-accessible persistent localStorage.
 */
export function getCpHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    "X-BYOS-Client": "control-plane",
    ...extraHeaders,
  };
  return headers;
}

