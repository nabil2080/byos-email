import {
  listMailboxes,
  getMailbox,
  deleteMailbox,
  impersonateMailbox,
  rotateRoot,
  createAlias,
  deleteAlias,
  listAliases,
  listOrgAliases,
  inviteMailbox,
} from "./mailboxes";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runMailboxesTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;
  const originalFetch = globalThis.fetch;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  console.log("Running Mailboxes API Client Tests...");

  await test("listMailboxes returns array of mailboxes", async () => {
    const mockMailboxes = [
      { id: "mbx_1", local_part: "alice", domain_id: "dom_1", mode: "private" },
      { id: "mbx_2", local_part: "bob", domain_id: "dom_1", mode: "private" },
    ];

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      assert(url.toString().includes("/v1/organizations/org_123/mailboxes"), "Incorrect URL for listMailboxes");
      assert(init?.method === "GET", "Expected GET method");
      return new Response(JSON.stringify({ mailboxes: mockMailboxes }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const res = await listMailboxes("org_123");
    assert(res.length === 2, "Expected 2 mailboxes");
    assert(res[0].id === "mbx_1", "Expected mbx_1 first");
  });

  await test("getMailbox fetches a single mailbox", async () => {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      assert(url.toString().includes("/v1/mailboxes/mbx_1"), "Incorrect URL for getMailbox");
      assert(init?.method === "GET", "Expected GET method");
      return new Response(
        JSON.stringify({ id: "mbx_1", local_part: "alice", domain_id: "dom_1", mode: "private" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const res = await getMailbox("mbx_1");
    assert(res.id === "mbx_1", "Expected mailbox id mbx_1");
    assert(res.local_part === "alice", "Expected local_part alice");
  });

  await test("deleteMailbox deletes a mailbox", async () => {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      assert(
        url.toString().includes("/v1/organizations/org_123/mailboxes/mbx_1"),
        "Incorrect URL for deleteMailbox"
      );
      assert(init?.method === "DELETE", "Expected DELETE method");
      return new Response(JSON.stringify({ id: "mbx_1", status: "deleted" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const res = await deleteMailbox("org_123", "mbx_1");
    assert(res.id === "mbx_1", "Expected deleted mailbox ID");
    assert(res.status === "deleted", "Expected deleted status");
  });

  await test("impersonateMailbox requests impersonation session", async () => {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      assert(
        url.toString().includes("/v1/organizations/org_123/mailboxes/mbx_1/impersonate"),
        "Incorrect URL for impersonateMailbox"
      );
      assert(init?.method === "POST", "Expected POST method");
      return new Response(
        JSON.stringify({
          mailbox_id: "mbx_1",
          target_user_id: "usr_1",
          wrapped_sk_org: null,
          session_token: "token_123",
          webmail_url: "http://localhost:3001",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const res = await impersonateMailbox("org_123", "mbx_1");
    assert(res.mailbox_id === "mbx_1", "Expected mailbox_id");
    assert(res.session_token === "token_123", "Expected session_token");
  });

  await test("rotateRoot rotates recovery root secret", async () => {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      assert(
        url.toString().includes("/v1/organizations/org_123/mailboxes/mbx_1/rotate-root"),
        "Incorrect URL for rotateRoot"
      );
      assert(init?.method === "POST", "Expected POST method");
      return new Response(
        JSON.stringify({ mailbox_id: "mbx_1", root_secret_id: "rs_1", version: 2 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const res = await rotateRoot("org_123", "mbx_1", "hex_wrap");
    assert(res.mailbox_id === "mbx_1", "Expected mailbox_id");
    assert(res.version === 2, "Expected version 2");
  });

  await test("alias operations create, list, and delete aliases", async () => {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const path = url.toString();
      if (path.includes("/v1/mailboxes/mbx_1/aliases") && init?.method === "POST") {
        return new Response(
          JSON.stringify({ id: "alias_1", local_part: "alias1", domain_id: "dom_1", is_active: true }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (path.includes("/v1/mailboxes/mbx_1/aliases") && init?.method === "GET") {
        return new Response(
          JSON.stringify({
            aliases: [{ id: "alias_1", local_part: "alias1", domain_id: "dom_1", is_active: true }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (path.includes("/v1/mailboxes/mbx_1/aliases/alias_1") && init?.method === "DELETE") {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    }) as typeof fetch;

    const created = await createAlias("mbx_1", "alias1", "dom_1");
    assert(created.id === "alias_1", "Expected created alias id");

    const aliases = await listAliases("mbx_1");
    assert(aliases.length === 1, "Expected 1 alias");

    await deleteAlias("mbx_1", "alias_1");
  });

  await test("listOrgAliases fetches organization level aliases", async () => {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      assert(url.toString().includes("/v1/organizations/org_123/aliases"), "Incorrect URL for listOrgAliases");
      return new Response(
        JSON.stringify({
          aliases: [
            {
              id: "org_alias_1",
              mailbox_id: "mbx_1",
              mailbox_local_part: "alice",
              local_part: "support",
              domain_id: "dom_1",
              is_active: true,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const orgAliases = await listOrgAliases("org_123");
    assert(orgAliases.length === 1, "Expected 1 org alias");
    assert(orgAliases[0].local_part === "support", "Expected support alias");
  });

  await test("inviteMailbox sends privacy_mode: 'private'", async () => {
    let capturedBody: any = null;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      assert(
        url.toString().includes("/v1/organizations/org_123/mailboxes/invite"),
        "Incorrect URL for inviteMailbox"
      );
      assert(init?.method === "POST", "Expected POST method");
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          invitation_id: "inv_1",
          invite_url: "http://localhost:3000/invite/inv_1",
          mailbox_id: "mbx_1",
          email: "carol@demo.local",
          privacy_mode: "private",
          expires_at: "2026-12-31T00:00:00Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const res = await inviteMailbox("org_123", { address: "carol@demo.local", name: "Carol" });
    assert(res.invitation_id === "inv_1", "Expected invitation_id");
    assert(capturedBody.privacy_mode === "private", "Expected privacy_mode 'private' sent in request body");
  });

  await test("handles non-200 HTTP error responses", async () => {
    globalThis.fetch = (async () => {
      return new Response("Mailbox not found", { status: 404 });
    }) as typeof fetch;

    try {
      await getMailbox("invalid_mbx");
      assert(false, "Should have thrown an error for 404 response");
    } catch (err: any) {
      assert(err.status === 404, "Expected status 404 on error object");
      assert(err.message.includes("Mailbox not found"), "Expected error message");
    }
  });

  return { passed, failed };
}
