import { filterNavigation, searchOrganization, NAVIGATION_DESTINATIONS } from "./search";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

export async function runSearchTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    try {
      fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e: unknown) {
      failed++;
      console.error(`  ✗ ${name}:`, e instanceof Error ? e.message : e);
    }
  }

  test("filterNavigation returns empty array for empty or blank query", () => {
    assert(filterNavigation("").length === 0, "empty string returns 0 items");
    assert(filterNavigation("   ").length === 0, "whitespace returns 0 items");
  });

  test("filterNavigation matches navigation title exactly and fuzzily", () => {
    const domains = filterNavigation("domains");
    assert(domains.some((d) => d.id === "nav-domains"), "matched nav-domains by title");

    const billing = filterNavigation("bill");
    assert(billing.some((b) => b.id === "nav-billing"), "matched nav-billing by prefix");
  });

  test("filterNavigation matches navigation keywords", () => {
    const dkim = filterNavigation("dkim");
    assert(dkim.some((d) => d.id === "nav-domains"), "matched nav-domains via keyword 'dkim'");

    const seats = filterNavigation("seats");
    assert(seats.some((s) => s.id === "nav-billing"), "matched nav-billing via keyword 'seats'");
  });

  test("searchOrganization returns navigation without API call when query is empty", async () => {
    const res = await searchOrganization("fake-org", "");
    assert(res.query === "", "query is empty");
    assert(res.domains.length === 0, "zero domains");
    assert(res.mailboxes.length === 0, "zero mailboxes");
    assert(res.members.length === 0, "zero members");
    assert(res.navigation.length === 0, "zero navigation items");
  });

  test("NAVIGATION_DESTINATIONS covers all main Control Panel destinations", () => {
    const ids = NAVIGATION_DESTINATIONS.map((n) => n.id);
    assert(ids.includes("nav-overview"), "has overview");
    assert(ids.includes("nav-domains"), "has domains");
    assert(ids.includes("nav-mailboxes"), "has mailboxes");
    assert(ids.includes("nav-members"), "has members");
    assert(ids.includes("nav-storage"), "has storage");
    assert(ids.includes("nav-billing"), "has billing");
    assert(ids.includes("nav-settings"), "has settings");
  });

  return { passed, failed };
}
