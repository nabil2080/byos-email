import { fetchMailboxes, fetchDrafts, fetchFolders, fetchLabels, fetchContacts } from "./api.js";
import { getGlobalError, setGlobalError, clearGlobalError } from "./errors.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runApiErrorTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    }
  };

  console.log("Running API Error Handling Tests...");

  const originalFetch = globalThis.fetch;

  try {
    await test("test_api_error_propagates_not_swallowed: fetchMailboxes throws on 500", async () => {
      globalThis.fetch = (async () => {
        return {
          ok: false,
          status: 500,
          text: async () => "Internal Server Error",
        } as unknown as Response;
      }) as unknown as typeof fetch;

      let threw = false;
      try {
        await fetchMailboxes("org-123");
      } catch (err: any) {
        threw = true;
        assert(err.status === 500, "Error status should be 500");
        assert(err.message.includes("Internal Server Error"), "Error message preserved");
      }
      assert(threw, "fetchMailboxes must throw on 500 rather than swallowing error into []");
    });

    await test("test_api_error_propagates_not_swallowed: fetchDrafts, fetchFolders, fetchLabels, fetchContacts throw on 500", async () => {
      globalThis.fetch = (async () => {
        return {
          ok: false,
          status: 500,
          text: async () => "Internal Server Error",
        } as unknown as Response;
      }) as unknown as typeof fetch;

      for (const [name, fn] of [
        ["fetchDrafts", () => fetchDrafts("box-123")],
        ["fetchFolders", () => fetchFolders("box-123")],
        ["fetchLabels", () => fetchLabels("box-123")],
        ["fetchContacts", () => fetchContacts("box-123")],
      ] as const) {
        let threw = false;
        try {
          await fn();
        } catch (err: any) {
          threw = true;
          assert(err.status === 500, `${name} error status should be 500`);
        }
        assert(threw, `${name} must throw on 500 rather than swallowing error into []`);
      }
    });

    await test("test_successful_return_shape: api client returns data on 200", async () => {
      globalThis.fetch = (async (url: string) => {
        if (url.includes("/mailboxes")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ mailboxes: [{ id: "box-1", local_part: "alice", domain_id: "d1", mode: "private" }] }),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ drafts: [], folders: [], labels: [], contacts: [] }),
        } as unknown as Response;
      }) as unknown as typeof fetch;

      const boxes = await fetchMailboxes("org-123");
      assert(Array.isArray(boxes), "Must return array");
      assert(boxes.length === 1, "Must return 1 mailbox");
      assert(boxes[0].local_part === "alice", "Must return correct mailbox data");
    });

    await test("test_global_error_banner_renders: set and clear global error signal", () => {
      clearGlobalError();
      assert(getGlobalError() === null, "Initial global error should be null");

      setGlobalError("Failed to fetch mailbox data", false);
      const err = getGlobalError();
      assert(err !== null, "Global error should not be null");
      assert(err!.message === "Failed to fetch mailbox data", "Global error message should match");
      assert(err!.isAuth === false, "isAuth should be false");

      clearGlobalError();
      assert(getGlobalError() === null, "Global error should be null after clearing");

      setGlobalError("Session expired (401)", true);
      const authErr = getGlobalError();
      assert(authErr !== null, "Auth error should not be null");
      assert(authErr!.message === "Session expired (401)", "Auth error message should match");
      assert(authErr!.isAuth === true, "isAuth should be true");

      clearGlobalError();
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  return { passed, failed };
}
