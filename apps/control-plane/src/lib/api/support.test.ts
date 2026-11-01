/**
 * Support API Client Tests (Mock Fetch Harness)
 */

import {
  fetchCustomerTickets,
  fetchCustomerTicketDetail,
  createCustomerTicket,
  addCustomerTicketReply,
} from "./support";

export async function runSupportApiTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✓ ${msg}`);
      passed++;
    } else {
      console.error(`  ✗ ${msg}`);
      failed++;
    }
  }

  const originalFetch = globalThis.fetch;

  try {
    // 1. Test fetchCustomerTickets
    globalThis.fetch = async (url: any, init?: any) => {
      if (String(url).endsWith("/v1/support/tickets") && (!init?.method || init.method === "GET")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tickets: [
              {
                id: "tkt-123",
                ticket_number: "TK-20261031-A1B2",
                subject: "Test Domain Verification Issue",
                product_area: "domains",
                category: "issue",
                priority: "high",
                status: "open",
                created_at: "2026-10-31T12:00:00Z",
                updated_at: "2026-10-31T12:00:00Z",
                last_activity_at: "2026-10-31T12:00:00Z",
                message_count: 1,
                snippet: "Need assistance with DNS",
              },
            ],
            total: 1,
          }),
        } as Response;
      }
      return { ok: false, status: 404, text: async () => "Not found" } as Response;
    };

    const ticketsResp = await fetchCustomerTickets();
    assert(ticketsResp.total === 1, "fetchCustomerTickets returns 1 ticket");
    assert(ticketsResp.tickets[0].ticket_number === "TK-20261031-A1B2", "Ticket number matches");

    // 2. Test createCustomerTicket
    let capturedCreateBody: any = null;
    globalThis.fetch = async (url: any, init?: any) => {
      if (String(url).endsWith("/v1/support/tickets") && init?.method === "POST") {
        capturedCreateBody = JSON.parse(init.body);
        return {
          ok: true,
          status: 201,
          json: async () => ({
            ticket: {
              id: "tkt-created",
              ticket_number: "TK-20261031-9999",
              subject: capturedCreateBody.subject,
              product_area: capturedCreateBody.product_area,
              category: "issue",
              priority: capturedCreateBody.priority,
              status: "new",
              created_at: "2026-10-31T12:00:00Z",
              updated_at: "2026-10-31T12:00:00Z",
              last_activity_at: "2026-10-31T12:00:00Z",
              message_count: 1,
              snippet: capturedCreateBody.body,
            },
            message: {
              id: "msg-1",
              author_type: "customer",
              author_name: "Alice",
              body: capturedCreateBody.body,
              created_at: "2026-10-31T12:00:00Z",
            },
          }),
        } as Response;
      }
      return { ok: false, status: 404, text: async () => "Not found" } as Response;
    };

    const createResp = await createCustomerTicket({
      subject: "Storage sync timeout",
      product_area: "storage",
      category: "issue",
      priority: "urgent",
      body: "My minio S3 connection times out after 30 seconds.",
    });
    assert(createResp.ticket.id === "tkt-created", "createCustomerTicket creates ticket");
    assert(capturedCreateBody.priority === "urgent", "Transmits priority correctly");
    assert(createResp.message.author_type === "customer", "Message author_type is customer");

    // 3. Test fetchCustomerTicketDetail
    globalThis.fetch = async (url: any, init?: any) => {
      if (String(url).endsWith("/v1/support/tickets/tkt-created")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "tkt-created",
            ticket_number: "TK-20261031-9999",
            subject: "Storage sync timeout",
            product_area: "storage",
            category: "issue",
            priority: "urgent",
            status: "new",
            created_at: "2026-10-31T12:00:00Z",
            updated_at: "2026-10-31T12:00:00Z",
            last_activity_at: "2026-10-31T12:00:00Z",
            message_count: 1,
            snippet: "Initial message",
            messages: [
              {
                id: "msg-1",
                author_type: "customer",
                author_name: "Alice",
                body: "Initial message",
                created_at: "2026-10-31T12:00:00Z",
              },
            ],
          }),
        } as Response;
      }
      return { ok: false, status: 404, text: async () => "Not found" } as Response;
    };

    const detailResp = await fetchCustomerTicketDetail("tkt-created");
    assert(detailResp.id === "tkt-created", "fetchCustomerTicketDetail returns ticket");
    assert(detailResp.messages.length === 1, "Messages array populated");

    // 4. Test addCustomerTicketReply
    let capturedReplyBody: any = null;
    globalThis.fetch = async (url: any, init?: any) => {
      if (String(url).endsWith("/v1/support/tickets/tkt-created/reply") && init?.method === "POST") {
        capturedReplyBody = JSON.parse(init.body);
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: "msg-reply-1",
            author_type: "customer",
            author_name: "Alice",
            body: capturedReplyBody.body,
            created_at: "2026-10-31T12:15:00Z",
          }),
        } as Response;
      }
      return { ok: false, status: 404, text: async () => "Not found" } as Response;
    };

    const replyResp = await addCustomerTicketReply("tkt-created", "Added TLS certificate logs.");
    assert(replyResp.id === "msg-reply-1", "addCustomerTicketReply returns created message");
    assert(capturedReplyBody.body === "Added TLS certificate logs.", "Transmits reply body");
  } finally {
    globalThis.fetch = originalFetch;
  }

  return { passed, failed };
}
