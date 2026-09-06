import { Component, createEffect, createSignal, onCleanup, Show } from "solid-js";
import ProviderSelector from "./ProviderSelector";
import S3Form from "./S3Form";
import MockForm from "./MockForm";
import type { StorageProvider } from "../../lib/api/storage";
import { validateStorageConfig } from "../../lib/validation/storage";
import { authorizeGoogleDrive } from "../../lib/api/storage";

interface Props {
  open: boolean;
  mode: "create" | "replace";
  onClose: () => void;
  onSubmit: (provider: StorageProvider, config: Record<string, unknown>) => Promise<void>;
}

const ConnectStorageDialog: Component<Props> = (props) => {
  const [provider, setProvider] = createSignal<StorageProvider>("s3");
  const [endpoint, setEndpoint] = createSignal("");
  const [bucket, setBucket] = createSignal("");
  const [accessKey, setAccessKey] = createSignal("");
  const [secretKey, setSecretKey] = createSignal("");
  const [region, setRegion] = createSignal("");
  const [pathStyle, setPathStyle] = createSignal(true);
  const [root, setRoot] = createSignal("");
  const [accessToken, setAccessToken] = createSignal("");
  const [refreshToken, setRefreshToken] = createSignal("");
  const [folderId, setFolderId] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  const [topError, setTopError] = createSignal("");

  let dialogRef: HTMLDialogElement | undefined;
  let triggerEl: HTMLElement | null = null;

  function clearSensitive() {
    setAccessKey("");
    setSecretKey("");
    setAccessToken("");
    setRefreshToken("");
  }

  function handleClose() {
    clearSensitive();
    setErrors({});
    setTopError("");
    props.onClose();
  }

  // Native dialog lifecycle: open/close, Esc handling, focus restoration
  createEffect(() => {
    if (props.open) {
      triggerEl = document.activeElement as HTMLElement | null;
      queueMicrotask(() => {
        if (dialogRef && !dialogRef.open) {
          dialogRef.showModal();
          // focus first provider radio
          const first = dialogRef.querySelector<HTMLInputElement>('input[name="provider"]');
          first?.focus();
        }
      });
    } else {
      if (dialogRef?.open) dialogRef.close();
      // focus restoration
      triggerEl?.focus();
      triggerEl = null;
    }
  });

  function onDialogCancel(e: Event) {
    e.preventDefault();
    handleClose();
  }

  function onDialogClick(e: MouseEvent) {
    // Backdrop click: native dialog closes only when clicking backdrop (target === dialog)
    if (e.target === dialogRef) handleClose();
  }

  function onDialogClose() {
    // Sync when dialog closed via Esc or programmatically
    if (props.open) handleClose();
  }

  async function startGoogleAuthorization() {
    setTopError("");
    setSubmitting(true);
    try {
      const orgId = (document.querySelector('meta[name="org-id"]') as HTMLMetaElement)?.content || "";
      if (!orgId) {
        throw new Error("Organization ID is unavailable.");
      }
      const result = await authorizeGoogleDrive(orgId);
      window.location.assign(result.authorization_url);
    } catch {
      setTopError("Google Drive authorization is unavailable. Check OAuth configuration.");
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setTopError("");
    setErrors({});

    let config: Record<string, unknown>;
    if (provider() === "google_drive_mock") {
      config = {};
      if (root().trim() !== "") config.root = root().trim();
    } else if (provider() === "google_drive") {
      config = {
        access_token: accessToken(),
        ...(refreshToken().trim() ? { refresh_token: refreshToken().trim() } : {}),
        ...(folderId().trim() ? { folder_id: folderId().trim() } : {}),
      };
    } else {
      config = {
        endpoint: endpoint().trim(),
        bucket: bucket().trim(),
        access_key: accessKey(),
        secret_key: secretKey(),
        ...(region().trim() ? { region: region().trim() } : {}),
        path_style: pathStyle(),
      };
    }

    const v = validateStorageConfig(provider(), config);
    if (!v.ok) {
      setErrors({ [v.field]: v.message });
      return;
    }

    setSubmitting(true);
    try {
      await props.onSubmit(provider(), config);
      clearSensitive();
      setEndpoint("");
      setBucket("");
      setRegion("");
      setRoot("");
      props.onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Storage service temporarily unavailable.";
      if (msg.includes("409")) {
        setTopError("An active storage configuration already exists for this organization. Use Replace to rotate credentials.");
      } else if (msg.includes("403")) {
        setTopError("You don't have permission to manage storage for this organization.");
      } else if (msg.includes("400")) {
        setTopError(msg);
      } else {
        setTopError("Storage service temporarily unavailable.");
      }
      clearSensitive();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Show when={props.open}>
      <dialog
        ref={dialogRef}
        onCancel={onDialogCancel}
        onClose={onDialogClose}
        onClick={onDialogClick}
        aria-labelledby="dialog-title"
        class="p-0 bg-transparent backdrop:bg-slate-900/50 open:flex open:items-center open:justify-center max-w-none w-full h-full"
      >
        <div class="relative w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto mx-4">
          <h2 id="dialog-title" class="text-lg font-semibold text-slate-900">
            {props.mode === "create" ? "Connect Storage" : "Replace Storage Configuration"}
          </h2>
          <p class="mt-1 text-xs text-slate-500">
            Credentials are encrypted and stored. They are never displayed again after submission.
          </p>

          <Show when={topError()}>
            <div role="alert" class="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
              {topError()}
            </div>
          </Show>

          <form onSubmit={handleSubmit} class="mt-6 space-y-6">
            <ProviderSelector value={provider()} onChange={setProvider} disabled={submitting()} />

            <Show when={provider() !== "google_drive_mock" && provider() !== "google_drive"}>
              <S3Form
                endpoint={endpoint()}
                setEndpoint={setEndpoint}
                bucket={bucket()}
                setBucket={setBucket}
                accessKey={accessKey()}
                setAccessKey={setAccessKey}
                secretKey={secretKey()}
                setSecretKey={setSecretKey}
                region={region()}
                setRegion={setRegion}
                pathStyle={pathStyle()}
                setPathStyle={setPathStyle}
                disabled={submitting()}
                errors={errors()}
              />
            </Show>

            <Show when={provider() === "google_drive"}>
              <div class="grid gap-3">
                <button type="button" onClick={startGoogleAuthorization} disabled={submitting()} class="rounded-md border border-sky-600 px-3 py-2 text-sm font-medium text-sky-700 disabled:opacity-50">Authorize with Google</button>
                <p class="text-xs text-slate-500">Or enter an existing OAuth token below for controlled service-account deployments.</p>
                <input type="password" autocomplete="off" placeholder="Google OAuth access token" value={accessToken()} onInput={(event) => setAccessToken(event.currentTarget.value)} disabled={submitting()} class="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                <input type="password" autocomplete="off" placeholder="Refresh token (optional)" value={refreshToken()} onInput={(event) => setRefreshToken(event.currentTarget.value)} disabled={submitting()} class="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                <input placeholder="Drive folder ID (optional)" value={folderId()} onInput={(event) => setFolderId(event.currentTarget.value)} disabled={submitting()} class="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                <p class="text-xs text-slate-500">Tokens are sent once for encrypted storage and are never returned by the API.</p>
              </div>
            </Show>

            <Show when={provider() === "google_drive_mock"}>
              <MockForm root={root()} setRoot={setRoot} disabled={submitting()} errors={errors()} />
            </Show>

            <div class="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={submitting()}
                class="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting()}
                class="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
              >
                {submitting() ? "Saving…" : props.mode === "create" ? "Save configuration" : "Save new configuration"}
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </Show>
  );
};

export default ConnectStorageDialog;
