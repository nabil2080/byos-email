import {
  createContext,
  useContext,
  createSignal,
  createMemo,
  type Accessor,
  type Setter,
  type JSX,
} from "solid-js";
import type { UserMe, Mailbox, ConnectedAccount } from "../api";
import { zeroizeKeys, clearAllSensitiveSessionKeys } from "../session_isolation";

export interface AuthContextValue {
  // User & Identity
  currentUser: Accessor<UserMe | null>;
  setCurrentUser: Setter<UserMe | null>;
  isLoading: Accessor<boolean>;
  setIsLoading: Setter<boolean>;

  // Mailboxes
  mailboxes: Accessor<Mailbox[]>;
  setMailboxes: Setter<Mailbox[]>;
  selectedMailbox: Accessor<Mailbox | null>;
  setSelectedMailbox: Setter<Mailbox | null>;
  activeMailboxId: Accessor<string | null>;

  // Connected accounts
  connectedAccounts: Accessor<ConnectedAccount[]>;
  setConnectedAccounts: Setter<ConnectedAccount[]>;
  pendingSwitchAccount: Accessor<ConnectedAccount | null>;
  setPendingSwitchAccount: Setter<ConnectedAccount | null>;

  // Key Custody & Seeds
  mailboxKey: Accessor<Uint8Array | null>;
  setMailboxKey: Setter<Uint8Array | null>;
  signingSeed: Accessor<Uint8Array | null>;
  setSigningSeed: Setter<Uint8Array | null>;
  xwingSeed: Accessor<Uint8Array | null>;
  setXwingSeed: Setter<Uint8Array | null>;
  searchKey: Accessor<string | null>;
  setSearchKey: Setter<string | null>;
  unlockedBoxId: Accessor<string | null>;
  setUnlockedBoxId: Setter<string | null>;

  // Unlock / Lock state
  lockedReadingAccount: Accessor<{ mailboxId: string; email: string; isHistorical?: boolean } | null>;
  setLockedReadingAccount: Setter<{ mailboxId: string; email: string; isHistorical?: boolean } | null>;
  unlockAccountTarget: Accessor<{ mailboxId: string; email: string; isHistorical?: boolean } | null>;
  setUnlockAccountTarget: Setter<{ mailboxId: string; email: string; isHistorical?: boolean } | null>;
  unlockSecretInput: Accessor<string>;
  setUnlockSecretInput: Setter<string>;
  unlockAccountPassword: Accessor<string>;
  setUnlockAccountPassword: Setter<string>;
  unlockAccountError: Accessor<string | null>;
  setUnlockAccountError: Setter<string | null>;
  unlockAccountBusy: Accessor<boolean>;
  setUnlockAccountBusy: Setter<boolean>;

  // Setup & Impersonation
  isSetupAccount: Accessor<boolean>;
  setIsSetupAccount: Setter<boolean>;
  isImpersonating: Accessor<boolean>;
  setIsImpersonating: Setter<boolean>;
  impersonateMailboxId: Accessor<string | null>;
  setImpersonateMailboxId: Setter<string | null>;
  impersonateEmail: Accessor<string | null>;
  setImpersonateEmail: Setter<string | null>;
  storageErrorBanner: Accessor<string | null>;
  setStorageErrorBanner: Setter<string | null>;

  // Actions & Triggers
  lockMailbox: (mailboxId: string) => void;
  triggerZeroizeKeys: (mailboxId?: string) => void;
  clearAuthSession: () => void;
  isMailboxLocked: (mailboxId?: string) => boolean;
}

export function createAuthState(overrides?: Partial<AuthContextValue>): AuthContextValue {
  const [currentUser, setCurrentUser] = createSignal<UserMe | null>(null);
  const [isLoading, setIsLoading] = createSignal<boolean>(true);
  const [mailboxes, setMailboxes] = createSignal<Mailbox[]>([]);
  const [selectedMailbox, setSelectedMailbox] = createSignal<Mailbox | null>(null);
  const [connectedAccounts, setConnectedAccounts] = createSignal<ConnectedAccount[]>([]);
  const [pendingSwitchAccount, setPendingSwitchAccount] = createSignal<ConnectedAccount | null>(null);

  const [mailboxKey, setMailboxKey] = createSignal<Uint8Array | null>(null);
  const [signingSeed, setSigningSeed] = createSignal<Uint8Array | null>(null);
  const [xwingSeed, setXwingSeed] = createSignal<Uint8Array | null>(null);
  const [searchKey, setSearchKey] = createSignal<string | null>(null);
  const [unlockedBoxId, setUnlockedBoxId] = createSignal<string | null>(null);

  const [lockedReadingAccount, setLockedReadingAccount] = createSignal<{
    mailboxId: string;
    email: string;
    isHistorical?: boolean;
  } | null>(null);
  const [unlockAccountTarget, setUnlockAccountTarget] = createSignal<{
    mailboxId: string;
    email: string;
    isHistorical?: boolean;
  } | null>(null);
  const [unlockSecretInput, setUnlockSecretInput] = createSignal<string>("");
  const [unlockAccountPassword, setUnlockAccountPassword] = createSignal<string>("");
  const [unlockAccountError, setUnlockAccountError] = createSignal<string | null>(null);
  const [unlockAccountBusy, setUnlockAccountBusy] = createSignal<boolean>(false);

  const [isSetupAccount, setIsSetupAccount] = createSignal<boolean>(false);
  const [isImpersonating, setIsImpersonating] = createSignal<boolean>(false);
  const [impersonateMailboxId, setImpersonateMailboxId] = createSignal<string | null>(null);
  const [impersonateEmail, setImpersonateEmail] = createSignal<string | null>(null);
  const [storageErrorBanner, setStorageErrorBanner] = createSignal<string | null>(null);

  const activeMailboxId = createMemo(() => selectedMailbox()?.id || null);

  function lockMailbox(mbId: string) {
    if (unlockedBoxId() === mbId || selectedMailbox()?.id === mbId) {
      setMailboxKey(null);
      setUnlockedBoxId(null);
    }
    zeroizeKeys(mbId);
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem("byos_mailbox_sk_" + mbId);
      sessionStorage.removeItem("byos_xwing_seed_" + mbId);
    }
    setConnectedAccounts((prev) =>
      prev.map((a) => (a.id === mbId ? { ...a, mailboxSkHex: undefined, searchKeyHex: undefined, isLocked: true } : a))
    );
  }

  function triggerZeroizeKeys(mbId?: string) {
    setMailboxKey(null);
    setSigningSeed(null);
    setXwingSeed(null);
    setSearchKey(null);
    setUnlockedBoxId(null);
    zeroizeKeys(mbId);
  }

  function clearAuthSession() {
    triggerZeroizeKeys();
    clearAllSensitiveSessionKeys();
    setCurrentUser(null);
    setSelectedMailbox(null);
    setMailboxes([]);
    setConnectedAccounts([]);
    setIsImpersonating(false);
    setImpersonateMailboxId(null);
    setImpersonateEmail(null);
  }

  function isMailboxLocked(mbId?: string): boolean {
    const id = mbId || selectedMailbox()?.id;
    if (!id) return true;
    const key = mailboxKey();
    if (!key || !(key instanceof Uint8Array) || key.length !== 32) return true;
    return unlockedBoxId() !== id;
  }

  const base: AuthContextValue = {
    currentUser,
    setCurrentUser,
    isLoading,
    setIsLoading,
    mailboxes,
    setMailboxes,
    selectedMailbox,
    setSelectedMailbox,
    activeMailboxId,
    connectedAccounts,
    setConnectedAccounts,
    pendingSwitchAccount,
    setPendingSwitchAccount,
    mailboxKey,
    setMailboxKey,
    signingSeed,
    setSigningSeed,
    xwingSeed,
    setXwingSeed,
    searchKey,
    setSearchKey,
    unlockedBoxId,
    setUnlockedBoxId,
    lockedReadingAccount,
    setLockedReadingAccount,
    unlockAccountTarget,
    setUnlockAccountTarget,
    unlockSecretInput,
    setUnlockSecretInput,
    unlockAccountPassword,
    setUnlockAccountPassword,
    unlockAccountError,
    setUnlockAccountError,
    unlockAccountBusy,
    setUnlockAccountBusy,
    isSetupAccount,
    setIsSetupAccount,
    isImpersonating,
    setIsImpersonating,
    impersonateMailboxId,
    setImpersonateMailboxId,
    impersonateEmail,
    setImpersonateEmail,
    storageErrorBanner,
    setStorageErrorBanner,
    lockMailbox,
    triggerZeroizeKeys,
    clearAuthSession,
    isMailboxLocked,
  };

  return Object.assign(base, overrides);
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export interface AuthProviderProps {
  value?: AuthContextValue;
  children: JSX.Element;
}

export function AuthProvider(props: AuthProviderProps) {
  const state = props.value ?? createAuthState();
  return (
    <AuthContext.Provider value={state}>
      {props.children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export function useOptionalAuth(): AuthContextValue | undefined {
  return useContext(AuthContext);
}
