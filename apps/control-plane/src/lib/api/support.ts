/**
 * Customer Support & Help Desk API Client
 * Wraps zero-knowledge customer support endpoints.
 * Never exposes credentials, customer ciphertext, or internal notes.
 */

import { getCpHeaders } from "./client";

export interface CustomerTicketListItem {
  id: string;
  ticket_number: string;
  subject: string;
  product_area: string;
  category: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "new" | "open" | "pending_customer" | "in_progress" | "resolved" | "closed";
  first_response_at?: string;
  resolved_at?: string;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  snippet: string;
}

export interface CustomerTicketMessage {
  id: string;
  author_type: "customer" | "agent";
  author_name: string;
  body: string;
  created_at: string;
}

export interface CustomerTicketDetail extends CustomerTicketListItem {
  messages: CustomerTicketMessage[];
  agent_typing?: boolean;
}

export interface CreateTicketPayload {
  subject: string;
  product_area: string;
  category: string;
  priority: string;
  body: string;
}

function apiBase(): string {
  return (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE || "";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getCpHeaders(),
    ...(init?.headers as Record<string, string>),
  };
  const res = await fetch(`${apiBase()}${path}`, { credentials: "include", ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Request failed ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export async function fetchCustomerTickets(): Promise<{ tickets: CustomerTicketListItem[]; total: number }> {
  return request<{ tickets: CustomerTicketListItem[]; total: number }>("/v1/support/tickets");
}

export async function fetchCustomerTicketDetail(ticketId: string): Promise<CustomerTicketDetail> {
  return request<CustomerTicketDetail>(`/v1/support/tickets/${ticketId}`);
}

export async function createCustomerTicket(
  payload: CreateTicketPayload
): Promise<{ ticket: CustomerTicketListItem; message: CustomerTicketMessage }> {
  return request<{ ticket: CustomerTicketListItem; message: CustomerTicketMessage }>("/v1/support/tickets", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function addCustomerTicketReply(
  ticketId: string,
  body: string
): Promise<CustomerTicketMessage> {
  return request<CustomerTicketMessage>(`/v1/support/tickets/${ticketId}/reply`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export async function recordCustomerTyping(ticketId: string): Promise<void> {
  try {
    await request<void>(`/v1/support/tickets/${ticketId}/typing`, { method: "POST" });
  } catch {
    // Non-blocking typing signal
  }
}
