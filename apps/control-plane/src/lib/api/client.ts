export function apiBase(): string {
  return (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE || "";
}

export function getCpHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    "X-BYOS-Client": "control-plane",
    ...extraHeaders,
  };
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("byos_cp_session_token");
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }
  return headers;
}
