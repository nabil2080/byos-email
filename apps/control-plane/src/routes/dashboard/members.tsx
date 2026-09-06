import { Component, createResource, createSignal, For, Show } from "solid-js";
import { getMembers, changeMemberRole, terminateUser, OrgMember, MemberRole } from "../../lib/api/members";

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

const MembersPage: Component = () => {
  const [members, { refetch }] = createResource<OrgMember[]>(() => getMembers());
  const [banner, setBanner] = createSignal<{ type: "ok" | "err"; msg: string } | null>(null);
  const [busy, setBusy] = createSignal<string | null>(null); // target user id being actioned

  function showBanner(type: "ok" | "err", msg: string) {
    setBanner({ type, msg });
    setTimeout(() => setBanner(null), 4000);
  }

  async function handleRoleChange(member: OrgMember, newRole: MemberRole) {
    if (busy()) return;
    setBusy(member.id);
    try {
      await changeMemberRole(member.id, newRole);
      await refetch();
      showBanner("ok", `${member.email} is now ${ROLE_LABELS[newRole]}.`);
    } catch (e) {
      showBanner("err", e instanceof Error ? e.message : "Failed to change role.");
    } finally {
      setBusy(null);
    }
  }

  async function handleTerminate(member: OrgMember) {
    if (busy()) return;
    const reason = prompt(
      `Terminate ${member.email}? This disables their account and revokes all sessions immediately.\n\nEnter a reason (required):`
    );
    if (!reason?.trim()) return;
    setBusy(member.id);
    try {
      await terminateUser(member.id, reason.trim());
      await refetch();
      showBanner("ok", `${member.email} has been terminated.`);
    } catch (e) {
      showBanner("err", e instanceof Error ? e.message : "Failed to terminate user.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div class="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-semibold text-slate-900">Organization Members</h1>
          <p class="mt-1 text-sm text-slate-500">
            Manage who has access to your organization. Owners can change roles and terminate members.
          </p>
        </div>
      </div>

      <Show when={banner()}>
        {(b) => (
          <div
            role="alert"
            class={`mt-4 rounded-md p-3 text-sm ${
              b().type === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
            }`}
          >
            {b().msg}
          </div>
        )}
      </Show>

      <div class="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
        <Show when={members.loading}>
          <div class="p-6 text-sm text-slate-500 animate-pulse">Loading members…</div>
        </Show>
        <Show when={members.error}>
          <div class="p-6 text-sm text-red-700">
            {members.error instanceof Error ? members.error.message : "Failed to load members."}
          </div>
        </Show>
        <Show when={members() && !members.loading}>
          <table class="min-w-full divide-y divide-slate-200 text-sm">
            <thead class="bg-slate-50">
              <tr>
                <th class="px-6 py-3 text-left font-medium text-slate-500 uppercase tracking-wider">Member</th>
                <th class="px-6 py-3 text-left font-medium text-slate-500 uppercase tracking-wider">Role</th>
                <th class="px-6 py-3 text-left font-medium text-slate-500 uppercase tracking-wider">Status</th>
                <th class="px-6 py-3 text-right font-medium text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-slate-100">
              <For each={members()}>
                {(member) => (
                  <tr class={member.is_active ? "" : "opacity-50"}>
                    <td class="px-6 py-4">
                      <div class="font-medium text-slate-900">{member.email}</div>
                      <Show when={member.display_name}>
                        <div class="text-xs text-slate-500">{member.display_name}</div>
                      </Show>
                    </td>
                    <td class="px-6 py-4">
                      <span
                        class={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          member.role === "owner"
                            ? "bg-amber-100 text-amber-800"
                            : member.role === "admin"
                            ? "bg-sky-100 text-sky-800"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {ROLE_LABELS[member.role]}
                      </span>
                    </td>
                    <td class="px-6 py-4">
                      <span
                        class={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          member.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {member.is_active ? "Active" : "Terminated"}
                      </span>
                    </td>
                    <td class="px-6 py-4 text-right space-x-2">
                      <Show when={member.is_active && member.role !== "owner"}>
                        <select
                          aria-label={`Change role for ${member.email}`}
                          disabled={!!busy()}
                          class="rounded border border-slate-300 text-xs px-2 py-1 disabled:opacity-50"
                          onChange={(e) => {
                            const val = e.currentTarget.value as MemberRole;
                            if (val) handleRoleChange(member, val);
                            e.currentTarget.value = "";
                          }}
                        >
                          <option value="">Change role…</option>
                          <option value="admin">→ Admin</option>
                          <option value="member">→ Member</option>
                          <option value="owner">→ Owner</option>
                        </select>
                        <button
                          disabled={!!busy()}
                          onClick={() => handleTerminate(member)}
                          class="rounded border border-red-300 text-xs px-3 py-1 text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          {busy() === member.id ? "…" : "Terminate"}
                        </button>
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <Show when={members()?.length === 0}>
            <div class="p-6 text-sm text-slate-500">No members found.</div>
          </Show>
        </Show>
      </div>

      <p class="mt-4 text-xs text-slate-500">
        Only owners can change roles or terminate members. Termination is immediate and irrevocable via this interface — it disables the account and revokes all active sessions.
      </p>
    </div>
  );
};

export default MembersPage;
