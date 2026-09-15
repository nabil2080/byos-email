import { apiBase, getCpHeaders } from "./client";

export interface OrgMember {
  id: string;
  email: string;
  display_name: string;
  role: "owner" | "admin" | "member";
  is_active: boolean;
  has_mailbox?: boolean;
}

export type MemberRole = "owner" | "admin" | "member";

export interface InviteMemberRequest {
  email: string;
  role: "admin" | "member";
  display_name?: string;
  password?: string;
}

export interface InviteMemberResponse {
  id: string;
  email: string;
  display_name: string;
  role: string;
  temp_password: string;
  success: boolean;
}

export async function getMembers(): Promise<OrgMember[]> {
  const res = await fetch(`${apiBase()}/v1/auth/organization-members`, {
    headers: getCpHeaders(),
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `List members failed ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const data = (await res.json()) as { members: OrgMember[] };
  return data.members;
}

export async function inviteMember(req: InviteMemberRequest): Promise<InviteMemberResponse> {
  const res = await fetch(`${apiBase()}/v1/auth/organization-members`, {
    method: "POST",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Invite member failed ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as InviteMemberResponse;
}

export async function changeMemberRole(targetUserId: string, newRole: MemberRole): Promise<void> {
  const res = await fetch(`${apiBase()}/v1/auth/change-member-role`, {
    method: "PATCH",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ target_user_id: targetUserId, new_role: newRole }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Change role failed ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
}

export async function terminateUser(targetUserId: string, reason: string): Promise<void> {
  const res = await fetch(`${apiBase()}/v1/auth/terminate-user`, {
    method: "DELETE",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ target_user_id: targetUserId, reason }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Terminate user failed ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
}
