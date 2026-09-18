import { Component, createSignal, Show, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  login,
  me,
  fetchPasskeyLoginOptions,
  loginWithPasskey,
  verifyLogin2FA,
  sendLogin2FACode,
} from "../lib/api/auth";
import { deriveClientPasswordVerifier } from "../lib/crypto/client_crypto";

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

  const [twoFactorChallenge, setTwoFactorChallenge] = createSignal<{
    challenge_token: string;
    methods: string[];
    preferred_method: string;
    destination_masked: string;
    debug_code?: string;
  } | null>(null);
  const [twoFactorCode, setTwoFactorCode] = createSignal("");
  const [twoFactorBusy, setTwoFactorBusy] = createSignal(false);
  const [selected2FAMethod, setSelected2FAMethod] = createSignal<string>("email");

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
        const params = new URLSearchParams(window.location.search);
        const seats = params.get("seats");
        const cycle = params.get("billing_cycle") || params.get("cycle");
        let redirect = params.get("redirect");
        if (!redirect && seats) {
          redirect = `/onboarding/pricing?seats=${seats}${cycle ? `&billing_cycle=${cycle}` : ""}`;
        } else if (!redirect) {
          redirect = "/dashboard";
        }
        window.location.replace(redirect);
        return;
      }
    } catch {
      // Not logged in, stay on login page
    } finally {
      setCheckingSession(false);
    }
  });

  function getSuccessfulRedirect(): string {
    const params = new URLSearchParams(window.location.search);
    const seats = params.get("seats");
    const cycle = params.get("billing_cycle") || params.get("cycle");
    const redirect = params.get("redirect");
    if (redirect) return redirect;
    if (seats) {
      return `/onboarding/pricing?seats=${seats}${cycle ? `&billing_cycle=${cycle}` : ""}`;
    }
    return "/dashboard";
  }

  async function handlePasskeyLogin() {
    setError(null);
    setPasskeyLoading(true);
    try {
      const em = email().trim().toLowerCase();
      const options = await fetchPasskeyLoginOptions(em || undefined);
      const challengeBuf = base64URLToBuffer(options.challenge);
      const allowCreds = (options.allowCredentials || []).map((c) => ({
        id: base64URLToBuffer(c.id),
        type: c.type as PublicKeyCredentialType,
      }));

      const credential = (await navigator.credentials.get({
        publicKey: {
          challenge: challengeBuf,
          rpId: options.rpId || window.location.hostname,
          userVerification: options.userVerification as UserVerificationRequirement,
          allowCredentials: allowCreds.length > 0 ? allowCreds : undefined,
          timeout: options.timeout || 60000,
        },
      })) as PublicKeyCredential;

      if (!credential) {
        throw new Error("No credential returned from authenticator");
      }

      const rawIdB64 = bufferToBase64URL(credential.rawId);
      const assertionResponse = credential.response as AuthenticatorAssertionResponse;
      const clientDataB64 = bufferToBase64URL(assertionResponse.clientDataJSON);
      const authDataB64 = bufferToBase64URL(assertionResponse.authenticatorData);
      const sigHex = Array.from(new Uint8Array(assertionResponse.signature))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const loginRes = await loginWithPasskey({
        credential_id: rawIdB64,
        authenticator_data: authDataB64,
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
      window.location.replace(getSuccessfulRedirect());
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
      const em = email().trim().toLowerCase();
      // Zero-Knowledge Authentication: Pre-hash password client-side before transmission.
      // Plaintext password NEVER crosses the network boundary.
      const passwordVerifier = await deriveClientPasswordVerifier(password(), em);
      const res = await login(em, passwordVerifier);

      if (res.two_factor_required) {
        setTwoFactorChallenge({
          challenge_token: res.challenge_token || "",
          methods: res.methods || ["email"],
          preferred_method: res.preferred_method || "email",
          destination_masked: res.destination_masked || "",
          debug_code: res.debug_code,
        });
        setSelected2FAMethod(res.preferred_method || "email");
        setTwoFactorCode(res.debug_code || "");
        setError(null);
        return;
      }

      if (res.role === "member") {
        const webmailUrl =
          (import.meta as unknown as { env: Record<string, string> }).env?.VITE_WEBMAIL_URL ||
          "http://127.0.0.1:3001";
        window.location.replace(webmailUrl);
        return;
      }
      window.location.replace(getSuccessfulRedirect());
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

  async function handleVerify2FA(e: Event) {
    e.preventDefault();
    const challenge = twoFactorChallenge();
    const code = twoFactorCode().trim();
    if (!challenge || !code) {
      setError("Please enter your 6-digit verification code.");
      return;
    }
    setError(null);
    setTwoFactorBusy(true);
    try {
      const res = await verifyLogin2FA(challenge.challenge_token, code);
      if (res.role === "member") {
        const webmailUrl =
          (import.meta as unknown as { env: Record<string, string> }).env?.VITE_WEBMAIL_URL ||
          "http://127.0.0.1:3001";
        window.location.replace(webmailUrl);
        return;
      }
      window.location.replace(getSuccessfulRedirect());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "2-Step verification failed";
      setError(msg);
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function handleSwitch2FAMethod(method: "email" | "phone") {
    const challenge = twoFactorChallenge();
    if (!challenge) return;
    setTwoFactorBusy(true);
    setError(null);
    try {
      const resp = await sendLogin2FACode(challenge.challenge_token, method);
      setSelected2FAMethod(method);
      setTwoFactorChallenge((prev) =>
        prev
          ? {
              ...prev,
              preferred_method: method,
              destination_masked: resp.destination_masked,
              debug_code: resp.debug_code,
            }
          : null
      );
      if (resp.debug_code) setTwoFactorCode(resp.debug_code);
    } catch (err: any) {
      setError(err?.message || "Failed to switch verification method.");
    } finally {
      setTwoFactorBusy(false);
    }
  }

  function handleCancel2FA() {
    setTwoFactorChallenge(null);
    setTwoFactorCode("");
    setError(null);
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
            {twoFactorChallenge() ? "Two-Step Verification" : "Sign in to Control Panel"}
          </h1>
          <p class="mt-2 text-sm text-[#6F7173]">
            {twoFactorChallenge()
              ? "Security challenge required to access administrative controls."
              : "Administrative console for your self-sovereign email organization."}
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

            <Show
              when={!twoFactorChallenge()}
              fallback={
                <div class="space-y-5">
                  <div class="flex items-center gap-3 p-3.5 rounded-xl bg-[#FAF9F6] border border-[#E2DFD8]">
                    <div class="w-9 h-9 rounded-lg bg-[#9E725F]/10 text-[#9E725F] flex items-center justify-center shrink-0">
                      <svg class="w-5 h-5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </div>
                    <div>
                      <h2 class="text-xs font-semibold text-[#3C3D3E]">2-Step Verification Active</h2>
                      <p class="text-[11px] text-[#6F7173]">
                        {twoFactorChallenge()?.preferred_method === "totp"
                          ? "Authenticator App Code"
                          : `Security code sent to ${twoFactorChallenge()?.destination_masked}`}
                      </p>
                    </div>
                  </div>

                  <form onSubmit={handleVerify2FA} class="space-y-4">
                    <div>
                      <label class="block text-xs font-semibold uppercase tracking-wider text-[#6F7173] mb-1.5">
                        6-Digit Security Code
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        required
                        autofocus
                        placeholder="123456"
                        value={twoFactorCode()}
                        onInput={(e) => setTwoFactorCode(e.currentTarget.value.replace(/[^0-9]/g, ""))}
                        disabled={twoFactorBusy()}
                        class="block w-full rounded-lg border border-[#E2DFD8] bg-white px-3.5 py-2.5 text-center font-mono text-lg tracking-widest text-[#3C3D3E] placeholder-[#6F7173]/40 focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none transition-all"
                      />
                    </div>

                    <Show when={(twoFactorChallenge()?.methods?.length || 0) > 1}>
                      <div class="flex items-center justify-between text-xs text-[#6F7173] pt-1">
                        <span>Alternate method:</span>
                        <div class="flex items-center gap-2">
                          <Show when={twoFactorChallenge()?.methods.includes("email") && selected2FAMethod() !== "email"}>
                            <button
                              type="button"
                              onClick={() => handleSwitch2FAMethod("email")}
                              disabled={twoFactorBusy()}
                              class="text-[#9E725F] hover:underline cursor-pointer font-medium"
                            >
                              Send Email Code
                            </button>
                          </Show>
                          <Show when={twoFactorChallenge()?.methods.includes("phone") && selected2FAMethod() !== "phone"}>
                            <button
                              type="button"
                              onClick={() => handleSwitch2FAMethod("phone")}
                              disabled={twoFactorBusy()}
                              class="text-[#9E725F] hover:underline cursor-pointer font-medium"
                            >
                              Send SMS Code
                            </button>
                          </Show>
                        </div>
                      </div>
                    </Show>

                    <button
                      type="submit"
                      disabled={twoFactorBusy() || twoFactorCode().length < 6}
                      class="w-full inline-flex justify-center items-center rounded-lg bg-[#9E725F] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#865E4D] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/30 disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      {twoFactorBusy() ? "Verifying Code…" : "Verify & Sign In"}
                    </button>

                    <button
                      type="button"
                      onClick={handleCancel2FA}
                      disabled={twoFactorBusy()}
                      class="w-full rounded-lg border border-[#E2DFD8] bg-white hover:bg-[#FAF9F6] px-4 py-2 text-xs font-medium text-[#6F7173] hover:text-[#3C3D3E] transition cursor-pointer"
                    >
                      ← Back to Email & Password
                    </button>
                  </form>
                </div>
              }
            >
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
                  <div class="mt-2 rounded-lg bg-[#FAF9F6] border border-[#E2DFD8] p-2.5 flex items-center gap-2 text-[11px] text-[#6F7173]">
                    <svg class="w-3.5 h-3.5 text-[#9E725F] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <span>Zero-Knowledge: Passwords are hashed client-side before transmission.</span>
                  </div>
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
            </Show>

            <div class="mt-6 pt-6 border-t border-[#E2DFD8] text-center text-xs text-[#6F7173]">
              Need to register a new organization?{" "}
              <a
                href={`/register${typeof window !== "undefined" ? window.location.search : ""}`}
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
