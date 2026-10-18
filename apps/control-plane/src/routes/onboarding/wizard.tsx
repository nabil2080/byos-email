import { Component, createSignal, onMount, createEffect, Show, For, createMemo } from "solid-js";
import { useParams, useNavigate } from "@solidjs/router";
import { useOrg } from "../../context/OrgContext";
import OnboardingLayout from "../../components/onboarding/OnboardingLayout";
import {
  getOnboardingState,
  setupDomain,
  verifyDomain,
  selectStorageMode,
  connectStorage,
  createMailboxes,
  inviteEmployees,
  getVerificationMatrix,
  completeOnboarding,
  skipOnboarding,
  OnboardingState,
  VerificationMatrix,
  DNSRecord,
} from "../../lib/api/onboarding";

export const OnboardingWizardPage: Component = () => {
  const params = useParams();
  const navigate = useNavigate();
  const org = useOrg();

  // Step state (1 to 7)
  const currentStep = () => {
    const raw = Number(params.step);
    if (!isNaN(raw) && raw >= 1 && raw <= 7) {
      return raw;
    }
    return org.onboardingCurrentStep || 1;
  };

  const [loading, setLoading] = createSignal(true);
  const [submitting, setSubmitting] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal("");
  const [successMessage, setSuccessMessage] = createSignal("");
  const [state, setState] = createSignal<OnboardingState | null>(null);

  // Step 1: Domain state
  const [domainName, setDomainName] = createSignal("acme.local");
  const [domainVerified, setDomainVerified] = createSignal(false);
  const [dnsRecords, setDnsRecords] = createSignal<DNSRecord[]>([]);
  const [domainId, setDomainId] = createSignal("");

  // Step 2: Storage Mode state
  const [selectedStorageMode, setSelectedStorageMode] = createSignal("org_managed");

  // Step 3: Storage Connection state
  const [storageProvider, setStorageProvider] = createSignal("minio");
  const [storageEndpoint, setStorageEndpoint] = createSignal("minio:9000");
  const [storageBucket, setStorageBucket] = createSignal("byos-mailbox");
  const [storageAccessKey, setStorageAccessKey] = createSignal("byosminio");
  const [storageSecretKey, setStorageSecretKey] = createSignal("byosminio_dev_password");
  const [storageRegion, setStorageRegion] = createSignal("us-east-1");
  const [probeResult, setProbeResult] = createSignal<string>("");

  // Step 4: Mailboxes state
  const [newMailboxLocalPart, setNewMailboxLocalPart] = createSignal("");
  const [newMailboxName, setNewMailboxName] = createSignal("");
  const [pendingMailboxes, setPendingMailboxes] = createSignal<Array<{ local_part: string; name: string }>>([]);

  // Step 5: Invitations state
  const [inviteEmail, setInviteEmail] = createSignal("");
  const [inviteName, setInviteName] = createSignal("");
  const [inviteRole, setInviteRole] = createSignal("member");
  const [pendingInvites, setPendingInvites] = createSignal<Array<{ email: string; name: string; role: string }>>([]);
  const [sentInvitesList, setSentInvitesList] = createSignal<Array<{ id: string; email: string; invite_url: string }>>([]);

  // Step 7: Verification Matrix state
  const [matrix, setMatrix] = createSignal<VerificationMatrix | null>(null);

  const loadState = async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await getOnboardingState();
      setState(data);

      if (data.domain) {
        setDomainName(data.domain.name);
        setDomainVerified(data.domain.is_verified);
        setDomainId(data.domain.id);
        if (data.domain.dns_records) {
          setDnsRecords(data.domain.dns_records);
        }
      }

      if (data.storage_mode) {
        setSelectedStorageMode(data.storage_mode);
      }

      if (data.storage_connection) {
        setStorageProvider(data.storage_connection.provider);
        setStorageBucket(data.storage_connection.bucket_name);
        if (data.storage_connection.status === "active") {
          setProbeResult("verified");
        }
      }

      if (currentStep() === 7) {
        const mat = await getVerificationMatrix();
        setMatrix(mat);
      }
    } catch (err: any) {
      console.warn("Failed to load onboarding state:", err);
      setErrorMessage(err.message || "Failed to load onboarding state");
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    loadState();
  });

  createEffect(() => {
    if (currentStep() === 7) {
      getVerificationMatrix().then(setMatrix).catch((err) => {
        console.warn("Failed to fetch verification matrix:", err);
      });
    }
  });

  const completedSteps = createMemo(() => {
    const s = state();
    return s ? s.completed_steps : [];
  });

  // Skip Onboarding Action
  const handleSkip = async () => {
    setSubmitting(true);
    try {
      await skipOnboarding();
      await org.refetch();
      navigate("/dashboard");
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to skip onboarding");
    } finally {
      setSubmitting(false);
    }
  };

  // Step 1 Actions
  const handleConfigureDomain = async (e: Event) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const res = await setupDomain(domainName());
      setDomainId(res.id);
      setDomainVerified(res.is_verified);
      if (res.dns_records) {
        setDnsRecords(res.dns_records);
      }
      setSuccessMessage(`Domain ${domainName()} configured. DNS configuration preview generated.`);
      await loadState();
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to configure domain");
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyDomain = async () => {
    setSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const res = await verifyDomain(domainId());
      setDomainVerified(true);
      if (res.dns_records) {
        setDnsRecords(res.dns_records);
      }
      if (res.verification_type === "development") {
        setSuccessMessage("Development verification successful: Domain verified in development mode without public DNS.");
      } else {
        setSuccessMessage("Domain verified successfully via public DNS records.");
      }
      await loadState();
    } catch (err: any) {
      setErrorMessage(err.message || "Domain verification failed");
    } finally {
      setSubmitting(false);
    }
  };

  // Step 2 Actions
  const handleSaveStorageMode = async () => {
    setSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await selectStorageMode(selectedStorageMode());
      await loadState();
      navigate("/onboarding/3");
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to set storage mode");
    } finally {
      setSubmitting(false);
    }
  };

  // Step 3 Actions
  const handlePrefillDevMinIO = () => {
    setStorageProvider("minio");
    setStorageEndpoint("minio:9000");
    setStorageBucket("byos-mailbox");
    setStorageAccessKey("byosminio");
    setStorageSecretKey("byosminio_dev_password");
    setStorageRegion("us-east-1");
  };

  const handleConnectStorage = async (e: Event) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    setProbeResult("");
    try {
      const config = {
        endpoint: storageEndpoint(),
        bucket: storageBucket(),
        access_key: storageAccessKey(),
        secret_key: storageSecretKey(),
        region: storageRegion(),
        path_style: true,
      };
      const res = await connectStorage(storageProvider(), config);
      setProbeResult("verified");
      setSuccessMessage("Live storage probe successful: Write, read, verify, and delete probe verified.");
      await loadState();
    } catch (err: any) {
      setErrorMessage(err.message || "Storage probe connection failed");
    } finally {
      setSubmitting(false);
    }
  };

  // Step 4 Actions
  const handleAddMailboxDraft = (e: Event) => {
    e.preventDefault();
    const lp = newMailboxLocalPart().trim().toLowerCase();
    if (!lp) return;
    const name = newMailboxName().trim() || lp;
    setPendingMailboxes([...pendingMailboxes(), { local_part: lp, name }]);
    setNewMailboxLocalPart("");
    setNewMailboxName("");
  };

  const handleSaveMailboxes = async () => {
    setSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const list = pendingMailboxes();
      if (list.length === 0) {
        // If empty, add an initial admin mailbox
        list.push({ local_part: "admin", name: "Administrator" });
      }
      await createMailboxes(list);
      setPendingMailboxes([]);
      setSuccessMessage("Mailbox(es) provisioned successfully.");
      await loadState();
      navigate("/onboarding/5");
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to create mailboxes");
    } finally {
      setSubmitting(false);
    }
  };

  // Step 5 Actions
  const handleAddInviteDraft = (e: Event) => {
    e.preventDefault();
    const em = inviteEmail().trim().toLowerCase();
    if (!em) return;
    const nm = inviteName().trim() || em.split("@")[0];
    const rl = inviteRole();
    setPendingInvites([...pendingInvites(), { email: em, name: nm, role: rl }]);
    setInviteEmail("");
    setInviteName("");
  };

  const handleSendInvitations = async () => {
    setSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const list = pendingInvites();
      if (list.length > 0) {
        const res = await inviteEmployees(list);
        if (res.invitations) {
          setSentInvitesList(res.invitations);
        }
        setPendingInvites([]);
        setSuccessMessage(`${list.length} invitation(s) dispatched via local SMTP/Mailpit.`);
      }
      await loadState();
      navigate("/onboarding/6");
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to dispatch invitations");
    } finally {
      setSubmitting(false);
    }
  };

  // Step 7 Actions
  const handleCompleteOnboarding = async () => {
    setSubmitting(true);
    setErrorMessage("");
    try {
      await completeOnboarding();
      await org.refetch();
      navigate("/dashboard");
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to complete onboarding");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <OnboardingLayout
      currentStep={currentStep()}
      completedSteps={completedSteps()}
      onSkip={handleSkip}
      isSkipping={submitting()}
    >
      <div class="space-y-6">
        {/* Error and Success Notifications */}
        <Show when={errorMessage()}>
          <div
            role="alert"
            class="bg-rose-50 border border-rose-200 rounded-xl p-4 text-xs text-rose-800 flex items-start gap-3"
          >
            <div class="w-5 h-5 rounded-full bg-rose-200 text-rose-800 flex items-center justify-center font-bold flex-shrink-0">
              !
            </div>
            <div class="flex-1 font-medium">{errorMessage()}</div>
          </div>
        </Show>

        <Show when={successMessage()}>
          <div
            role="status"
            class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs text-emerald-800 flex items-start gap-3"
          >
            <div class="w-5 h-5 rounded-full bg-emerald-200 text-emerald-800 flex items-center justify-center font-bold flex-shrink-0">
              ✓
            </div>
            <div class="flex-1 font-medium">{successMessage()}</div>
          </div>
        </Show>

        {/* STEP 1: Custom Domain Setup */}
        <Show when={currentStep() === 1}>
          <div class="bg-white rounded-2xl border border-[#E2DFD8] p-6 sm:p-8 shadow-xs space-y-6">
            <div>
              <div class="text-[11px] font-bold uppercase tracking-wider text-[#9E725F] font-mono">
                Step 1 of 7
              </div>
              <h2 class="text-xl sm:text-2xl font-bold text-[#3C3D3E] mt-1">
                Domain Setup & DNS Configuration
              </h2>
              <p class="text-xs sm:text-sm text-[#6F7173] mt-1">
                Connect your organization's custom email domain. In local development, you can use <code>.local</code> or <code>.test</code> domains for automatic development verification.
              </p>
            </div>

            <form onSubmit={handleConfigureDomain} class="space-y-4">
              <div>
                <label class="block text-xs font-bold text-[#3C3D3E] uppercase tracking-wider mb-1.5">
                  Custom Domain Name
                </label>
                <div class="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={domainName()}
                    onInput={(e) => setDomainName(e.currentTarget.value)}
                    placeholder="e.g. acme.local or mycompany.com"
                    class="flex-1 rounded-lg border border-[#E2DFD8] bg-[#FAF9F6] px-3.5 py-2.5 text-sm text-[#3C3D3E] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 font-mono"
                    required
                  />
                  <button
                    type="submit"
                    disabled={submitting()}
                    class="inline-flex items-center justify-center rounded-lg bg-[#9E725F] px-5 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-[#865E4D] transition-colors focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 disabled:opacity-50"
                  >
                    {submitting() ? "Configuring…" : "Configure Domain"}
                  </button>
                </div>
              </div>
            </form>

            {/* DNS Records Table Preview */}
            <Show when={dnsRecords().length > 0}>
              <div class="space-y-3 pt-4 border-t border-[#E2DFD8]">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-bold uppercase tracking-wider text-[#3C3D3E]">
                    Required DNS Records Preview
                  </span>
                  <span class="text-[11px] font-mono text-[#6F7173]">
                    {dnsRecords().length} Records Generated
                  </span>
                </div>

                <div class="overflow-x-auto rounded-lg border border-[#E2DFD8]">
                  <table class="w-full text-left text-xs border-collapse">
                    <thead class="bg-[#F0EEE9] text-[#6F7173] font-mono uppercase tracking-wider text-[10px]">
                      <tr>
                        <th class="p-2.5 font-semibold">Type</th>
                        <th class="p-2.5 font-semibold">Host / Name</th>
                        <th class="p-2.5 font-semibold">Value</th>
                        <th class="p-2.5 font-semibold">Priority</th>
                        <th class="p-2.5 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-[#E2DFD8] bg-white font-mono text-[11px]">
                      <For each={dnsRecords()}>
                        {(rec) => (
                          <tr class="hover:bg-[#FAF9F6]">
                            <td class="p-2.5 font-bold text-[#9E725F]">{rec.type}</td>
                            <td class="p-2.5 text-[#3C3D3E] max-w-[140px] truncate" title={rec.name}>
                              {rec.name}
                            </td>
                            <td class="p-2.5 text-[#6F7173] max-w-[200px] truncate" title={rec.value}>
                              {rec.value}
                            </td>
                            <td class="p-2.5 text-[#6F7173]">{rec.priority ?? "—"}</td>
                            <td class="p-2.5">
                              <span class="inline-block px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-[#FAF9F6] border border-[#E2DFD8] text-[#3C3D3E]">
                                {rec.status || "required"}
                              </span>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>

                {/* Verification CTA */}
                <div class="bg-[#FAF9F6] rounded-xl border border-[#E2DFD8] p-4 flex flex-col sm:flex-row items-center justify-between gap-4 mt-4">
                  <div>
                    <div class="text-xs font-bold text-[#3C3D3E]">
                      Verification Status:{" "}
                      <span class={domainVerified() ? "text-emerald-700" : "text-amber-700"}>
                        {domainVerified() ? "Verified ✓" : "Pending Verification"}
                      </span>
                    </div>
                    <div class="text-[11px] text-[#6F7173] mt-0.5">
                      {domainVerified()
                        ? "Domain identity and DKIM keys confirmed."
                        : "Click below to run domain verification checks."}
                    </div>
                  </div>

                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleVerifyDomain}
                      disabled={submitting()}
                      class="inline-flex items-center justify-center rounded-lg border border-[#9E725F] bg-white text-[#9E725F] px-4 py-2 text-xs font-semibold shadow-xs hover:bg-[#F2E8E2] transition-colors focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 disabled:opacity-50"
                    >
                      {submitting() ? "Verifying…" : "Run Verification Check"}
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate("/onboarding/2")}
                      disabled={!domainVerified() && !domainName()}
                      class="inline-flex items-center justify-center rounded-lg bg-[#9E725F] px-5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#865E4D] transition-colors focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
                    >
                      Continue to Step 2 →
                    </button>
                  </div>
                </div>
              </div>
            </Show>
          </div>
        </Show>

        {/* STEP 2: Storage Mode Selection */}
        <Show when={currentStep() === 2}>
          <div class="bg-white rounded-2xl border border-[#E2DFD8] p-6 sm:p-8 shadow-xs space-y-6">
            <div>
              <div class="text-[11px] font-bold uppercase tracking-wider text-[#9E725F] font-mono">
                Step 2 of 7
              </div>
              <h2 class="text-xl sm:text-2xl font-bold text-[#3C3D3E] mt-1">
                Storage Architecture Mode
              </h2>
              <p class="text-xs sm:text-sm text-[#6F7173] mt-1">
                Select how encryption keys and email objects are managed for your organization.
              </p>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Option A: Org Managed */}
              <div
                onClick={() => setSelectedStorageMode("org_managed")}
                class={`p-5 rounded-xl border-2 cursor-pointer transition-all ${
                  selectedStorageMode() === "org_managed"
                    ? "border-[#9E725F] bg-[#FAF9F6] shadow-xs"
                    : "border-[#E2DFD8] bg-white hover:border-[#9E725F]/40"
                }`}
              >
                <div class="flex items-center justify-between mb-3">
                  <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-[#9E725F]/15 text-[#9E725F]">
                    Active • Recommended
                  </span>
                  <div
                    class={`w-4 h-4 rounded-full border flex items-center justify-center ${
                      selectedStorageMode() === "org_managed"
                        ? "border-[#9E725F] bg-[#9E725F]"
                        : "border-[#E2DFD8]"
                    }`}
                  >
                    <Show when={selectedStorageMode() === "org_managed"}>
                      <div class="w-1.5 h-1.5 rounded-full bg-white" />
                    </Show>
                  </div>
                </div>
                <h3 class="font-bold text-sm text-[#3C3D3E]">Organization-Managed</h3>
                <p class="text-xs text-[#6F7173] mt-2 leading-relaxed">
                  All encryption keys and objects are held under the organization's sovereign root key. Backups and migrations are centrally managed.
                </p>
              </div>

              {/* Option B: Individual Managed (Coming Soon) */}
              <div class="p-5 rounded-xl border border-[#E2DFD8] bg-[#FAF9F6]/60 opacity-60 cursor-not-allowed">
                <div class="flex items-center justify-between mb-3">
                  <span class="inline-block px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-stone-200 text-stone-600">
                    Coming Soon
                  </span>
                </div>
                <h3 class="font-bold text-sm text-[#6F7173]">Individual-Managed</h3>
                <p class="text-xs text-[#6F7173] mt-2 leading-relaxed">
                  Each employee controls their own private root key with zero organizational access or recovery capability.
                </p>
              </div>

              {/* Option C: Hybrid Mode (Coming Soon) */}
              <div class="p-5 rounded-xl border border-[#E2DFD8] bg-[#FAF9F6]/60 opacity-60 cursor-not-allowed">
                <div class="flex items-center justify-between mb-3">
                  <span class="inline-block px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-stone-200 text-stone-600">
                    Coming Soon
                  </span>
                </div>
                <h3 class="font-bold text-sm text-[#6F7173]">Hybrid Storage</h3>
                <p class="text-xs text-[#6F7173] mt-2 leading-relaxed">
                  Split architecture allowing executive mailboxes to maintain private keys while standard accounts use org governance.
                </p>
              </div>
            </div>

            <div class="flex items-center justify-between pt-4 border-t border-[#E2DFD8]">
              <button
                type="button"
                onClick={() => navigate("/onboarding/1")}
                class="text-xs text-[#6F7173] hover:text-[#3C3D3E] font-medium"
              >
                ← Back to Domain Setup
              </button>
              <button
                type="button"
                onClick={handleSaveStorageMode}
                disabled={submitting()}
                class="inline-flex items-center justify-center rounded-lg bg-[#9E725F] px-6 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-[#865E4D] transition-colors focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 disabled:opacity-50"
              >
                {submitting() ? "Saving…" : "Confirm & Proceed to Storage →"}
              </button>
            </div>
          </div>
        </Show>

        {/* STEP 3: Storage Connection & Live Probe */}
        <Show when={currentStep() === 3}>
          <div class="bg-white rounded-2xl border border-[#E2DFD8] p-6 sm:p-8 shadow-xs space-y-6">
            <div>
              <div class="text-[11px] font-bold uppercase tracking-wider text-[#9E725F] font-mono">
                Step 3 of 7
              </div>
              <h2 class="text-xl sm:text-2xl font-bold text-[#3C3D3E] mt-1">
                Zero-Knowledge Storage Connection
              </h2>
              <p class="text-xs sm:text-sm text-[#6F7173] mt-1">
                Connect your sovereign object storage. BYOS executes a live write, read, verify, and delete probe to confirm full bucket read/write permissions.
              </p>
            </div>

            {/* Provider Tabs */}
            <div class="flex items-center gap-2 border-b border-[#E2DFD8] pb-3">
              <button
                type="button"
                class="px-3 py-1.5 rounded-lg bg-[#9E725F]/15 text-[#9E725F] font-bold text-xs"
              >
                MinIO Object Storage (Active)
              </button>
              <button
                type="button"
                disabled
                class="px-3 py-1.5 rounded-lg text-stone-400 text-xs font-medium cursor-not-allowed"
              >
                AWS S3 (Coming Soon)
              </button>
              <button
                type="button"
                disabled
                class="px-3 py-1.5 rounded-lg text-stone-400 text-xs font-medium cursor-not-allowed"
              >
                Google Drive (Coming Soon)
              </button>
            </div>

            {/* MinIO Connection Form */}
            <form onSubmit={handleConnectStorage} class="space-y-4">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold uppercase tracking-wider text-[#3C3D3E]">
                  MinIO S3-Compatible Credentials
                </span>
                <button
                  type="button"
                  onClick={handlePrefillDevMinIO}
                  class="text-[11px] text-[#9E725F] hover:underline font-semibold"
                >
                  Prefill Local Dev Credentials
                </button>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-medium text-[#6F7173] mb-1">
                    Endpoint Address
                  </label>
                  <input
                    type="text"
                    value={storageEndpoint()}
                    onInput={(e) => setStorageEndpoint(e.currentTarget.value)}
                    placeholder="minio:9000"
                    class="w-full rounded-lg border border-[#E2DFD8] bg-[#FAF9F6] px-3 py-2 text-xs font-mono text-[#3C3D3E] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
                    required
                  />
                </div>
                <div>
                  <label class="block text-xs font-medium text-[#6F7173] mb-1">
                    Bucket Name
                  </label>
                  <input
                    type="text"
                    value={storageBucket()}
                    onInput={(e) => setStorageBucket(e.currentTarget.value)}
                    placeholder="byos-mailbox"
                    class="w-full rounded-lg border border-[#E2DFD8] bg-[#FAF9F6] px-3 py-2 text-xs font-mono text-[#3C3D3E] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
                    required
                  />
                </div>
                <div>
                  <label class="block text-xs font-medium text-[#6F7173] mb-1">
                    Access Key
                  </label>
                  <input
                    type="text"
                    value={storageAccessKey()}
                    onInput={(e) => setStorageAccessKey(e.currentTarget.value)}
                    placeholder="byosminio"
                    class="w-full rounded-lg border border-[#E2DFD8] bg-[#FAF9F6] px-3 py-2 text-xs font-mono text-[#3C3D3E] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
                    required
                  />
                </div>
                <div>
                  <label class="block text-xs font-medium text-[#6F7173] mb-1">
                    Secret Key
                  </label>
                  <input
                    type="password"
                    value={storageSecretKey()}
                    onInput={(e) => setStorageSecretKey(e.currentTarget.value)}
                    placeholder="••••••••"
                    class="w-full rounded-lg border border-[#E2DFD8] bg-[#FAF9F6] px-3 py-2 text-xs font-mono text-[#3C3D3E] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
                    required
                  />
                </div>
              </div>

              <div class="bg-[#FAF9F6] rounded-xl border border-[#E2DFD8] p-4 space-y-3">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-bold text-[#3C3D3E]">
                    Storage Verification Probe
                  </span>
                  <span class="text-[11px] font-mono text-[#6F7173]">
                    Status: {probeResult() === "verified" ? "Probe Passed ✓" : "Untested"}
                  </span>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                  <div class="bg-white p-2 rounded border border-[#E2DFD8]">1. Bucket Reachable</div>
                  <div class="bg-white p-2 rounded border border-[#E2DFD8]">2. Write Probe</div>
                  <div class="bg-white p-2 rounded border border-[#E2DFD8]">3. Read Verify</div>
                  <div class="bg-white p-2 rounded border border-[#E2DFD8]">4. Delete Cleanup</div>
                </div>
              </div>

              <div class="flex items-center justify-between pt-4 border-t border-[#E2DFD8]">
                <button
                  type="button"
                  onClick={() => navigate("/onboarding/2")}
                  class="text-xs text-[#6F7173] hover:text-[#3C3D3E] font-medium"
                >
                  ← Back to Mode
                </button>
                <div class="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={submitting()}
                    class="inline-flex items-center justify-center rounded-lg border border-[#9E725F] bg-white text-[#9E725F] px-4 py-2.5 text-xs font-semibold shadow-xs hover:bg-[#F2E8E2] transition-colors focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 disabled:opacity-50"
                  >
                    {submitting() ? "Running Probe…" : "Run Live Storage Probe"}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate("/onboarding/4")}
                    disabled={probeResult() !== "verified"}
                    class="inline-flex items-center justify-center rounded-lg bg-[#9E725F] px-5 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-[#865E4D] transition-colors focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 disabled:opacity-50"
                  >
                    Continue to Mailboxes →
                  </button>
                </div>
              </div>
            </form>
          </div>
        </Show>

        {/* STEP 4: Mailbox Creation */}
        <Show when={currentStep() === 4}>
          <div class="bg-white rounded-2xl border border-[#E2DFD8] p-6 sm:p-8 shadow-xs space-y-6">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div class="text-[11px] font-bold uppercase tracking-wider text-[#9E725F] font-mono">
                  Step 4 of 7
                </div>
                <h2 class="text-xl sm:text-2xl font-bold text-[#3C3D3E] mt-1">
                  Mailbox Allocation
                </h2>
                <p class="text-xs sm:text-sm text-[#6F7173] mt-1">
                  Provision initial mailboxes for your organization. The owner mailbox counts toward your total purchased seat count.
                </p>
              </div>
              <div class="bg-[#FAF9F6] border border-[#E2DFD8] rounded-xl px-4 py-2 text-right">
                <div class="text-[10px] font-bold text-[#6F7173] uppercase tracking-wider">
                  Capacity
                </div>
                <div class="text-sm font-mono font-bold text-[#9E725F]">
                  {(state()?.mailbox_count || 0) + pendingMailboxes().length} of {state()?.organization.seat_count || 1} Seats Used
                </div>
              </div>
            </div>

            {/* Add Mailbox Form */}
            <form onSubmit={handleAddMailboxDraft} class="bg-[#FAF9F6] p-4 rounded-xl border border-[#E2DFD8] space-y-3">
              <span class="text-xs font-bold uppercase tracking-wider text-[#3C3D3E]">
                Add Mailbox
              </span>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <input
                    type="text"
                    value={newMailboxLocalPart()}
                    onInput={(e) => setNewMailboxLocalPart(e.currentTarget.value)}
                    placeholder="local-part (e.g. admin)"
                    class="w-full rounded-lg border border-[#E2DFD8] bg-white px-3 py-2 text-xs font-mono text-[#3C3D3E] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
                  />
                </div>
                <div>
                  <input
                    type="text"
                    value={newMailboxName()}
                    onInput={(e) => setNewMailboxName(e.currentTarget.value)}
                    placeholder="Display Name (optional)"
                    class="w-full rounded-lg border border-[#E2DFD8] bg-white px-3 py-2 text-xs text-[#3C3D3E] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
                  />
                </div>
                <div>
                  <button
                    type="submit"
                    class="w-full inline-flex items-center justify-center rounded-lg border border-[#9E725F] bg-white text-[#9E725F] px-4 py-2 text-xs font-semibold hover:bg-[#F2E8E2] transition-colors focus:outline-none"
                  >
                    + Add to Queue
                  </button>
                </div>
              </div>
            </form>

            {/* Pending List */}
            <Show when={pendingMailboxes().length > 0}>
              <div class="space-y-2">
                <span class="text-xs font-bold text-[#3C3D3E]">Pending Provisioning Queue:</span>
                <div class="space-y-1">
                  <For each={pendingMailboxes()}>
                    {(mb, idx) => (
                      <div class="flex items-center justify-between p-2.5 rounded-lg border border-[#E2DFD8] bg-white text-xs">
                        <span class="font-mono font-bold text-[#3C3D3E]">
                          {mb.local_part}@{domainName()}
                        </span>
                        <div class="flex items-center gap-3">
                          <span class="text-[#6F7173]">{mb.name}</span>
                          <button
                            type="button"
                            onClick={() => setPendingMailboxes(pendingMailboxes().filter((_, i) => i !== idx()))}
                            class="text-rose-600 hover:text-rose-800 font-bold"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <div class="flex items-center justify-between pt-4 border-t border-[#E2DFD8]">
              <button
                type="button"
                onClick={() => navigate("/onboarding/3")}
                class="text-xs text-[#6F7173] hover:text-[#3C3D3E] font-medium"
              >
                ← Back to Storage
              </button>
              <button
                type="button"
                onClick={handleSaveMailboxes}
                disabled={submitting()}
                class="inline-flex items-center justify-center rounded-lg bg-[#9E725F] px-6 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-[#865E4D] transition-colors focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 disabled:opacity-50"
              >
                {submitting() ? "Provisioning…" : "Save Mailboxes & Continue →"}
              </button>
            </div>
          </div>
        </Show>

        {/* STEP 5: Employee Invitations */}
        <Show when={currentStep() === 5}>
          <div class="bg-white rounded-2xl border border-[#E2DFD8] p-6 sm:p-8 shadow-xs space-y-6">
            <div>
              <div class="text-[11px] font-bold uppercase tracking-wider text-[#9E725F] font-mono">
                Step 5 of 7
              </div>
              <h2 class="text-xl sm:text-2xl font-bold text-[#3C3D3E] mt-1">
                Employee Invitations
              </h2>
              <p class="text-xs sm:text-sm text-[#6F7173] mt-1">
                Invite team members to join your email organization. Cryptographic invitation tokens are generated and dispatched via SMTP/Mailpit.
              </p>
            </div>

            <form onSubmit={handleAddInviteDraft} class="bg-[#FAF9F6] p-4 rounded-xl border border-[#E2DFD8] space-y-3">
              <span class="text-xs font-bold uppercase tracking-wider text-[#3C3D3E]">
                Invite Team Member
              </span>
              <div class="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <div class="sm:col-span-2">
                  <input
                    type="email"
                    value={inviteEmail()}
                    onInput={(e) => setInviteEmail(e.currentTarget.value)}
                    placeholder="employee@domain.local"
                    class="w-full rounded-lg border border-[#E2DFD8] bg-white px-3 py-2 text-xs font-mono text-[#3C3D3E] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
                  />
                </div>
                <div>
                  <input
                    type="text"
                    value={inviteName()}
                    onInput={(e) => setInviteName(e.currentTarget.value)}
                    placeholder="Name"
                    class="w-full rounded-lg border border-[#E2DFD8] bg-white px-3 py-2 text-xs text-[#3C3D3E] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
                  />
                </div>
                <div>
                  <button
                    type="submit"
                    class="w-full inline-flex items-center justify-center rounded-lg border border-[#9E725F] bg-white text-[#9E725F] px-4 py-2 text-xs font-semibold hover:bg-[#F2E8E2] transition-colors focus:outline-none"
                  >
                    + Add to Queue
                  </button>
                </div>
              </div>
            </form>

            <Show when={pendingInvites().length > 0}>
              <div class="space-y-2">
                <span class="text-xs font-bold text-[#3C3D3E]">Ready to Send:</span>
                <div class="space-y-1">
                  <For each={pendingInvites()}>
                    {(inv, idx) => (
                      <div class="flex items-center justify-between p-2.5 rounded-lg border border-[#E2DFD8] bg-white text-xs">
                        <span class="font-mono text-[#3C3D3E]">{inv.email}</span>
                        <div class="flex items-center gap-3">
                          <span class="text-[#6F7173]">{inv.name} ({inv.role})</span>
                          <button
                            type="button"
                            onClick={() => setPendingInvites(pendingInvites().filter((_, i) => i !== idx()))}
                            class="text-rose-600 hover:text-rose-800 font-bold"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <div class="flex items-center justify-between pt-4 border-t border-[#E2DFD8]">
              <button
                type="button"
                onClick={() => navigate("/onboarding/4")}
                class="text-xs text-[#6F7173] hover:text-[#3C3D3E] font-medium"
              >
                ← Back to Mailboxes
              </button>
              <button
                type="button"
                onClick={handleSendInvitations}
                disabled={submitting()}
                class="inline-flex items-center justify-center rounded-lg bg-[#9E725F] px-6 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-[#865E4D] transition-colors focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 disabled:opacity-50"
              >
                {submitting() ? "Sending…" : "Send Invitations & Proceed →"}
              </button>
            </div>
          </div>
        </Show>

        {/* STEP 6: Employee Activation Tracking */}
        <Show when={currentStep() === 6}>
          <div class="bg-white rounded-2xl border border-[#E2DFD8] p-6 sm:p-8 shadow-xs space-y-6">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div class="text-[11px] font-bold uppercase tracking-wider text-[#9E725F] font-mono">
                  Step 6 of 7
                </div>
                <h2 class="text-xl sm:text-2xl font-bold text-[#3C3D3E] mt-1">
                  Employee Activation Tracking
                </h2>
                <p class="text-xs sm:text-sm text-[#6F7173] mt-1">
                  Track member activation status. Users generate their client-side encryption keys upon clicking the activation link.
                </p>
              </div>
              <button
                type="button"
                onClick={loadState}
                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E2DFD8] bg-[#FAF9F6] text-xs font-medium text-[#3C3D3E] hover:bg-white"
              >
                ↻ Refresh Status
              </button>
            </div>

            <div class="bg-[#FAF9F6] rounded-xl border border-[#E2DFD8] p-4 text-xs space-y-3">
              <div class="flex items-center justify-between">
                <span class="font-bold text-[#3C3D3E]">
                  Active Team Members: {state()?.activated_count || 0}
                </span>
                <span class="font-mono text-[#6F7173]">
                  Total Invitations: {state()?.invited_count || 0}
                </span>
              </div>

              <Show when={sentInvitesList().length > 0}>
                <div class="space-y-2 mt-2">
                  <span class="font-semibold text-[#6F7173] text-[11px]">Recently Issued Activation URLs:</span>
                  <For each={sentInvitesList()}>
                    {(inv) => (
                      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-lg bg-white border border-[#E2DFD8]">
                        <span class="font-mono text-[11px] text-[#3C3D3E]">{inv.email}</span>
                        <div class="flex items-center gap-2">
                          <input
                            type="text"
                            readonly
                            value={inv.invite_url}
                            class="bg-[#FAF9F6] border border-[#E2DFD8] px-2 py-1 rounded text-[10px] font-mono text-[#6F7173] max-w-[260px] truncate"
                          />
                          <button
                            type="button"
                            onClick={() => navigator.clipboard.writeText(inv.invite_url)}
                            class="px-2 py-1 rounded bg-[#9E725F]/10 text-[#9E725F] hover:bg-[#9E725F]/20 font-bold text-[10px]"
                          >
                            Copy Link
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            <div class="flex items-center justify-between pt-4 border-t border-[#E2DFD8]">
              <button
                type="button"
                onClick={() => navigate("/onboarding/5")}
                class="text-xs text-[#6F7173] hover:text-[#3C3D3E] font-medium"
              >
                ← Back to Invitations
              </button>
              <button
                type="button"
                onClick={() => navigate("/onboarding/7")}
                class="inline-flex items-center justify-center rounded-lg bg-[#9E725F] px-6 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-[#865E4D] transition-colors focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
              >
                Continue to Final Verification →
              </button>
            </div>
          </div>
        </Show>

        {/* STEP 7: Final System Verification */}
        <Show when={currentStep() === 7}>
          <div class="bg-white rounded-2xl border border-[#E2DFD8] p-6 sm:p-8 shadow-xs space-y-6">
            <div>
              <div class="text-[11px] font-bold uppercase tracking-wider text-[#9E725F] font-mono">
                Step 7 of 7
              </div>
              <h2 class="text-xl sm:text-2xl font-bold text-[#3C3D3E] mt-1">
                Final System Verification
              </h2>
              <p class="text-xs sm:text-sm text-[#6F7173] mt-1">
                Read-only system integrity checklist. Confirms all zero-knowledge encryption, storage probes, and mailbox routing are verified prior to production launch.
              </p>
            </div>

            {/* Checklist Matrix */}
            <Show when={matrix()}>
              <div class="space-y-3">
                <For each={matrix()?.checks || []}>
                  {(check) => (
                    <div class="p-3.5 rounded-xl border border-[#E2DFD8] bg-[#FAF9F6] flex items-start justify-between gap-4">
                      <div>
                        <div class="flex items-center gap-2">
                          <span class="text-xs font-bold text-[#3C3D3E]">{check.name}</span>
                          <span class="text-[10px] text-[#6F7173] font-mono">[{check.category}]</span>
                        </div>
                        <div class="text-xs text-[#6F7173] mt-1">{check.message}</div>
                        <Show when={check.details}>
                          <div class="text-[11px] font-mono text-[#9E725F] mt-0.5">{check.details}</div>
                        </Show>
                      </div>

                      <div>
                        <Show when={check.status === "passed"}>
                          <span class="inline-block px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-800 border border-emerald-300">
                            Passed ✓
                          </span>
                        </Show>
                        <Show when={check.status === "simulated"}>
                          <span class="inline-block px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wide bg-blue-100 text-blue-800 border border-blue-300">
                            Simulated (Dev)
                          </span>
                        </Show>
                        <Show when={check.status === "not_tested"}>
                          <span class="inline-block px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wide bg-stone-200 text-stone-700 border border-stone-300">
                            Untested (Prod)
                          </span>
                        </Show>
                        <Show when={check.status === "failed"}>
                          <span class="inline-block px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wide bg-rose-100 text-rose-800 border border-rose-300">
                            Failed ✕
                          </span>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <div class="bg-[#F2E8E2] rounded-xl border border-[#9E725F]/30 p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <div class="text-xs font-bold text-[#3C3D3E]">
                  Ready to Complete Setup
                </div>
                <div class="text-[11px] text-[#6F7173] mt-0.5">
                  Clicking Complete will mark your organization setup complete and grant full access to the Control Panel.
                </div>
              </div>

              <button
                type="button"
                onClick={handleCompleteOnboarding}
                disabled={submitting()}
                class="inline-flex items-center justify-center rounded-lg bg-[#9E725F] px-6 py-3 text-xs font-semibold text-white shadow-xs hover:bg-[#865E4D] transition-colors focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 disabled:opacity-50 flex-shrink-0"
              >
                {submitting() ? "Completing…" : "Complete Setup & Enter Dashboard →"}
              </button>
            </div>
          </div>
        </Show>
      </div>
    </OnboardingLayout>
  );
};

export default OnboardingWizardPage;
