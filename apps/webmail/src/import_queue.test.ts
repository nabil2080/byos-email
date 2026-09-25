import { runWithConcurrency } from "./import_queue.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runImportQueueTests(): Promise<{ passed: number; failed: number }> {
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

  console.log("Running Import Queue Tests...");

  // 1. Concurrency limit is respected
  await test("1. Concurrency limit is respected", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    let active = 0;
    let maxActive = 0;
    const completedItems: number[] = [];

    await runWithConcurrency(
      items,
      3,
      async (item) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        completedItems.push(item);
        active--;
      },
      () => {},
    );

    assert(maxActive <= 3, `Max active workers exceeded: ${maxActive}`);
    assert(completedItems.length === 8, `Not all items completed: ${completedItems.length}`);
  });

  // 2. Continues when item worker throws
  await test("2. Continues when item worker throws", async () => {
    const items = ["a", "b", "c", "d"];
    const results: string[] = [];

    await runWithConcurrency(
      items,
      2,
      async (item) => {
        if (item === "b") {
          throw new Error("Simulated upload error");
        }
        results.push(item);
      },
      () => {},
    );

    assert(results.length === 3, `Expected 3 successful items, got ${results.length}`);
    assert(!results.includes("b"), "Item b should have failed");
  });

  // 3. onProgress tracks completed and total accurately
  await test("3. onProgress tracks completed and total accurately", async () => {
    const items = [10, 20, 30];
    const progressHistory: { completed: number; total: number }[] = [];

    await runWithConcurrency(
      items,
      2,
      async () => {
        await new Promise((r) => setTimeout(r, 10));
      },
      (completed, total) => {
        progressHistory.push({ completed, total });
      },
    );

    assert(progressHistory.length === 3, `Expected 3 progress events, got ${progressHistory.length}`);
    assert(progressHistory[2].completed === 3, "Final completed should be 3");
    assert(progressHistory[2].total === 3, "Total should be 3");
  });

  return { passed, failed };
}
