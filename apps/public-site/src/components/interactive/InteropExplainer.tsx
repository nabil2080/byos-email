import { createSignal, Show } from "solid-js";

type Mode = "internal" | "external";

export function InteropExplainer() {
  const [mode, setMode] = createSignal<Mode>("internal");

  return (
    <div class="card-editorial p-6 sm:p-8 bg-[#F6F3ED]/85">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span class="eyebrow">Transparency</span>
          <h3 class="mt-2 font-display text-2xl font-bold text-[#18212A]">
            Know exactly how your mail is protected
          </h3>
        </div>

        <div class="inline-flex rounded-full border border-[#D8D3C9] bg-[#E2E7EB] p-1 self-start">
          <button
            type="button"
            onClick={() => setMode("internal")}
            class={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              mode() === "internal" ? "bg-[#226192] text-white shadow-xs" : "text-[#55616D]"
            }`}
          >
            BYOS &rarr; BYOS
          </button>
          <button
            type="button"
            onClick={() => setMode("external")}
            class={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              mode() === "external" ? "bg-[#226192] text-white shadow-xs" : "text-[#55616D]"
            }`}
          >
            BYOS &rarr; External
          </button>
        </div>
      </div>

      {/* Flow */}
      <div class="mt-8 flex items-center gap-3 sm:gap-6">
        <div class="flex flex-col items-center gap-2">
          <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#226192] text-white font-mono text-xs font-bold tracking-wider shadow-md">
            BYOS
          </div>
          <span class="text-[11px] font-medium text-[#55616D]">Sender</span>
        </div>

        {/* connector */}
        <div class="relative flex-1">
          <div class="h-px w-full bg-[#D8D3C9]"></div>
          <div
            class={`absolute inset-0 h-px transition-all duration-500 ${
              mode() === "internal" ? "bg-[#226192]" : "bg-[#EF8557]"
            }`}
          ></div>
          <span
            class={`absolute left-1/2 -top-3 -translate-x-1/2 whitespace-nowrap rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-wide ${
              mode() === "internal"
                ? "border-[#226192]/30 bg-[#E2E7EB] text-[#1B4E76]"
                : "border-[#D8D3C9] bg-[#F6F3ED] text-[#55616D]"
            }`}
          >
            <Show when={mode() === "internal"} fallback="Standard internet email">
              Protected end-to-end
            </Show>
          </span>
        </div>

        {/* recipients */}
        <div class="flex flex-col items-center gap-2">
          <Show
            when={mode() === "internal"}
            fallback={
              <div class="grid grid-cols-2 gap-1.5">
                {["Gmail", "Outlook", "Yahoo", "Other"].map((r) => (
                  <span class="rounded-lg border border-[#D8D3C9] bg-[#F6F3ED] px-2 py-1.5 text-[10px] font-medium text-[#18212A]">
                    {r}
                  </span>
                ))}
              </div>
            }
          >
            <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#18212A] text-[#EAE6DE] font-mono text-xs font-bold tracking-wider shadow-md">
              BYOS
            </div>
          </Show>
          <span class="text-[11px] font-medium text-[#55616D]">Recipient</span>
        </div>
      </div>

      {/* Explanation */}
      <div class="mt-8 rounded-[14px] border border-[#D8D3C9] bg-[#F4F2EC] p-5">
        <Show
          when={mode() === "internal"}
          fallback={
            <p class="text-sm leading-relaxed text-[#18212A]">
              Mail sent to Gmail, Outlook, Yahoo, or any other provider is delivered over standard
              internet email so your team stays fully interoperable. Traditional email was not
              built for end-to-end encryption, so those messages follow normal internet email
              privacy boundaries. We say so plainly rather than overpromising.
            </p>
          }
        >
          <p class="text-sm leading-relaxed text-[#18212A]">
            When both sender and recipient are on BYOS, internal mail can use end-to-end
            protection. The content is designed to stay protected in transit and at rest in
            customer-controlled storage.
          </p>
        </Show>
      </div>
    </div>
  );
}
