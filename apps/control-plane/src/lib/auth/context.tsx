/**
 * Auth context with real session support.
 * Tries /v1/auth/me via cookie first, falls back to legacy window.__BYOS_USER_ID only if BYOS_LEGACY_AUTH_ENABLED=true (test env).
 * Do NOT use localStorage for identity.
 */
import { createContext, useContext, ParentComponent, createResource, createSignal, onMount } from "solid-js";

interface AuthState {
  userId: string;
  orgId: string;
  email: string;
  displayName: string;
  isLoading: boolean;
}

const AuthContext = createContext<AuthState>({ userId: "", orgId: "", email: "", displayName: "", isLoading: true });

function apiBase(): string {
  return (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE || "";
}

async function fetchMe(): Promise<{ id: string; email: string; org_id: string; display_name: string } | null> {
  try {
    const res = await fetch(`${apiBase()}/v1/auth/me`, { credentials: "include" });
    if (!res.ok) return null;
    return (await res.json()) as { id: string; email: string; org_id: string; display_name: string };
  } catch {
    return null;
  }
}

export const AuthProvider: ParentComponent = (props) => {
  const [auth, setAuth] = createSignal<AuthState>({ userId: "", orgId: "", email: "", displayName: "", isLoading: true });

  onMount(async () => {
    const me = await fetchMe();
    if (me && me.id) {
      setAuth({ userId: me.id, orgId: me.org_id, email: me.email, displayName: me.display_name, isLoading: false });
      return;
    }
    // Legacy fallback only if explicitly enabled (test env)
    const legacyEnabled = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_LEGACY_AUTH_ENABLED === "true";
    if (legacyEnabled) {
      const userId =
        (typeof window !== "undefined" && (window as unknown as { __BYOS_USER_ID?: string }).__BYOS_USER_ID) || "";
      const orgId =
        (typeof document !== "undefined" && (document.querySelector('meta[name="org-id"]') as HTMLMetaElement)?.content) || "";
      if (userId && orgId) {
        setAuth({ userId, orgId, email: "", displayName: "", isLoading: false });
        return;
      }
    }
    setAuth({ userId: "", orgId: "", email: "", displayName: "", isLoading: false });
  });

  return <AuthContext.Provider value={auth()}>{props.children}</AuthContext.Provider>;
};

export function useAuth() {
  return useContext(AuthContext);
}

export function useOrgId() {
  return useContext(AuthContext).orgId;
}

export function useUserId() {
  return useContext(AuthContext).userId;
}
