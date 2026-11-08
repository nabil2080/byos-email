import { Component, createSignal, onMount, Show } from "solid-js";
import {
  Mailbox,
  UserMe,
  fetchMailboxSettings,
  updateMailboxSettings,
} from "../../api";
import { saveSignature, saveSignatureHtml } from "../../signature";
import { RichTextEditor } from "../../components/RichTextEditor";
import { t } from "../../utils/i18n";
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

  const [signaturePlain, setSignaturePlain] = createSignal("");
  const [signatureHtml, setSignatureHtml] = createSignal("");
  const [insertOnReply, setInsertOnReply] = createSignal(true);

  const primaryEmail = () => {
    const domain = props.currentUser?.email?.split("@")[1] || "byos.local";
    return `${props.mailbox.local_part}@${domain}`;
  };

  const senderDisplayName = () => {
    return props.currentUser?.display_name || props.mailbox.local_part;
  };

  onMount(async () => {
    try {
      setLoading(true);
      const settings = await fetchMailboxSettings(props.mailbox.id);

      setSignaturePlain(settings.signature_plain || "");
      const initialHtml =
        settings.signature_html ||
        settings.signature_plain?.replace(/\n/g, "<br/>") ||
        "";
      setSignatureHtml(DOMPurify.sanitize(initialHtml, { FORCE_BODY: true, FORBID_TAGS: ['style', 'head', 'meta'] }));
      setInsertOnReply(settings.insert_signature_on_reply);

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
      await updateMailboxSettings(props.mailbox.id, {
        signature_plain: signaturePlain(),
        signature_html: DOMPurify.sanitize(signatureHtml()),
        insert_signature_on_reply: insertOnReply(),
      });
      saveSignature(props.mailbox.id, signaturePlain());
      saveSignatureHtml(props.mailbox.id, DOMPurify.sanitize(signatureHtml()));
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
        <h3 class="text-lg font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">{t("Signatures")}</h3>
        <p class="text-xs text-[#6E7075] dark:text-[#878A8E] mt-1">
          {t("Customize your rich email signatures, formatting, and automatic reply defaults.")}
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
          <span>{t("Your signature preferences have been saved.")}</span>
        </div>
      </Show>

      <Show when={loading()}>
        <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-8 border border-[#E2DFD8] dark:border-[#2E3138] text-center">
          <div class="inline-block animate-spin w-6 h-6 border-2 border-[#A27561] border-t-transparent rounded-full mb-2"></div>
          <p class="text-xs text-[#55575B] dark:text-[#A1A1AA]">{t("Loading signature settings…")}</p>
        </div>
      </Show>

      <Show when={!loading()}>
        <form onSubmit={handleSave} class="space-y-6">
          {/* Rich Signature Editor Card */}
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
                  {t("Email Signature")}
                </h4>
                <p class="text-[11px] text-[#55575B] dark:text-[#A1A1AA] mt-0.5">
                  {t("Appended to outbound messages and replies. Supports rich text, links, and logos.")}
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
                {t("Automatically append signature when composing new messages and replying")}
              </label>
            </div>

            {/* Live Preview */}
            <Show when={signatureHtml().trim() || signaturePlain().trim()}>
              <div class="mt-5 pt-4 border-t border-[#E2DFD8] dark:border-[#2E3138]">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-[11px] font-bold text-[#55575B] dark:text-[#A1A1AA] uppercase tracking-wider font-mono">
                    {t("Live Preview")}
                  </span>
                  <span class="text-[10px] text-[#878A8E] dark:text-[#71717A] font-mono">{t("Recipient View")}</span>
                </div>
                <div class="p-4 bg-[#F8F7F4] dark:bg-[#18191D] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] space-y-2">
                  <div class="text-[#55575B] dark:text-[#A1A1AA] text-[11px] font-mono">
                    From: <span class="text-[#1A1B1E] dark:text-[#F3F4F6] font-medium">{senderDisplayName() ? `${senderDisplayName()} <${primaryEmail()}>` : primaryEmail()}</span>
                  </div>
                  <div class="text-[#878A8E] dark:text-[#71717A] text-xs">--</div>
                  <div
                    class="reading-pane-content prose prose-xs max-w-none text-xs text-[#1A1B1E] dark:text-[#F3F4F6] leading-relaxed break-words"
                    innerHTML={DOMPurify.sanitize(signatureHtml(), { FORCE_BODY: true, FORBID_TAGS: ['style', 'head', 'meta'] }) || "<span class='text-[#878A8E] italic'>No signature configured</span>"}
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
              data-testid="save-signature-btn"
              class="px-5 py-2.5 rounded-xl bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-semibold transition disabled:opacity-50 flex items-center gap-2 shadow-xs cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#A27561]/40"
            >
              <Show when={saving()}>
                <div class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              </Show>
              <span>{saving() ? t("Saving Changes…") : t("Save Signature")}</span>
            </button>
          </div>
        </form>
      </Show>
    </div>
  );
};
