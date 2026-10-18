import { controlPlaneSteps, CONTROL_PLANE_V1_ID } from "./control_plane_v1";
import {
  fetchTourState,
  recordTourComplete,
  recordTourSkip,
  recordTourReset,
} from "./runner";

export async function runTourRunnerTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✓ ${msg}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${msg}`);
      failed++;
    }
  }

  console.log("Running Product Tour Step Definitions & Client Tests...");

  // 1. Verify step count and identifiers
  assert(CONTROL_PLANE_V1_ID === "control_plane_v1", "Tour ID is control_plane_v1");
  assert(controlPlaneSteps.length === 7, `Expected exactly 7 steps, got ${controlPlaneSteps.length}`);

  // 2. Verify all step anchors match expected data-testids
  const expectedSelectors = [
    '[data-testid="dashboard-overview"]',
    '[data-testid="nav-domains"]',
    '[data-testid="nav-mailboxes"]',
    '[data-testid="nav-members"]',
    '[data-testid="nav-storage"]',
    '[data-testid="nav-billing"]',
    '[data-testid="nav-settings"]',
  ];

  controlPlaneSteps.forEach((step, idx) => {
    assert(step.element === expectedSelectors[idx], `Step ${idx + 1} anchor is ${expectedSelectors[idx]}`);
    assert(!!step.popover?.title, `Step ${idx + 1} has title: "${step.popover?.title}"`);
    assert(!!step.popover?.description, `Step ${idx + 1} has description`);
  });

  // 3. Mock fetch tests for API endpoints
  const originalFetch = globalThis.fetch;
  try {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody = "";

    // Test fetchTourState
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method || "GET";
      return new Response(
        JSON.stringify({
          tours: {
            control_plane_v1: {
              completed_at: "2026-10-17T12:00:00Z",
              skipped_at: null,
              last_step: 7,
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const state = await fetchTourState();
    assert(capturedUrl.includes("/v1/tours/state"), `fetchTourState hits /v1/tours/state (${capturedUrl})`);
    assert(state.control_plane_v1?.last_step === 7, "fetchTourState decodes response payload correctly");

    // Test recordTourComplete
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method || "GET";
      capturedBody = String(init?.body || "");
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    };

    await recordTourComplete("control_plane_v1", 7);
    assert(capturedUrl.includes("/v1/tours/control_plane_v1/complete"), "recordTourComplete hits /complete endpoint");
    assert(capturedMethod === "POST", "recordTourComplete uses POST");
    assert(capturedBody.includes('"last_step":7'), "recordTourComplete transmits last_step: 7 in body");

    // Test recordTourSkip
    await recordTourSkip("control_plane_v1", 3);
    assert(capturedUrl.includes("/v1/tours/control_plane_v1/skip"), "recordTourSkip hits /skip endpoint");
    assert(capturedMethod === "POST", "recordTourSkip uses POST");
    assert(capturedBody.includes('"last_step":3'), "recordTourSkip transmits last_step: 3 in body");

    // Test recordTourReset
    await recordTourReset("control_plane_v1");
    assert(capturedUrl.includes("/v1/tours/control_plane_v1/reset"), "recordTourReset hits /reset endpoint");
    assert(capturedMethod === "POST", "recordTourReset uses POST");
  } finally {
    globalThis.fetch = originalFetch;
  }

  return { passed, failed };
}
