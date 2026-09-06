import { Component, createResource, createSignal, Show } from "solid-js";
import StorageCard from "../../components/storage/StorageCard";
import ConnectStorageDialog from "../../components/storage/ConnectStorageDialog";
import {
  getStorageConnection,
  createStorageConnection,
  updateStorageConnection,
  testStorageConnection,
  deleteStorageConnection,
  type StorageProvider,
} from "../../lib/api/storage";

// In a real app orgId/userId come from auth context
function useOrgId(): string {
  return (document.querySelector('meta[name="org-id"]') as HTMLMetaElement)?.content || "";
}

export const StoragePage: Component = () => {
  const orgId = useOrgId();
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [dialogMode, setDialogMode] = createSignal<"create" | "replace">("create");
  const [banner, setBanner] = createSignal<{ kind: "success" | "error"; text: string } | null>(null);
  const [isTesting, setIsTesting] = createSignal(false);
  const [isDisconnecting, setIsDisconnecting] = createSignal(false);

  const [connection, { refetch }] = createResource(() => orgId, async (id) => {
    if (!id) return null;
    try {
      return await getStorageConnection(id);
    } catch (e) {
      if (e instanceof Error && e.message.includes("404")) return null;
      throw e;
    }
  });

  function openCreate() {
    setDialogMode("create");
    setDialogOpen(true);
  }
  function openReplace() {
    setDialogMode("replace");
    setDialogOpen(true);
  }

  async function handleSubmit(provider: StorageProvider, config: Record<string, unknown>) {
    if (!orgId) throw new Error("Missing organization");
    if (dialogMode() === "create") {
      await createStorageConnection(orgId, { provider, config });
      setBanner({ kind: "success", text: "Storage configuration saved — encrypted." });
    } else {
      await updateStorageConnection(orgId, { provider, config });
      setBanner({ kind: "success", text: "Storage configuration saved — encrypted." });
    }
    await refetch();
    setTimeout(() => setBanner(null), 5000);
  }

  async function handleTest() {
    if (!orgId) return;
    setIsTesting(true);
    // Clear previous banner, announce testing via aria-busy on button
    setBanner(null);
    try {
      const result = await testStorageConnection(orgId);
      await refetch();
      if (result.code === "verified") {
        setBanner({ kind: "success", text: "Connection verified." });
      } else if (result.code === "authentication_failed") {
        setBanner({ kind: "error", text: "Authentication failed – check access key and secret key." });
      } else if (result.code === "provider_unavailable") {
        setBanner({ kind: "error", text: "Provider unavailable – check endpoint and bucket." });
      } else if (result.code === "configuration_error") {
        setBanner({ kind: "error", text: "Configuration error – check provider settings." });
      } else {
        setBanner({ kind: "error", text: "Storage service temporarily unavailable." });
      }
      setTimeout(() => setBanner(null), 6000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // Preserve structured 409
      if (msg.includes("configuration_changed") || (e as unknown as { status?: number }).status === 409) {
        setBanner({ kind: "error", text: "Storage configuration changed while the test was running. Please test again." });
      } else if (msg.includes("403")) {
        setBanner({ kind: "error", text: "You don't have permission to test this storage connection." });
      } else if (msg.includes("404")) {
        setBanner({ kind: "error", text: "No storage connection found." });
      } else {
        setBanner({ kind: "error", text: "Storage service temporarily unavailable." });
      }
      await refetch();
      setTimeout(() => setBanner(null), 6000);
    } finally {
      setIsTesting(false);
    }
  }

  async function handleDisconnect() {
    if (!orgId) return;
    setIsDisconnecting(true);
    try {
      await deleteStorageConnection(orgId);
      await refetch();
      setBanner({ kind: "success", text: "Storage disconnected." });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("403")) {
        setBanner({ kind: "error", text: "You don't have permission to disconnect storage." });
      } else if (msg.includes("404")) {
        setBanner({ kind: "error", text: "No active storage connection." });
      } else {
        setBanner({ kind: "error", text: "Failed to disconnect storage." });
      }
    } finally {
      setIsDisconnecting(false);
    }
  }

  return (
    <div class="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div class="mb-6">
        <h1 class="text-2xl font-semibold text-slate-900">Storage</h1>
        <p class="mt-1 text-sm text-slate-500">
          S3-compatible storage for your organization. Credentials are encrypted and never displayed again.
        </p>
      </div>

      <Show when={banner()}>
        {(b) => (
          <div
            role="alert"
            aria-live="polite"
            class={`mb-4 rounded-md p-3 text-sm ${b().kind === "success" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}
          >
            {b().text}
          </div>
        )}
      </Show>

      <StorageCard
        connection={connection() ?? null}
        loading={connection.loading}
        error={connection.error ? "Unable to reach the BYOS API." : undefined}
        onConnect={openCreate}
        onReplace={openReplace}
        onTest={handleTest}
        isTesting={isTesting()}
        onDisconnect={handleDisconnect}
        isDisconnecting={isDisconnecting()}
      />

      <ConnectStorageDialog
        open={dialogOpen()}
        mode={dialogMode()}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleSubmit}
      />

      <p class="mt-6 text-xs text-slate-400">
        Use Test connection to verify provider connectivity. Configuration is encrypted immediately on save.
      </p>
    </div>
  );
};

export default StoragePage;
