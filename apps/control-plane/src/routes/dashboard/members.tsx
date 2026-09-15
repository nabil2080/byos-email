import { Component, createResource, createSignal, For, Show } from "solid-js";
import {
  getMembers,
  changeMemberRole,
  terminateUser,
  inviteMember,
  OrgMember,
  MemberRole,
  InviteMemberResponse,
} from "../../lib/api/members";
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

  // Invite Admin Modal state
  const [inviteModalOpen, setInviteModalOpen] = createSignal(false);
  const [inviteEmail, setInviteEmail] = createSignal("");
  const [inviteDisplayName, setInviteDisplayName] = createSignal("");
  const [inviteRole, setInviteRole] = createSignal<"admin" | "member">("admin");
  const [invitePassword, setInvitePassword] = createSignal("");
  const [inviteBusy, setInviteBusy] = createSignal(false);
  const [inviteError, setInviteError] = createSignal<string | null>(null);

  // Created credentials popup
  const [createdUser, setCreatedUser] = createSignal<InviteMemberResponse | null>(null);
  const [copied, setCopied] = createSignal(false);

  // Filter state
  const [searchQuery, setSearchQuery] = createSignal("");
  const [activeTab, setActiveTab] = createSignal<"all" | "team" | "mailboxes">("team");

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

  async function handleInviteSubmit(e: Event) {
    e.preventDefault();
    const email = inviteEmail().trim();
    if (!email || !email.includes("@")) {
      setInviteError("Please enter a valid email address.");
      return;
    }
    setInviteBusy(true);
    setInviteError(null);
    try {
      const resp = await inviteMember({
        email,
        display_name: inviteDisplayName().trim() || undefined,
        role: inviteRole(),
        password: invitePassword().trim() || undefined,
      });
      setInviteModalOpen(false);
      setInviteEmail("");
      setInviteDisplayName("");
      setInvitePassword("");
      setCreatedUser(resp);
      await refetch();
      showBanner("ok", `User ${resp.email} successfully created.`);
    } catch (err: any) {
      setInviteError(err instanceof Error ? err.message : "Failed to invite administrator.");
    } finally {
      setInviteBusy(false);
    }
  }

  function handleCopyCredentials() {
    const user = createdUser();
    if (!user) return;
    const text = `BYOS Control Panel Credentials\nEmail: ${user.email}\nRole: ${user.role}\nTemporary Password: ${user.temp_password}\nSign-in URL: ${window.location.origin}/login`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  const filteredMembers = () => {
    const list = members() || [];
    const q = searchQuery().toLowerCase().trim();
    const tab = activeTab();

    return list.filter((m) => {
      // Tab filter
      if (tab === "team") {
        // Team includes owners, admins, or members without mailboxes
        if (m.role === "member" && m.has_mailbox) return false;
      } else if (tab === "mailboxes") {
        // Mailboxes includes users that have an active mailbox
        if (!m.has_mailbox) return false;
      }

      // Text search
      if (!q) return true;
      return (
        m.email.toLowerCase().includes(q) ||
        (m.display_name && m.display_name.toLowerCase().includes(q)) ||
        m.role.toLowerCase().includes(q)
      );
    });
  };

  const teamCount = () => (members() || []).filter((m) => m.role !== "member" || !m.has_mailbox).length;
  const mailboxCount = () => (members() || []).filter((m) => m.has_mailbox).length;

  return (
    <div class="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Page Header */}
      <div class="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-[#3C3D3E]">
            Team & Access Control
          </h1>
          <p class="mt-1 text-sm text-[#6F7173]">
            Manage organization administrators, team staff, and separate Control Panel users from mailbox accounts.
          </p>
        </div>

        <Show when={org.isOwner || org.isAdmin}>
          <button
            type="button"
            onClick={() => {
              setInviteError(null);
              setInviteModalOpen(true);
            }}
            class="inline-flex items-center justify-center gap-2 rounded-xl bg-[#9E725F] px-4 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-[#865E4D] transition-colors cursor-pointer shrink-0"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8" x2="19" y2="14" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
            <span>Invite Administrator</span>
          </button>
        </Show>
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

      {/* Main Container */}
      <div class="rounded-2xl border border-[#E2DFD8] bg-white shadow-xs overflow-hidden">
        {/* Toolbar & Segmented Tabs */}
        <div class="p-4 sm:p-6 border-b border-[#E2DFD8] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* Tabs */}
          <div class="inline-flex p-1 rounded-xl bg-[#F0EEE9] text-xs font-medium border border-[#E2DFD8]">
            <button
              type="button"
              onClick={() => setActiveTab("team")}
              class={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab() === "team"
                  ? "bg-white text-[#3C3D3E] shadow-2xs font-semibold"
                  : "text-[#6F7173] hover:text-[#3C3D3E]"
              }`}
            >
              <span>Control Panel Team</span>
              <span class="rounded-full bg-[#E2DFD8] px-1.5 py-0.2 text-[10px] font-mono">
                {teamCount()}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("mailboxes")}
              class={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab() === "mailboxes"
                  ? "bg-white text-[#3C3D3E] shadow-2xs font-semibold"
                  : "text-[#6F7173] hover:text-[#3C3D3E]"
              }`}
            >
              <span>Mailbox Users</span>
              <span class="rounded-full bg-[#E2DFD8] px-1.5 py-0.2 text-[10px] font-mono">
                {mailboxCount()}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("all")}
              class={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab() === "all"
                  ? "bg-white text-[#3C3D3E] shadow-2xs font-semibold"
                  : "text-[#6F7173] hover:text-[#3C3D3E]"
              }`}
            >
              <span>All Members</span>
              <span class="rounded-full bg-[#E2DFD8] px-1.5 py-0.2 text-[10px] font-mono">
                {(members() || []).length}
              </span>
            </button>
          </div>

          {/* Search & Refresh */}
          <div class="flex items-center gap-2">
            <div class="relative flex-1 sm:w-64">
              <input
                type="text"
                placeholder="Search by email, name..."
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                class="w-full rounded-xl border border-[#E2DFD8] bg-[#FAF9F6] pl-8 pr-3 py-1.5 text-xs text-[#3C3D3E] focus:border-[#9E725F] focus:outline-none"
              />
              <svg class="w-3.5 h-3.5 text-[#6F7173] absolute left-2.5 top-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>

            <button
              type="button"
              onClick={() => refetch()}
              title="Refresh member list"
              class="rounded-xl border border-[#E2DFD8] p-2 text-xs text-[#6F7173] hover:text-[#3C3D3E] hover:bg-[#F0EEE9] transition cursor-pointer"
            >
              ↻
            </button>
          </div>
        </div>

        {/* Loading state */}
        <Show when={members.loading}>
          <div class="p-12 text-center text-xs text-[#6F7173]">
            <div class="inline-block animate-spin w-5 h-5 border-2 border-[#9E725F] border-t-transparent rounded-full mb-2"></div>
            <div>Loading organization members…</div>
          </div>
        </Show>

        {/* Error state */}
        <Show when={members.error}>
          <div class="p-8 text-center text-xs text-red-700">
            {members.error instanceof Error ? members.error.message : "Failed to load members."}
          </div>
        </Show>

        {/* Members Table */}
        <Show when={members() && !members.loading}>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-[#E2DFD8]">
              <thead class="bg-[#F0EEE9]/60 font-semibold text-[#6F7173] text-xs">
                <tr>
                  <th class="px-6 py-3 text-left">Identity</th>
                  <th class="px-6 py-3 text-left">Account Type</th>
                  <th class="px-6 py-3 text-left">Access Role</th>
                  <th class="px-6 py-3 text-left">Status</th>
                  <th class="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[#E2DFD8] bg-white text-xs text-[#3C3D3E]">
                <For each={filteredMembers()}>
                  {(member) => (
                    <tr class={`hover:bg-[#F0EEE9]/30 transition-colors ${member.is_active ? "" : "opacity-50"}`}>
                      {/* Identity */}
                      <td class="px-6 py-4">
                        <div class="font-medium text-[#3C3D3E]">{member.email}</div>
                        <Show when={member.display_name}>
                          <div class="text-[11px] text-[#6F7173]">{member.display_name}</div>
                        </Show>
                      </td>

                      {/* Account Type */}
                      <td class="px-6 py-4">
                        <Show
                          when={member.has_mailbox}
                          fallback={
                            <span class="inline-flex items-center gap-1 text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md font-medium">
                              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                              </svg>
                              Control Panel Staff
                            </span>
                          }
                        >
                          <span class="inline-flex items-center gap-1 text-[11px] text-[#9E725F] bg-[#F3ECE8] border border-[#E2DFD8] px-2 py-0.5 rounded-md font-medium">
                            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <rect x="2" y="4" width="20" height="16" rx="2" />
                              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                            </svg>
                            Mailbox User
                          </span>
                        </Show>
                      </td>

                      {/* Access Role */}
                      <td class="px-6 py-4">
                        <span
                          class={`inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase ${
                            member.role === "owner"
                              ? "bg-[#F3ECE8] text-[#9E725F] border border-[#9E725F]/20"
                              : member.role === "admin"
                              ? "bg-amber-100 text-amber-800 border border-amber-200"
                              : "bg-[#F0EEE9] text-[#6F7173] border border-[#E2DFD8]"
                          }`}
                        >
                          {ROLE_LABELS[member.role]}
                        </span>
                      </td>

                      {/* Status */}
                      <td class="px-6 py-4">
                        <span
                          class={`inline-flex items-center gap-1 font-medium text-[11px] ${
                            member.is_active ? "text-emerald-700" : "text-[#6F7173]"
                          }`}
                        >
                          <span class={`w-1.5 h-1.5 rounded-full ${member.is_active ? "bg-emerald-500" : "bg-[#6F7173]"}`}></span>
                          {member.is_active ? "Active" : "Terminated"}
                        </span>
                      </td>

                      {/* Actions */}
                      <td class="px-6 py-4 text-right space-x-2">
                        <Show when={member.is_active && member.role !== "owner" && (org.isOwner || org.isAdmin)}>
                          {/* Role Selector */}
                          <select
                            aria-label={`Change role for ${member.email}`}
                            disabled={!!busy()}
                            value={member.role}
                            class="rounded-lg border border-[#E2DFD8] bg-white text-xs px-2.5 py-1 text-[#3C3D3E] focus:border-[#9E725F] focus:outline-none cursor-pointer"
                            onChange={(e) => {
                              const val = e.currentTarget.value as MemberRole;
                              if (val && val !== member.role) {
                                handleRoleChange(member, val);
                              }
                            }}
                          >
                            <option value="admin">Admin</option>
                            <option value="member">Member</option>
                            <Show when={org.isOwner}>
                              <option value="owner">Transfer Ownership</option>
                            </Show>
                          </select>

                          {/* Terminate Button */}
                          <button
                            disabled={!!busy()}
                            onClick={() => handleTerminate(member)}
                            class="rounded-lg border border-red-200 bg-red-50/50 text-xs px-2.5 py-1 font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors cursor-pointer"
                          >
                            {busy() === member.id ? "…" : "Terminate"}
                          </button>
                        </Show>

                        <Show when={member.has_mailbox}>
                          <a
                            href="/dashboard/mailboxes"
                            class="text-xs text-[#9E725F] hover:underline font-medium inline-block ml-2"
                          >
                            Mailbox →
                          </a>
                        </Show>
                      </td>
                    </tr>
                  )}
                </For>
                <Show when={filteredMembers().length === 0}>
                  <tr>
                    <td colspan="5" class="px-6 py-12 text-center text-xs text-[#6F7173]">
                      No accounts found matching this criteria.
                    </td>
                  </tr>
                </Show>
              </tbody>
            </table>
          </div>
        </Show>
      </div>

      {/* Invite Administrator Modal */}
      <Show when={inviteModalOpen()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#3C3D3E]/40 backdrop-blur-xs">
          <div class="w-full max-w-md bg-white rounded-2xl border border-[#E2DFD8] shadow-2xl p-6">
            <div class="flex items-center justify-between mb-4">
              <div>
                <h3 class="text-base font-semibold text-[#3C3D3E]">Invite Administrator</h3>
                <p class="text-xs text-[#6F7173] mt-0.5">
                  Create credentials for a Control Panel administrator or staff member.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInviteModalOpen(false)}
                class="text-[#6F7173] hover:text-[#3C3D3E] p-1 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <Show when={inviteError()}>
              <div role="alert" class="mb-4 rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                {inviteError()}
              </div>
            </Show>

            <form onSubmit={handleInviteSubmit} class="space-y-4">
              <div>
                <label class="block text-xs font-semibold text-[#3C3D3E] mb-1">
                  Email Address <span class="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  placeholder="admin@yourdomain.com"
                  value={inviteEmail()}
                  onInput={(e) => setInviteEmail(e.currentTarget.value)}
                  class="w-full rounded-xl border border-[#E2DFD8] bg-[#FAF9F6] px-3.5 py-2 text-xs text-[#3C3D3E] focus:border-[#9E725F] focus:outline-none"
                />
              </div>

              <div>
                <label class="block text-xs font-semibold text-[#3C3D3E] mb-1">
                  Full / Display Name (Optional)
                </label>
                <input
                  type="text"
                  placeholder="Jane Doe"
                  value={inviteDisplayName()}
                  onInput={(e) => setInviteDisplayName(e.currentTarget.value)}
                  class="w-full rounded-xl border border-[#E2DFD8] bg-[#FAF9F6] px-3.5 py-2 text-xs text-[#3C3D3E] focus:border-[#9E725F] focus:outline-none"
                />
              </div>

              <div>
                <label class="block text-xs font-semibold text-[#3C3D3E] mb-1">
                  Administrative Role
                </label>
                <select
                  value={inviteRole()}
                  onChange={(e) => setInviteRole(e.currentTarget.value as any)}
                  class="w-full rounded-xl border border-[#E2DFD8] bg-[#FAF9F6] px-3 py-2 text-xs text-[#3C3D3E] focus:border-[#9E725F] focus:outline-none cursor-pointer"
                >
                  <option value="admin">Administrator (Full Control Panel Management)</option>
                  <option value="member">Staff Member (Read-Only / Basic Access)</option>
                </select>
              </div>

              <div>
                <label class="block text-xs font-semibold text-[#3C3D3E] mb-1">
                  Initial Password (Optional)
                </label>
                <input
                  type="password"
                  placeholder="Leave blank to auto-generate a secure password"
                  value={invitePassword()}
                  onInput={(e) => setInvitePassword(e.currentTarget.value)}
                  class="w-full rounded-xl border border-[#E2DFD8] bg-[#FAF9F6] px-3.5 py-2 text-xs text-[#3C3D3E] focus:border-[#9E725F] focus:outline-none"
                />
                <p class="text-[11px] text-[#6F7173] mt-1">
                  If empty, a random high-entropy temporary password will be created for you to copy.
                </p>
              </div>

              <div class="mt-6 flex items-center justify-end gap-3 pt-3 border-t border-[#E2DFD8]">
                <button
                  type="button"
                  onClick={() => setInviteModalOpen(false)}
                  disabled={inviteBusy()}
                  class="rounded-xl border border-[#E2DFD8] px-4 py-2 text-xs font-medium text-[#6F7173] hover:bg-[#F0EEE9] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviteBusy()}
                  class="rounded-xl bg-[#9E725F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#865E4D] transition cursor-pointer disabled:opacity-50"
                >
                  {inviteBusy() ? "Creating Account…" : "Create & Reveal Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>

      {/* Account Created / Temporary Credentials Dialog */}
      <Show when={createdUser()}>
        {(user) => (
          <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#3C3D3E]/40 backdrop-blur-xs">
            <div class="w-full max-w-md bg-white rounded-2xl border border-[#E2DFD8] shadow-2xl p-6">
              <div class="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4">
                <svg class="w-6 h-6 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>

              <h3 class="text-base font-semibold text-[#3C3D3E]">Administrator Account Ready</h3>
              <p class="text-xs text-[#6F7173] mt-1">
                Provide these sign-in credentials to the administrator. They can sign into the Control Panel immediately at <span class="font-mono text-[#3C3D3E]">/login</span>.
              </p>

              <div class="mt-4 rounded-xl bg-[#FAF9F6] border border-[#E2DFD8] p-4 space-y-2 text-xs">
                <div class="flex justify-between">
                  <span class="text-[#6F7173]">Email:</span>
                  <span class="font-medium font-mono text-[#3C3D3E]">{user().email}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-[#6F7173]">Role:</span>
                  <span class="font-medium uppercase font-mono text-[#9E725F]">{user().role}</span>
                </div>
                <div class="flex justify-between items-center pt-2 border-t border-[#E2DFD8]">
                  <span class="text-[#6F7173]">Temporary Password:</span>
                  <span class="font-mono font-bold text-[#3C3D3E] bg-white border border-[#E2DFD8] px-2 py-0.5 rounded">
                    {user().temp_password}
                  </span>
                </div>
              </div>

              <div class="mt-6 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleCopyCredentials}
                  class="rounded-xl border border-[#E2DFD8] bg-white px-4 py-2 text-xs font-semibold text-[#3C3D3E] hover:bg-[#F0EEE9] transition cursor-pointer flex items-center gap-1.5"
                >
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  <span>{copied() ? "Copied to Clipboard!" : "Copy Credentials"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCreatedUser(null)}
                  class="rounded-xl bg-[#9E725F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#865E4D] transition cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
};

export default MembersPage;
