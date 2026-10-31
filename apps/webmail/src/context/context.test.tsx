import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { createRoot } from "solid-js";
import {
  AuthProvider,
  useAuth,
  useOptionalAuth,
  createAuthState,
  ModalProvider,
  useModal,
  useOptionalModal,
  createModalState,
  MailProvider,
  useMail,
  useOptionalMail,
  createMailState,
  AppProviders,
} from "./index";
import type { UserMe, Mailbox, ConnectedAccount } from "../api";

describe("SolidJS Modular Feature Contexts", () => {
  afterEach(() => {
    cleanup();
  });

  describe("AuthContext", () => {
    it("creates default auth state with expected initial values", () => {
      createRoot((dispose) => {
        const auth = createAuthState();
        expect(auth.currentUser()).toBeNull();
        expect(auth.isLoading()).toBe(true);
        expect(auth.selectedMailbox()).toBeNull();
        expect(auth.activeMailboxId()).toBeNull();
        expect(auth.connectedAccounts()).toEqual([]);
        expect(auth.mailboxKey()).toBeNull();
        expect(auth.isMailboxLocked("test-id")).toBe(true);
        dispose();
      });
    });

    it("reactively updates currentUser, mailboxes, and computes activeMailboxId", () => {
      createRoot((dispose) => {
        const auth = createAuthState();
        const mockUser: UserMe = {
          user_id: "usr_1",
          email: "alice@byos.local",
          org_id: "org_1",
          role: "member",
        };
        const mockBox: Mailbox = {
          id: "mbx_123",
          local_part: "alice",
          domain_id: "dom_1",
          mode: "path_a",
        };

        auth.setCurrentUser(mockUser);
        auth.setSelectedMailbox(mockBox);

        expect(auth.currentUser()?.email).toBe("alice@byos.local");
        expect(auth.selectedMailbox()?.id).toBe("mbx_123");
        expect(auth.activeMailboxId()).toBe("mbx_123");
        dispose();
      });
    });

    it("locks mailbox, clears in-memory keys, and marks account locked", () => {
      createRoot((dispose) => {
        const auth = createAuthState();
        const mbId = "mbx_lock_test";
        const keyBytes = new Uint8Array(32).fill(7);

        auth.setMailboxKey(keyBytes);
        auth.setUnlockedBoxId(mbId);
        auth.setConnectedAccounts([
          {
            id: mbId,
            email: "bob@byos.local",
            displayName: "Bob",
            role: "member",
            privacyMode: "path_a",
            sessionToken: "token_123",
            mailboxSkHex: "07".repeat(32),
            isLocked: false,
          },
        ]);

        expect(auth.mailboxKey()).toEqual(keyBytes);
        expect(auth.unlockedBoxId()).toBe(mbId);

        auth.lockMailbox(mbId);

        expect(auth.mailboxKey()).toBeNull();
        expect(auth.unlockedBoxId()).toBeNull();
        expect(auth.connectedAccounts()[0].isLocked).toBe(true);
        expect(auth.connectedAccounts()[0].mailboxSkHex).toBeUndefined();
        dispose();
      });
    });

    it("throws when useAuth is called outside AuthProvider, but useOptionalAuth returns undefined", () => {
      createRoot((dispose) => {
        expect(() => useAuth()).toThrow("useAuth must be used within an AuthProvider");
        expect(useOptionalAuth()).toBeUndefined();
        dispose();
      });
    });

    it("renders consumer component within AuthProvider", () => {
      const TestConsumer = () => {
        const auth = useAuth();
        return (
          <div>
            <span data-testid="auth-user">{auth.currentUser()?.email || "guest"}</span>
            <button
              onClick={() =>
                auth.setCurrentUser({
                  user_id: "usr_2",
                  email: "charlie@byos.local",
                  org_id: "org_1",
                  role: "member",
                })
              }
            >
              Sign In
            </button>
          </div>
        );
      };

      render(() => (
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      ));

      expect(screen.getByTestId("auth-user")).toHaveTextContent("guest");
      fireEvent.click(screen.getByText("Sign In"));
      expect(screen.getByTestId("auth-user")).toHaveTextContent("charlie@byos.local");
    });
  });

  describe("ModalContext", () => {
    it("creates default modal state with all modals closed", () => {
      createRoot((dispose) => {
        const modal = createModalState();
        expect(modal.composeOpen()).toBe(false);
        expect(modal.contactsOpen()).toBe(false);
        expect(modal.addMailboxModalOpen()).toBe(false);
        expect(modal.createFolderModalOpen()).toBe(false);
        expect(modal.createLabelModalOpen()).toBe(false);
        expect(modal.settingsOpen()).toBe(false);
        expect(modal.rightCustomizerOpen()).toBe(false);
        expect(modal.mobileSidebarOpen()).toBe(false);
        dispose();
      });
    });

    it("opens and closes compose with options", () => {
      createRoot((dispose) => {
        const modal = createModalState();
        modal.openCompose({ accountId: "acc_99", fromAlias: "support@byos.local" });

        expect(modal.composeOpen()).toBe(true);
        expect(modal.composeAccountId()).toBe("acc_99");
        expect(modal.composeFromAlias()).toBe("support@byos.local");

        modal.closeCompose();
        expect(modal.composeOpen()).toBe(false);
        dispose();
      });
    });

    it("manages folder and label modals and active editing targets", () => {
      createRoot((dispose) => {
        const modal = createModalState();
        const mockFolder = {
          id: "fld_1",
          mailbox_id: "mbx_1",
          name: "Invoices",
          notify: false,
          created_at: new Date().toISOString(),
        };

        modal.openCreateFolder(mockFolder);
        expect(modal.createFolderModalOpen()).toBe(true);
        expect(modal.folderToEdit()).toEqual(mockFolder);

        modal.closeCreateFolder();
        expect(modal.createFolderModalOpen()).toBe(false);
        expect(modal.folderToEdit()).toBeNull();
        dispose();
      });
    });

    it("throws when useModal is called outside ModalProvider, but useOptionalModal returns undefined", () => {
      createRoot((dispose) => {
        expect(() => useModal()).toThrow("useModal must be used within a ModalProvider");
        expect(useOptionalModal()).toBeUndefined();
        dispose();
      });
    });
  });

  describe("MailContext", () => {
    it("creates default mail state with inbox selected and empty lists", () => {
      createRoot((dispose) => {
        const mail = createMailState();
        expect(mail.currentFolder()).toBe("inbox");
        expect(mail.messages()).toEqual([]);
        expect(mail.selectedMsg()).toBeNull();
        expect(mail.selectedIds().size).toBe(0);
        expect(mail.sortOrder()).toBe("newest");
        expect(mail.currentPage()).toBe(1);
        expect(mail.pageSize).toBe(50);
        expect(mail.draftDirty()).toBe(false);
        dispose();
      });
    });

    it("manages selection helpers cleanly", () => {
      createRoot((dispose) => {
        const mail = createMailState();

        mail.toggleSelectMessage("msg_1", true);
        mail.toggleSelectMessage("msg_2", true);
        expect(mail.selectedIds().has("msg_1")).toBe(true);
        expect(mail.selectedIds().has("msg_2")).toBe(true);
        expect(mail.selectedIds().size).toBe(2);

        mail.toggleSelectMessage("msg_1", false);
        expect(mail.selectedIds().has("msg_1")).toBe(false);
        expect(mail.selectedIds().size).toBe(1);

        mail.selectAllVisible(["msg_3", "msg_4"]);
        expect(mail.selectedIds().size).toBe(2);
        expect(mail.selectedIds().has("msg_3")).toBe(true);
        expect(mail.selectedIds().has("msg_4")).toBe(true);

        mail.clearSelection();
        expect(mail.selectedIds().size).toBe(0);
        dispose();
      });
    });

    it("throws when useMail is called outside MailProvider, but useOptionalMail returns undefined", () => {
      createRoot((dispose) => {
        expect(() => useMail()).toThrow("useMail must be used within a MailProvider");
        expect(useOptionalMail()).toBeUndefined();
        dispose();
      });
    });
  });

  describe("Unified AppProviders", () => {
    it("provides all three contexts to nested children without prop drilling", () => {
      const ChildView = () => {
        const auth = useAuth();
        const modal = useModal();
        const mail = useMail();

        return (
          <div>
            <div data-testid="folder-name">{mail.currentFolder()}</div>
            <div data-testid="compose-status">{modal.composeOpen() ? "open" : "closed"}</div>
            <div data-testid="auth-status">{auth.currentUser() ? "authed" : "anon"}</div>
            <button data-testid="btn-open-compose" onClick={() => modal.openCompose()}>
              Compose
            </button>
            <button data-testid="btn-change-folder" onClick={() => mail.setCurrentFolder("sent")}>
              Sent
            </button>
          </div>
        );
      };

      render(() => (
        <AppProviders>
          <ChildView />
        </AppProviders>
      ));

      expect(screen.getByTestId("folder-name")).toHaveTextContent("inbox");
      expect(screen.getByTestId("compose-status")).toHaveTextContent("closed");
      expect(screen.getByTestId("auth-status")).toHaveTextContent("anon");

      fireEvent.click(screen.getByTestId("btn-open-compose"));
      expect(screen.getByTestId("compose-status")).toHaveTextContent("open");

      fireEvent.click(screen.getByTestId("btn-change-folder"));
      expect(screen.getByTestId("folder-name")).toHaveTextContent("sent");
    });
  });
});
