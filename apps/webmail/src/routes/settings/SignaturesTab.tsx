import { Component, createSignal, onMount, For, Show } from "solid-js";
import {
  Mailbox,
  UserMe,
  MailboxAlias,
  fetchMailboxSettings,
  updateMailboxSettings,
  fetchMailboxAliases,
} from "../../api";
import { saveSignature } from "../../signature";
import { ProfileAvatar } from "../../components/ProfileAvatar";
import { RichTextEditor } from "../../components/RichTextEditor";
import DOMPurify from "dompurify";

interface SignaturesTabProps {
  mailbox: Mailbox;
  currentUser: UserMe | null;
}

export const SignaturesTab: Component<SignaturesTabProps> = (props) => {
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [savedSuccess, setSavedSuccess] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const [displayName, setDisplayName] = createSignal("");
  const [avatarUrl, setAvatarUrl] = createSignal("");
  const [avatarInputUrl, setAvatarInputUrl] = createSignal("");
  const [signaturePlain, setSignaturePlain] = createSignal("");
  const [signatureHtml, setSignatureHtml] = createSignal("");
  const [insertOnReply, setInsertOnReply] = createSignal(true);
  const [aliases, setAliases] = createSignal<MailboxAlias[]>([]);
  const [selectedSenderIdentity, setSelectedSenderIdentity] = createSignal("");

  let fileInputRef: HTMLInputElement | undefined;

  const primaryEmail = () => {
    const domain = props.currentUser?.email.split("@")[1] || "byos.local";
    return `${props.mailbox.local_part}@${domain}`;
  };

  function saveAvatarLocally(url: string) {
    const email = primaryEmail().toLowerCase().trim();
    if (url) {
      localStorage.setItem("byos_avatar_" + email, url);
      localStorage.setItem("byos_avatar_" + props.mailbox.id, url);
    } else {
      localStorage.removeItem("byos_avatar_" + email);
      localStorage.removeItem("byos_avatar_" + props.mailbox.id);
    }
    // Notify same-window listeners
    window.dispatchEvent(new Event("storage"));
  }

  function handleAvatarFileUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];

    const reader = new FileReader();
    reader.onload = (event) => {
      const src = event.target?.result as string;
      if (!src) return;

      const img = new Image();
      img.onload = () => {
        const maxDim = 128;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          const downscaled = canvas.toDataURL("image/jpeg", 0.85);
          setAvatarUrl(downscaled);
          setAvatarInputUrl(downscaled.startsWith("data:") ? "" : downscaled);
          saveAvatarLocally(downscaled);
        }
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
    input.value = "";
  }

  function handleAvatarUrlChange(url: string) {
    const trimmed = url.trim();
    setAvatarInputUrl(trimmed);
    setAvatarUrl(trimmed);
    saveAvatarLocally(trimmed);
  }

  function removeAvatar() {
    setAvatarUrl("");
    setAvatarInputUrl("");
    saveAvatarLocally("");
  }

  onMount(async () => {
    try {
      setLoading(true);
      const [settings, aliasList] = await Promise.all([
        fetchMailboxSettings(props.mailbox.id),
        fetchMailboxAliases(props.mailbox.id),
      ]);

      setDisplayName(settings.display_name || "");
      setSignaturePlain(settings.signature_plain || "");
      const initialHtml =
        settings.signature_html ||
        settings.signature_plain?.replace(/\n/g, "<br/>") ||
        "";
      setSignatureHtml(DOMPurify.sanitize(initialHtml));
      setInsertOnReply(settings.insert_signature_on_reply);
      setAliases(aliasList);
      setSelectedSenderIdentity(primaryEmail());

      // Load avatar from settings or local storage
      const email = primaryEmail().toLowerCase().trim();
      const localAvatar =
        settings.avatar_url ||
        localStorage.getItem("byos_avatar_" + email) ||
        localStorage.getItem("byos_avatar_" + props.mailbox.id) ||
        "";
      if (localAvatar) {
        setAvatarUrl(localAvatar);
        if (!localAvatar.startsWith("data:")) {
          setAvatarInputUrl(localAvatar);
        }
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load mailbox settings.");
    } finally {
      setLoading(false);
    }
  });

  async function handleSave(e: Event) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      saveAvatarLocally(avatarUrl());
      await updateMailboxSettings(props.mailbox.id, {
        display_name: displayName().trim(),
        signature_plain: signaturePlain(),
        signature_html: DOMPurify.sanitize(signatureHtml()),
        insert_signature_on_reply: insertOnReply(),
        avatar_url: avatarUrl(),
      });
      saveSignature(props.mailbox.id, signaturePlain());
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err: any) {
      setError(err?.message || "Failed to save signature settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="space-y-6">
      <div>
        <h3 class="text-lg font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Identities, Photo & Signatures</h3>
        <p class="text-xs text-[#55575B] dark:text-[#A1A1AA] mt-1">
          Customize your sender profile picture, display name, and rich email signature.
        </p>
      </div>

      <Show when={error()}>
        <div class="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between">
          <span>{error()}</span>
          <button
            onClick={() => setError(null)}
            class="text-rose-500 hover:text-rose-800 dark:hover:text-rose-200 p-1 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/40 transition cursor-pointer"
            aria-label="Dismiss error"
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </Show>

      <Show when={savedSuccess()}>
        <div class="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
          <svg class="w-4 h-4 stroke-emerald-600 dark:stroke-emerald-400 fill-none stroke-2 flex-shrink-0" viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>Your identity and signature preferences have been saved.</span>
        </div>
      </Show>

      <Show when={loading()}>
        <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-8 border border-[#E2DFD8] dark:border-[#2E3138] text-center">
          <div class="inline-block animate-spin w-6 h-6 border-2 border-[#A27561] border-t-transparent rounded-full mb-2"></div>
          <p class="text-xs text-[#55575B] dark:text-[#A1A1AA]">Loading identity settings…</p>
        </div>
      </Show>

      <Show when={!loading()}>
        <form onSubmit={handleSave} class="space-y-6">
          {/* Profile Photo Card */}
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-4">
            <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
              Profile Photo
            </h4>

            <div class="flex flex-col sm:flex-row items-start sm:items-center gap-5">
              <ProfileAvatar
                email={primaryEmail()}
                displayName={displayName()}
                avatarUrl={avatarUrl()}
                size="lg"
                class="ring-4 ring-[#F2E8E2] dark:ring-[#2D2522] shadow-sm flex-shrink-0"
              />

              <div class="flex-1 space-y-3 min-w-0 w-full">
                <div class="flex flex-wrap items-center gap-2.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={handleAvatarFileUpload}
                    class="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef?.click()}
                    class="px-3.5 py-1.5 rounded-xl bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-semibold transition cursor-pointer shadow-2xs flex items-center gap-1.5"
                  >
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <span>Upload Photo</span>
                  </button>

                  <Show when={avatarUrl()}>
                    <button
                      type="button"
                      onClick={removeAvatar}
                      class="px-3 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                    >
                      Remove Photo
                    </button>
                  </Show>
                </div>

                <div class="flex items-center gap-2 max-w-md">
                  <input
                    type="url"
                    placeholder="Or paste image URL (e.g. https://…)"
                    value={avatarInputUrl()}
                    onInput={(e) => handleAvatarUrlChange(e.currentTarget.value)}
                    class="flex-1 px-3 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] placeholder-[#878A8E] dark:placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#A27561]"
                  />
                </div>

                <p class="text-[11px] text-[#55575B] dark:text-[#A1A1AA]">
                  Uploaded photos are automatically optimized to 128x128px (~20KB) for sovereign local rendering.
                </p>
              </div>
            </div>
          </div>

          {/* Sender Identity Card */}
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-4">
            <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
              Sender Identity
            </h4>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Jane Doe"
                  value={displayName()}
                  onInput={(e) => setDisplayName(e.currentTarget.value)}
                  class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-1 focus:ring-[#A27561] focus:bg-white dark:focus:bg-[#1E2025] transition"
                />
                <p class="text-[11px] text-[#55575B] dark:text-[#A1A1AA] mt-1">
                  Appears in the "From" header alongside your email address.
                </p>
              </div>

              <div>
                <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                  Active Address / Aliases
                </label>
                <select
                  value={selectedSenderIdentity()}
                  onChange={(e) => setSelectedSenderIdentity(e.currentTarget.value)}
                  class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-1 focus:ring-[#A27561] focus:bg-white dark:focus:bg-[#1E2025] transition"
                >
                  <option value={primaryEmail()}>
                    {primaryEmail()} (Primary)
                  </option>
                  <For each={aliases()}>
                    {(alias) => {
                      const aliasAddr = `${alias.local_part}@${props.currentUser?.email.split("@")[1] || "byos.local"}`;
                      return <option value={aliasAddr}>{aliasAddr} (Alias)</option>;
                    }}
                  </For>
                </select>
                <p class="text-[11px] text-[#55575B] dark:text-[#A1A1AA] mt-1">
                  Mailbox address routed through BYOS sovereign delivery.
                </p>
              </div>
            </div>
          </div>

          {/* Rich Signature Editor Card */}
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
                  Email Signature
                </h4>
                <p class="text-[11px] text-[#55575B] dark:text-[#A1A1AA] mt-0.5">
                  Appended to outbound messages and replies. Supports rich text, links, and logos.
                </p>
              </div>
              <span class="text-[11px] font-mono text-[#A27561] dark:text-[#D4A38F] bg-[#F3ECE8] dark:bg-[#2D2522] px-2 py-0.5 rounded">
                WYSIWYG Ribbon
              </span>
            </div>

            {/* Unified RichTextEditor Component */}
            <RichTextEditor
              value={signatureHtml()}
              placeholder="Best regards,<br/>Jane Doe"
              onChange={({ html, text }) => {
                setSignatureHtml(html);
                setSignaturePlain(text);
              }}
              minHeight="140px"
              maxHeight="320px"
              showHtmlToggle={true}
            />

            <div class="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="insertOnReply"
                checked={insertOnReply()}
                onChange={(e) => setInsertOnReply(e.currentTarget.checked)}
                class="w-4 h-4 rounded text-[#A27561] accent-[#A27561] border-[#E2DFD8] dark:border-[#2E3138]"
              />
              <label for="insertOnReply" class="text-xs font-medium text-[#1A1B1E] dark:text-[#F3F4F6] cursor-pointer">
                Automatically append signature when composing new messages and replying
              </label>
            </div>

            {/* Live Preview */}
            <Show when={signatureHtml().trim() || signaturePlain().trim()}>
              <div class="mt-5 pt-4 border-t border-[#E2DFD8] dark:border-[#2E3138]">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-[11px] font-bold text-[#55575B] dark:text-[#A1A1AA] uppercase tracking-wider font-mono">
                    Live Preview
                  </span>
                  <span class="text-[10px] text-[#878A8E] dark:text-[#71717A] font-mono">Recipient View</span>
                </div>
                <div class="p-4 bg-[#F8F7F4] dark:bg-[#18191D] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] space-y-2">
                  <div class="text-[#55575B] dark:text-[#A1A1AA] text-[11px] font-mono">
                    From: <span class="text-[#1A1B1E] dark:text-[#F3F4F6] font-medium">{displayName() ? `${displayName()} <${selectedSenderIdentity()}>` : selectedSenderIdentity()}</span>
                  </div>
                  <div class="text-[#878A8E] dark:text-[#71717A] text-xs">--</div>
                  <div
                    class="prose prose-xs max-w-none text-xs text-[#1A1B1E] dark:text-[#F3F4F6] leading-relaxed break-words"
                    innerHTML={DOMPurify.sanitize(signatureHtml()) || "<span class='text-[#878A8E] italic'>No signature configured</span>"}
                  />
                </div>
              </div>
            </Show>
          </div>

          {/* Action Bar */}
          <div class="flex items-center justify-end gap-3 pt-2">
            <button
              type="submit"
              disabled={saving()}
              class="px-5 py-2.5 rounded-xl bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-semibold transition disabled:opacity-50 flex items-center gap-2 shadow-xs cursor-pointer"
            >
              <Show when={saving()}>
                <div class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              </Show>
              <span>{saving() ? "Saving Changes…" : "Save Preferences"}</span>
            </button>
          </div>
        </form>
      </Show>
    </div>
  );
};
