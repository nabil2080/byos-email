import { Component, Show, createSignal } from "solid-js";
import type { StorageConnection } from "../../lib/api/storage";

interface Props {
  connection: StorageConnection | null;
  loading: boolean;
  error?: string;
  onConnect: () => void;
  onReplace: () => void;
  onTest?: () => void;
  isTesting?: boolean;
  onDisconnect?: () => void;
  isDisconnecting?: boolean;
}

const providerLabel: Record<string, string> = {
  s3: "S3",
  minio: "MinIO",
  s3_compatible: "S3 Compatible",
  google_drive_mock: "Google Drive Mock",
  google_drive: "Google Drive",
};

const StorageCard: Component<Props> = (props) => {
  const [showConfirm, setShowConfirm] = createSignal(false);

  return (
    <div class="rounded-lg border border-slate-200 bg-white shadow-sm">
      <Show when={props.loading}>
        <div class="p-6 animate-pulse space-y-3">
          <div class="h-4 w-32 bg-slate-200 rounded" />
          <div class="h-3 w-48 bg-slate-100 rounded" />
        </div>
      </Show>

      <Show when={!props.loading && !!props.error}>
        <div class="p-6">
          <p class="text-sm font-medium text-red-700">Unable to load storage</p>
          <p class="mt-1 text-xs text-slate-500">{props.error}</p>
          <button onClick={props.onConnect} class="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800">Try again</button>
        </div>
      </Show>

      <Show when={!props.loading && !props.error && !props.connection}>
        <div class="p-6 text-center border-2 border-dashed border-slate-200 rounded-lg m-4">
          <div class="mx-auto h-8 w-8 rounded bg-slate-100 flex items-center justify-center text-slate-500">◧</div>
          <h3 class="mt-3 text-sm font-medium text-slate-900">No storage configured</h3>
          <p class="mt-1 text-xs text-slate-500">Connect S3-compatible, MinIO or Mock (dev) storage for your organization.</p>
          <button onClick={props.onConnect} class="mt-4 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700">Connect Storage</button>
        </div>
      </Show>

      <Show when={!props.loading && !props.error && props.connection}>
        <div class="p-6">
          <div class="flex items-start justify-between gap-4">
            <div class="flex-1 min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="inline-flex items-center rounded bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">{providerLabel[props.connection!.provider] || props.connection!.provider}</span>
                <Show when={props.connection!.status === "active" && !props.connection!.last_checked}>
                  <span class="inline-flex items-center gap-1 text-xs text-emerald-700"><span class="h-2 w-2 rounded-full bg-emerald-500" />Configured • Encrypted</span>
                </Show>
                <Show when={props.connection!.status === "active" && !!props.connection!.last_checked}>
                  <span class="inline-flex items-center gap-1 text-xs text-emerald-700"><span class="h-2 w-2 rounded-full bg-emerald-500" />Connection verified</span>
                </Show>
                <Show when={props.connection!.status === "error" && props.connection!.error_code === "authentication_failed"}>
                  <span class="inline-flex items-center gap-1 text-xs text-amber-700"><span class="h-2 w-2 rounded-full bg-amber-500" />Authentication failed</span>
                </Show>
                <Show when={props.connection!.status === "error" && props.connection!.error_code === "provider_unavailable"}>
                  <span class="inline-flex items-center gap-1 text-xs text-amber-700"><span class="h-2 w-2 rounded-full bg-amber-500" />Provider unavailable</span>
                </Show>
                <Show when={props.connection!.status === "error" && props.connection!.error_code === "configuration_error"}>
                  <span class="inline-flex items-center gap-1 text-xs text-red-700"><span class="h-2 w-2 rounded-full bg-red-500" />Configuration error</span>
                </Show>
                {props.connection!.provider === "google_drive_mock" && <span class="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">DEV</span>}
              </div>
              <dl class="mt-3 space-y-1 text-sm">
                <div class="flex gap-2"><dt class="text-slate-500">Bucket:</dt><dd class="font-mono text-slate-900 truncate">{props.connection!.bucket_name}</dd></div>
                <Show when={!!props.connection!.last_checked}>
                  <div class="flex gap-2"><dt class="text-slate-500">Last checked:</dt><dd class="text-slate-600">{new Date(props.connection!.last_checked!).toLocaleString()}</dd></div>
                </Show>
                <Show when={props.connection!.status === "error" && !!props.connection!.error_code}>
                  <div class="flex gap-2"><dt class="text-slate-500">Error:</dt><dd class="text-slate-600 text-xs">{props.connection!.error_code === "authentication_failed" && "Authentication failed – check access key and secret key."}{props.connection!.error_code === "provider_unavailable" && "Provider unavailable – check endpoint and bucket."}{props.connection!.error_code === "configuration_error" && "Configuration error – check provider settings."}{!["authentication_failed","provider_unavailable","configuration_error"].includes(props.connection!.error_code!) && props.connection!.error_code}</dd></div>
                </Show>
                <div class="flex gap-2"><dt class="text-slate-500">Updated:</dt><dd class="text-slate-600">{new Date(props.connection!.updated_at).toLocaleString()}</dd></div>
              </dl>
              <div class="mt-4 flex flex-wrap gap-2">
                <button onClick={props.onTest} disabled={props.isTesting || props.isDisconnecting} aria-busy={props.isTesting} class="inline-flex items-center gap-2 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed">{props.isTesting ? <><span class="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />Testing…</> : props.connection!.status === "error" ? "Test again" : "Test connection"}</button>
                <button onClick={props.onReplace} disabled={props.isTesting || props.isDisconnecting} class="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">Replace</button>
                <button onClick={() => setShowConfirm(true)} disabled={props.isTesting || props.isDisconnecting} class="rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">{props.isDisconnecting ? "Disconnecting…" : "Disconnect"}</button>
              </div>
            </div>
          </div>
        </div>
      </Show>

      <Show when={showConfirm()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center">
          <div class="fixed inset-0 bg-slate-900/50" onClick={() => setShowConfirm(false)} aria-hidden="true" />
          <div role="dialog" aria-modal="true" aria-labelledby="disconnect-title" class="relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-xl mx-4">
            <h3 id="disconnect-title" class="text-sm font-semibold text-slate-900">Disconnect storage?</h3>
            <p class="mt-2 text-xs text-slate-600">This will remove the active storage connection for your organization. Mailboxes will become unavailable until you connect new storage. This cannot be undone automatically – you will need to connect again.</p>
            <div class="mt-6 flex justify-end gap-3">
              <button onClick={() => setShowConfirm(false)} disabled={props.isDisconnecting} class="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
              <button onClick={() => { setShowConfirm(false); props.onDisconnect?.(); }} disabled={props.isDisconnecting} class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">Disconnect</button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default StorageCard;
