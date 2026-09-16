import { Component, createSignal, Show, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { login, me, fetchPasskeyLoginOptions, loginWithPasskey } from "../lib/api/auth";

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

const LoginPage: Component = () => {
  const navigate = useNavigate();
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [passkeyLoading, setPasskeyLoading] = createSignal(false);
  const [checkingSession, setCheckingSession] = createSignal(true);

  onMount(async () => {
    try {
      const session = await me();
      if (session && session.id) {
        if (session.role === "member") {
          const webmailUrl =
            (import.meta as unknown as { env: Record<string, string> }).env?.VITE_WEBMAIL_URL ||
            "http://127.0.0.1:3001";
          window.location.replace(webmailUrl);
          return;
        }
        window.location.replace("/dashboard");
        return;
      }
    } catch {
      // Not logged in, stay on login page
    } finally {
      setCheckingSession(false);
    }
  });

  async function handlePasskeyLogin() {
    if (typeof window === "undefined" || !window.PublicKeyCredential) {
      setError("Passkeys and WebAuthn are not supported in this browser.");
      return;
    }
    setError(null);
    setPasskeyLoading(true);
    try {
      const emailInput = email().trim() || undefined;
      const opts = await fetchPasskeyLoginOptions(emailInput);

      const effectiveRpId =
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
          ? window.location.hostname
          : (opts.rpId || window.location.hostname);

      const allowCreds = opts.allowCredentials?.map((c) => ({
        id: base64URLToBuffer(c.id),
        type: "public-key" as const,
      }));

      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge: base64URLToBuffer(opts.challenge),
          rpId: effectiveRpId,
          userVerification: opts.userVerification as any,
          timeout: opts.timeout,
          allowCredentials: allowCreds && allowCreds.length > 0 ? allowCreds : undefined,
        },
      })) as PublicKeyCredential;

      if (!assertion) {
        throw new Error("Passkey login was cancelled.");
      }

      const credId = bufferToBase64URL(assertion.rawId);
      const resp = assertion.response as AuthenticatorAssertionResponse;
      const sigHex = Array.from(new Uint8Array(resp.signature), (b) =>
        b.toString(16).padStart(2, "0")
      ).join("");
      const clientDataB64 = bufferToBase64URL(resp.clientDataJSON);

      const loginRes = await loginWithPasskey({
        credential_id: credId,
        challenge_token: opts.challenge,
        signature: sigHex,
        client_data_json: clientDataB64,
      });

      if (loginRes.role === "member") {
        const webmailUrl =
          (import.meta as unknown as { env: Record<string, string> }).env?.VITE_WEBMAIL_URL ||
          "http://127.0.0.1:3001";
        window.location.replace(webmailUrl);
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get("redirect") || "/dashboard";
      window.location.replace(redirect);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Passkey authentication failed";
      setError(msg);
    } finally {
      setPasskeyLoading(false);
    }
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(email().trim(), password());
      if (res.role === "member") {
        const webmailUrl =
          (import.meta as unknown as { env: Record<string, string> }).env?.VITE_WEBMAIL_URL ||
          "http://127.0.0.1:3001";
        window.location.replace(webmailUrl);
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get("redirect") || "/dashboard";
      window.location.replace(redirect);
    } catch (err) {
      const status = (err as unknown as { status: number })?.status;
      if (status === 429) {
        setError("Too many attempts. Please try again later.");
      } else if (status === 401) {
        setError("Invalid email or password.");
      } else {
        const msg = err instanceof Error ? err.message : "Authentication failed";
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="min-h-screen bg-[#F0EEE9] flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-[#3C3D3E]">
      <Show when={checkingSession()}>
        <div class="text-center text-sm text-[#6F7173]">
          Checking session…
        </div>
      </Show>

      <Show when={!checkingSession()}>
        <div class="sm:mx-auto sm:w-full sm:max-w-md text-center">
          <div class="inline-flex w-12 h-12 rounded-xl bg-[#9E725F] items-center justify-center text-[#F0EEE9] font-mono font-bold text-base shadow-sm mb-4">
            BYOS
          </div>
          <h1 class="text-2xl font-bold tracking-tight text-[#3C3D3E]">
            Sign in to Control Panel
          </h1>
          <p class="mt-2 text-sm text-[#6F7173]">
            Administrative console for your self-sovereign email organization.
          </p>
        </div>

        <div class="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div class="bg-white py-8 px-6 shadow-sm border border-[#E2DFD8] sm:rounded-2xl sm:px-10">
            <Show when={error()}>
              <div
                role="alert"
                class="mb-6 rounded-lg bg-red-50 p-3.5 text-xs text-red-800 border border-red-200"
              >
                {error()}
              </div>
            </Show>

            <form onSubmit={handleSubmit} class="space-y-5">
              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-[#6F7173] mb-1.5">
                  Work Email
                </label>
                <input
                  type="email"
                  required
                  value={email()}
                  onInput={(e) => setEmail(e.currentTarget.value)}
                  placeholder="admin@yourcompany.com"
                  class="block w-full rounded-lg border border-[#E2DFD8] bg-white px-3.5 py-2.5 text-sm text-[#3C3D3E] placeholder-[#6F7173]/50 focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none transition-all"
                />
              </div>

              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <label class="block text-xs font-semibold uppercase tracking-wider text-[#6F7173]">
                    Password
                  </label>
                </div>
                <input
                  type="password"
                  required
                  value={password()}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                  placeholder="••••••••••••"
                  class="block w-full rounded-lg border border-[#E2DFD8] bg-white px-3.5 py-2.5 text-sm text-[#3C3D3E] placeholder-[#6F7173]/50 focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={loading() || passkeyLoading()}
                class="w-full inline-flex justify-center items-center rounded-lg bg-[#9E725F] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#865E4D] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/30 disabled:opacity-50 transition-colors"
              >
                {loading() ? "Authenticating…" : "Sign In to Admin Console"}
              </button>

              <div class="relative my-4">
                <div class="absolute inset-0 flex items-center">
                  <div class="w-full border-t border-[#E2DFD8]" />
                </div>
                <div class="relative flex justify-center text-xs uppercase">
                  <span class="bg-white px-2 text-[#6F7173]">Or continue with</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handlePasskeyLogin}
                disabled={loading() || passkeyLoading()}
                class="w-full inline-flex justify-center items-center gap-2 rounded-lg border border-[#E2DFD8] bg-[#F7F5F0] px-4 py-2.5 text-sm font-semibold text-[#3C3D3E] hover:bg-[#EAE6DE] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/30 disabled:opacity-50 transition-colors"
              >
                <svg class="w-4 h-4 text-[#9E725F]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m0 0a8 8 0 00.528 2.86" />
                </svg>
                {passkeyLoading() ? "Verifying Passkey…" : "Sign In with Passkey / Biometrics"}
              </button>
            </form>

            <div class="mt-6 pt-6 border-t border-[#E2DFD8] text-center text-xs text-[#6F7173]">
              Need to register a new organization?{" "}
              <a
                href="/register"
                class="font-semibold text-[#9E725F] hover:text-[#865E4D] hover:underline"
              >
                Create organization
              </a>
            </div>
          </div>

          <div class="mt-6 text-center text-xs text-[#6F7173]">
            Looking for personal or webmail access?{" "}
            <a
              href={(import.meta as unknown as { env: Record<string, string> }).env?.VITE_WEBMAIL_URL || "http://127.0.0.1:3001"}
              class="font-medium text-[#9E725F] hover:underline"
            >
              Open Webmail Client →
            </a>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default LoginPage;
