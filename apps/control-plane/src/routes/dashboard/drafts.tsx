import { Component, createResource, createSignal, For, Show } from "solid-js";
import { useAuth } from "../../lib/auth/context";
import { listMailboxes } from "../../lib/api/mailboxes";
import { createDraft, deleteDraft, Draft, listDrafts, updateDraft } from "../../lib/api/drafts";

const DraftsPage: Component = () => {
  const { orgId } = useAuth();
  const [selectedMailboxId, setSelectedMailboxId] = createSignal("");
  const [subject, setSubject] = createSignal("");
  const [recipient, setRecipient] = createSignal("");
  const [encryptedEnvelope, setEncryptedEnvelope] = createSignal("");
  const [editing, setEditing] = createSignal<Draft | null>(null);
  const [banner, setBanner] = createSignal<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = createSignal(false);

  const [mailboxes] = createResource(
    () => orgId,
    async (id) => (id ? listMailboxes(id) : []),
  );
  const [drafts, { refetch }] = createResource(
    selectedMailboxId,
    async (id) => (id ? listDrafts(id) : []),
  );

  function clearForm() {
    setSubject("");
    setRecipient("");
    setEncryptedEnvelope("");
    setEditing(null);
  }

  function editDraft(draft: Draft) {
    setEditing(draft);
    setSubject(draft.subject);
    setRecipient(draft.recipient);
    setEncryptedEnvelope(draft.encrypted_envelope);
    setBanner(null);
  }

  async function saveDraft() {
    const mailboxId = selectedMailboxId();
    if (!mailboxId || !encryptedEnvelope().trim()) return;
    setBusy(true);
    setBanner(null);
    try {
      if (editing()) {
        await updateDraft(mailboxId, editing()!.id, {
          subject: subject().trim(),
          recipient: recipient().trim(),
          encrypted_envelope: encryptedEnvelope().trim(),
          version: editing()!.version,
        });
        setBanner({ kind: "success", text: "Draft updated." });
      } else {
        await createDraft(mailboxId, {
          subject: subject().trim(),
          recipient: recipient().trim(),
          encrypted_envelope: encryptedEnvelope().trim(),
        });
        setBanner({ kind: "success", text: "Draft saved." });
      }
      clearForm();
      await refetch();
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      setBanner({
        kind: "error",
        text: status === 409 ? "This draft changed elsewhere. Reload it before saving." : "Unable to save draft.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeDraft(draft: Draft) {
    const mailboxId = selectedMailboxId();
    if (!mailboxId) return;
    setBusy(true);
    setBanner(null);
    try {
      await deleteDraft(mailboxId, draft.id);
      if (editing()?.id === draft.id) clearForm();
      await refetch();
      setBanner({ kind: "success", text: "Draft deleted." });
    } catch {
      setBanner({ kind: "error", text: "Unable to delete draft." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 class="text-2xl font-semibold text-slate-900">Drafts</h1>
      <p class="mt-1 text-sm text-slate-500">Draft metadata is visible here; encrypted message envelopes remain opaque to the service.</p>

      <Show when={banner()}>
        {(message) => (
          <div role="alert" class={`mt-4 rounded-md p-3 text-sm ${message().kind === "success" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
            {message().text}
          </div>
        )}
      </Show>

      <div class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <label class="block text-sm font-medium text-slate-700" for="draft-mailbox">Mailbox</label>
        <select id="draft-mailbox" class="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={selectedMailboxId()} onChange={(event) => { setSelectedMailboxId(event.currentTarget.value); clearForm(); }}>
          <option value="">Select mailbox</option>
          <For each={mailboxes() ?? []}>
            {(mailbox) => <option value={mailbox.id}>{mailbox.local_part} ({mailbox.mode})</option>}
          </For>
        </select>

        <Show when={selectedMailboxId()}>
          <div class="mt-5 grid gap-3">
            <input class="rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Subject metadata" value={subject()} onInput={(event) => setSubject(event.currentTarget.value)} />
            <input class="rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Recipient metadata" value={recipient()} onInput={(event) => setRecipient(event.currentTarget.value)} />
            <textarea class="min-h-24 rounded-md border border-slate-300 px-3 py-2 font-mono text-xs" placeholder="Base64 encrypted envelope" value={encryptedEnvelope()} onInput={(event) => setEncryptedEnvelope(event.currentTarget.value)} />
            <div class="flex gap-2">
              <button class="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={busy() || !encryptedEnvelope().trim()} onClick={saveDraft}>
                {editing() ? "Update draft" : "Save draft"}
              </button>
              <Show when={editing()}>
                <button class="rounded-md border border-slate-300 px-4 py-2 text-sm" onClick={clearForm}>Cancel</button>
              </Show>
            </div>
          </div>
        </Show>
      </div>

      <div class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-sm font-medium text-slate-900">Saved drafts</h2>
        <Show when={selectedMailboxId()} fallback={<p class="mt-3 text-sm text-slate-500">Select a mailbox to view drafts.</p>}>
          <Show when={!drafts.loading && (drafts() ?? []).length === 0}>
            <p class="mt-3 text-sm text-slate-500">No drafts yet.</p>
          </Show>
          <div class="mt-3 space-y-2">
            <For each={drafts() ?? []}>
              {(draft) => (
                <div class="flex items-center justify-between rounded-md border border-slate-200 p-3">
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-slate-900">{draft.subject || "(no subject)"}</p>
                    <p class="text-xs text-slate-500">{draft.recipient || "No recipient"} · version {draft.version}</p>
                  </div>
                  <div class="ml-3 flex shrink-0 gap-2">
                    <button class="text-sm text-sky-700 hover:underline" onClick={() => editDraft(draft)}>Edit</button>
                    <button class="text-sm text-red-700 hover:underline" onClick={() => removeDraft(draft)} disabled={busy()}>Delete</button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default DraftsPage;
