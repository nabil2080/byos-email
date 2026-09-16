import { Component, createSignal, onMount, For, Show } from "solid-js";
import {
  UserPasskey,
  listPasskeys,
  fetchPasskeyRegisterOptions,
  registerPasskey,
  deletePasskey,
} from "../../lib/api/auth";

function base64URLToBuffer(base64URL: string): ArrayBuffer {
  const base64 = base64URL.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (base64.length % 4)) % 4;
  const padded = base64 + "=".repeat(padLen);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function bufferToBase64URL(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

const SecurityPage: Component = () => {
  const [passkeys, setPasskeys] = createSignal<UserPasskey[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [addModalOpen, setAddModalOpen] = createSignal(false);
  const [deviceName, setDeviceName] = createSignal("");
  const [enrolling, setEnrolling] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [success, setSuccess] = createSignal<string | null>(null);
  const [deletingId, setDeletingId] = createSignal<string | null>(null);

  async function loadPasskeys() {
    setLoading(true);
    try {
      const list = await listPasskeys();
      setPasskeys(list);
    } catch (err) {
      console.warn("Failed to load passkeys:", err);
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    loadPasskeys();
  });

  function showSuccess(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 4000);
  }

  async function handleEnrollPasskey(e: Event) {
    e.preventDefault();
    if (typeof window === "undefined" || !window.PublicKeyCredential) {
      setError("WebAuthn / Passkeys are not supported by this browser.");
      return;
    }
    setEnrolling(true);
    setError(null);
    try {
      const opts = await fetchPasskeyRegisterOptions();

      const effectiveRpId =
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
          ? window.location.hostname
          : (opts.rp?.id || window.location.hostname);

      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge: base64URLToBuffer(opts.challenge),
          rp: {
            name: opts.rp?.name || "BYOS Control Panel",
            id: effectiveRpId,
          },
          user: {
            id: base64URLToBuffer(opts.user.id),
            name: opts.user.name,
            displayName: opts.user.displayName,
          },
          pubKeyCredParams: opts.pubKeyCredParams as any,
          authenticatorSelection: opts.authenticatorSelection as any,
          timeout: opts.timeout,
        },
      })) as PublicKeyCredential;

      if (!cred) {
        throw new Error("Passkey registration was cancelled.");
      }

      const rawId = bufferToBase64URL(cred.rawId);
      const resp = cred.response as AuthenticatorAttestationResponse;
      const attestationHex = Array.from(new Uint8Array(resp.attestationObject), (b) =>
        b.toString(16).padStart(2, "0")
      ).join("");

      await registerPasskey({
        credential_id: rawId,
        public_key: attestationHex,
        device_name: deviceName().trim() || "Touch ID / Windows Hello",
        challenge_token: opts.challenge,
      });

      setAddModalOpen(false);
      setDeviceName("");
      showSuccess("Passkey registered successfully! You can now log into Control Panel with 1-touch biometrics.");
      await loadPasskeys();
    } catch (err: any) {
      if (err?.name === "NotAllowedError" || err?.message?.includes("cancelled")) {
        setError("Passkey registration was cancelled or timed out.");
      } else {
        setError(err?.message || "Failed to enroll passkey.");
      }
    } finally {
      setEnrolling(false);
    }
  }

  async function handleDeletePasskey(id: string) {
    if (!confirm("Are you sure you want to revoke this passkey? You will not be able to use this device to sign in.")) {
      return;
    }
    setDeletingId(id);
    try {
      await deletePasskey(id);
      showSuccess("Passkey revoked.");
      await loadPasskeys();
    } catch (err: any) {
      setError(err?.message || "Failed to revoke passkey.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div class="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div class="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <a href="/dashboard/settings" class="text-xs font-semibold text-[#9E725F] hover:underline">
              ← Settings
            </a>
          </div>
          <h1 class="text-2xl font-bold tracking-tight text-[#3C3D3E]">
            Hardware & Trusted Devices
          </h1>
          <p class="mt-1 text-sm text-[#6F7173]">
            Manage FIDO2 / WebAuthn security keys and biometric sensors (Touch ID, Windows Hello, Face ID) for instant 1-touch login.
          </p>
        </div>
        <button
          onClick={() => {
            setError(null);
            setDeviceName("");
            setAddModalOpen(true);
          }}
          class="inline-flex items-center justify-center gap-2 rounded-xl bg-[#9E725F] px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#865E4D] transition-colors self-start sm:self-auto"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          Register New Passkey
        </button>
      </div>

      {/* Notifications */}
      <Show when={error()}>
        <div class="mb-6 rounded-xl bg-red-50 border border-red-200 p-4 text-xs text-red-800 flex items-center justify-between">
          <span>{error()}</span>
          <button onClick={() => setError(null)} class="text-red-500 hover:text-red-700 font-bold ml-2">✕</button>
        </div>
      </Show>
      <Show when={success()}>
        <div class="mb-6 rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-xs text-emerald-800 flex items-center justify-between">
          <span>{success()}</span>
          <button onClick={() => setSuccess(null)} class="text-emerald-500 hover:text-emerald-700 font-bold ml-2">✕</button>
        </div>
      </Show>

      {/* Passkeys List */}
      <div class="rounded-2xl border border-[#E2DFD8] bg-white overflow-hidden shadow-xs">
        <div class="border-b border-[#E2DFD8] bg-[#FAF8F5] px-6 py-4 flex items-center justify-between">
          <div>
            <h2 class="text-sm font-bold text-[#3C3D3E]">Registered Biometrics & Passkeys</h2>
            <p class="text-xs text-[#6F7173]">These authenticators can sign into this console without entering a password.</p>
          </div>
          <span class="rounded-full bg-[#9E725F]/15 px-2.5 py-0.5 text-xs font-mono font-bold text-[#9E725F]">
            {passkeys().length} active
          </span>
        </div>

        <Show when={loading()}>
          <div class="p-8 text-center text-xs text-[#6F7173]">Loading authenticators…</div>
        </Show>

        <Show when={!loading() && passkeys().length === 0}>
          <div class="p-12 text-center">
            <div class="w-12 h-12 rounded-2xl bg-[#F3ECE8] text-[#9E725F] flex items-center justify-center mx-auto mb-3">
              <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m0 0a8 8 0 00.528 2.86" />
              </svg>
            </div>
            <p class="text-sm font-bold text-[#3C3D3E]">No passkeys registered yet</p>
            <p class="text-xs text-[#6F7173] max-w-sm mx-auto mt-1 mb-4">
              Add your laptop's fingerprint reader, face unlock, or a physical YubiKey for fast, phishing-resistant sign-in.
            </p>
            <button
              onClick={() => {
                setError(null);
                setDeviceName("");
                setAddModalOpen(true);
              }}
              class="inline-flex items-center gap-1.5 rounded-lg bg-[#9E725F] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#865E4D] transition-colors"
            >
              Enroll this device
            </button>
          </div>
        </Show>

        <Show when={!loading() && passkeys().length > 0}>
          <div class="divide-y divide-[#E2DFD8]">
            <For each={passkeys()}>
              {(pk) => (
                <div class="p-5 flex items-center justify-between hover:bg-[#FAF8F5]/50 transition-colors">
                  <div class="flex items-center gap-3.5">
                    <div class="w-10 h-10 rounded-xl bg-[#F3ECE8] text-[#9E725F] flex items-center justify-center shrink-0">
                      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m0 0a8 8 0 00.528 2.86" />
                      </svg>
                    </div>
                    <div>
                      <div class="flex items-center gap-2">
                        <span class="text-sm font-bold text-[#3C3D3E]">{pk.device_name || "Hardware Key"}</span>
                        <span class="text-[10px] font-mono text-[#6F7173] bg-[#E2DFD8]/50 px-1.5 py-0.5 rounded">
                          {pk.credential_id.slice(0, 10)}…
                        </span>
                      </div>
                      <div class="mt-0.5 flex items-center gap-3 text-xs text-[#6F7173]">
                        <span>Registered {new Date(pk.created_at).toLocaleDateString()}</span>
                        <span>•</span>
                        <span>
                          {pk.last_used_at
                            ? `Last used ${new Date(pk.last_used_at).toLocaleDateString()}`
                            : "Never used"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeletePasskey(pk.id)}
                    disabled={deletingId() === pk.id}
                    class="rounded-lg border border-[#E2DFD8] px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 hover:border-red-200 transition-colors disabled:opacity-50"
                  >
                    {deletingId() === pk.id ? "Revoking…" : "Revoke"}
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* Modal: Enroll Passkey */}
      <Show when={addModalOpen()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-[#E2DFD8]">
            <h3 class="text-lg font-bold text-[#3C3D3E]">Enroll Passkey / Biometric Authenticator</h3>
            <p class="mt-1 text-xs text-[#6F7173]">
              Your browser will prompt you to authenticate via Touch ID, Windows Hello, Face ID, or a FIDO2 hardware token.
            </p>

            <Show when={error()}>
              <div class="mt-4 rounded-lg bg-red-50 p-3 text-xs text-red-800 border border-red-200">
                {error()}
              </div>
            </Show>

            <form onSubmit={handleEnrollPasskey} class="mt-5 space-y-4">
              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-[#6F7173] mb-1">
                  Device / Authenticator Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Work MacBook Pro, Office YubiKey"
                  value={deviceName()}
                  onInput={(e) => setDeviceName(e.currentTarget.value)}
                  class="block w-full rounded-lg border border-[#E2DFD8] bg-white px-3 py-2 text-sm text-[#3C3D3E] placeholder-[#6F7173]/50 focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none"
                  autofocus
                />
              </div>

              <div class="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={enrolling()}
                  onClick={() => setAddModalOpen(false)}
                  class="rounded-lg border border-[#E2DFD8] px-4 py-2 text-xs font-semibold text-[#6F7173] hover:bg-[#F3ECE8] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={enrolling()}
                  class="inline-flex items-center gap-1.5 rounded-lg bg-[#9E725F] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#865E4D] transition-colors disabled:opacity-50"
                >
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m0 0a8 8 0 00.528 2.86" />
                  </svg>
                  {enrolling() ? "Touch your sensor…" : "Trigger Biometric Sensor"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default SecurityPage;
