import {
  createContext,
  useContext,
  createSignal,
  type Accessor,
  type Setter,
  type JSX,
} from "solid-js";
import type { MailboxFolder, MailboxLabel } from "../api";
import type { SettingsTabId } from "../routes/settings/SettingsLayout";

export interface ModalContextValue {
  // Compose Drawer
  composeOpen: Accessor<boolean>;
  setComposeOpen: Setter<boolean>;
  composeAccountId: Accessor<string | null>;
  setComposeAccountId: Setter<string | null>;
  composeFromAlias: Accessor<string | null>;
  setComposeFromAlias: Setter<string | null>;
  openCompose: (options?: { accountId?: string | null; fromAlias?: string | null }) => void;
  closeCompose: () => void;

  // Contacts
  contactsOpen: Accessor<boolean>;
  setContactsOpen: Setter<boolean>;
  openContacts: () => void;
  closeContacts: () => void;

  // Add Mailbox
  addMailboxModalOpen: Accessor<boolean>;
  setAddMailboxModalOpen: Setter<boolean>;
  openAddMailbox: () => void;
  closeAddMailbox: () => void;

  // Custom Folder Modals
  createFolderModalOpen: Accessor<boolean>;
  setCreateFolderModalOpen: Setter<boolean>;
  folderToEdit: Accessor<MailboxFolder | null>;
  setFolderToEdit: Setter<MailboxFolder | null>;
  openCreateFolder: (folder?: MailboxFolder | null) => void;
  closeCreateFolder: () => void;

  // Custom Label Modals
  createLabelModalOpen: Accessor<boolean>;
  setCreateLabelModalOpen: Setter<boolean>;
  labelToEdit: Accessor<MailboxLabel | null>;
  setLabelToEdit: Setter<MailboxLabel | null>;
  initialParentLabelId: Accessor<string | null>;
  setInitialParentLabelId: Setter<string | null>;
  changeParentLabel: Accessor<MailboxLabel | null>;
  setChangeParentLabel: Setter<MailboxLabel | null>;
  openCreateLabel: (label?: MailboxLabel | null, parentId?: string | null) => void;
  closeCreateLabel: () => void;
  openChangeParentLabel: (label: MailboxLabel) => void;
  closeChangeParentLabel: () => void;

  // Import Emails Modal
  importEmailsModalOpen: Accessor<boolean>;
  setImportEmailsModalOpen: Setter<boolean>;
  openImportEmails: () => void;
  closeImportEmails: () => void;

  // Shortcuts Help Modal
  shortcutsHelpOpen: Accessor<boolean>;
  setShortcutsHelpOpen: Setter<boolean>;
  openShortcutsHelp: () => void;
  closeShortcutsHelp: () => void;

  // Settings Modal / Dialog
  settingsOpen: Accessor<boolean>;
  setSettingsOpen: Setter<boolean>;
  activeSettingsTab: Accessor<SettingsTabId>;
  setActiveSettingsTab: Setter<SettingsTabId>;
  openSettings: (tab?: SettingsTabId) => void;
  closeSettings: () => void;

  // Right Customizer Drawer
  rightCustomizerOpen: Accessor<boolean>;
  setRightCustomizerOpen: Setter<boolean>;
  toggleRightCustomizer: () => void;

  // Mobile Sidebar Drawer
  mobileSidebarOpen: Accessor<boolean>;
  setMobileSidebarOpen: Setter<boolean>;
  toggleMobileSidebar: () => void;

  // Forgot Password / Recovery Modals
  forgotPasswordModalOpen: Accessor<boolean>;
  setForgotPasswordModalOpen: Setter<boolean>;
  forgotStep: Accessor<1 | 2 | 3>;
  setForgotStep: Setter<1 | 2 | 3>;
  openForgotPassword: () => void;
  closeForgotPassword: () => void;

  // Exceptional Recovery Modal
  exceptionalRecoveryOpen: Accessor<boolean>;
  setExceptionalRecoveryOpen: Setter<boolean>;
  exceptionalStep: Accessor<1 | 2>;
  setExceptionalStep: Setter<1 | 2>;
  openExceptionalRecovery: () => void;
  closeExceptionalRecovery: () => void;
}

export function createModalState(overrides?: Partial<ModalContextValue>): ModalContextValue {
  const [composeOpen, setComposeOpen] = createSignal(false);
  const [composeAccountId, setComposeAccountId] = createSignal<string | null>(null);
  const [composeFromAlias, setComposeFromAlias] = createSignal<string | null>(null);

  const [contactsOpen, setContactsOpen] = createSignal(false);
  const [addMailboxModalOpen, setAddMailboxModalOpen] = createSignal(false);

  const [createFolderModalOpen, setCreateFolderModalOpen] = createSignal(false);
  const [folderToEdit, setFolderToEdit] = createSignal<MailboxFolder | null>(null);

  const [createLabelModalOpen, setCreateLabelModalOpen] = createSignal(false);
  const [labelToEdit, setLabelToEdit] = createSignal<MailboxLabel | null>(null);
  const [initialParentLabelId, setInitialParentLabelId] = createSignal<string | null>(null);
  const [changeParentLabel, setChangeParentLabel] = createSignal<MailboxLabel | null>(null);

  const [importEmailsModalOpen, setImportEmailsModalOpen] = createSignal(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = createSignal(false);

  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [activeSettingsTab, setActiveSettingsTab] = createSignal<SettingsTabId>("account");

  const [rightCustomizerOpen, setRightCustomizerOpen] = createSignal(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = createSignal(false);

  const [forgotPasswordModalOpen, setForgotPasswordModalOpen] = createSignal(false);
  const [forgotStep, setForgotStep] = createSignal<1 | 2 | 3>(1);

  const [exceptionalRecoveryOpen, setExceptionalRecoveryOpen] = createSignal(false);
  const [exceptionalStep, setExceptionalStep] = createSignal<1 | 2>(1);

  const openCompose = (options?: { accountId?: string | null; fromAlias?: string | null }) => {
    if (options?.accountId !== undefined) setComposeAccountId(options.accountId);
    if (options?.fromAlias !== undefined) setComposeFromAlias(options.fromAlias);
    setComposeOpen(true);
  };
  const closeCompose = () => setComposeOpen(false);

  const openContacts = () => setContactsOpen(true);
  const closeContacts = () => setContactsOpen(false);

  const openAddMailbox = () => setAddMailboxModalOpen(true);
  const closeAddMailbox = () => setAddMailboxModalOpen(false);

  const openCreateFolder = (folder?: MailboxFolder | null) => {
    setFolderToEdit(folder || null);
    setCreateFolderModalOpen(true);
  };
  const closeCreateFolder = () => {
    setFolderToEdit(null);
    setCreateFolderModalOpen(false);
  };

  const openCreateLabel = (label?: MailboxLabel | null, parentId?: string | null) => {
    setLabelToEdit(label || null);
    setInitialParentLabelId(parentId || null);
    setCreateLabelModalOpen(true);
  };
  const closeCreateLabel = () => {
    setLabelToEdit(null);
    setInitialParentLabelId(null);
    setCreateLabelModalOpen(false);
  };

  const openChangeParentLabel = (label: MailboxLabel) => {
    setChangeParentLabel(label);
  };
  const closeChangeParentLabel = () => setChangeParentLabel(null);

  const openImportEmails = () => setImportEmailsModalOpen(true);
  const closeImportEmails = () => setImportEmailsModalOpen(false);

  const openShortcutsHelp = () => setShortcutsHelpOpen(true);
  const closeShortcutsHelp = () => setShortcutsHelpOpen(false);

  const openSettings = (tab?: SettingsTabId) => {
    if (tab) setActiveSettingsTab(tab);
    setSettingsOpen(true);
  };
  const closeSettings = () => setSettingsOpen(false);

  const toggleRightCustomizer = () => setRightCustomizerOpen((prev) => !prev);
  const toggleMobileSidebar = () => setMobileSidebarOpen((prev) => !prev);

  const openForgotPassword = () => {
    setForgotStep(1);
    setForgotPasswordModalOpen(true);
  };
  const closeForgotPassword = () => setForgotPasswordModalOpen(false);

  const openExceptionalRecovery = () => {
    setExceptionalStep(1);
    setExceptionalRecoveryOpen(true);
  };
  const closeExceptionalRecovery = () => setExceptionalRecoveryOpen(false);

  const base: ModalContextValue = {
    composeOpen,
    setComposeOpen,
    composeAccountId,
    setComposeAccountId,
    composeFromAlias,
    setComposeFromAlias,
    openCompose,
    closeCompose,
    contactsOpen,
    setContactsOpen,
    openContacts,
    closeContacts,
    addMailboxModalOpen,
    setAddMailboxModalOpen,
    openAddMailbox,
    closeAddMailbox,
    createFolderModalOpen,
    setCreateFolderModalOpen,
    folderToEdit,
    setFolderToEdit,
    openCreateFolder,
    closeCreateFolder,
    createLabelModalOpen,
    setCreateLabelModalOpen,
    labelToEdit,
    setLabelToEdit,
    initialParentLabelId,
    setInitialParentLabelId,
    changeParentLabel,
    setChangeParentLabel,
    openCreateLabel,
    closeCreateLabel,
    openChangeParentLabel,
    closeChangeParentLabel,
    importEmailsModalOpen,
    setImportEmailsModalOpen,
    openImportEmails,
    closeImportEmails,
    shortcutsHelpOpen,
    setShortcutsHelpOpen,
    openShortcutsHelp,
    closeShortcutsHelp,
    settingsOpen,
    setSettingsOpen,
    activeSettingsTab,
    setActiveSettingsTab,
    openSettings,
    closeSettings,
    rightCustomizerOpen,
    setRightCustomizerOpen,
    toggleRightCustomizer,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    toggleMobileSidebar,
    forgotPasswordModalOpen,
    setForgotPasswordModalOpen,
    forgotStep,
    setForgotStep,
    openForgotPassword,
    closeForgotPassword,
    exceptionalRecoveryOpen,
    setExceptionalRecoveryOpen,
    exceptionalStep,
    setExceptionalStep,
    openExceptionalRecovery,
    closeExceptionalRecovery,
  };

  return Object.assign(base, overrides);
}

const ModalContext = createContext<ModalContextValue | undefined>(undefined);

export interface ModalProviderProps {
  value?: ModalContextValue;
  children: JSX.Element;
}

export function ModalProvider(props: ModalProviderProps) {
  const state = props.value ?? createModalState();
  return (
    <ModalContext.Provider value={state}>
      {props.children}
    </ModalContext.Provider>
  );
}

export function useModal(): ModalContextValue {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error("useModal must be used within a ModalProvider");
  }
  return context;
}

export function useOptionalModal(): ModalContextValue | undefined {
  return useContext(ModalContext);
}
