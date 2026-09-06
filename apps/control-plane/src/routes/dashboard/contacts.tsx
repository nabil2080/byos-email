import { Component, createResource, createSignal, For, Show } from "solid-js";
import { useAuth } from "../../lib/auth/context";
import { listMailboxes } from "../../lib/api/mailboxes";
import { Contact, createContact, deleteContact, listContacts, updateContact } from "../../lib/api/contacts";

const ContactsPage: Component = () => {
  const { orgId } = useAuth();
  const [mailboxId, setMailboxId] = createSignal("");
  const [envelope, setEnvelope] = createSignal("");
  const [editing, setEditing] = createSignal<Contact | null>(null);
  const [message, setMessage] = createSignal("");
  const [mailboxes] = createResource(() => orgId, (id) => (id ? listMailboxes(id) : []));
  const [contacts, { refetch }] = createResource(mailboxId, (id) => (id ? listContacts(id) : []));

  function clear() {
    setEnvelope("");
    setEditing(null);
  }

  async function save() {
    if (!mailboxId() || !envelope().trim()) return;
    try {
      if (editing()) await updateContact(mailboxId(), editing()!, envelope().trim());
      else await createContact(mailboxId(), envelope().trim());
      clear();
      await refetch();
      setMessage("Contact saved.");
    } catch {
      setMessage("Unable to save contact.");
    }
  }

  async function remove(contact: Contact) {
    try {
      await deleteContact(mailboxId(), contact.id);
      if (editing()?.id === contact.id) clear();
      await refetch();
      setMessage("Contact deleted.");
    } catch {
      setMessage("Unable to delete contact.");
    }
  }

  return (
    <div class="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 class="text-2xl font-semibold text-slate-900">Contacts</h1>
      <p class="mt-1 text-sm text-slate-500">Contact records remain client-encrypted and opaque to the service.</p>
      <Show when={message()}><div role="alert" class="mt-4 rounded-md bg-slate-100 p-3 text-sm text-slate-700">{message()}</div></Show>
      <div class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <label class="block text-sm font-medium text-slate-700" for="contact-mailbox">Mailbox</label>
        <select id="contact-mailbox" class="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={mailboxId()} onChange={(event) => { setMailboxId(event.currentTarget.value); clear(); }}>
          <option value="">Select mailbox</option>
          <For each={mailboxes() ?? []}>{(mailbox) => <option value={mailbox.id}>{mailbox.local_part} ({mailbox.mode})</option>}</For>
        </select>
        <Show when={mailboxId()}>
          <div class="mt-5 grid gap-3">
            <textarea class="min-h-24 rounded-md border border-slate-300 px-3 py-2 font-mono text-xs" placeholder="Base64 encrypted envelope" value={envelope()} onInput={(event) => setEnvelope(event.currentTarget.value)} />
            <div class="flex gap-2">
              <button class="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!envelope().trim()} onClick={save}>{editing() ? "Update contact" : "Save contact"}</button>
              <Show when={editing()}><button class="rounded-md border border-slate-300 px-4 py-2 text-sm" onClick={clear}>Cancel</button></Show>
            </div>
          </div>
        </Show>
      </div>
      <div class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-sm font-medium text-slate-900">Saved contacts</h2>
        <Show when={mailboxId()} fallback={<p class="mt-3 text-sm text-slate-500">Select a mailbox to view contacts.</p>}>
          <div class="mt-3 space-y-2">
            <For each={contacts() ?? []}>{(contact) => <div class="flex items-center justify-between rounded-md border border-slate-200 p-3"><span class="text-xs text-slate-500">Encrypted contact · version {contact.version}</span><span class="flex gap-2"><button class="text-sm text-sky-700 hover:underline" onClick={() => { setEditing(contact); setEnvelope(contact.encrypted_envelope); }}>Edit</button><button class="text-sm text-red-700 hover:underline" onClick={() => remove(contact)}>Delete</button></span></div>}</For>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default ContactsPage;
