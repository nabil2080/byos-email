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
  Available: "border-[#9E725F]/30 bg-[#F3ECE8] text-[#865E4D]",
  Compatible: "border-[#E2DFD8] bg-white text-[#6F7173]",
  Planned: "border-[#E2DFD8] bg-white text-[#8B8E91]",
};

export function StorageConstellation() {
  const [active, setActive] = createSignal<number | null>(null);

  return (
    <div class="grid lg:grid-cols-[0.85fr_1.15fr] gap-6 lg:gap-10 items-center">
      {/* Central BYOS object */}
      <div class="relative">
        <div class="card-editorial p-8 text-center bg-white/80">
          <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#9E725F] text-white font-mono text-sm font-bold tracking-wider shadow-md">
            BYOS
          </div>
          <h3 class="font-display text-xl font-bold text-[#2B2C2D]">Your mailbox</h3>
          <p class="mt-2 text-sm text-[#6F7173] leading-relaxed">
            BYOS runs the email service. Your persistent mailbox data lives in the storage you
            connect and control.
          </p>
          <div class="mt-5 inline-flex items-center gap-2 rounded-full border border-[#E2DFD8] bg-[#F3ECE8] px-3 py-1.5">
            <span class="h-1.5 w-1.5 rounded-full bg-[#9E725F]"></span>
            <span class="text-[11px] font-mono uppercase tracking-widest text-[#6F7173]">
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
              class={`group relative flex items-center gap-4 rounded-[14px] border bg-white px-5 py-4 transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-[#9E725F]/30 ${
                active() === i()
                  ? "-translate-y-0.5 border-[#9E725F]/40 shadow-[0_12px_28px_-12px_rgba(158,114,95,0.35)]"
                  : "border-[#E2DFD8]"
              }`}
            >
              {/* connection line */}
              <span
                aria-hidden="true"
                class={`absolute -left-px top-1/2 h-px -translate-y-1/2 bg-[#9E725F] transition-all duration-300 ${
                  active() === i() ? "w-4 opacity-100 -left-4" : "w-0 opacity-0"
                }`}
              ></span>

              <span
                class={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                  active() === i() ? "border-[#9E725F]/40 bg-[#F3ECE8]" : "border-[#E2DFD8] bg-[#F4F2EC]"
                }`}
              >
                <span class="h-2.5 w-2.5 rounded-sm bg-[#9E725F]"></span>
              </span>

              <div class="min-w-0 flex-1">
                <div class="font-semibold text-[#2B2C2D]">{p.name}</div>
                <div class="text-xs text-[#6F7173]">{p.detail}</div>
              </div>

              <span
                class={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusStyle[p.status]}`}
              >
                {p.status}
              </span>
            </div>
          )}
        </For>

        <p class="pt-2 text-xs text-[#6F7173] leading-relaxed">
          Available connectors are usable today. Compatible providers work through the same
          S3-compatible interface. Planned items are on the roadmap and clearly marked.
        </p>
      </div>
    </div>
  );
}
