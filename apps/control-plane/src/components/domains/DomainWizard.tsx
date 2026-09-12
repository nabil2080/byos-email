import { Component, createSignal, Show, For, createEffect } from "solid-js";
import { Domain, createDomain, verifyDomain } from "../../lib/api/domains";
import { useOrg } from "../../context/OrgContext";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialDomain?: Domain | null;
  initialStep?: number;
}

export const DomainWizard: Component<Props> = (props) => {
  const org = useOrg();
  const [step, setStep] = createSignal<number>(1);
  const [domainInput, setDomainInput] = createSignal("");
  const [domainError, setDomainError] = createSignal<string | null>(null);
  const [currentDomain, setCurrentDomain] = createSignal<Domain | null>(null);
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [isVerifying, setIsVerifying] = createSignal(false);
  const [verifyStatus, setVerifyStatus] = createSignal<"idle" | "success" | "pending" | "failed">("idle");
  const [verifyMessage, setVerifyMessage] = createSignal<string>("");
  const [copiedKey, setCopiedKey] = createSignal<string | null>(null);

  // Sync initialDomain when opened
  createEffect(() => {
    if (props.isOpen) {
      if (props.initialDomain) {
        setCurrentDomain(props.initialDomain);
        setDomainInput(props.initialDomain.name);
        setStep(props.initialStep || 2);
        if (props.initialDomain.is_verified || props.initialDomain.verified) {
          setVerifyStatus("success");
        } else {
          setVerifyStatus("idle");
        }
      } else {
        setCurrentDomain(null);
        setDomainInput("");
        setDomainError(null);
        setStep(1);
        setVerifyStatus("idle");
      }
    }
  });

  const domainRegex = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

  function copyToClipboard(key: string, text: string) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  }

  async function handleStep1Submit(e: Event) {
    e.preventDefault();
    setDomainError(null);
    const raw = domainInput().trim().toLowerCase();

    if (!raw) {
      setDomainError("Please enter a domain name.");
      return;
    }

    if (!domainRegex.test(raw)) {
      setDomainError("Invalid domain format. Example: company.com or mail.example.org");
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await createDomain(org.orgId, raw);
      setCurrentDomain(created);
      setStep(2);
    } catch (err: any) {
      const status = err?.status;
      if (status === 409 || err?.message?.includes("already exists")) {
        setDomainError("This domain has already been added to an organization.");
      } else if (status === 402) {
        setDomainError("Plan domain limit reached. Please upgrade your subscription.");
      } else {
        setDomainError(err?.message || "Failed to create domain. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleTriggerVerification() {
    const d = currentDomain();
    if (!d || !org.orgId) return;

    setIsVerifying(true);
    setVerifyMessage("");
    try {
      await verifyDomain(org.orgId, d.id);
      setVerifyStatus("success");
      setVerifyMessage("Ownership successfully verified! All DNS records detected.");
      setCurrentDomain({ ...d, is_verified: true, verified: true });
      props.onSuccess();
    } catch (err: any) {
      setVerifyStatus("pending");
      setVerifyMessage(
        "Verification record not detected yet. DNS propagation can take a few minutes. You may continue to the next steps and verify later."
      );
    } finally {
      setIsVerifying(false);
    }
  }

  // Extract DNS records or compute canonical defaults
  const getTxtToken = () => {
    const d = currentDomain();
    if (!d) return "";
    if (d.verification_token) return d.verification_token;
    const txtRec = (d.dns_records || []).find((r) => r.type === "TXT" && r.name.startsWith("_byos"));
    return txtRec?.value || "byos-verification=pending";
  };

  const getDkimKey = () => {
    const d = currentDomain();
    if (!d) return "";
    if (d.dkim_public_key) return d.dkim_public_key;
    const dkimRec = (d.dns_records || []).find((r) => r.name.includes("_domainkey"));
    return dkimRec?.value || "v=DKIM1; k=rsa; p=...";
  };

  const getMxHost = () => {
    const d = currentDomain();
    if (!d) return "mail.byos.email";
    const mxRec = (d.dns_records || []).find((r) => r.type === "MX");
    return mxRec?.value || "mail.byos.email";
  };

  if (!props.isOpen) return null;

  return (
    <div class="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        class="fixed inset-0 bg-[#3C3D3E]/50 backdrop-blur-xs transition-opacity"
        onClick={props.onClose}
      />

      <div class="flex min-h-screen items-center justify-center p-4 text-center sm:p-0">
        <div
          class="relative transform overflow-hidden rounded-2xl bg-white text-left shadow-2xl transition-all sm:my-8 sm:w-full sm:max-w-2xl border border-[#E2DFD8]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div class="border-b border-[#E2DFD8] bg-[#F0EEE9]/50 px-6 py-4 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="w-7 h-7 rounded-md bg-[#9E725F] text-[#F0EEE9] flex items-center justify-center font-bold text-xs">
                🌐
              </div>
              <h3 class="text-base font-bold text-[#3C3D3E]">
                Domain Setup Wizard
              </h3>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              class="rounded-lg p-1.5 text-[#6F7173] hover:bg-[#F3ECE8] hover:text-[#3C3D3E] transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Stepper Bar */}
          <div class="px-6 pt-5 pb-3 border-b border-[#E2DFD8] bg-white">
            <div class="grid grid-cols-4 gap-2 text-center text-xs">
              {/* Step 1 */}
              <div class={`flex flex-col items-center gap-1.5 pb-2 border-b-2 transition-colors ${step() >= 1 ? "border-[#9E725F] text-[#9E725F] font-bold" : "border-transparent text-[#6F7173]"}`}>
                <div class={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-mono ${step() === 1 ? "bg-[#9E725F] text-white" : step() > 1 ? "bg-emerald-100 text-emerald-800" : "bg-[#F0EEE9] text-[#6F7173]"}`}>
                  {step() > 1 ? "✓" : "1"}
                </div>
                <span>1. Domain</span>
              </div>

              {/* Step 2 */}
              <div class={`flex flex-col items-center gap-1.5 pb-2 border-b-2 transition-colors ${step() >= 2 ? "border-[#9E725F] text-[#9E725F] font-bold" : "border-transparent text-[#6F7173]"}`}>
                <div class={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-mono ${step() === 2 ? "bg-[#9E725F] text-white" : step() > 2 ? "bg-emerald-100 text-emerald-800" : "bg-[#F0EEE9] text-[#6F7173]"}`}>
                  {step() > 2 ? "✓" : "2"}
                </div>
                <span>2. Ownership</span>
              </div>

              {/* Step 3 */}
              <div class={`flex flex-col items-center gap-1.5 pb-2 border-b-2 transition-colors ${step() >= 3 ? "border-[#9E725F] text-[#9E725F] font-bold" : "border-transparent text-[#6F7173]"}`}>
                <div class={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-mono ${step() === 3 ? "bg-[#9E725F] text-white" : step() > 3 ? "bg-emerald-100 text-emerald-800" : "bg-[#F0EEE9] text-[#6F7173]"}`}>
                  {step() > 3 ? "✓" : "3"}
                </div>
                <span>3. MX Routing</span>
              </div>

              {/* Step 4 */}
              <div class={`flex flex-col items-center gap-1.5 pb-2 border-b-2 transition-colors ${step() === 4 ? "border-[#9E725F] text-[#9E725F] font-bold" : "border-transparent text-[#6F7173]"}`}>
                <div class={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-mono ${step() === 4 ? "bg-[#9E725F] text-white" : "bg-[#F0EEE9] text-[#6F7173]"}`}>
                  4
                </div>
                <span>4. Auth (SPF/DKIM)</span>
              </div>
            </div>
          </div>

          {/* Wizard Body */}
          <div class="px-6 py-6 min-h-[340px] flex flex-col justify-between">
            {/* STEP 1: INPUT DOMAIN */}
            <Show when={step() === 1}>
              <div>
                <h4 class="text-base font-bold text-[#3C3D3E]">
                  What domain do you want to configure?
                </h4>
                <p class="mt-1 text-xs text-[#6F7173] leading-relaxed">
                  Enter your company or organization domain name. You will need access to your domain registrar (Cloudflare, Namecheap, Route53, GoDaddy, etc.) to configure DNS records.
                </p>

                <form onSubmit={handleStep1Submit} class="mt-6 space-y-4">
                  <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-[#6F7173] mb-1.5">
                      Domain Name
                    </label>
                    <input
                      type="text"
                      required
                      value={domainInput()}
                      onInput={(e) => setDomainInput(e.currentTarget.value)}
                      placeholder="acme-corp.com"
                      class="block w-full rounded-lg border border-[#E2DFD8] bg-white px-3.5 py-2.5 text-sm text-[#3C3D3E] placeholder-[#6F7173]/50 focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none"
                    />
                    <span class="mt-1.5 block text-[11px] text-[#6F7173]">
                      Must be a valid FQDN (e.g. yourcompany.com)
                    </span>
                  </div>

                  <Show when={domainError()}>
                    <div class="rounded-lg bg-red-50 p-3 text-xs text-red-800 border border-red-200">
                      {domainError()}
                    </div>
                  </Show>
                </form>
              </div>

              <div class="mt-8 flex items-center justify-end gap-3 pt-4 border-t border-[#E2DFD8]">
                <button
                  type="button"
                  onClick={props.onClose}
                  class="rounded-lg border border-[#E2DFD8] px-4 py-2 text-xs font-semibold text-[#3C3D3E] hover:bg-[#F0EEE9]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleStep1Submit}
                  disabled={isSubmitting() || !domainInput().trim()}
                  class="rounded-lg bg-[#9E725F] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#865E4D] disabled:opacity-50 transition-colors"
                >
                  {isSubmitting() ? "Creating Domain…" : "Next: Verify Ownership →"}
                </button>
              </div>
            </Show>

            {/* STEP 2: TXT OWNERSHIP VERIFICATION */}
            <Show when={step() === 2}>
              <div>
                <div class="flex items-center justify-between">
                  <div>
                    <h4 class="text-base font-bold text-[#3C3D3E]">
                      Verify Domain Ownership
                    </h4>
                    <p class="mt-1 text-xs text-[#6F7173]">
                      Add the following TXT record to your DNS provider to prove ownership of{" "}
                      <span class="font-bold text-[#3C3D3E]">{currentDomain()?.name}</span>.
                    </p>
                  </div>
                  <Show when={currentDomain()?.is_verified || currentDomain()?.verified}>
                    <span class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
                      <span>✓</span> Verified
                    </span>
                  </Show>
                </div>

                <div class="mt-5 rounded-xl border border-[#E2DFD8] bg-[#F0EEE9]/40 p-4">
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    <div>
                      <span class="block text-[11px] font-bold uppercase text-[#6F7173] mb-1">
                        Record Type
                      </span>
                      <div class="font-mono font-bold text-[#9E725F] bg-white border border-[#E2DFD8] rounded-md px-2.5 py-1.5">
                        TXT
                      </div>
                    </div>
                    <div>
                      <span class="block text-[11px] font-bold uppercase text-[#6F7173] mb-1">
                        Host / Name
                      </span>
                      <div class="flex items-center justify-between font-mono text-[#3C3D3E] bg-white border border-[#E2DFD8] rounded-md px-2.5 py-1.5">
                        <span class="truncate select-all">{`_byos.${currentDomain()?.name || ""}`}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard("host_txt", `_byos.${currentDomain()?.name || ""}`)}
                          class="ml-1 text-[11px] text-[#9E725F] hover:underline"
                        >
                          {copiedKey() === "host_txt" ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                    <div>
                      <span class="block text-[11px] font-bold uppercase text-[#6F7173] mb-1">
                        Value
                      </span>
                      <div class="flex items-center justify-between font-mono text-[#3C3D3E] bg-white border border-[#E2DFD8] rounded-md px-2.5 py-1.5">
                        <span class="truncate select-all" title={getTxtToken()}>{getTxtToken()}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard("val_txt", getTxtToken())}
                          class="ml-1 text-[11px] text-[#9E725F] hover:underline"
                        >
                          {copiedKey() === "val_txt" ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="mt-4 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleTriggerVerification}
                    disabled={isVerifying()}
                    class="inline-flex items-center gap-2 rounded-lg bg-[#9E725F] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#865E4D] disabled:opacity-50 transition-colors"
                  >
                    <span>{isVerifying() ? "Querying DNS…" : "Verify Ownership Now"}</span>
                  </button>
                  <span class="text-xs text-[#6F7173]">
                    DNS changes may take 1 to 5 minutes to propagate.
                  </span>
                </div>

                <Show when={verifyMessage()}>
                  <div
                    class={`mt-4 rounded-lg p-3 text-xs border ${
                      verifyStatus() === "success"
                        ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                        : "bg-amber-50 text-amber-800 border-amber-200"
                    }`}
                  >
                    {verifyMessage()}
                  </div>
                </Show>
              </div>

              <div class="mt-8 flex items-center justify-between pt-4 border-t border-[#E2DFD8]">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  class="rounded-lg border border-[#E2DFD8] px-4 py-2 text-xs font-semibold text-[#3C3D3E] hover:bg-[#F0EEE9]"
                >
                  ← Back
                </button>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    class="rounded-lg bg-[#9E725F] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#865E4D] transition-colors"
                  >
                    Next: Configure MX Routing →
                  </button>
                </div>
              </div>
            </Show>

            {/* STEP 3: MX ROUTING */}
            <Show when={step() === 3}>
              <div>
                <h4 class="text-base font-bold text-[#3C3D3E]">
                  Configure MX (Mail Exchange) Routing
                </h4>
                <p class="mt-1 text-xs text-[#6F7173]">
                  Point your inbound email traffic to BYOS mail relays. Create this MX record in your DNS manager.
                </p>

                <div class="mt-5 rounded-xl border border-[#E2DFD8] bg-[#F0EEE9]/40 p-4">
                  <div class="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                    <div>
                      <span class="block text-[11px] font-bold uppercase text-[#6F7173] mb-1">
                        Record Type
                      </span>
                      <div class="font-mono font-bold text-[#9E725F] bg-white border border-[#E2DFD8] rounded-md px-2.5 py-1.5">
                        MX
                      </div>
                    </div>
                    <div>
                      <span class="block text-[11px] font-bold uppercase text-[#6F7173] mb-1">
                        Host / Name
                      </span>
                      <div class="flex items-center justify-between font-mono text-[#3C3D3E] bg-white border border-[#E2DFD8] rounded-md px-2.5 py-1.5">
                        <span class="select-all">@</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard("mx_host", "@")}
                          class="text-[11px] text-[#9E725F] hover:underline"
                        >
                          {copiedKey() === "mx_host" ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                    <div>
                      <span class="block text-[11px] font-bold uppercase text-[#6F7173] mb-1">
                        Value / Target
                      </span>
                      <div class="flex items-center justify-between font-mono text-[#3C3D3E] bg-white border border-[#E2DFD8] rounded-md px-2.5 py-1.5">
                        <span class="truncate select-all">{getMxHost()}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard("mx_val", getMxHost())}
                          class="ml-1 text-[11px] text-[#9E725F] hover:underline"
                        >
                          {copiedKey() === "mx_val" ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                    <div>
                      <span class="block text-[11px] font-bold uppercase text-[#6F7173] mb-1">
                        Priority
                      </span>
                      <div class="font-mono font-bold text-[#3C3D3E] bg-white border border-[#E2DFD8] rounded-md px-2.5 py-1.5">
                        10
                      </div>
                    </div>
                  </div>
                </div>

                <div class="mt-4 rounded-lg bg-[#F3ECE8]/60 border border-[#9E725F]/20 p-3 text-xs text-[#3C3D3E]">
                  <span class="font-bold text-[#9E725F]">Migration Tip:</span> If migrating an active domain from another email provider, configure your SPF and DKIM records (in Step 4) before switching this MX record to avoid delivery delays.
                </div>
              </div>

              <div class="mt-8 flex items-center justify-between pt-4 border-t border-[#E2DFD8]">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  class="rounded-lg border border-[#E2DFD8] px-4 py-2 text-xs font-semibold text-[#3C3D3E] hover:bg-[#F0EEE9]"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  class="rounded-lg bg-[#9E725F] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#865E4D] transition-colors"
                >
                  Next: SPF, DKIM & DMARC →
                </button>
              </div>
            </Show>

            {/* STEP 4: AUTHENTICATION (SPF, DKIM, DMARC) */}
            <Show when={step() === 4}>
              <div>
                <div class="flex items-center justify-between">
                  <div>
                    <h4 class="text-base font-bold text-[#3C3D3E]">
                      Email Authentication & Deliverability
                    </h4>
                    <p class="mt-1 text-xs text-[#6F7173]">
                      Configure SPF, DKIM (RSA-2048), and DMARC to guarantee inbox placement and prevent spoofing.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleTriggerVerification}
                    disabled={isVerifying()}
                    class="rounded-lg border border-[#9E725F] bg-white px-3 py-1.5 text-xs font-semibold text-[#9E725F] hover:bg-[#F3ECE8] disabled:opacity-50 transition-colors"
                  >
                    {isVerifying() ? "Checking…" : "Check DNS Records"}
                  </button>
                </div>

                <div class="mt-4 space-y-3">
                  {/* SPF */}
                  <div class="rounded-xl border border-[#E2DFD8] bg-[#F0EEE9]/30 p-3 text-xs">
                    <div class="flex items-center justify-between mb-1">
                      <div class="flex items-center gap-2">
                        <span class="font-bold text-[#3C3D3E]">1. SPF (Sender Policy Framework)</span>
                        <span class="rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5">
                          TXT
                        </span>
                      </div>
                      <span class={`text-[11px] font-semibold ${currentDomain()?.is_verified ? "text-emerald-700" : "text-amber-700"}`}>
                        {currentDomain()?.is_verified ? "🟢 Valid" : "🟡 Pending Propagation"}
                      </span>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                      <div class="flex items-center justify-between bg-white border border-[#E2DFD8] rounded-md px-2 py-1 font-mono text-[11px]">
                        <span>Host: @</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard("spf_h", "@")}
                          class="text-[#9E725F] hover:underline"
                        >
                          {copiedKey() === "spf_h" ? "Copied!" : "Copy"}
                        </button>
                      </div>
                      <div class="flex items-center justify-between bg-white border border-[#E2DFD8] rounded-md px-2 py-1 font-mono text-[11px]">
                        <span class="truncate">v=spf1 include:_spf.byos.email ~all</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard("spf_v", "v=spf1 include:_spf.byos.email ~all")}
                          class="ml-1 text-[#9E725F] hover:underline"
                        >
                          {copiedKey() === "spf_v" ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* DKIM */}
                  <div class="rounded-xl border border-[#E2DFD8] bg-[#F0EEE9]/30 p-3 text-xs">
                    <div class="flex items-center justify-between mb-1">
                      <div class="flex items-center gap-2">
                        <span class="font-bold text-[#3C3D3E]">2. DKIM (RSA-2048 Cryptographic Signature)</span>
                        <span class="rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5">
                          TXT
                        </span>
                      </div>
                      <span class={`text-[11px] font-semibold ${currentDomain()?.is_verified ? "text-emerald-700" : "text-amber-700"}`}>
                        {currentDomain()?.is_verified ? "🟢 Valid" : "🟡 Pending Propagation"}
                      </span>
                    </div>
                    <div class="space-y-1.5 mt-2">
                      <div class="flex items-center justify-between bg-white border border-[#E2DFD8] rounded-md px-2 py-1 font-mono text-[11px]">
                        <span class="truncate">Host: {`${currentDomain()?.dkim_selector || "byos"}._domainkey.${currentDomain()?.name || ""}`}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard("dkim_h", `${currentDomain()?.dkim_selector || "byos"}._domainkey.${currentDomain()?.name || ""}`)}
                          class="ml-1 text-[#9E725F] hover:underline"
                        >
                          {copiedKey() === "dkim_h" ? "Copied!" : "Copy"}
                        </button>
                      </div>
                      <div class="flex items-center justify-between bg-white border border-[#E2DFD8] rounded-md px-2 py-1 font-mono text-[11px]">
                        <span class="truncate max-w-sm" title={getDkimKey()}>
                          Value: {getDkimKey()}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard("dkim_v", getDkimKey())}
                          class="ml-1 text-[#9E725F] hover:underline shrink-0"
                        >
                          {copiedKey() === "dkim_v" ? "Copied Key!" : "Copy Key"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* DMARC */}
                  <div class="rounded-xl border border-[#E2DFD8] bg-[#F0EEE9]/30 p-3 text-xs">
                    <div class="flex items-center justify-between mb-1">
                      <div class="flex items-center gap-2">
                        <span class="font-bold text-[#3C3D3E]">3. DMARC (Policy & Reporting)</span>
                        <span class="rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5">
                          TXT
                        </span>
                      </div>
                      <span class={`text-[11px] font-semibold ${currentDomain()?.is_verified ? "text-emerald-700" : "text-amber-700"}`}>
                        {currentDomain()?.is_verified ? "🟢 Valid" : "🟡 Pending Propagation"}
                      </span>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                      <div class="flex items-center justify-between bg-white border border-[#E2DFD8] rounded-md px-2 py-1 font-mono text-[11px]">
                        <span>Host: _dmarc.{currentDomain()?.name}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard("dmarc_h", `_dmarc.${currentDomain()?.name}`)}
                          class="text-[#9E725F] hover:underline"
                        >
                          {copiedKey() === "dmarc_h" ? "Copied!" : "Copy"}
                        </button>
                      </div>
                      <div class="flex items-center justify-between bg-white border border-[#E2DFD8] rounded-md px-2 py-1 font-mono text-[11px]">
                        <span class="truncate">v=DMARC1; p=quarantine;</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard("dmarc_v", "v=DMARC1; p=quarantine;")}
                          class="ml-1 text-[#9E725F] hover:underline"
                        >
                          {copiedKey() === "dmarc_v" ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="mt-8 flex items-center justify-between pt-4 border-t border-[#E2DFD8]">
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  class="rounded-lg border border-[#E2DFD8] px-4 py-2 text-xs font-semibold text-[#3C3D3E] hover:bg-[#F0EEE9]"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    props.onSuccess();
                    props.onClose();
                  }}
                  class="rounded-lg bg-[#9E725F] px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#865E4D] transition-colors"
                >
                  Finish Setup
                </button>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DomainWizard;
