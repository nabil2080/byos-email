import { createContext, useContext, ParentComponent, createSignal, createMemo, onMount, batch } from "solid-js";

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
  seatCount: number;
  subscriptionStatus: string;
  onboardingCompleted: boolean;
  onboardingCurrentStep: number;
  onboardingSkipped: boolean;
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
  plan: "1 Seat",
  seatCount: 1,
  subscriptionStatus: "active",
  onboardingCompleted: false,
  onboardingCurrentStep: 1,
  onboardingSkipped: false,
  isOwner: false,
  isAdmin: false,
  isMember: false,
  isLoading: true,
  isAuthenticated: false,
  refetch: async () => {},
  logout: async () => {},
};

const OrgContext = createContext<OrgContextValue>(defaultContext);

import { apiBase, getCpHeaders } from "../lib/api/client";

export const OrgProvider: ParentComponent = (props) => {
  const [user, setUser] = createSignal<UserProfile | null>(null);
  const [orgId, setOrgId] = createSignal<string>("");
  const [role, setRole] = createSignal<UserRole | null>(null);
  const [seatCount, setSeatCount] = createSignal<number>(1);
  const [subscriptionStatus, setSubscriptionStatus] = createSignal<string>("active");
  const [plan, setPlan] = createSignal<string>("1 Seat");
  const [onboardingCompleted, setOnboardingCompleted] = createSignal<boolean>(false);
  const [onboardingCurrentStep, setOnboardingCurrentStep] = createSignal<number>(1);
  const [onboardingSkipped, setOnboardingSkipped] = createSignal<boolean>(false);
  const [isLoading, setIsLoading] = createSignal<boolean>(true);

  const fetchSession = async () => {
    if (!user()) {
      setIsLoading(true);
    }
    try {
      const res = await fetch(`${apiBase()}/v1/auth/me`, {
        credentials: "include",
        headers: getCpHeaders({ "Content-Type": "application/json" }),
      });

      if (res.ok) {
        const data = await res.json();
        const userId = data.id || data.user_id || "";
        const userEmail = data.email || "";
        const userDisplayName = data.display_name || userEmail.split("@")[0] || "User";
        const userOrgId = data.org_id || data.organization_id || "";
        const userRole = (data.role as UserRole) || "member";
        const seats = Number(data.seat_count) || 1;
        const subStatus = data.subscription_status || "active";
        const userPlan = `${seats} Seat${seats === 1 ? "" : "s"}`;
        const obCompleted = Boolean(data.onboarding_completed);
        const obStep = Number(data.onboarding_current_step) || 1;
        const obSkipped = Boolean(data.onboarding_skipped);

        batch(() => {
          setUser({ id: userId, email: userEmail, displayName: userDisplayName });
          setOrgId(userOrgId);
          setRole(userRole);
          setSeatCount(seats);
          setSubscriptionStatus(subStatus);
          setPlan(userPlan);
          setOnboardingCompleted(obCompleted);
          setOnboardingCurrentStep(obStep);
          setOnboardingSkipped(obSkipped);
          setIsLoading(false);
        });
      } else {
        batch(() => {
          setUser(null);
          setOrgId("");
          setRole(null);
          setSeatCount(1);
          setSubscriptionStatus("active");
          setPlan("1 Seat");
          setOnboardingCompleted(false);
          setOnboardingCurrentStep(1);
          setOnboardingSkipped(false);
          setIsLoading(false);
        });
      }
    } catch (err) {
      console.error("[OrgContext fetchSession ERROR]:", err);
      batch(() => {
        setUser(null);
        setOrgId("");
        setRole(null);
        setSeatCount(1);
        setSubscriptionStatus("active");
        setPlan("1 Seat");
        setOnboardingCompleted(false);
        setOnboardingCurrentStep(1);
        setOnboardingSkipped(false);
        setIsLoading(false);
      });
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(`${apiBase()}/v1/auth/logout`, {
        method: "POST",
        headers: getCpHeaders(),
        credentials: "include",
      });
    } catch {
      // Ignore network errors on logout
    } finally {
      setUser(null);
      setOrgId("");
      setRole(null);
      setSeatCount(1);
      setSubscriptionStatus("active");
      setPlan("1 Seat");
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
    get seatCount() {
      return seatCount();
    },
    get subscriptionStatus() {
      return subscriptionStatus();
    },
    get onboardingCompleted() {
      return onboardingCompleted();
    },
    get onboardingCurrentStep() {
      return onboardingCurrentStep();
    },
    get onboardingSkipped() {
      return onboardingSkipped();
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
    seatCount: ctx.seatCount,
    subscriptionStatus: ctx.subscriptionStatus,
    isLoading: ctx.isLoading,
  };
}
