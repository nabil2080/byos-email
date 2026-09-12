import { Component, createSignal, Show } from "solid-js";
import { register } from "../lib/api/auth";

function recoveryFileSlug(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "organization";
}

const RegisterPage: Component = () => {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const wasm = await import("../generated/crypto-core/byos_crypto_core.js");
      const keypair = JSON.parse(wasm.wasm_generate_keypair()) as { secret_key: string; public_key: string };
      const result = await register(email().trim(), password(), keypair.public_key);
      const recoveryKey = new Blob([keypair.secret_key], { type: "text/plain" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(recoveryKey);
      link.download = `byos-recovery-key-${recoveryFileSlug(result.org_name)}-${new Date().toISOString().slice(0, 10)}.txt`;
      link.click();
      URL.revokeObjectURL(link.href);
      window.location.replace("/dashboard");
    } catch (err) {
      const status = (err as unknown as { status: number })?.status;
      if (status === 409) {
        setError("Email already registered. Try signing in.");
      } else if (status === 400) {
        setError("Password must be 8-128 characters.");
      } else {
        const msg = err instanceof Error ? err.message : "Registration failed";
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="min-h-screen bg-[#F0EEE9] flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-[#3C3D3E]">
      <div class="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div class="inline-flex w-12 h-12 rounded-xl bg-[#9E725F] items-center justify-center text-[#F0EEE9] font-mono font-bold text-base shadow-sm mb-4">
          BYOS
        </div>
        <h1 class="text-2xl font-bold tracking-tight text-[#3C3D3E]">
          Create New Organization
        </h1>
        <p class="mt-2 text-sm text-[#6F7173]">
          Initialize your organization root and download your master recovery key.
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
                Owner Email
              </label>
              <input
                type="email"
                required
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                placeholder="founder@example.com"
                class="block w-full rounded-lg border border-[#E2DFD8] bg-white px-3.5 py-2.5 text-sm text-[#3C3D3E] placeholder-[#6F7173]/50 focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none transition-all"
              />
            </div>

            <div>
              <div class="flex items-center justify-between mb-1.5">
                <label class="block text-xs font-semibold uppercase tracking-wider text-[#6F7173]">
                  Password
                </label>
                <span class="text-[11px] text-[#6F7173]">Min. 8 characters</span>
              </div>
              <input
                type="password"
                required
                minLength={8}
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                placeholder="••••••••••••"
                class="block w-full rounded-lg border border-[#E2DFD8] bg-white px-3.5 py-2.5 text-sm text-[#3C3D3E] placeholder-[#6F7173]/50 focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none transition-all"
              />
            </div>

            <div class="rounded-lg bg-[#F3ECE8]/60 border border-[#9E725F]/20 p-3 text-xs text-[#3C3D3E] leading-relaxed">
              <span class="font-semibold text-[#9E725F]">Zero-Knowledge Root:</span> Your browser will locally generate an Ed25519 organization recovery keypair before account provisioning.
            </div>

            <button
              type="submit"
              disabled={loading()}
              class="w-full inline-flex justify-center items-center rounded-lg bg-[#9E725F] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#865E4D] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/30 disabled:opacity-50 transition-colors"
            >
              {loading() ? "Generating Keys & Initializing…" : "Create Organization"}
            </button>
          </form>

          <div class="mt-6 pt-6 border-t border-[#E2DFD8] text-center text-xs text-[#6F7173]">
            Already registered?{" "}
            <a
              href="/login"
              class="font-semibold text-[#9E725F] hover:text-[#865E4D] hover:underline"
            >
              Sign in
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
