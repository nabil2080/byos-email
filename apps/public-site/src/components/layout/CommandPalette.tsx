import { createSignal, createMemo, onMount, onCleanup, Show } from "solid-js";

interface CommandItem {
  id: string;
  code: string;
  label: string;
  category: string;
  hint: string;
  href: string;
}

const COMMANDS: CommandItem[] = [
  { id: "hero", code: "01", label: "Jump to Sovereign Overview", category: "Blueprint", hint: "/#top", href: "/#top" },
  { id: "unbundle", code: "02", label: "Inspect Pipe vs. Vault Unbundling", category: "Blueprint", hint: "/#unbundling", href: "/#unbundling" },
  { id: "wasm", code: "03", label: "Run Live Rust WASM Crypto Inspector", category: "Cryptography", hint: "/#wasm-lab", href: "/#wasm-lab" },
  { id: "workspace", code: "04", label: "Explore Interactive Workspace Stage", category: "Product", hint: "/#workspace", href: "/#workspace" },
  { id: "ledger", code: "05", label: "Open CFO Capacity & Storage Ledger", category: "Economics", hint: "/pricing", href: "/pricing" },
  { id: "sec-arch", code: "06", label: "Read Security Dossier & Key Derivation", category: "Security", hint: "/security#architecture", href: "/security#architecture" },
  { id: "sec-threat", code: "07", label: "Simulate Breach & Threat Scenarios", category: "Security", hint: "/security#threats", href: "/security#threats" },
  { id: "support", code: "08", label: "Search Technical FAQ & DNS Guides", category: "Support", hint: "/support", href: "/support" },
  { id: "blog", code: "09", label: "Read Engineering Dispatches", category: "Journal", hint: "/blog", href: "/blog" },
  { id: "privacy", code: "10", label: "Review Zero-Knowledge Privacy Charter", category: "Legal", hint: "/privacy", href: "/privacy" },
  { id: "signup", code: "→", label: "Provision Organization & Domain", category: "Action", hint: "/signup", href: "/signup" },
];

export function CommandPalette() {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [activeIndex, setActiveIndex] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.hint.toLowerCase().includes(q)
    );
  });

  const openModal = () => {
    setOpen(true);
    setQuery("");
    setActiveIndex(0);
    window.setTimeout(() => inputRef?.focus(), 20);
  };

  const closeModal = () => setOpen(false);

  const execute = (item?: CommandItem) => {
    const target = item || filtered()[activeIndex()];
    if (!target) return;
    closeModal();
    window.location.href = target.href;
  };

  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open()) closeModal();
        else openModal();
        return;
      }
      if (!open()) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const len = filtered().length;
        if (len > 0) setActiveIndex((i) => (i + 1) % len);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const len = filtered().length;
        if (len > 0) setActiveIndex((i) => (i - 1 + len) % len);
      } else if (e.key === "Enter") {
        e.preventDefault();
        execute();
      }
    };

    const onCustomOpen = () => openModal();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("byos:open-command-palette", onCustomOpen);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("byos:open-command-palette", onCustomOpen);
    });
  });

  return (
    <Show when={open()}>
      <div
        class="fixed inset-0 z-[90] flex items-start justify-center bg-[#0B131B]/70 backdrop-blur-sm px-4 pt-[12vh]"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeModal();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Sovereign Command Palette"
          class="w-full max-w-2xl border border-[#D8D3C9] bg-[#F6F3ED] text-[#18212A] shadow-[0_32px_90px_-20px_rgba(11,19,27,0.65)] overflow-hidden"
        >
          {/* Top Input Rail */}
          <div class="flex items-center justify-between border-b border-[#D8D3C9] bg-[#EAE6DE] px-5 py-3.5">
            <div class="flex items-center gap-3 flex-1">
              <span class="font-mono text-xs font-bold text-[#226192]">[⌘K]</span>
              <input
                ref={inputRef}
                type="text"
                value={query()}
                onInput={(e) => {
                  setQuery(e.currentTarget.value);
                  setActiveIndex(0);
                }}
                placeholder="Type a specification, crypto test, or route…"
                class="w-full bg-transparent font-mono text-sm text-[#18212A] placeholder:text-[#55616D] focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={closeModal}
              class="border border-[#D8D3C9] bg-[#F6F3ED] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[#55616D] hover:text-[#18212A] cursor-pointer"
            >
              ESC
            </button>
          </div>

          {/* Results Matrix */}
          <div class="max-h-[360px] overflow-y-auto divide-y divide-[#D8D3C9]">
            {filtered().length === 0 ? (
              <div class="p-8 text-center font-mono text-xs text-[#55616D]">
                No matching specification or route found.
              </div>
            ) : (
              filtered().map((item, idx) => (
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => execute(item)}
                  class={`w-full text-left px-5 py-3.5 flex items-center justify-between gap-4 transition-colors cursor-pointer ${
                    activeIndex() === idx
                      ? "bg-[#226192] text-[#EAE6DE]"
                      : "bg-[#F6F3ED] text-[#18212A] hover:bg-[#EAE6DE]"
                  }`}
                >
                  <div class="flex items-center gap-3.5 min-w-0">
                    <span
                      class={`font-mono text-[11px] font-bold px-1.5 py-0.5 border ${
                        activeIndex() === idx
                          ? "border-[#EAE6DE]/30 text-[#EAE6DE]"
                          : "border-[#D8D3C9] text-[#226192]"
                      }`}
                    >
                      {item.code}
                    </span>
                    <span class="font-display text-sm font-semibold truncate">{item.label}</span>
                  </div>
                  <div class="flex items-center gap-3 shrink-0 font-mono text-[11px]">
                    <span class={activeIndex() === idx ? "text-[#EAE6DE]/75" : "text-[#55616D]"}>
                      {item.category}
                    </span>
                    <span class={activeIndex() === idx ? "text-[#EF8557]" : "text-[#226192]"}>
                      {item.hint}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Footer Bar */}
          <div class="flex items-center justify-between border-t border-[#D8D3C9] bg-[#EAE6DE] px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[#55616D]">
            <span>↑↓ Navigate · ↵ Open</span>
            <span>BYOS Sovereign Dossier v1.0</span>
          </div>
        </div>
      </div>
    </Show>
  );
}
