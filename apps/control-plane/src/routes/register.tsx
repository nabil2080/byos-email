import { Component, createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
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
  const navigate = useNavigate();
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
      navigate("/dashboard", { replace: true });
      window.location.reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Registration failed";
      if ((err as unknown as { status: number }).status === 409) setError("Email already registered");
      else if ((err as unknown as { status: number }).status === 400) setError("Invalid email or password must be 8-128 characters");
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="mx-auto max-w-md px-4 py-12">
      <h1 class="text-2xl font-semibold text-slate-900">Create account</h1>
      <p class="mt-1 text-sm text-slate-500">Get started with BYOS.</p>
      <form onSubmit={handleSubmit} class="mt-6 space-y-4">
        <Show when={error()}>
          <div role="alert" class="rounded-md bg-red-50 p-3 text-sm text-red-700">{error()}</div>
        </Show>
        <div>
          <label class="text-sm font-medium text-slate-700">Email</label>
          <input type="email" required value={email()} onInput={(e) => setEmail(e.currentTarget.value)} class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="you@example.com" />
        </div>
        <div>
          <label class="text-sm font-medium text-slate-700">Password</label>
          <input type="password" required minLength={8} value={password()} onInput={(e) => setPassword(e.currentTarget.value)} class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="••••••••" />
          <p class="mt-1 text-xs text-slate-500">8-128 characters</p>
        </div>
        <button type="submit" disabled={loading()} class="w-full rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
          {loading() ? "Creating…" : "Create account"}
        </button>
        <p class="text-center text-sm text-slate-500">
          Already have an account? <a href="/login" class="text-sky-600 hover:underline">Sign in</a>
        </p>
      </form>
    </div>
  );
};

export default RegisterPage;
