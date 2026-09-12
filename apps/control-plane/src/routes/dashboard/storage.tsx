import { Component, createResource, createSignal, Show } from "solid-js";
import StorageCard from "../../components/storage/StorageCard";
import ConnectStorageDialog from "../../components/storage/ConnectStorageDialog";
import { useOrg } from "../../context/OrgContext";
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

export const StoragePage: Component = () => {
  const org = useOrg();
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [dialogMode, setDialogMode] = createSignal<"create" | "replace">("create");
  const [banner, setBanner] = createSignal<{ kind: "success" | "error"; text: string } | null>(null);
  const [isTesting, setIsTesting] = createSignal(false);
  const [isDisconnecting, setIsDisconnecting] = createSignal(false);
  const [migrationId, setMigrationId] = createSignal("");
  const [migration, setMigration] = createSignal<StorageMigrationStatus | null>(null);
  const [isMigrationBusy, setIsMigrationBusy] = createSignal(false);

  const [connection, { refetch }] = createResource(
    () => org.orgId,
    async (id) => {
      if (!id) return null;
      try {
        return await getStorageConnection(id);
      } catch (e: any) {
        if (e instanceof Error && e.message.includes("404")) return null;
        throw e;
      }
    }
  );

  function openCreate() {
    setDialogMode("create");
    setDialogOpen(true);
  }
  function openReplace() {
    setDialogMode("replace");
    setDialogOpen(true);
  }

  async function handleSubmit(provider: StorageProvider, config: Record<string, unknown>) {
    if (!org.orgId) throw new Error("Missing organization");
    if (dialogMode() === "create") {
      await createStorageConnection(org.orgId, { provider, config });
      setBanner({ kind: "success", text: "Storage configuration saved and encrypted." });
    } else {
      await updateStorageConnection(org.orgId, { provider, config });
      setBanner({ kind: "success", text: "Storage configuration updated and re-encrypted." });
    }
    await refetch();
    setTimeout(() => setBanner(null), 5000);
  }

  async function handleTest() {
    if (!org.orgId) return;
    setIsTesting(true);
    setBanner(null);
    try {
      const result = await testStorageConnection(org.orgId);
      await refetch();
      if (result.code === "verified") {
        setBanner({ kind: "success", text: "Storage connection verified successfully." });
      } else if (result.code === "authentication_failed") {
        setBanner({ kind: "error", text: "Authentication failed – check access key and secret key." });
      } else if (result.code === "provider_unavailable") {
        setBanner({ kind: "error", text: "Provider unavailable – check endpoint and bucket name." });
      } else if (result.code === "configuration_error") {
        setBanner({ kind: "error", text: "Configuration error – check provider settings." });
      } else {
        setBanner({ kind: "error", text: "Storage service temporarily unavailable." });
      }
      setTimeout(() => setBanner(null), 6000);
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("configuration_changed") || e?.status === 409) {
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
    if (!org.orgId) return;
    setIsDisconnecting(true);
    try {
      await deleteStorageConnection(org.orgId);
      await refetch();
      setBanner({ kind: "success", text: "Storage disconnected." });
    } catch (e: any) {
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
    if (!org.orgId || !migrationId().trim()) return;
    setIsMigrationBusy(true);
    try {
      setMigration(await getStorageMigrationStatus(org.orgId, migrationId().trim()));
      setBanner(null);
    } catch {
      setMigration(null);
      setBanner({ kind: "error", text: "Unable to load migration status." });
    } finally {
      setIsMigrationBusy(false);
    }
  }

  async function handleMigrationRetry() {
    if (!org.orgId || !migrationId().trim()) return;
    setIsMigrationBusy(true);
    try {
      const result = await retryStorageMigration(org.orgId, migrationId().trim());
      setMigration(result);
      setBanner({ kind: "success", text: "Migration retry started." });
    } catch {
      setBanner({ kind: "error", text: "Migration could not be retried. It may already be running or completed." });
    } finally {
      setIsMigrationBusy(false);
    }
  }

  return (
    <div class="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div class="mb-8">
        <h1 class="text-2xl font-bold tracking-tight text-[#3C3D3E]">
          Self-Sovereign Storage
        </h1>
        <p class="mt-1 text-sm text-[#6F7173]">
          Connect your S3-compatible or MinIO object bucket. All email bodies and attachments are encrypted at rest with client-side keys before upload.
        </p>
      </div>

      <Show when={banner()}>
        {(b) => (
          <div
            role="alert"
            class={`mb-6 rounded-xl p-4 text-xs border ${
              b().kind === "success"
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : "bg-red-50 text-red-800 border-red-200"
            }`}
          >
            {b().text}
          </div>
        )}
      </Show>

      <div class="rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs mb-8">
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
      </div>

      <ConnectStorageDialog
        open={dialogOpen()}
        mode={dialogMode()}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleSubmit}
      />

      <section class="rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs">
        <h2 class="text-sm font-bold text-[#3C3D3E]">Storage Migration Recovery</h2>
        <p class="mt-1 text-xs text-[#6F7173]">
          Enter a background migration ID to inspect synchronization progress or retry an object cutover.
        </p>
        <div class="mt-4 flex gap-2">
          <input
            class="min-w-0 flex-1 rounded-lg border border-[#E2DFD8] bg-white px-3 py-2 text-xs text-[#3C3D3E] placeholder-[#6F7173]/50 focus:border-[#9E725F] focus:outline-none"
            placeholder="Migration UUID"
            value={migrationId()}
            onInput={(e) => setMigrationId(e.currentTarget.value)}
          />
          <button
            class="rounded-lg border border-[#E2DFD8] bg-white px-4 py-2 text-xs font-semibold text-[#3C3D3E] hover:bg-[#F0EEE9] disabled:opacity-50 transition-colors"
            disabled={isMigrationBusy() || !migrationId().trim()}
            onClick={handleMigrationStatus}
          >
            Check Progress
          </button>
        </div>
        <Show when={migration()}>
          {(current) => (
            <div class="mt-4 rounded-xl bg-[#F0EEE9]/50 border border-[#E2DFD8] p-4 text-xs text-[#3C3D3E]">
              <div>
                Status: <strong class="capitalize font-bold text-[#9E725F]">{current().status}</strong> · Objects: {current().objects} · Retries: {current().retry_count}
              </div>
              <Show when={current().error_code}>
                <div class="mt-1 text-xs text-red-700">Error: {current().error_code}</div>
              </Show>
              <Show when={current().status === "failed"}>
                <button
                  class="mt-3 rounded-lg bg-[#9E725F] px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#865E4D] disabled:opacity-50 transition-colors"
                  disabled={isMigrationBusy()}
                  onClick={handleMigrationRetry}
                >
                  Retry Migration
                </button>
              </Show>
            </div>
          )}
        </Show>
      </section>
    </div>
  );
};

export default StoragePage;
