import { Component, createSignal, For, Show } from "solid-js";
import { searchMailbox, indexSearchToken } from "../../lib/api/search";

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.trim();
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error("Invalid hex string");
  }
  const out = new Uint8Array(new ArrayBuffer(clean.length / 2));
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Frozen §14 keyed tokens: search_key = HKDF(root_secret,
// "byos-search-key-v1") via WASM, then HMAC-SHA256(search_key, term) via
// WebCrypto. The mnemonic, root secret, and search key never leave this
// browser — only the 32-byte token reaches the server.
async function computeTokenHex(term: string, mnemonic: string): Promise<string> {
  const phrase = mnemonic.trim();
  if (!phrase) {
    throw new Error("Recovery phrase is required to derive the mailbox search key.");
  }
  const normalized = term.trim().toLowerCase();
  if (!normalized) {
    throw new Error("Search term is empty.");
  }
  const wasm = await import("../../generated/crypto-core/byos_crypto_core.js");
  const rootHex: string = wasm.wasm_recover_root_secret(phrase);
  const searchKeyHex: string = wasm.wasm_derive_search_key(rootHex);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    hexToBytes(searchKeyHex),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(normalized));
  return bytesToHex(new Uint8Array(sig));
}

const SearchPage: Component = () => {
  const [mailboxId, setMailboxId] = createSignal("");
  const [mnemonic, setMnemonic] = createSignal("");
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<string[] | null>(null);
  const [searching, setSearching] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Indexing test state
  const [indexMsgId, setIndexMsgId] = createSignal("");
  const [indexTerm, setIndexTerm] = createSignal("");
  const [indexing, setIndexing] = createSignal(false);
  const [indexSuccess, setIndexSuccess] = createSignal<string | null>(null);

  async function handleSearch(e: Event) {
    e.preventDefault();
    setError(null);
    setResults(null);
    if (!mailboxId().trim() || !query().trim()) {
      setError("Please provide both Mailbox ID and a search term.");
      return;
    }

    setSearching(true);
    try {
      const tokenHex = await computeTokenHex(query(), mnemonic());
      const msgIds = await searchMailbox(mailboxId().trim(), tokenHex);
      setResults(msgIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  async function handleIndex(e: Event) {
    e.preventDefault();
    setError(null);
    setIndexSuccess(null);
    if (!mailboxId().trim() || !indexMsgId().trim() || !indexTerm().trim()) {
      setError("Please fill in Mailbox ID, Message ID, and Search Term for indexing.");
      return;
    }

    setIndexing(true);
    try {
      const tokenHex = await computeTokenHex(indexTerm(), mnemonic());
      await indexSearchToken(mailboxId().trim(), indexMsgId().trim(), tokenHex);
      setIndexSuccess(`Token for term "${indexTerm()}" successfully indexed for message ${indexMsgId().trim()}`);
      setIndexMsgId("");
      setIndexTerm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Indexing token failed.");
    } finally {
      setIndexing(false);
    }
  }

  return (
    <div class="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 class="text-2xl font-semibold text-slate-900">Encrypted Local Search</h1>
      <p class="mt-1 text-sm text-slate-500">
        Privacy-preserving search (Section 16). Tokens are HMAC-SHA-256 under a mailbox search key
        derived locally from your recovery phrase (HKDF, frozen §14). Plaintext terms, the phrase,
        and all keys never leave this browser — the server sees only opaque 32-byte tokens.
      </p>

      <Show when={error()}>
        <div role="alert" class="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error()}
        </div>
      </Show>

      {/* Target Mailbox ID */}
      <div class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <label class="block">
          <span class="text-sm font-medium text-slate-700">Mailbox ID</span>
          <input
            type="text"
            class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
            placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
            value={mailboxId()}
            onInput={(e) => setMailboxId(e.currentTarget.value)}
          />
        </label>
        <label class="mt-4 block">
          <span class="text-sm font-medium text-slate-700">Mailbox recovery phrase</span>
          <input
            type="password"
            autocomplete="off"
            class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
            placeholder="24-word recovery phrase (never leaves this browser)"
            value={mnemonic()}
            onInput={(e) => setMnemonic(e.currentTarget.value)}
          />
        </label>
        <p class="mt-2 text-xs text-slate-500">
          The phrase derives the mailbox search key locally. It is never stored, transmitted, or logged.
        </p>
      </div>

      {/* Search Section */}
      <div class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-lg font-medium text-slate-900">Search Tokens</h2>
        <form onSubmit={handleSearch} class="mt-4 flex gap-2">
          <input
            type="text"
            class="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
            placeholder="Enter search keyword (e.g. invoice, report)"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            disabled={searching()}
          />
          <button
            type="submit"
            disabled={searching() || !mailboxId().trim() || !mnemonic().trim() || !query().trim()}
            class="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {searching() ? "Searching…" : "Search"}
          </button>
        </form>

        <Show when={results() !== null}>
          <div class="mt-6 border-t border-slate-100 pt-4">
            <h3 class="text-sm font-medium text-slate-900">
              Matches Found: {results()?.length}
            </h3>
            <Show
              when={results()!.length > 0}
              fallback={<p class="mt-2 text-sm text-slate-500">No matching message tokens found for this query.</p>}
            >
              <ul class="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200 bg-slate-50 font-mono text-xs">
                <For each={results()}>
                  {(msgId) => (
                    <li class="p-3 text-slate-800 flex justify-between items-center">
                      <span>Message ID: {msgId}</span>
                      <span class="text-emerald-700 font-sans text-xs bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        Token Matched
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </Show>
      </div>

      {/* Index Token Section */}
      <div class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-lg font-medium text-slate-900">Index Message Search Token</h2>
        <p class="mt-1 text-xs text-slate-500">
          When receiving or decrypting messages client-side, search tokens are computed and uploaded to enable future fast privacy-preserving retrieval.
        </p>

        <Show when={indexSuccess()}>
          <div class="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
            {indexSuccess()}
          </div>
        </Show>

        <form onSubmit={handleIndex} class="mt-4 space-y-3">
          <div>
            <label class="block text-xs font-medium text-slate-700">Message ID</label>
            <input
              type="text"
              class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-mono placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="e.g. msg_12345"
              value={indexMsgId()}
              onInput={(e) => setIndexMsgId(e.currentTarget.value)}
              disabled={indexing()}
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-700">Keyword / Term</label>
            <input
              type="text"
              class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="e.g. invoice"
              value={indexTerm()}
              onInput={(e) => setIndexTerm(e.currentTarget.value)}
              disabled={indexing()}
            />
          </div>
          <button
            type="submit"
            disabled={indexing() || !mailboxId().trim() || !mnemonic().trim() || !indexMsgId().trim() || !indexTerm().trim()}
            class="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {indexing() ? "Indexing…" : "Index Search Token"}
          </button>
        </form>
      </div>

      <p class="mt-6 text-xs text-slate-500">
        Accepted V1 Privacy Leakage: tokens are mailbox-keyed, so the server can observe token
        equality within this mailbox, result counts, and access patterns — but not across mailboxes,
        and it cannot recover plaintext search terms.
      </p>
    </div>
  );
};

export default SearchPage;
