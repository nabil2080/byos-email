import { createContext, useContext, ParentComponent, createSignal, createMemo, onMount } from "solid-js";

export type UserRole = "owner" | "admin" | "member";

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
}

export interface OrgContextValue {
  user: UserProfile | null;
  orgId: string;
  role: UserRole | null;
  plan: string;
  isOwner: boolean;
  isAdmin: boolean;
  isMember: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  refetch: () => Promise<void>;
  logout: () => Promise<void>;
}

const defaultContext: OrgContextValue = {
  user: null,
  orgId: "",
  role: null,
  plan: "solo",
  isOwner: false,
  isAdmin: false,
  isMember: false,
  isLoading: true,
  isAuthenticated: false,
  refetch: async () => {},
  logout: async () => {},
};

const OrgContext = createContext<OrgContextValue>(defaultContext);

function apiBase(): string {
  return (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE || "";
}

export const OrgProvider: ParentComponent = (props) => {
  const [user, setUser] = createSignal<UserProfile | null>(null);
  const [orgId, setOrgId] = createSignal<string>("");
  const [role, setRole] = createSignal<UserRole | null>(null);
  const [plan, setPlan] = createSignal<string>("solo");
  const [isLoading, setIsLoading] = createSignal<boolean>(true);

  const fetchSession = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${apiBase()}/v1/auth/me`, {
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      if (res.ok) {
        const data = await res.json();
        const userId = data.id || data.user_id || "";
        const userEmail = data.email || "";
        const userDisplayName = data.display_name || userEmail.split("@")[0] || "User";
        const userOrgId = data.org_id || data.organization_id || "";
        const userRole = (data.role as UserRole) || "member";
        const userPlan = data.plan || "solo";

        setUser({ id: userId, email: userEmail, displayName: userDisplayName });
        setOrgId(userOrgId);
        setRole(userRole);
        setPlan(userPlan);
      } else {
        setUser(null);
        setOrgId("");
        setRole(null);
        setPlan("solo");
      }
    } catch {
      setUser(null);
      setOrgId("");
      setRole(null);
      setPlan("solo");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(`${apiBase()}/v1/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Ignore network errors on logout
    } finally {
      setUser(null);
      setOrgId("");
      setRole(null);
      setPlan("solo");
      window.location.href = "/login";
    }
  };

  onMount(() => {
    fetchSession();
  });

  const isOwner = createMemo(() => role() === "owner");
  const isAdmin = createMemo(() => role() === "admin" || role() === "owner");
  const isMember = createMemo(() => role() === "member");
  const isAuthenticated = createMemo(() => !!user() && !!orgId());

  const value: OrgContextValue = {
    get user() {
      return user();
    },
    get orgId() {
      return orgId();
    },
    get role() {
      return role();
    },
    get plan() {
      return plan();
    },
    get isOwner() {
      return isOwner();
    },
    get isAdmin() {
      return isAdmin();
    },
    get isMember() {
      return isMember();
    },
    get isLoading() {
      return isLoading();
    },
    get isAuthenticated() {
      return isAuthenticated();
    },
    refetch: fetchSession,
    logout: handleLogout,
  };

  return <OrgContext.Provider value={value}>{props.children}</OrgContext.Provider>;
};

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) {
    throw new Error("useOrg must be used within an OrgProvider");
  }
  return ctx;
}

// Backward-compatibility wrapper for existing routes calling useAuth()
export function useAuth() {
  const ctx = useOrg();
  return {
    userId: ctx.user?.id || "",
    orgId: ctx.orgId,
    email: ctx.user?.email || "",
    displayName: ctx.user?.displayName || "",
    role: ctx.role,
    plan: ctx.plan,
    isLoading: ctx.isLoading,
  };
}
