import { Component, createSignal, Show, For } from "solid-js";
import { enrollRecovery, getRecoveryChallenge, verifyRecovery, changePassword } from "../../lib/api/recovery";
import { getMailbox, rotateRoot, recoverMailboxSecret, fetchOrgRecoveryPkHex } from "../../lib/api/mailboxes";
import { enrollPrincipal, listPrincipals, revokePrincipal, getPrincipal, RecoveryPrincipal } from "../../lib/api/principals";
import { getMembers, OrgMember } from "../../lib/api/members";
import { useAuth } from "../../lib/auth/context";

type Tab = "phrase" | "enroll" | "recover" | "rotate" | "principals";

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const parts = clean.match(/.{2}/g);
  if (!parts || parts.length * 2 !== clean.length) {
    throw new Error("Invalid hex string");
  }
  return new Uint8Array(parts.map((b) => parseInt(b, 16)));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function hexToB64(hex: string): string {
  return bytesToBase64(hexToBytes(hex));
}

// Canonical recovery challenge message shared with the API
// (recoveryChallengeMessage server-side). Must match exactly.
function challengeMessage(challengeId: string): string {
  return "byos-recovery-v1:challenge:" + challengeId;
}

const RecoveryPage: Component = () => {
  const [tab, setTab] = createSignal<Tab>("phrase");

  // ── Phrase tab state ──
  const [mnemonic, setMnemonic] = createSignal<string | null>(null);
  const [phraseVerified, setPhraseVerified] = createSignal(false);
  const [phraseCopied, setPhraseCopied] = createSignal(false);
  const [phraseError, setPhraseError] = createSignal<string | null>(null);

  // ── Enroll tab state ──
  const [enrollMnemonic, setEnrollMnemonic] = createSignal("");
  const [enrollBusy, setEnrollBusy] = createSignal(false);
  const [enrollDone, setEnrollDone] = createSignal(false);
  const [enrollError, setEnrollError] = createSignal<string | null>(null);

  // ── Recover tab state ──
  const [recoverEmail, setRecoverEmail] = createSignal("");
  const [recoverMnemonic, setRecoverMnemonic] = createSignal("");
  const [recoverBusy, setRecoverBusy] = createSignal(false);
  const [recoverError, setRecoverError] = createSignal<string | null>(null);
  const [recoverDone, setRecoverDone] = createSignal(false);
  const [newPassword, setNewPassword] = createSignal("");
  const [pwBusy, setPwBusy] = createSignal(false);
  const [pwError, setPwError] = createSignal<string | null>(null);
  const [pwDone, setPwDone] = createSignal(false);

  // ── Rotate tab state ──
  const { orgId } = useAuth();
  const [rotBoxId, setRotBoxId] = createSignal("");
  const [rotMode, setRotMode] = createSignal<string | null>(null);
  const [rotLoading, setRotLoading] = createSignal(false);
  const [rotMnemonic, setRotMnemonic] = createSignal("");
  const [rotBusy, setRotBusy] = createSignal(false);
  const [rotError, setRotError] = createSignal<string | null>(null);
  const [rotVersion, setRotVersion] = createSignal<number | null>(null);
  const [rotNewMnemonic, setRotNewMnemonic] = createSignal<string | null>(null);
  const [rotCopied, setRotCopied] = createSignal(false);
  const [rotSkFile, setRotSkFile] = createSignal<File | null>(null);

  // ── Phrase tab handlers ──
  async function handleGenerate() {
    setPhraseError(null);
    setPhraseVerified(false);
    setPhraseCopied(false);
    try {
      const wasm = await import("../../generated/crypto-core/byos_crypto_core.js");
      const m: string = wasm.wasm_generate_mnemonic();
      setMnemonic(m);
    } catch (e) {
      setPhraseError(e instanceof Error ? e.message : "Failed to generate");
    }
  }

  async function handleCopy() {
    const m = mnemonic();
    if (!m) return;
    try {
      await navigator.clipboard.writeText(m);
      setPhraseCopied(true);
      setTimeout(() => setPhraseCopied(false), 2000);
    } catch {
      setPhraseError("Clipboard not available, please copy manually");
    }
  }

  async function handleVerify() {
    const m = mnemonic();
    if (!m) return;
    setPhraseError(null);
    try {
      const wasm = await import("../../generated/crypto-core/byos_crypto_core.js");
      const recovered: string = wasm.wasm_recover_root_secret(m);
      const kpJson: string = wasm.wasm_generate_keypair();
      const kp = JSON.parse(kpJson) as { secret_key: string; public_key: string };
      const testId = crypto.randomUUID().replace(/-/g, "");
      const wrapped: string = wasm.wasm_wrap_mailbox_key(recovered, kp.secret_key, testId);
      const unwrapped: string = wasm.wasm_unwrap_mailbox_key(recovered, wrapped, testId);
      if (unwrapped.toLowerCase() !== kp.secret_key.toLowerCase()) throw new Error("unwrap mismatch");
      const wrongId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
        b.toString(16).padStart(2, "0")
      ).join("");
      let shouldFail = false;
      try {
        wasm.wasm_unwrap_mailbox_key(recovered, wrapped, wrongId);
      } catch {
        shouldFail = true;
      }
      if (!shouldFail) throw new Error("wrong id should fail");
      setPhraseVerified(true);
    } catch (e) {
      setPhraseError(e instanceof Error ? e.message : "Verification failed");
      setPhraseVerified(false);
    }
  }

  // ── Enroll tab handler ──
  // Derives an Ed25519 public key from the mnemonic's entropy and registers it
  // with the server as the recovery verifier. The private key never leaves the
  // browser. The server stores only the public key.
  async function handleEnroll() {
    setEnrollError(null);
    const words = enrollMnemonic().trim();
    if (!words) {
      setEnrollError("Enter your recovery phrase.");
      return;
    }
    setEnrollBusy(true);
    try {
      const wasm = await import("../../generated/crypto-core/byos_crypto_core.js");

      // Recover the root secret from the mnemonic (deterministic, client-only).
      const rootHex: string = wasm.wasm_recover_root_secret(words);
      // Derive the Ed25519 recovery verifier. There is NO fallback here by
      // design: enrolling anything else (e.g. raw root material) would hand
      // the server key material instead of a public verifier.
      if (typeof wasm.wasm_recovery_auth_pk_from_root !== "function") {
        throw new Error("Crypto core too old: rebuild bindings for recovery enrollment.");
      }
      const pkHex: string = wasm.wasm_recovery_auth_pk_from_root(rootHex);

      // Convert hex → Uint8Array → base64 for the API.
      const pkBytes = new Uint8Array(pkHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
      const pkB64 = btoa(String.fromCharCode(...pkBytes));

      await enrollRecovery(pkB64);
      setEnrollDone(true);
      setEnrollMnemonic("");
    } catch (e) {
      setEnrollError(e instanceof Error ? e.message : "Enrollment failed.");
    } finally {
      setEnrollBusy(false);
    }
  }

  // ── Recover tab handler ──
  // Proves possession of the mnemonic-derived key without revealing it:
  // challenge → sign canonical message → verify → server session.
  // Restores ACCOUNT access only; mailbox keys are never involved.
  async function handleRecover() {
    setRecoverError(null);
    const email = recoverEmail().trim();
    const words = recoverMnemonic().trim();
    if (!email || !words) {
      setRecoverError("Enter your account email and recovery phrase.");
      return;
    }
    setRecoverBusy(true);
    try {
      const ch = await getRecoveryChallenge(email);
      const wasm = await import("../../generated/crypto-core/byos_crypto_core.js");
      const rootHex: string = wasm.wasm_recover_root_secret(words);
      if (typeof wasm.wasm_recovery_auth_sign !== "function") {
        throw new Error("Crypto core too old: rebuild bindings for account recovery.");
      }
      const msgHex = bytesToHex(new TextEncoder().encode(challengeMessage(ch.challenge_id)));
      const sigHex: string = wasm.wasm_recovery_auth_sign(rootHex, msgHex);
      await verifyRecovery(ch.challenge_id, bytesToBase64(hexToBytes(sigHex)));
      setRecoverDone(true);
      setRecoverMnemonic("");
    } catch (e) {
      setRecoverError(e instanceof Error ? e.message : "Recovery failed.");
      setRecoverDone(false);
    } finally {
      setRecoverBusy(false);
    }
  }

  async function handleChangePassword() {
    setPwError(null);
    const pw = newPassword();
    if (pw.length < 8 || pw.length > 128) {
      setPwError("Password must be 8-128 characters.");
      return;
    }
    setPwBusy(true);
    try {
      await changePassword(pw);
      setPwDone(true);
      setNewPassword("");
    } catch (e) {
      setPwError(e instanceof Error ? e.message : "Password change failed.");
    } finally {
      setPwBusy(false);
    }
  }

  // ── Rotate tab handlers ──
  // Root-only rotation for PRIVATE mailboxes: the caller proves possession
  // of the old root (unwrap must succeed), mints a fresh mnemonic, re-anchors
  // the same mailbox key under the new root, rotates server-side, then
  // re-enrolls the recovery verifier (it derives from the old root).
  // Org-managed rotation needs the org-recovery ceremony and is server-ready
  // but has no client flow yet — stated explicitly in the UI, not silently.
  async function handleLoadRotBox() {
    setRotError(null);
    setRotMode(null);
    const id = rotBoxId().trim();
    if (!id) {
      setRotError("Enter a mailbox ID.");
      return;
    }
    setRotLoading(true);
    try {
      const box = await getMailbox(id);
      setRotMode(box.mode);
    } catch (e) {
      setRotError(e instanceof Error ? e.message : "Mailbox lookup failed.");
    } finally {
      setRotLoading(false);
    }
  }

  function hexOfB64(b64: string): string {
    const bin = atob(b64.trim());
    return Array.from(bin, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  }

  function hexToB64(hex: string): string {
    const bytes = new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    return btoa(String.fromCharCode(...bytes));
  }

  async function handleRotate() {
    setRotError(null);
    const boxId = rotBoxId().trim();
    const words = rotMnemonic().trim();
    if (!boxId || !words || !orgId) {
      setRotError("Mailbox ID, current phrase, and organization context are required.");
      return;
    }
    setRotBusy(true);
    try {
      const wasm = await import("../../generated/crypto-core/byos_crypto_core.js");
      const box = await getMailbox(boxId);
      if (box.mode !== "private") {
        throw new Error("This client flow covers private mailboxes only; org-managed rotation needs the org-recovery ceremony.");
      }
      if (!box.mailbox_sk_wrapped) throw new Error("Mailbox wrapped key unavailable.");
      const mailboxIdHex = boxId.replace(/-/g, "");
      // Proof of possession: unwrap with the OLD root must succeed.
      const oldRoot: string = wasm.wasm_recover_root_secret(words);
      const skHex: string = wasm.wasm_unwrap_mailbox_key(oldRoot, hexOfB64(box.mailbox_sk_wrapped), mailboxIdHex);
      // Fresh root from a fresh mnemonic; re-anchor the SAME mailbox key.
      const newMnemonic: string = wasm.wasm_generate_mnemonic();
      const newRoot: string = wasm.wasm_recover_root_secret(newMnemonic);
      // Local sanity: the new wrap must open under the new root.
      const sanityWrap: string = wasm.wasm_wrap_mailbox_key(newRoot, skHex, mailboxIdHex);
      const sanityOpen: string = wasm.wasm_unwrap_mailbox_key(newRoot, sanityWrap, mailboxIdHex);
      if (sanityOpen.toLowerCase() !== skHex.toLowerCase()) throw new Error("Re-wrap sanity check failed.");
      const res = await rotateRoot(orgId, boxId);
      // The verifier derives from the OLD root: re-enroll with the new one.
      const newPkHex: string = wasm.wasm_recovery_auth_pk_from_root(newRoot);
      await enrollRecovery(hexToB64(newPkHex));
      setRotVersion(res.version);
      setRotNewMnemonic(newMnemonic);
      setRotMnemonic("");
    } catch (e) {
      setRotError(e instanceof Error ? e.message : "Rotation failed.");
      setRotVersion(null);
      setRotNewMnemonic(null);
    } finally {
      setRotBusy(false);
    }
  }

  async function handleRotCopy() {
    const m = rotNewMnemonic();
    if (!m) return;
    try {
      await navigator.clipboard.writeText(m);
      setRotCopied(true);
      setTimeout(() => setRotCopied(false), 2000);
    } catch {
      setRotError("Clipboard not available, please copy manually");
    }
  }

  // ── Principals tab state + handlers ──
  // Owner-only enrollment: the passphrase and org secret never leave the
  // browser; only the KDF envelope (plus pinned parameters) is uploaded.
  const [princList, setPrincList] = createSignal<RecoveryPrincipal[]>([]);
  const [princMembers, setPrincMembers] = createSignal<OrgMember[]>([]);
  const [princLoading, setPrincLoading] = createSignal(false);
  const [princError, setPrincError] = createSignal<string | null>(null);
  const [princNotice, setPrincNotice] = createSignal<string | null>(null);
  const [princUserId, setPrincUserId] = createSignal("");
  const [princName, setPrincName] = createSignal("");
  const [princPass, setPrincPass] = createSignal("");
  const [princFile, setPrincFile] = createSignal<File | null>(null);
  const [princBusy, setPrincBusy] = createSignal(false);

  async function refreshPrincipals() {
    if (!orgId) return;
    setPrincLoading(true);
    setPrincError(null);
    try {
      const [list, members] = await Promise.all([listPrincipals(orgId), getMembers()]);
      setPrincList(list);
      setPrincMembers(members);
      if (!princUserId() && members.length > 0) {
        const owner = members.find((m) => m.role === "owner") ?? members[0];
        setPrincUserId(owner.id);
      }
    } catch (e) {
      setPrincError(e instanceof Error ? e.message : "Failed to load principals.");
    } finally {
      setPrincLoading(false);
    }
  }

  function memberEmail(id: string): string {
    return princMembers().find((m) => m.id === id)?.email ?? id;
  }

  async function handleEnrollPrincipal() {
    setPrincError(null);
    setPrincNotice(null);
    const file = princFile();
    if (!orgId || !princUserId() || !princName().trim() || !file) {
      setPrincError("Member, principal name, and org secret file are required.");
      return;
    }
    if (princPass().length < 8 || princPass().length > 128) {
      setPrincError("Passphrase must be 8-128 characters.");
      return;
    }
    setPrincBusy(true);
    try {
      const wasm = await import("../../generated/crypto-core/byos_crypto_core.js");
      const skHex = (await file.text()).trim();
      if (!/^[0-9a-fA-F]{64}$/.test(skHex)) throw new Error("Secret file must hold 64 hex chars.");
      const salt = new Uint8Array(32);
      crypto.getRandomValues(salt);
      const saltHex = bytesToHex(salt.slice(0, 16));
      const wrappedHex: string = wasm.wasm_passphrase_wrap_key(princPass(), saltHex, skHex);
      // Local sanity: unwrap must round-trip before anything is uploaded.
      const checkHex: string = wasm.wasm_passphrase_unwrap_key(princPass(), saltHex, wrappedHex);
      if (checkHex.toLowerCase() !== skHex.toLowerCase()) throw new Error("Wrap sanity check failed.");
      // Record the org's canonical public key alongside (same key the secret
      // belongs to; the server cannot verify the pairing, the ceremony does).
      const orgRes = await fetch(`${(import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE || ""}/v1/organizations/${orgId}`, { credentials: "include" });
      if (!orgRes.ok) throw new Error("Could not read organization record.");
      const orgData = (await orgRes.json()) as { org_recovery_pk?: string };
      const orgPkB64: string | undefined = orgData.org_recovery_pk;
      if (!orgPkB64) throw new Error("Organization has no recovery public key.");
      // Public key half for the record (X25519 recipient key if hex, else omit).
      await enrollPrincipal(orgId, {
        user_id: princUserId(),
        principal_name: princName().trim(),
        kdf_algorithm: "argon2id",
        kdf_version: 1,
        kdf_salt: hexToB64(saltHex),
        kdf_memory: 65536,
        kdf_iterations: 3,
        kdf_parallelism: 2,
        org_recovery_sk_encrypted: hexToB64(wrappedHex),
        org_recovery_pk: orgPkB64,
      });
      setPrincNotice(`Principal "${princName().trim()}" enrolled.`);
      setPrincName("");
      setPrincPass("");
      setPrincFile(null);
      await refreshPrincipals();
    } catch (e) {
      setPrincError(e instanceof Error ? e.message : "Enrollment failed.");
    } finally {
      setPrincBusy(false);
    }
  }

  async function handleRevokePrincipal(id: string, name: string) {
    if (!orgId) return;
    if (!window.confirm(`Revoke recovery principal "${name}"? Enrolled material stays for audit; the principal can no longer be used.`)) return;
    setPrincError(null);
    try {
      await revokePrincipal(orgId, id);
      setPrincNotice(`Principal "${name}" revoked.`);
      await refreshPrincipals();
    } catch (e) {
      setPrincError(e instanceof Error ? e.message : "Revocation failed.");
    }
  }

  async function handleCopyEnvelope(id: string) {
    if (!orgId) return;
    setPrincError(null);
    try {
      const full = await getPrincipal(orgId, id);
      if (!full.org_recovery_sk_encrypted) throw new Error("No ciphertext on record.");
      await navigator.clipboard.writeText(full.org_recovery_sk_encrypted);
      setPrincNotice("Envelope copied — decrypt it locally with the principal passphrase.");
    } catch (e) {
      setPrincError(e instanceof Error ? e.message : "Copy failed.");
    }
  }

  // ── Org-managed rotation ceremony ──
  // Frozen §9: no mnemonic is shown to anyone. The admin holds the org
  // recovery secret (file), opens the current root through the recovery
  // endpoint, mints a fresh root from local entropy, seals it to the org
  // public key, re-anchors the same mailbox key, and rotates. Sanity opens
  // (seal + wrap) are verified locally before anything is sent.
  async function handleRotateOrgManaged() {
    setRotError(null);
    const boxId = rotBoxId().trim();
    const file = rotSkFile();
    if (!boxId || !file || !orgId) {
      setRotError("Mailbox ID, recovery secret file, and organization context are required.");
      return;
    }
    setRotBusy(true);
    try {
      const orgSkHex = (await file.text()).trim();
      if (!orgSkHex) throw new Error("Recovery secret file is empty.");
      const box = await getMailbox(boxId);
      if (box.mode !== "org_managed") {
        throw new Error("This ceremony is for org-managed mailboxes only.");
      }
      const wasm = await import("../../generated/crypto-core/byos_crypto_core.js");
      const skHex: string = await recoverMailboxSecret(orgId, boxId, orgSkHex);
      const entropy = new Uint8Array(32);
      crypto.getRandomValues(entropy);
      const entropyHex = Array.from(entropy, (b) => b.toString(16).padStart(2, "0")).join("");
      const newRoot: string = wasm.wasm_derive_root_secret(entropyHex);
      const mailboxIdHex = boxId.replace(/-/g, "");
      const orgPkHex = await fetchOrgRecoveryPkHex(orgId);
      const sealHex: string = wasm.wasm_hpke_seal(orgPkHex, newRoot, "");
      // Sanity: the seal must open under the same org secret, and the new
      // wrap must open under the new root.
      const openedRoot: string = wasm.wasm_hpke_open(orgSkHex, sealHex, "");
      if (openedRoot.toLowerCase() !== newRoot.toLowerCase()) throw new Error("Seal sanity check failed.");
      const newWrap: string = wasm.wasm_wrap_mailbox_key(newRoot, skHex, mailboxIdHex);
      const sanityOpen: string = wasm.wasm_unwrap_mailbox_key(newRoot, newWrap, mailboxIdHex);
      if (sanityOpen.toLowerCase() !== skHex.toLowerCase()) throw new Error("Re-wrap sanity check failed.");
      const res = await rotateRoot(orgId, boxId, sealHex);
      setRotVersion(res.version);
      setRotNewMnemonic(null);
      setRotSkFile(null);
    } catch (e) {
      setRotError(e instanceof Error ? e.message : "Rotation failed.");
      setRotVersion(null);
    } finally {
      setRotBusy(false);
    }
  }

  return (
    <div class="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div class="mb-6">
        <h1 class="text-2xl font-bold tracking-tight text-[#3C3D3E]">Recovery Material & Root Keys</h1>
        <p class="mt-1 text-sm text-[#6F7173]">
          Your zero-knowledge recovery phrase can restore your mailbox keys. Keep it safe and never share it.
          All cryptographic operations occur client-side; only derived public verifiers are enrolled.
        </p>
      </div>

      {/* Tab bar */}
      <div class="flex gap-1.5 rounded-xl border border-[#E2DFD8] bg-white p-1.5 w-fit flex-wrap shadow-2xs">
        {(["phrase", "enroll", "recover", "rotate", "principals"] as Tab[]).map((t) => (
          <button
            onClick={() => { setTab(t); if (t === "principals") { void refreshPrincipals(); } }}
            class={`rounded-lg px-4 py-2 text-xs sm:text-sm font-semibold transition-all ${
              tab() === t ? "bg-[#9E725F] text-white shadow-xs" : "text-[#6F7173] hover:text-[#3C3D3E] hover:bg-[#F3ECE8]/60"
            }`}
          >
            {t === "phrase"
              ? "Generate Phrase"
              : t === "enroll"
                ? "Enroll Recovery Key"
                : t === "recover"
                  ? "Recover Account"
                  : t === "rotate"
                    ? "Rotate Root"
                    : "Principals"}
          </button>
        ))}
      </div>

      {/* ── Generate Phrase tab ── */}
      <Show when={tab() === "phrase"}>
        <Show when={phraseError()}>
          <div role="alert" class="mt-4 rounded-xl bg-rose-50 border border-rose-200 p-3.5 text-xs text-rose-700">
            {phraseError()}
          </div>
        </Show>
        <div class="mt-4 rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs">
          <Show
            when={mnemonic()}
            fallback={
              <div>
                <p class="text-xs sm:text-sm text-[#6F7173]">No recovery phrase generated yet. Generated entirely in your browser — never sent to any server.</p>
                <button
                  onClick={handleGenerate}
                  class="mt-4 rounded-xl bg-[#9E725F] px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-xs hover:bg-[#865E4D] transition-colors"
                >
                  Generate recovery phrase
                </button>
              </div>
            }
          >
            {(m) => (
              <div>
                <p class="text-xs sm:text-sm font-bold text-[#3C3D3E]">Your recovery phrase (24 words):</p>
                <p class="mt-2 rounded-xl bg-[#F0EEE9]/60 border border-[#E2DFD8] p-4 font-mono text-xs sm:text-sm text-[#3C3D3E]" style="word-spacing: 0.25rem">
                  {m()}
                </p>
                <p class="mt-2 text-xs text-amber-800">Copy it now and store it securely. You will not be shown this again. Do not store it in email or cloud notes.</p>
                <div class="mt-4 flex flex-wrap gap-2.5">
                  <button onClick={handleCopy} class="rounded-xl bg-[#3C3D3E] px-4 py-2 text-xs sm:text-sm font-medium text-white hover:bg-[#2B2D30] transition-colors">
                    {phraseCopied() ? "Copied!" : "Copy to clipboard"}
                  </button>
                  <button onClick={handleVerify} class="rounded-xl bg-emerald-600 px-4 py-2 text-xs sm:text-sm font-medium text-white hover:bg-emerald-700 transition-colors">
                    Verify phrase can restore
                  </button>
                  <button
                    onClick={() => { setMnemonic(null); setPhraseVerified(false); }}
                    class="rounded-xl border border-[#E2DFD8] px-4 py-2 text-xs sm:text-sm font-medium text-[#3C3D3E] hover:bg-[#F3ECE8] transition-colors"
                  >
                    Clear
                  </button>
                </div>
                <Show when={phraseVerified()}>
                  <p class="mt-4 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs sm:text-sm text-emerald-800 font-medium">
                    ✓ Verified: phrase recovers the same root and can unwrap a test mailbox key. Wrong ID correctly fails.
                  </p>
                </Show>
              </div>
            )}
          </Show>
        </div>
      </Show>

      {/* ── Enroll Recovery Key tab ── */}
      <Show when={tab() === "enroll"}>
        <div class="mt-4 rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs">
          <Show when={enrollDone()}>
            <div class="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-xs sm:text-sm text-emerald-800">
              <p class="font-bold">Recovery key enrolled successfully.</p>
              <p class="mt-1">Your server now holds the public verifier derived from your phrase. If you lose your password, your phrase can prove your identity during recovery.</p>
            </div>
          </Show>
          <Show when={!enrollDone()}>
            <p class="text-xs sm:text-sm text-[#6F7173]">
              Enrolling your recovery key registers a public verifier on the server so you can prove your identity using your phrase without revealing it.
              Your phrase is only used locally — only the derived public key is sent to the server.
            </p>
            <Show when={enrollError()}>
              <div role="alert" class="mt-3 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
                {enrollError()}
              </div>
            </Show>
            <label class="mt-4 block">
              <span class="text-xs sm:text-sm font-semibold text-[#3C3D3E]">Your 24-word recovery phrase</span>
              <textarea
                rows={3}
                class="mt-1.5 block w-full rounded-xl border border-[#E2DFD8] bg-[#F0EEE9]/40 px-3.5 py-2.5 text-xs sm:text-sm font-mono text-[#3C3D3E] placeholder-[#6F7173] focus:outline-none focus:border-[#9E725F] focus:ring-1 focus:ring-[#9E725F]"
                placeholder="word1 word2 word3 … word24"
                value={enrollMnemonic()}
                onInput={(e) => setEnrollMnemonic(e.currentTarget.value)}
                disabled={enrollBusy()}
              />
            </label>
            <p class="mt-1.5 text-xs text-[#6F7173]">
              The phrase is processed entirely in your browser. Only the derived public key is sent to the server.
            </p>
            <button
              onClick={handleEnroll}
              disabled={enrollBusy() || !enrollMnemonic().trim()}
              aria-busy={enrollBusy()}
              class="mt-4 rounded-xl bg-[#9E725F] px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-xs hover:bg-[#865E4D] disabled:opacity-50 transition-colors"
            >
              {enrollBusy() ? "Enrolling…" : "Enroll recovery key"}
            </button>
          </Show>
        </div>
        <p class="mt-4 text-xs text-[#6F7173]">
          Security: your phrase never leaves your browser. Enrollment stores only the derived Ed25519 public verifier key. This key cannot reverse-derive your phrase or your root secret.
        </p>
      </Show>

      <p class="mt-4 text-xs text-[#6F7173]">
        Authentication (login) does not derive mailbox keys. Your mailbox encryption keys are separate from your login password.
      </p>

      {/* ── Recover Account tab ── */}
      <Show when={tab() === "recover"}>
        <div class="mt-4 rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs">
          <Show when={recoverDone()}>
            <div class="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-xs sm:text-sm text-emerald-800">
              <p class="font-bold">Identity verified — account access restored.</p>
              <p class="mt-1">Set a new password below to durably regain login. Your mailbox keys were never involved.</p>
            </div>
            <Show when={pwDone()}>
              <p class="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs sm:text-sm text-emerald-800 font-medium">
                ✓ Password updated. Other sessions were revoked; this session stays signed in.
              </p>
            </Show>
            <Show when={!pwDone()}>
              <Show when={pwError()}>
                <div role="alert" class="mt-3 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
                  {pwError()}
                </div>
              </Show>
              <label class="mt-4 block">
                <span class="text-xs sm:text-sm font-semibold text-[#3C3D3E]">New password (8-128 characters)</span>
                <input
                  type="password"
                  autocomplete="new-password"
                  class="mt-1.5 block w-full rounded-xl border border-[#E2DFD8] bg-[#F0EEE9]/40 px-3.5 py-2.5 text-xs sm:text-sm text-[#3C3D3E] placeholder-[#6F7173] focus:outline-none focus:border-[#9E725F] focus:ring-1 focus:ring-[#9E725F]"
                  value={newPassword()}
                  onInput={(e) => setNewPassword(e.currentTarget.value)}
                  disabled={pwBusy()}
                />
              </label>
              <button
                onClick={handleChangePassword}
                disabled={pwBusy() || newPassword().length < 8}
                aria-busy={pwBusy()}
                class="mt-4 rounded-xl bg-[#9E725F] px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-xs hover:bg-[#865E4D] disabled:opacity-50 transition-colors"
              >
                {pwBusy() ? "Updating…" : "Set new password"}
              </button>
            </Show>
          </Show>
          <Show when={!recoverDone()}>
            <p class="text-xs sm:text-sm text-[#6F7173]">
              Lost your password? Prove possession of your recovery phrase to restore account access.
              Your phrase is only used locally to sign a one-time server challenge — it is never sent anywhere.
            </p>
            <Show when={recoverError()}>
              <div role="alert" class="mt-3 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
                {recoverError()}
              </div>
            </Show>
            <label class="mt-4 block">
              <span class="text-xs sm:text-sm font-semibold text-[#3C3D3E]">Account email</span>
              <input
                type="email"
                autocomplete="username"
                class="mt-1.5 block w-full rounded-xl border border-[#E2DFD8] bg-[#F0EEE9]/40 px-3.5 py-2.5 text-xs sm:text-sm text-[#3C3D3E] placeholder-[#6F7173] focus:outline-none focus:border-[#9E725F] focus:ring-1 focus:ring-[#9E725F]"
                placeholder="you@example.com"
                value={recoverEmail()}
                onInput={(e) => setRecoverEmail(e.currentTarget.value)}
                disabled={recoverBusy()}
              />
            </label>
            <label class="mt-4 block">
              <span class="text-xs sm:text-sm font-semibold text-[#3C3D3E]">24-word recovery phrase</span>
              <textarea
                rows={3}
                autocomplete="off"
                class="mt-1.5 block w-full rounded-xl border border-[#E2DFD8] bg-[#F0EEE9]/40 px-3.5 py-2.5 text-xs sm:text-sm font-mono text-[#3C3D3E] placeholder-[#6F7173] focus:outline-none focus:border-[#9E725F] focus:ring-1 focus:ring-[#9E725F]"
                placeholder="word1 word2 word3 … word24"
                value={recoverMnemonic()}
                onInput={(e) => setRecoverMnemonic(e.currentTarget.value)}
                disabled={recoverBusy()}
              />
            </label>
            <button
              onClick={handleRecover}
              disabled={recoverBusy() || !recoverEmail().trim() || !recoverMnemonic().trim()}
              aria-busy={recoverBusy()}
              class="mt-4 rounded-xl bg-[#9E725F] px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-xs hover:bg-[#865E4D] disabled:opacity-50 transition-colors"
            >
              {recoverBusy() ? "Verifying…" : "Recover account"}
            </button>
          </Show>
        </div>
      </Show>

      {/* ── Rotate Root tab ── */}
      <Show when={tab() === "rotate"}>
        <div class="mt-4 rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs">
          <p class="text-xs sm:text-sm text-[#6F7173]">
            Replace a mailbox recovery root after compromise (or as hygiene). The mailbox key itself
            does not change, so existing messages keep decrypting; the old root is revoked, its
            device grants die, and private rotations re-enroll the recovery verifier automatically.
          </p>
          <Show when={rotError()}>
            <div role="alert" class="mt-3 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
              {rotError()}
            </div>
          </Show>
          <Show when={rotVersion() !== null}>
            <div class="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-xs sm:text-sm text-emerald-800">
              <p class="font-bold">Root rotated to version {rotVersion()}. Recovery verifier re-enrolled where applicable.</p>
              <Show when={rotNewMnemonic()}>
                <p class="mt-2 font-bold text-[#3C3D3E]">Your NEW recovery phrase (replaces the old one):</p>
              <p class="mt-2 rounded-xl bg-[#F0EEE9]/60 border border-[#E2DFD8] p-4 font-mono text-xs sm:text-sm text-[#3C3D3E]" style="word-spacing: 0.25rem">
                {rotNewMnemonic()}
              </p>
              <p class="mt-2 text-xs text-amber-800">Copy it now and store it securely. The old phrase no longer recovers this mailbox.</p>
              <div class="mt-3 flex gap-2.5">
                <button onClick={handleRotCopy} class="rounded-xl bg-[#3C3D3E] px-4 py-2 text-xs sm:text-sm font-medium text-white hover:bg-[#2B2D30] transition-colors">
                  {rotCopied() ? "Copied!" : "Copy to clipboard"}
                </button>
                <button
                  onClick={() => { setRotNewMnemonic(null); setRotVersion(null); setRotBoxId(""); setRotMode(null); setRotMnemonic(""); setRotSkFile(null); }}
                  class="rounded-xl border border-[#E2DFD8] px-4 py-2 text-xs sm:text-sm font-medium text-[#3C3D3E] hover:bg-[#F3ECE8] transition-colors"
                >
                  Clear
                </button>
              </div>
              </Show>
              <Show when={rotNewMnemonic() === null}>
                <p class="mt-2 text-xs text-[#6F7173]">
                  User recovery verifiers derived from the old root must be re-enrolled by their holders.
                  Device grants under the old root were revoked server-side.
                </p>
                <button
                  onClick={() => { setRotVersion(null); setRotBoxId(""); setRotMode(null); setRotSkFile(null); }}
                  class="mt-3 rounded-xl border border-[#E2DFD8] px-4 py-2 text-xs sm:text-sm font-medium text-[#3C3D3E] hover:bg-[#F3ECE8] transition-colors"
                >
                  Clear
                </button>
              </Show>
            </div>
          </Show>
          <Show when={rotVersion() === null}>
            <label class="mt-4 block">
              <span class="text-xs sm:text-sm font-semibold text-[#3C3D3E]">Mailbox ID</span>
              <input
                type="text"
                class="mt-1.5 block w-full rounded-xl border border-[#E2DFD8] bg-[#F0EEE9]/40 px-3.5 py-2.5 text-xs sm:text-sm font-mono text-[#3C3D3E] placeholder-[#6F7173] focus:outline-none focus:border-[#9E725F] focus:ring-1 focus:ring-[#9E725F]"
                placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                value={rotBoxId()}
                onInput={(e) => { setRotBoxId(e.currentTarget.value); setRotMode(null); }}
                disabled={rotBusy() || rotLoading()}
              />
            </label>
            <button
              onClick={handleLoadRotBox}
              disabled={rotLoading() || !rotBoxId().trim()}
              class="mt-3 rounded-xl border border-[#E2DFD8] px-4 py-2 text-xs sm:text-sm font-medium text-[#3C3D3E] hover:bg-[#F3ECE8] disabled:opacity-50 transition-colors"
            >
              {rotLoading() ? "Loading…" : "Check mailbox mode"}
            </button>
            <Show when={rotMode() !== null}>
              <p class="mt-3 text-xs sm:text-sm text-[#3C3D3E]">
                Mode: <span class="font-mono font-bold text-[#9E725F] uppercase">{rotMode()}</span>
              </p>
            </Show>
            <Show when={rotMode() === "private"}>
              <label class="mt-4 block">
                <span class="text-xs sm:text-sm font-semibold text-[#3C3D3E]">Current 24-word recovery phrase (proves possession)</span>
                <textarea
                  rows={3}
                  autocomplete="off"
                  class="mt-1.5 block w-full rounded-xl border border-[#E2DFD8] bg-[#F0EEE9]/40 px-3.5 py-2.5 text-xs sm:text-sm font-mono text-[#3C3D3E] placeholder-[#6F7173] focus:outline-none focus:border-[#9E725F] focus:ring-1 focus:ring-[#9E725F]"
                  placeholder="word1 word2 word3 … word24"
                  value={rotMnemonic()}
                  onInput={(e) => setRotMnemonic(e.currentTarget.value)}
                  disabled={rotBusy()}
                />
              </label>
              <p class="mt-1.5 text-xs text-[#6F7173]">
                A fresh phrase is generated for the new root. The old phrase stops working after rotation.
              </p>
              <button
                onClick={handleRotate}
                disabled={rotBusy() || !rotBoxId().trim() || !rotMnemonic().trim()}
                aria-busy={rotBusy()}
                class="mt-4 rounded-xl bg-[#9E725F] px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-xs hover:bg-[#865E4D] disabled:opacity-50 transition-colors"
              >
                {rotBusy() ? "Rotating…" : "Rotate root"}
              </button>
            </Show>
            <Show when={rotMode() !== null && rotMode() !== "private"}>
              <div class="mt-4 rounded-2xl border border-[#E2DFD8] bg-[#F0EEE9]/40 p-5">
                <p class="text-xs sm:text-sm text-[#6F7173] leading-relaxed">
                  Org-managed ceremony: provide the org recovery secret file. A fresh root is sealed
                  to the org public key — <span class="font-bold text-[#3C3D3E]">no mnemonic is shown to anyone</span> (frozen §9).
                </p>
                <label class="mt-3.5 block">
                  <span class="text-xs sm:text-sm font-semibold text-[#3C3D3E]">Org recovery secret (hex file)</span>
                  <input
                    type="file"
                    accept=".hex,.txt"
                    class="mt-1.5 block w-full text-xs text-[#6F7173] file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[#9E725F] file:text-white hover:file:bg-[#865E4D] file:cursor-pointer"
                    onChange={(e) => setRotSkFile(e.currentTarget.files?.[0] ?? null)}
                    disabled={rotBusy()}
                  />
                </label>
                <button
                  onClick={handleRotateOrgManaged}
                  disabled={rotBusy() || !rotBoxId().trim() || !rotSkFile()}
                  aria-busy={rotBusy()}
                  class="mt-4 rounded-xl bg-[#9E725F] px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-xs hover:bg-[#865E4D] disabled:opacity-50 transition-colors"
                >
                  {rotBusy() ? "Rotating…" : "Rotate org-managed root"}
                </button>
              </div>
            </Show>
          </Show>
        </div>
      </Show>

      {/* ── Principals tab (owner-only enrollment/revocation) ── */}
      <Show when={tab() === "principals"}>
        <div class="mt-4 rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs">
          <p class="text-xs sm:text-sm text-[#6F7173]">
            Recovery principals bind members to passphrase-wrapped copies of the org recovery
            secret. Enrollment and revocation require the organization owner role. The passphrase
            and secret never leave this browser — only the KDF envelope is uploaded.
          </p>
          <Show when={princError()}>
            <div role="alert" class="mt-3 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
              {princError()}
            </div>
          </Show>
          <Show when={princNotice()}>
            <div class="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-xs sm:text-sm text-emerald-800">
              {princNotice()}
            </div>
          </Show>
          <Show
            when={!princLoading()}
            fallback={<p class="mt-4 text-xs sm:text-sm text-[#6F7173]">Loading principals…</p>}
          >
            <Show
              when={princList().length > 0}
              fallback={<p class="mt-4 text-xs sm:text-sm text-[#6F7173]">No recovery principals enrolled.</p>}
            >
              <ul class="mt-4 divide-y divide-[#E2DFD8] rounded-xl border border-[#E2DFD8]">
                <For each={princList()}>
                  {(p) => (
                    <li class="flex items-center justify-between gap-3 p-3.5 hover:bg-[#F0EEE9]/30 transition-colors">
                      <div class="min-w-0">
                        <div class="text-xs sm:text-sm font-semibold text-[#3C3D3E]">
                          {p.principal_name}
                          <Show when={!p.is_active}>
                            <span class="ml-2 rounded bg-[#F0EEE9] px-2 py-0.5 text-[10px] font-bold text-[#6F7173] uppercase">revoked</span>
                          </Show>
                        </div>
                        <div class="truncate font-mono text-[11px] text-[#6F7173]">
                          {memberEmail(p.user_id)} · argon2id m={p.kdf_memory} t={p.kdf_iterations} p={p.kdf_parallelism}
                        </div>
                      </div>
                      <div class="flex shrink-0 gap-2">
                        <button
                          onClick={() => handleCopyEnvelope(p.id)}
                          class="rounded-lg border border-[#E2DFD8] px-3 py-1.5 text-xs font-medium text-[#3C3D3E] hover:bg-[#F3ECE8] transition-colors"
                        >
                          Copy envelope
                        </button>
                        <Show when={p.is_active}>
                          <button
                            onClick={() => handleRevokePrincipal(p.id, p.principal_name)}
                            class="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 transition-colors"
                          >
                            Revoke
                          </button>
                        </Show>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
          <div class="mt-6 border-t border-[#E2DFD8] pt-4">
            <h3 class="text-xs sm:text-sm font-bold text-[#3C3D3E]">Enroll Principal</h3>
            <label class="mt-3 block">
              <span class="text-xs font-semibold text-[#3C3D3E]">Member</span>
              <select
                class="mt-1.5 block w-full rounded-xl border border-[#E2DFD8] bg-[#F0EEE9]/40 px-3.5 py-2.5 text-xs sm:text-sm text-[#3C3D3E] focus:outline-none focus:border-[#9E725F] focus:ring-1 focus:ring-[#9E725F]"
                value={princUserId()}
                onInput={(e) => setPrincUserId(e.currentTarget.value)}
                disabled={princBusy()}
              >
                <For each={princMembers()}>{(m) => <option value={m.id}>{m.email} ({m.role})</option>}</For>
              </select>
            </label>
            <label class="mt-3 block">
              <span class="text-xs font-semibold text-[#3C3D3E]">Principal Name</span>
              <input
                type="text"
                class="mt-1.5 block w-full rounded-xl border border-[#E2DFD8] bg-[#F0EEE9]/40 px-3.5 py-2.5 text-xs sm:text-sm text-[#3C3D3E] placeholder-[#6F7173] focus:outline-none focus:border-[#9E725F] focus:ring-1 focus:ring-[#9E725F]"
                placeholder="e.g. alice-laptop"
                value={princName()}
                onInput={(e) => setPrincName(e.currentTarget.value)}
                disabled={princBusy()}
              />
            </label>
            <label class="mt-3 block">
              <span class="text-xs font-semibold text-[#3C3D3E]">New Passphrase (8-128 chars, never sent anywhere)</span>
              <input
                type="password"
                autocomplete="new-password"
                class="mt-1.5 block w-full rounded-xl border border-[#E2DFD8] bg-[#F0EEE9]/40 px-3.5 py-2.5 text-xs sm:text-sm font-mono text-[#3C3D3E] placeholder-[#6F7173] focus:outline-none focus:border-[#9E725F] focus:ring-1 focus:ring-[#9E725F]"
                value={princPass()}
                onInput={(e) => setPrincPass(e.currentTarget.value)}
                disabled={princBusy()}
              />
            </label>
            <label class="mt-3 block">
              <span class="text-xs font-semibold text-[#3C3D3E]">Org Recovery Secret (64-hex file)</span>
              <input
                type="file"
                accept=".hex,.txt"
                class="mt-1.5 block w-full text-xs text-[#6F7173] file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[#9E725F] file:text-white hover:file:bg-[#865E4D] file:cursor-pointer"
                onChange={(e) => setPrincFile(e.currentTarget.files?.[0] ?? null)}
                disabled={princBusy()}
              />
            </label>
            <button
              onClick={handleEnrollPrincipal}
              disabled={princBusy() || !princUserId() || !princName().trim() || !princFile()}
              aria-busy={princBusy()}
              class="mt-4 rounded-xl bg-[#9E725F] px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-xs hover:bg-[#865E4D] disabled:opacity-50 transition-colors"
            >
              {princBusy() ? "Enrolling…" : "Enroll principal"}
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default RecoveryPage;
