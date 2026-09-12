import { Component, createResource, createSignal, For, Show } from "solid-js";
import { getMembers, changeMemberRole, terminateUser, OrgMember, MemberRole } from "../../lib/api/members";
import { useOrg } from "../../context/OrgContext";

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

const MembersPage: Component = () => {
  const org = useOrg();
  const [members, { refetch }] = createResource<OrgMember[]>(() => getMembers());
  const [banner, setBanner] = createSignal<{ type: "ok" | "err"; msg: string } | null>(null);
  const [busy, setBusy] = createSignal<string | null>(null);

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
    } catch (e: any) {
      showBanner("err", e instanceof Error ? e.message : "Failed to change role.");
    } finally {
      setBusy(null);
    }
  }

  async function handleTerminate(member: OrgMember) {
    if (busy()) return;
    const reason = prompt(
      `Terminate ${member.email}? This disables their account and revokes all sessions immediately.\n\nEnter reason:`
    );
    if (!reason?.trim()) return;
    setBusy(member.id);
    try {
      await terminateUser(member.id, reason.trim());
      await refetch();
      showBanner("ok", `${member.email} has been terminated.`);
    } catch (e: any) {
      showBanner("err", e instanceof Error ? e.message : "Failed to terminate user.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div class="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div class="mb-8">
        <h1 class="text-2xl font-bold tracking-tight text-[#3C3D3E]">
          Organization Members & Access Control
        </h1>
        <p class="mt-1 text-sm text-[#6F7173]">
          Manage organizational members, elevate administrators, and revoke account credentials.
        </p>
      </div>

      <Show when={banner()}>
        {(b) => (
          <div
            role="alert"
            class={`mb-6 rounded-xl p-4 text-xs border ${
              b().type === "ok" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-800 border-red-200"
            }`}
          >
            {b().msg}
          </div>
        )}
      </Show>

      <div class="rounded-2xl border border-[#E2DFD8] bg-white shadow-xs overflow-hidden">
        <div class="p-6 border-b border-[#E2DFD8] flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold uppercase tracking-wider text-[#6F7173]">
              Active Members
            </span>
            <span class="rounded-full bg-[#F0EEE9] px-2 py-0.5 font-mono text-[11px] font-bold text-[#3C3D3E]">
              {(members() || []).length}
            </span>
          </div>

          <button
            type="button"
            onClick={() => refetch()}
            class="text-xs text-[#9E725F] hover:text-[#865E4D] font-medium hover:underline flex items-center gap-1"
          >
            <span>↻</span> Refresh
          </button>
        </div>

        <Show when={members.loading}>
          <div class="p-8 text-center text-xs text-[#6F7173]">Loading organization members…</div>
        </Show>

        <Show when={members.error}>
          <div class="p-8 text-center text-xs text-red-700">
            {members.error instanceof Error ? members.error.message : "Failed to load members."}
          </div>
        </Show>

        <Show when={members() && !members.loading}>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-[#E2DFD8]">
              <thead class="bg-[#F0EEE9]/60 font-semibold text-[#6F7173] text-xs">
                <tr>
                  <th class="px-6 py-3 text-left">User Identity</th>
                  <th class="px-6 py-3 text-left">Access Role</th>
                  <th class="px-6 py-3 text-left">Account Status</th>
                  <th class="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[#E2DFD8] bg-white text-xs text-[#3C3D3E]">
                <For each={members()}>
                  {(member) => (
                    <tr class={`hover:bg-[#F0EEE9]/30 transition-colors ${member.is_active ? "" : "opacity-50"}`}>
                      <td class="px-6 py-3.5">
                        <div class="font-medium text-[#3C3D3E]">{member.email}</div>
                        <Show when={member.display_name}>
                          <div class="text-[11px] text-[#6F7173]">{member.display_name}</div>
                        </Show>
                      </td>
                      <td class="px-6 py-3.5">
                        <span
                          class={`inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase ${
                            member.role === "owner"
                              ? "bg-[#F3ECE8] text-[#9E725F]"
                              : member.role === "admin"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-[#F0EEE9] text-[#6F7173]"
                          }`}
                        >
                          {ROLE_LABELS[member.role]}
                        </span>
                      </td>
                      <td class="px-6 py-3.5">
                        <span
                          class={`inline-flex items-center gap-1 font-semibold text-[11px] ${
                            member.is_active ? "text-emerald-700" : "text-[#6F7173]"
                          }`}
                        >
                          <span class={`w-1.5 h-1.5 rounded-full ${member.is_active ? "bg-emerald-500" : "bg-[#6F7173]"}`}></span>
                          {member.is_active ? "Active" : "Terminated"}
                        </span>
                      </td>
                      <td class="px-6 py-3.5 text-right space-x-2">
                        <Show when={member.is_active && member.role !== "owner" && org.isOwner}>
                          <select
                            aria-label={`Change role for ${member.email}`}
                            disabled={!!busy()}
                            class="rounded-lg border border-[#E2DFD8] bg-white text-xs px-2.5 py-1 text-[#3C3D3E] focus:border-[#9E725F] focus:outline-none"
                            onChange={(e) => {
                              const val = e.currentTarget.value as MemberRole;
                              if (val) handleRoleChange(member, val);
                              e.currentTarget.value = "";
                            }}
                          >
                            <option value="">Role…</option>
                            <option value="admin">→ Admin</option>
                            <option value="member">→ Member</option>
                            <option value="owner">→ Owner</option>
                          </select>
                          <button
                            disabled={!!busy()}
                            onClick={() => handleTerminate(member)}
                            class="rounded-lg border border-red-200 bg-red-50/50 text-xs px-2.5 py-1 font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors"
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
          </div>
        </Show>
      </div>
    </div>
  );
};

export default MembersPage;
