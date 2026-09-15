import { Component, createSignal, Show } from "solid-js";

export const LoginForm: Component = () => {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [showPassword, setShowPassword] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const apiBase = () => {
    // If an explicit API URL is configured (production), use it.
    // Otherwise use an empty base so /v1 requests route through the
    // Vite dev-server proxy (astro.config.mjs → vite.server.proxy).
    const envUrl = (import.meta as unknown as { env: Record<string, string> }).env?.PUBLIC_API_URL;
    return envUrl ?? "";
  };

  async function handleLogin(e: Event) {
    e.preventDefault();
    const mail = email().trim().toLowerCase();
    const pw = password();

    if (!mail || !pw) {
      setError("Please enter both email and password.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${apiBase()}/v1/auth/login`, {
        method: "POST",
        credentials: "include", // Preserves HttpOnly session cookie
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: mail, password: pw }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Invalid email or password. Please double check your credentials.");
        }
        if (response.status === 429) {
          throw new Error("Too many sign-in attempts. Please wait a few minutes before trying again.");
        }
        const text = await response.text();
        throw new Error(text || `Authentication failed with status ${response.status}`);
      }

      const data = await response.json();
      const role = (data.role || "member").toLowerCase();
      const host = typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
      const protocol = typeof window !== "undefined" ? window.location.protocol : "http:";

      // Role-based routing:
      // Owners & Admins -> Control Panel (:3000)
      // Members -> Webmail client (:3001)
      if (role === "owner" || role === "admin") {
        window.location.href = `${protocol}//${host}:3000/dashboard`;
      } else {
        window.location.href = `${protocol}//${host}:3001/`;
      }
    } catch (err: any) {
      setError(err?.message || "Failed to sign in. Please verify your internet connection.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="space-y-5">
      <Show when={error()}>
        <div
          role="alert"
          class="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between"
        >
          <span>{error()}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            class="text-rose-500 hover:text-rose-800 font-bold ml-2 cursor-pointer"
          >
            ✕
          </button>
        </div>
      </Show>

      <form onSubmit={handleLogin} class="space-y-4">
        {/* Email */}
        <div>
          <label class="block text-xs font-semibold text-[#3C3D3E] mb-1">
            Work Email Address
          </label>
          <input
            type="email"
            required
            autocomplete="username"
            placeholder="you@company.com"
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            class="w-full px-3.5 py-2.5 rounded-xl border border-[#E2DFD8] bg-[#F8F7F4] text-xs text-[#3C3D3E] focus:outline-none focus:ring-2 focus:ring-[#9E725F] focus:bg-white transition"
          />
        </div>

        {/* Password */}
        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="text-xs font-semibold text-[#3C3D3E]">Password</label>
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword())}
              class="text-[11px] text-[#6F7173] hover:text-[#3C3D3E] cursor-pointer"
            >
              {showPassword() ? "Hide" : "Show"}
            </button>
          </div>
          <input
            type={showPassword() ? "text" : "password"}
            required
            autocomplete="current-password"
            placeholder="••••••••••••"
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
            class="w-full px-3.5 py-2.5 rounded-xl border border-[#E2DFD8] bg-[#F8F7F4] text-xs text-[#3C3D3E] focus:outline-none focus:ring-2 focus:ring-[#9E725F] focus:bg-white transition font-mono"
          />
        </div>

        <div class="flex items-center justify-between text-[11px] pt-1">
          <span class="text-[#6F7173]">Encrypted HttpOnly session</span>
          <a
            href="http://127.0.0.1:3000/dashboard/recovery"
            class="text-[#9E725F] hover:underline font-semibold"
          >
            Forgot Password / Recover Org
          </a>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading() || !email().trim() || !password()}
          class="w-full py-3 rounded-xl bg-[#9E725F] text-white text-xs font-semibold hover:bg-[#865E4D] transition shadow-xs disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer mt-2"
        >
          <Show when={loading()}>
            <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          </Show>
          <span>{loading() ? "Verifying Credentials…" : "Sign In to BYOS"}</span>
        </button>
      </form>
    </div>
  );
};
