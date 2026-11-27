import { createSignal, For, Show } from "solid-js";

type Status = "Available" | "Compatible" | "Planned";

interface Provider {
  name: string;
  detail: string;
  status: Status;
  pill: string;
}

const providers: Provider[] = [
  { name: "Amazon S3", detail: "Native S3 buckets", status: "Available", pill: "Connected" },
  { name: "Google Drive", detail: "OAuth workspace storage", status: "Available", pill: "Connected" },
  { name: "Cloudflare R2", detail: "Via S3-compatible API", status: "Compatible", pill: "Storage connection" },
  { name: "S3-compatible storage", detail: "MinIO, Wasabi, Backblaze", status: "Compatible", pill: "Customer controlled" },
  { name: "Other compatible storage", detail: "Provider-neutral interface", status: "Planned", pill: "Roadmap" },
];

const statusStyle: Record<Status, string> = {
  Available: "border-[#226192]/30 bg-[#E2E7EB] text-[#1B4E76]",
  Compatible: "border-[#D8D3C9] bg-[#F6F3ED] text-[#55616D]",
  Planned: "border-[#D8D3C9] bg-[#F6F3ED] text-[#647280]",
};

export function StorageConstellation() {
  const [active, setActive] = createSignal<number | null>(null);

  return (
    <div class="grid lg:grid-cols-[0.85fr_1.15fr] gap-6 lg:gap-10 items-center">
      {/* Central BYOS object */}
      <div class="relative">
        <div class="card-editorial p-8 text-center bg-[#F6F3ED]/80">
          <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#226192] text-white font-mono text-sm font-bold tracking-wider shadow-md">
            BYOS
          </div>
          <h3 class="font-display text-xl font-bold text-[#18212A]">Your mailbox</h3>
          <p class="mt-2 text-sm text-[#55616D] leading-relaxed">
            BYOS runs the email service. Your persistent mailbox data lives in the storage you
            connect and control.
          </p>
          <div class="mt-5 inline-flex items-center gap-2 rounded-full border border-[#D8D3C9] bg-[#E2E7EB] px-3 py-1.5">
            <span class="h-1.5 w-1.5 rounded-full bg-[#226192]"></span>
            <span class="text-[11px] font-mono uppercase tracking-widest text-[#55616D]">
              <Show when={active() !== null} fallback="Hover a provider">
                {providers[active()!].pill}
              </Show>
            </span>
          </div>
        </div>
      </div>

      {/* Provider cards */}
      <div class="space-y-3">
        <For each={providers}>
          {(p, i) => (
            <div
              onMouseEnter={() => setActive(i())}
              onMouseLeave={() => setActive(null)}
              onFocusIn={() => setActive(i())}
              onFocusOut={() => setActive(null)}
              tabindex="0"
              class={`group relative flex items-center gap-4 rounded-[14px] border bg-[#F6F3ED] px-5 py-4 transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-[#226192]/30 ${
                active() === i()
                  ? "-translate-y-0.5 border-[#226192]/40 shadow-[0_12px_28px_-12px_rgba(34,97,146,0.35)]"
                  : "border-[#D8D3C9]"
              }`}
            >
              {/* connection line */}
              <span
                aria-hidden="true"
                class={`absolute -left-px top-1/2 h-px -translate-y-1/2 bg-[#226192] transition-all duration-300 ${
                  active() === i() ? "w-4 opacity-100 -left-4" : "w-0 opacity-0"
                }`}
              ></span>

              <span
                class={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                  active() === i() ? "border-[#226192]/40 bg-[#E2E7EB]" : "border-[#D8D3C9] bg-[#F4F2EC]"
                }`}
              >
                <span class="h-2.5 w-2.5 rounded-sm bg-[#226192]"></span>
              </span>

              <div class="min-w-0 flex-1">
                <div class="font-semibold text-[#18212A]">{p.name}</div>
                <div class="text-xs text-[#55616D]">{p.detail}</div>
              </div>

              <span
                class={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusStyle[p.status]}`}
              >
                {p.status}
              </span>
            </div>
          )}
        </For>

        <p class="pt-2 text-xs text-[#55616D] leading-relaxed">
          Available connectors are usable today. Compatible providers work through the same
          S3-compatible interface. Planned items are on the roadmap and clearly marked.
        </p>
      </div>
    </div>
  );
}
