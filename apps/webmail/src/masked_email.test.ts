import { buildMimeString } from "./App";
import { buildPendingSendPayload, restoreComposeState, PendingSend } from "./undo_send";
import {
  fetchMaskedAliases,
  createMaskedAlias,
  updateMaskedAlias,
  deleteMaskedAlias,
  MaskedAliasItem,
  MessageMetadata,
} from "./api";
import { validateLocalPart } from "./routes/settings/MaskedEmailTab";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runMaskedEmailTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    }
  };

  console.log("Running Masked Email Tests...");

  // 1. TestBuildMimeStringIncludesAliasHeaders
  await test("1. TestBuildMimeStringIncludesAliasHeaders", () => {
    const aliasAddress = "a1b2c3d4e5f6@masked.byos.local";
    const mime = buildMimeString({
      to: "recipient@example.com",
      subject: "Reply via Alias",
      signedBody: "This is a reply from the alias.",
      htmlBody: "<p>This is a reply from the alias.</p>",
      from: aliasAddress,
      replyTo: aliasAddress,
    });

    assert(mime.includes(`From: ${aliasAddress}`), "MIME string must include From header with alias address");
    assert(mime.includes(`Reply-To: ${aliasAddress}`), "MIME string must include Reply-To header with alias address");
    assert(mime.includes("To: recipient@example.com"), "MIME string must include To header");
    assert(mime.includes("Subject: Reply via Alias"), "MIME string must include Subject header");
  });

  // 2. TestBuildPendingSendPayloadWithFromAlias
  await test("2. TestBuildPendingSendPayloadWithFromAlias", () => {
    const aliasAddress = "x7k2mq9pab3f@masked.byos.local";
    const payload = buildPendingSendPayload({
      to: "service@external.com",
      subject: "Registration",
      body: "Hello from alias",
      bodyHtml: "<p>Hello from alias</p>",
      boxId: "box-uuid-1",
      signatureApplied: false,
      fromAlias: aliasAddress,
    });

    assert(payload !== null, "payload should not be null");
    assert(payload?.fromAlias === aliasAddress, "payload should preserve fromAlias");
    assert(payload?.recipient === "service@external.com", "recipient matches");
  });

  // 3. TestRestoreComposeStateWithFromAlias
  await test("3. TestRestoreComposeStateWithFromAlias", () => {
    const aliasAddress = "testalias123@masked.byos.local";
    const payload: PendingSend = {
      id: "pending-123",
      expiresAt: Date.now() + 5000,
      recipient: "someone@example.com",
      subject: "Test Subject",
      bodyPlaintext: "Body text",
      bodyHtml: "<p>Body text</p>",
      attachments: [],
      scheduledTime: "",
      trackOpens: false,
      mailboxId: "box-123",
      fromAlias: aliasAddress,
    };

    let restoredTo = "";
    let restoredSubject = "";
    let restoredBody = "";
    let restoredAlias: string | null = null;
    let restoredOpen: any = false;

    restoreComposeState(payload, {
      setTo: (v) => { restoredTo = v; },
      setSubject: (v) => { restoredSubject = v; },
      setBody: (v) => { restoredBody = v; },
      setBodyHtml: () => {},
      setAttachments: () => {},
      setScheduledTime: () => {},
      setTrackOpens: () => {},
      setSignatureApplied: () => {},
      setFromAlias: (v) => { restoredAlias = v; },
      setOpen: (v) => { restoredOpen = v; },
    });

    assert(restoredTo === "someone@example.com", "restored to matches");
    assert(restoredSubject === "Test Subject", "restored subject matches");
    assert(restoredAlias === aliasAddress, "restored fromAlias matches");
    assert(restoredOpen === true, "compose open matches");
  });

  // 4. TestMaskedAliasAPIFunctions
  await test("4. TestMaskedAliasAPIFunctions", async () => {
    const originalFetch = globalThis.fetch;
    const calls: { url: string; method?: string; body?: any }[] = [];

    (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method || "GET",
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });

      if (url.endsWith("/v1/users/me/aliases") && (!init?.method || init.method === "GET")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            aliases: [
              {
                id: "alias-uuid-1",
                alias_address: "alias1@masked.byos.local",
                label: "Shopping",
                is_enabled: true,
                created_at: "2026-10-08T12:00:00Z",
                disabled_at: null,
                reply_count: 0,
              },
            ],
          }),
        };
      }

      if (url.endsWith("/v1/users/me/aliases") && init?.method === "POST") {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: "alias-uuid-2",
            alias_address: "alias2@masked.byos.local",
            label: "Newsletters",
            is_enabled: true,
            created_at: "2026-10-08T12:05:00Z",
            disabled_at: null,
            reply_count: 0,
          }),
        };
      }

      if (url.includes("/v1/users/me/aliases/alias-uuid-1") && init?.method === "PATCH") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "alias-uuid-1",
            alias_address: "alias1@masked.byos.local",
            label: "Shopping Updated",
            is_enabled: false,
            created_at: "2026-10-08T12:00:00Z",
            disabled_at: "2026-10-08T12:10:00Z",
            reply_count: 0,
          }),
        };
      }

      if (url.includes("/v1/users/me/aliases/alias-uuid-1") && init?.method === "DELETE") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: "deleted" }),
        };
      }

      return {
        ok: false,
        status: 404,
        text: async () => "not found",
      };
    };

    try {
      // 1. fetchMaskedAliases
      const listResp = await fetchMaskedAliases("mock-token");
      assert(listResp.aliases.length === 1, "fetchMaskedAliases returns 1 alias");
      assert(listResp.aliases[0].alias_address === "alias1@masked.byos.local", "alias address matches");

      // 2. createMaskedAlias
      const created = await createMaskedAlias("Newsletters", "mock-token");
      assert(created.id === "alias-uuid-2", "createMaskedAlias returns created alias");
      assert(calls.some(c => c.method === "POST" && c.body?.label === "Newsletters"), "POST sent correct label");

      // 3. updateMaskedAlias
      const updated = await updateMaskedAlias("alias-uuid-1", { is_enabled: false, label: "Shopping Updated" }, "mock-token");
      assert(updated.is_enabled === false, "updateMaskedAlias disabled alias");
      assert(updated.label === "Shopping Updated", "updateMaskedAlias updated label");

      // 4. deleteMaskedAlias
      const delResp = await deleteMaskedAlias("alias-uuid-1", "mock-token");
      assert(delResp.status === "deleted", "deleteMaskedAlias deleted alias");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 5. TestMaskedAliasRateLimitErrorHandling
  await test("5. TestMaskedAliasRateLimitErrorHandling", async () => {
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => ({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: "rate_limit_exceeded" }),
    });

    try {
      let threw = false;
      try {
        await createMaskedAlias("Exceeded");
      } catch (err: any) {
        threw = true;
        assert(
          err.message.includes("429") || err.message.includes("rate_limit_exceeded"),
          "error should convey 429 rate limit exceeded",
        );
      }
      assert(threw, "createMaskedAlias should throw on 429");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 6. TestMessageMetadataReplyViaAlias
  await test("6. TestMessageMetadataReplyViaAlias", () => {
    const meta: MessageMetadata = {
      id: "msg-123",
      mailbox_id: "box-456",
      message_seq: 1,
      direction: "received",
      sender: "external@sender.com",
      recipients: ["user@byos.local"],
      storage_object_id: "obj-1",
      content_key_hpke_wrapped: "key",
      encryption_version: 1,
      encryption_iv: "iv",
      aad_version: 1,
      bundle_hash: "hash",
      received_at: "2026-10-08T12:00:00Z",
      status: "received",
      has_attachments: false,
      attachment_count: 0,
      reply_via_alias: "a1b2c3d4e5f6@masked.byos.local",
      alias_label: "Shopping Signup",
    };

    assert(meta.reply_via_alias === "a1b2c3d4e5f6@masked.byos.local", "reply_via_alias mapped");
    assert(meta.alias_label === "Shopping Signup", "alias_label mapped");
  });

  // 7. test_custom_alias_validation_shows_errors
  await test("7. test_custom_alias_validation_shows_errors", () => {
    // Valid cases
    const validNames = ["amazon", "Amazon", "my-store", "service_123", "a.b.c", "abc"];
    for (const name of validNames) {
      const res = validateLocalPart(name);
      assert(res.valid === true, `expected ${name} to be valid`);
      assert(res.error === null, `expected error to be null for ${name}`);
    }

    // Invalid cases with exact errors
    assert(validateLocalPart("").valid === false, "empty is invalid");
    assert(validateLocalPart("ab").error === "Must be at least 3 characters", "too short error");
    assert(validateLocalPart("a".repeat(33)).error === "Must be at most 32 characters", "too long error");
    assert(validateLocalPart(".start").error === "Must not start or end with ., -, or _", "starts with dot");
    assert(validateLocalPart("-start").error === "Must not start or end with ., -, or _", "starts with hyphen");
    assert(validateLocalPart("_start").error === "Must not start or end with ., -, or _", "starts with underscore");
    assert(validateLocalPart("end.").error === "Must not start or end with ., -, or _", "ends with dot");
    assert(validateLocalPart("end-").error === "Must not start or end with ., -, or _", "ends with hyphen");
    assert(validateLocalPart("end_").error === "Must not start or end with ., -, or _", "ends with underscore");
    assert(validateLocalPart("two..dots").error === "Must not contain two consecutive ., -, or _ characters", "consecutive dots");
    assert(validateLocalPart("two--dashes").error === "Must not contain two consecutive ., -, or _ characters", "consecutive dashes");
    assert(validateLocalPart("two__underscores").error === "Must not contain two consecutive ., -, or _ characters", "consecutive underscores");
    assert(validateLocalPart("two.-mixed").error === "Must not contain two consecutive ., -, or _ characters", "consecutive mixed");
    assert(validateLocalPart("admin").error === "This alias name is reserved", "reserved admin");
    assert(validateLocalPart("ADMIN").error === "This alias name is reserved", "reserved uppercase ADMIN");
    assert(validateLocalPart("support").error === "This alias name is reserved", "reserved support");
    assert(validateLocalPart("root").error === "This alias name is reserved", "reserved root");
    assert(validateLocalPart("no-reply").error === "This alias name is reserved", "reserved no-reply");
    assert(validateLocalPart("invalid@char").error === "Only lowercase letters, numbers, and . - _ are allowed", "invalid @ character");
    assert(validateLocalPart("space here").error === "Only lowercase letters, numbers, and . - _ are allowed", "space character");
    assert(validateLocalPart("special!mark").error === "Only lowercase letters, numbers, and . - _ are allowed", "exclamation mark");
  });

  // 8. test_custom_alias_preview_updates
  await test("8. test_custom_alias_preview_updates", () => {
    const formatPreview = (lp: string) => (lp.trim().toLowerCase() || "…") + "@masked.byos.local";
    assert(formatPreview("") === "…@masked.byos.local", "empty preview shows placeholder");
    assert(formatPreview("   ") === "…@masked.byos.local", "whitespace preview shows placeholder");
    assert(formatPreview("amazon") === "amazon@masked.byos.local", "standard preview matches");
    assert(formatPreview("AMAZON") === "amazon@masked.byos.local", "uppercase is lowercased in preview");
    assert(formatPreview("my-store.123") === "my-store.123@masked.byos.local", "symbols preserved in preview");
  });

  // 9. test_custom_alias_409_shows_friendly_error
  await test("9. test_custom_alias_409_shows_friendly_error", async () => {
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/users/me/aliases") && init?.method === "POST") {
        return {
          ok: false,
          status: 409,
          text: async () => JSON.stringify({ error: "alias_taken" }),
        };
      }
      return { ok: false, status: 500, text: async () => "server error" };
    };

    try {
      let threw = false;
      try {
        await createMaskedAlias({ label: "Duplicate", local_part: "taken-name" });
      } catch (err: any) {
        threw = true;
        assert(err.status === 409, "error status is 409");
        assert(err.message === "That alias is already taken. Try a different name.", "friendly error message returned on 409");
      }
      assert(threw, "should have thrown 409 friendly error");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 10. test_random_mode_hides_custom_input
  await test("10. test_random_mode_hides_custom_input", async () => {
    const originalFetch = globalThis.fetch;
    let sentBody: any = null;

    (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/users/me/aliases") && init?.method === "POST") {
        sentBody = init?.body ? JSON.parse(init.body as string) : {};
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: "alias-uuid-random",
            alias_address: "rnd123456789@masked.byos.local",
            label: "Random Label",
            is_enabled: true,
            created_at: "2026-10-09T14:00:00Z",
            disabled_at: null,
            reply_count: 0,
          }),
        };
      }
      return { ok: false, status: 500, text: async () => "server error" };
    };

    try {
      // In random mode, local_part is omitted from the request
      const created = await createMaskedAlias("Random Label");
      assert(created.id === "alias-uuid-random", "random alias created");
      assert(sentBody !== null, "request body was sent");
      assert(sentBody.label === "Random Label", "label was passed");
      assert(sentBody.local_part === undefined, "local_part is omitted in random mode");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 11. TestCreateCustomAliasAPI
  await test("11. TestCreateCustomAliasAPI", async () => {
    const originalFetch = globalThis.fetch;
    const calls: { url: string; method?: string; body?: any }[] = [];

    (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method || "GET",
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });

      if (url.endsWith("/v1/users/me/aliases") && init?.method === "POST") {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: "alias-uuid-custom",
            alias_address: "amazon@masked.byos.local",
            label: "Amazon Orders",
            is_enabled: true,
            created_at: "2026-10-09T14:00:00Z",
            disabled_at: null,
            reply_count: 0,
          }),
        };
      }

      return {
        ok: false,
        status: 404,
        text: async () => "not found",
      };
    };

    try {
      const created = await createMaskedAlias({ label: "Amazon Orders", local_part: "amazon" }, "mock-token");
      assert(created.id === "alias-uuid-custom", "custom alias created");
      assert(created.alias_address === "amazon@masked.byos.local", "alias address matches");
      assert(
        calls.some(c => c.method === "POST" && c.body?.label === "Amazon Orders" && c.body?.local_part === "amazon"),
        "POST payload includes label and local_part",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  return { passed, failed };
}
