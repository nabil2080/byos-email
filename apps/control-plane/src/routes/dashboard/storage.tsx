import { Component, createResource, createSignal, Show } from "solid-js";
import StorageCard from "../../components/storage/StorageCard";
import ConnectStorageDialog from "../../components/storage/ConnectStorageDialog";
import {
  getStorageConnection,
  createStorageConnection,
  updateStorageConnection,
  testStorageConnection,
  deleteStorageConnection,
  getStorageMigrationStatus,
  retryStorageMigration,
  type StorageMigrationStatus,
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
  const [migrationId, setMigrationId] = createSignal("");
  const [migration, setMigration] = createSignal<StorageMigrationStatus | null>(null);
  const [isMigrationBusy, setIsMigrationBusy] = createSignal(false);

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

  async function handleMigrationStatus() {
    if (!orgId || !migrationId().trim()) return;
    setIsMigrationBusy(true);
    try {
      setMigration(await getStorageMigrationStatus(orgId, migrationId().trim()));
      setBanner(null);
    } catch {
      setMigration(null);
      setBanner({ kind: "error", text: "Unable to load migration status." });
    } finally {
      setIsMigrationBusy(false);
    }
  }

  async function handleMigrationRetry() {
    if (!orgId || !migrationId().trim()) return;
    setIsMigrationBusy(true);
    try {
      const result = await retryStorageMigration(orgId, migrationId().trim());
      setMigration(result);
      setBanner({ kind: "success", text: "Migration retry started." });
    } catch {
      setBanner({ kind: "error", text: "Migration could not be retried. It may already be running or completed." });
    } finally {
      setIsMigrationBusy(false);
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

      <section class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="migration-heading">
        <h2 id="migration-heading" class="text-sm font-medium text-slate-900">Storage migration recovery</h2>
        <p class="mt-1 text-xs text-slate-500">Enter a migration ID to inspect progress or retry a failed copy. Encrypted credentials remain server-side.</p>
        <div class="mt-3 flex gap-2">
          <input class="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Migration ID" value={migrationId()} onInput={(event) => setMigrationId(event.currentTarget.value)} />
          <button class="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-50" disabled={isMigrationBusy() || !migrationId().trim()} onClick={handleMigrationStatus}>Check</button>
        </div>
        <Show when={migration()}>
          {(current) => (
            <div class="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
              <div>Status: <strong>{current().status}</strong> · objects: {current().objects} · retries: {current().retry_count}</div>
              <Show when={current().error_code}><div class="mt-1 text-xs text-red-700">Error: {current().error_code}</div></Show>
              <Show when={current().status === "failed"}>
                <button class="mt-3 rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={isMigrationBusy()} onClick={handleMigrationRetry}>Retry migration</button>
              </Show>
            </div>
          )}
        </Show>
      </section>

      <p class="mt-6 text-xs text-slate-400">
        Use Test connection to verify provider connectivity. Configuration is encrypted immediately on save.
      </p>
    </div>
  );
};

export default StoragePage;
