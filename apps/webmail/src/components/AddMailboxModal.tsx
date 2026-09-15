import { Component, createSignal, Show } from "solid-js";
import { ConnectedAccount, login } from "../api";
import { autoUnwrapMailboxKey } from "../message_crypto";

interface AddMailboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (account: ConnectedAccount) => void;
}

export const AddMailboxModal: Component<AddMailboxModalProps> = (props) => {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    const mail = email().trim();
    const pass = password();

    if (!mail || !pass) {
      setError("Please enter both email and password.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Authenticate with backend
      const res = await login(mail, pass);

      let skHex = "";
      let searchKeyHex = "";

      // 2. Client-side key unwrapping or self-healing
      if (res.wrapped_sk_user) {
        try {
          const wasm = await import("../generated/crypto-core/byos_crypto_core.js");
          const skBytes = autoUnwrapMailboxKey(wasm, pass, res.wrapped_sk_user);
          skHex = Array.from(skBytes, (b) => b.toString(16).padStart(2, "0")).join("");
          searchKeyHex = wasm.wasm_derive_search_key(skHex);
        } catch (unwrapErr) {
          console.warn("Could not unwrap mailbox key with password:", unwrapErr);
        }
      } else if (res.mailbox_id) {
        // Self-healing: if an account has no active wrapped key material, generate and register a fresh keypair
        try {
          const wasm = await import("../generated/crypto-core/byos_crypto_core.js");
          const kpJson = wasm.wasm_generate_keypair();
          const kp = JSON.parse(kpJson) as { secret_key: string; public_key: string };
          const salt = new Uint8Array(16);
          crypto.getRandomValues(salt);
          const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join("");
          const passphraseEnvelope = wasm.wasm_passphrase_wrap_key(pass, saltHex, kp.secret_key);
          const healWrapped = JSON.stringify({
            salt: saltHex,
            envelope: passphraseEnvelope,
          });

          // Use a temporary apiRequest override to use the NEW token for reactivateHistoricalKeys
          const tempToken = res.token || sessionStorage.getItem("byos_active_session_token");

          // We need to import reactivateHistoricalKeys or use fetch directly since we need the new token
          await fetch(`/v1/mailboxes/${res.mailbox_id}/reactivate-keys`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-BYOS-Client": "webmail",
              "Authorization": `Bearer ${tempToken}`
            },
            body: JSON.stringify({
              wrapped_sk_user: healWrapped,
              mailbox_pk: kp.public_key,
            })
          });

          // Set skHex from the newly generated secret key
          skHex = kp.secret_key;
          searchKeyHex = wasm.wasm_derive_search_key(skHex);
        } catch (healErr) {
          console.warn("Self-healing mailbox key failed:", healErr);
        }
      }

      const mailboxId = res.mailbox_id || res.id || "";
      const newAccount: ConnectedAccount = {
        id: mailboxId,
        email: res.email || mail,
        displayName: res.mailbox_local_part || (res.email ? res.email.split("@")[0] : mail.split("@")[0]),
        role: res.role || "member",
        privacyMode: res.mailbox_mode || "org_managed",
        sessionToken: res.token || "",
        mailboxSkHex: skHex,
        searchKeyHex: searchKeyHex,
      };

      // 3. Persist to byos_connected_accounts in sessionStorage
      const existingStr = sessionStorage.getItem("byos_connected_accounts");
      let accounts: ConnectedAccount[] = [];
      if (existingStr) {
        try {
          accounts = JSON.parse(existingStr);
        } catch {}
      }
      accounts = accounts.filter(
        (a) => a.id !== newAccount.id && a.email.toLowerCase() !== newAccount.email.toLowerCase()
      );
      accounts.push(newAccount);
      sessionStorage.setItem("byos_connected_accounts", JSON.stringify(accounts));

      // Reset form
      setEmail("");
      setPassword("");
      setError(null);

      // 4. Notify parent
      props.onSuccess(newAccount);
    } catch (err: any) {
      setError(err?.message || "Invalid credentials or failed to connect mailbox.");
    } finally {
      setLoading(false);
      setPassword("");
    }
  }

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
        <div class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-2xl max-w-md w-full p-6 space-y-4 font-sans">
          <div class="flex items-center justify-between pb-3 border-b border-[#E2DFD8] dark:border-[#2E3138]">
            <div>
              <h3 class="text-sm font-bold text-[#2B2C2D] dark:text-[#F3F4F6]">Add Mailbox</h3>
              <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-0.5">
                Connect another mailbox to your current Webmail session
              </p>
            </div>
            <button
              onClick={props.onClose}
              class="text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] cursor-pointer p-1 rounded-lg hover:bg-[#F0EEE9]/60 dark:hover:bg-[#26282E] transition"
              title="Close"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <Show when={error()}>
            <div class="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-400 text-xs rounded-xl flex items-center justify-between">
              <span>{error()}</span>
              <button onClick={() => setError(null)} class="text-rose-500 hover:text-rose-800 dark:hover:text-rose-300 p-0.5 cursor-pointer" title="Dismiss">
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </Show>

          <form onSubmit={handleSubmit} class="space-y-4">
            <div>
              <label class="block text-xs font-semibold text-[#3C3D3E] dark:text-[#A1A1AA] mb-1">Email address</label>
              <input
                type="email"
                required
                placeholder="user@yourdomain.com"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                class="w-full px-3.5 py-2.5 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#3C3D3E] dark:text-[#F3F4F6] placeholder-[#878A8E] dark:placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#A27561] focus:border-[#A27561] focus:bg-white dark:focus:bg-[#18191D] transition"
              />
            </div>

            <div>
              <label class="block text-xs font-semibold text-[#3C3D3E] dark:text-[#A1A1AA] mb-1">Password</label>
              <input
                type="password"
                required
                placeholder="Account password"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                class="w-full px-3.5 py-2.5 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#3C3D3E] dark:text-[#F3F4F6] placeholder-[#878A8E] dark:placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#A27561] focus:border-[#A27561] focus:bg-white dark:focus:bg-[#18191D] transition"
              />
            </div>

            <div class="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={props.onClose}
                class="px-4 py-2.5 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs font-medium text-[#3C3D3E] dark:text-[#A1A1AA] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading()}
                class="px-5 py-2.5 rounded-xl bg-[#A27561] text-white text-xs font-semibold hover:bg-[#8F6452] transition disabled:opacity-50 flex items-center gap-2 cursor-pointer shadow-xs"
              >
                <Show when={loading()}>
                  <div class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                </Show>
                <span>{loading() ? "Connecting…" : "Connect Mailbox"}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
};
