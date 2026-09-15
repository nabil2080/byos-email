import { createSignal, onCleanup } from "solid-js";

export function AnimatedHero() {
  const [activeStep, setActiveStep] = createSignal<1 | 2 | 3>(1);
  const [isSimulating, setIsSimulating] = createSignal(false);
  const [statusMessage, setStatusMessage] = createSignal("Ready for message ingestion simulation");
  let timer: ReturnType<typeof setTimeout> | null = null;

  function runSimulation() {
    if (timer) clearTimeout(timer);
    setIsSimulating(true);
    setActiveStep(1);
    setStatusMessage("Step 1: Inbound SMTP connection received on port 25 (STARTTLS)");

    timer = setTimeout(() => {
      setActiveStep(2);
      setStatusMessage("Step 2: Message sealed in memory via WASM HPKE (RFC 9180) before disk write");

      timer = setTimeout(() => {
        setActiveStep(3);
        setStatusMessage("Step 3: Ciphertext envelope committed directly to Customer S3/R2 bucket. Server memory purged.");

        timer = setTimeout(() => {
          setIsSimulating(false);
        }, 1500);
      }, 1600);
    }, 1600);
  }

  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });

  return (
    <section class="relative pt-16 sm:pt-24 pb-20 px-6 max-w-7xl mx-auto overflow-hidden">
      {/* Ambient Mesh Background & Beam Layer */}
      <div class="absolute inset-0 -z-10 bg-ambient-mesh bg-paper-grain opacity-95 pointer-events-none"></div>

      {/* Decorative Animated SVG Beam Lines */}
      <div class="absolute inset-0 -z-10 pointer-events-none overflow-hidden opacity-40">
        <svg class="w-full h-full" viewBox="0 0 1200 800" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M-100 200 C300 150, 400 450, 800 300 C1000 200, 1100 500, 1300 400"
            stroke="#9E725F"
            stroke-width="1.5"
            stroke-opacity="0.25"
            fill="none"
          />
          <path
            d="M-100 200 C300 150, 400 450, 800 300 C1000 200, 1100 500, 1300 400"
            stroke="#9E725F"
            stroke-width="2.5"
            class="animate-beam"
            fill="none"
          />
          <path
            d="M-50 550 C250 400, 550 650, 850 500 C1050 400, 1200 600, 1350 550"
            stroke="#9E725F"
            stroke-width="1.5"
            stroke-opacity="0.15"
            fill="none"
          />
        </svg>
      </div>

      {/* Main Header & Typography Stack */}
      <div class="text-center max-w-4xl mx-auto">
        {/* Announcement Pill */}
        <a
          href="#pipeline-simulation"
          class="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-[#F3ECE8] border border-[#9E725F]/30 text-[#9E725F] text-xs font-mono font-medium mb-6 shadow-xs hover:border-[#9E725F] hover:bg-[#F3ECE8]/80 transition-all cursor-pointer group"
        >
          <span class="relative flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span class="font-semibold">V1 Production Protocol</span>
          <span class="text-[#6F7173]">&bull;</span>
          <span>Zero-Plaintext Escrow Architecture</span>
          <span class="text-[#9E725F] group-hover:translate-x-0.5 transition-transform">&rarr;</span>
        </a>

        {/* Editorial Display Headline */}
        <h1 class="text-4xl sm:text-6xl lg:text-7xl font-extrabold text-[#2B2C2D] tracking-tight leading-[1.08] max-w-4xl mx-auto">
          Business email you <br class="hidden sm:inline" />
          <span class="text-[#9E725F] underline decoration-[#9E725F]/20 underline-offset-8">actually own.</span>
        </h1>

        {/* Plain, Non-Technical Subheadline */}
        <p class="mt-6 text-base sm:text-lg lg:text-xl text-[#6F7173] leading-relaxed max-w-2xl mx-auto font-normal">
          Connect your own S3, Cloudflare R2, or Google Drive. Get business-class webmail, custom domains, and IMAP/SMTP bridge support—without per-seat extortion or Big Tech surveillance.
        </p>

        {/* Action Buttons */}
        <div class="mt-10 flex flex-wrap items-center justify-center gap-4">
          <a
            href="/signup"
            class="rounded-xl bg-[#9E725F] px-8 py-3.5 text-sm sm:text-base font-semibold text-white shadow-md hover:bg-[#865E4D] transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center gap-2"
          >
            <span>Start 14-Day Trial</span>
            <span class="font-bold">&rarr;</span>
          </a>
          <button
            onClick={() => {
              const el = document.getElementById("pipeline-simulation");
              if (el) el.scrollIntoView({ behavior: "smooth" });
              runSimulation();
            }}
            class="rounded-xl border border-[#E2DFD8] bg-white px-6 py-3.5 text-sm sm:text-base font-semibold text-[#3C3D3E] hover:border-[#9E725F] hover:bg-[#F3ECE8]/50 shadow-xs transition-all cursor-pointer flex items-center gap-2"
          >
            <span>Explore Live Demo</span>
            <span class="text-xs font-mono text-[#9E725F] bg-[#F3ECE8] px-2 py-0.5 rounded">Interactive</span>
          </button>
        </div>
      </div>

      {/* Dynamic Product Simulation Card */}
      <div
        id="pipeline-simulation"
        class="max-w-4xl mx-auto mt-14 bg-white rounded-3xl border border-[#E2DFD8] shadow-xl p-6 sm:p-8 relative overflow-hidden transition-all"
      >
        {/* Card Header & Controls */}
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#E2DFD8]">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <h2 class="text-sm sm:text-base font-bold text-[#3C3D3E]">
                Inbound Message Ingestion Pipeline
              </h2>
            </div>
            <p class="text-xs text-[#6F7173]">
              Watch how incoming emails are sealed with recipient public keys before ever hitting storage.
            </p>
          </div>

          <button
            onClick={runSimulation}
            disabled={isSimulating()}
            class="inline-flex items-center gap-2 rounded-xl bg-[#F3ECE8] border border-[#9E725F]/30 px-4 py-2 text-xs font-semibold text-[#9E725F] hover:bg-[#9E725F] hover:text-white transition-all shadow-xs disabled:opacity-50 cursor-pointer"
          >
            <span class={isSimulating() ? "animate-spin" : ""}>⚡</span>
            <span>{isSimulating() ? "Simulating Pipeline..." : "Simulate Message Ingestion"}</span>
          </button>
        </div>

        {/* 3-Step Interactive Pipeline Track */}
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 my-8 relative">
          {/* Step 1: Raw Inbound SMTP */}
          <div
            onClick={() => setActiveStep(1)}
            class={`p-5 rounded-2xl border transition-all cursor-pointer ${
              activeStep() === 1
                ? "border-[#9E725F] bg-[#F3ECE8]/40 shadow-xs ring-2 ring-[#9E725F]/20"
                : "border-[#E2DFD8] bg-[#FBFBFA] hover:border-[#9E725F]/40"
            }`}
          >
            <div class="flex items-center justify-between mb-3">
              <div class="w-8 h-8 rounded-lg bg-white border border-[#E2DFD8] flex items-center justify-center text-base shadow-2xs">
                📨
              </div>
              <span class="text-[11px] font-mono font-bold text-[#9E725F]">STAGE 01</span>
            </div>
            <h3 class="text-sm font-bold text-[#3C3D3E]">Incoming SMTP</h3>
            <p class="text-[11px] text-[#6F7173] mt-1">
              TLS connection accepted on port 25. Ephemeral plaintext held in volatile memory.
            </p>
          </div>

          {/* Step 2: WASM HPKE Lock */}
          <div
            onClick={() => setActiveStep(2)}
            class={`p-5 rounded-2xl border transition-all cursor-pointer ${
              activeStep() === 2
                ? "border-[#9E725F] bg-[#F3ECE8]/40 shadow-xs ring-2 ring-[#9E725F]/20"
                : "border-[#E2DFD8] bg-[#FBFBFA] hover:border-[#9E725F]/40"
            }`}
          >
            <div class="flex items-center justify-between mb-3">
              <div class="w-8 h-8 rounded-lg bg-white border border-[#E2DFD8] flex items-center justify-center text-base shadow-2xs">
                <span class={activeStep() === 2 ? "animate-bounce" : ""}>🔒</span>
              </div>
              <span class="text-[11px] font-mono font-bold text-[#9E725F]">STAGE 02</span>
            </div>
            <h3 class="text-sm font-bold text-[#3C3D3E]">Sealed via WASM HPKE</h3>
            <p class="text-[11px] text-[#6F7173] mt-1">
              RFC 9180 hybrid encryption. Payload sealed using recipient's sovereign public key.
            </p>
          </div>

          {/* Step 3: Customer S3 Bucket */}
          <div
            onClick={() => setActiveStep(3)}
            class={`p-5 rounded-2xl border transition-all cursor-pointer ${
              activeStep() === 3
                ? "border-[#9E725F] bg-[#F3ECE8]/40 shadow-xs ring-2 ring-[#9E725F]/20"
                : "border-[#E2DFD8] bg-[#FBFBFA] hover:border-[#9E725F]/40"
            }`}
          >
            <div class="flex items-center justify-between mb-3">
              <div class="w-8 h-8 rounded-lg bg-white border border-[#E2DFD8] flex items-center justify-center text-base shadow-2xs">
                ☁️
              </div>
              <span class="text-[11px] font-mono font-bold text-[#9E725F]">STAGE 03</span>
            </div>
            <h3 class="text-sm font-bold text-[#3C3D3E]">Customer Bucket Deposit</h3>
            <p class="text-[11px] text-[#6F7173] mt-1">
              Ciphertext stream committed to your AWS S3 / Cloudflare R2 bucket. Zero escrow.
            </p>
          </div>
        </div>

        {/* Live Packet Inspector Drawer */}
        <div class="rounded-2xl bg-[#2B2C2D] text-stone-200 p-4 sm:p-5 font-mono text-xs border border-[#3C3D3E]">
          <div class="flex items-center justify-between border-b border-stone-700 pb-3 mb-3">
            <div class="flex items-center gap-2">
              <span class="h-2 w-2 rounded-full bg-emerald-400"></span>
              <span class="text-stone-400 font-bold uppercase tracking-wider text-[10px]">
                Payload Inspector &bull; {activeStep() === 1 ? "Raw SMTP" : activeStep() === 2 ? "WASM Memory Envelope" : "S3 Object Store"}
              </span>
            </div>
            <span class="text-[11px] text-stone-400">
              {activeStep() === 1 ? "Unsealed" : activeStep() === 2 ? "Cryptographic Sealing" : "Permanent Ciphertext"}
            </span>
          </div>

          {/* Conditional Inspection Terminal Content */}
          {activeStep() === 1 && (
            <div class="space-y-1.5 text-stone-300">
              <div class="text-[#9E725F] font-bold">220 mx.byos.email ESMTP Postfix (Cloud Dancer Cluster)</div>
              <div>&gt; MAIL FROM:&lt;founder@partner-enterprise.com&gt;</div>
              <div>&gt; RCPT TO:&lt;ceo@yourcompany.com&gt;</div>
              <div>&gt; DATA: 1024 bytes [Confidential Q3 Merger Terms &amp; Financial Model]</div>
              <div class="text-amber-400 text-[11px] pt-1">
                ⚠️ Message is held strictly in volatile RAM; never written to disk unencrypted.
              </div>
            </div>
          )}

          {activeStep() === 2 && (
            <div class="space-y-1.5 text-stone-300">
              <div class="text-[#9E725F] font-bold">&gt; wasm_hpke_seal_recipient_payload()</div>
              <div>Recipient PubKey: <span class="text-emerald-400">0x7c49b28a10ef39488d1c920bf8e390c5</span></div>
              <div>KDF / AEAD: <span class="text-stone-100">HKDF-SHA256 • ChaCha20Poly1305 / AES-256-GCM</span></div>
              <div>Encapsulated Key (pk_e): <span class="text-stone-400">0x04e198bca762810a99... (32 bytes)</span></div>
              <div>Ciphertext Envelope: <span class="text-stone-400">0x81b7e92841029c... [1056 bytes sealed]</span></div>
              <div class="text-emerald-400 text-[11px] pt-1">
                ✓ Cryptographic seal complete. Server unsealing mathematically impossible without private key.
              </div>
            </div>
          )}

          {activeStep() === 3 && (
            <div class="space-y-1.5 text-stone-300">
              <div class="text-[#9E725F] font-bold">&gt; PUT s3://acme-vault/emails/2026/09/msg_9180_0912.bin</div>
              <div>Storage Target: <span class="text-emerald-400">Cloudflare R2 / AWS S3 (Client Bucket ARN)</span></div>
              <div>Object Size: <span class="text-stone-100">1.08 KB</span></div>
              <div>Memory State: <span class="text-emerald-400">Zeroized (explicit_bzero)</span></div>
              <div>Server Retention: <span class="text-stone-400">0 bytes &bull; Zero access logs &bull; Zero keys</span></div>
              <div class="text-emerald-400 text-[11px] pt-1">
                ✓ Stored directly in your custody. You own the bucket, you own the mailbox.
              </div>
            </div>
          )}

          {/* Status Bar */}
          <div class="mt-4 pt-3 border-t border-stone-700/60 flex items-center justify-between text-[11px] text-stone-400">
            <span>Status: <span class="text-stone-200">{statusMessage()}</span></span>
            <span class="font-mono text-[#9E725F]">RFC 9180 HPKE</span>
          </div>
        </div>

        {/* Trust Badges Bar */}
        <div class="mt-6 pt-5 border-t border-[#E2DFD8] flex flex-wrap items-center justify-center gap-6 text-xs font-mono text-[#6F7173]">
          <div class="flex items-center gap-1.5">
            <span class="text-emerald-600 font-bold">✓</span>
            <span>RFC 9180 HPKE Core</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="text-emerald-600 font-bold">✓</span>
            <span>Zero Storage Markup</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="text-emerald-600 font-bold">✓</span>
            <span>Native IMAP / SMTP Bridge</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="text-emerald-600 font-bold">✓</span>
            <span>100% Exportable Storage</span>
          </div>
        </div>
      </div>
    </section>
  );
}
