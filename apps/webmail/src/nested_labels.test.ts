import { MailboxLabel } from "./api";
import {
  buildLabelTree,
  flattenVisibleLabelTree,
  getSubtreeLabelIds,
  validateReparent,
  loadExpandedLabels,
  saveExpandedLabels,
} from "./utils/nested_labels";

export async function runNestedLabelsTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (!condition) {
      console.error(`  FAIL: ${msg}`);
      failed++;
      throw new Error(msg);
    }
  }

  // Helper labels
  const mockLabels: MailboxLabel[] = [
    {
      id: "lbl-work",
      mailbox_id: "mb-1",
      name: "Work",
      color: "#9E725F",
      color_name: "Mocha",
      created_at: new Date().toISOString(),
      parent_label_id: null,
      sort_order: 0,
      path: "Work",
    },
    {
      id: "lbl-project-a",
      mailbox_id: "mb-1",
      name: "ProjectA",
      color: "#4D6BFE",
      color_name: "Cobalt",
      created_at: new Date().toISOString(),
      parent_label_id: "lbl-work",
      sort_order: 0,
      path: "Work/ProjectA",
    },
    {
      id: "lbl-subtask-1",
      mailbox_id: "mb-1",
      name: "SubTask1",
      color: "#64BB5C",
      color_name: "Leaf Green",
      created_at: new Date().toISOString(),
      parent_label_id: "lbl-project-a",
      sort_order: 0,
      path: "Work/ProjectA/SubTask1",
    },
    {
      id: "lbl-personal",
      mailbox_id: "mb-1",
      name: "Personal",
      color: "#7B68EE",
      color_name: "Lavender",
      created_at: new Date().toISOString(),
      parent_label_id: null,
      sort_order: 1,
      path: "Personal",
    },
  ];

  // 1. test_sidebar_renders_tree
  try {
    const tree = buildLabelTree(mockLabels);
    assert(tree.length === 2, "Expected 2 root labels (Work, Personal)");
    assert(tree[0].label.name === "Work", "First root should be Work");
    assert(tree[0].children.length === 1, "Work should have 1 child (ProjectA)");
    assert(tree[0].children[0].children.length === 1, "ProjectA should have 1 child (SubTask1)");
    assert(tree[0].descendantCount === 2, "Work should have 2 total descendants");

    // All expanded
    const expandedAll = new Set(["lbl-work", "lbl-project-a"]);
    const visibleAll = flattenVisibleLabelTree(tree, expandedAll);
    assert(visibleAll.length === 4, "When expanded, all 4 labels should be visible");
    assert(visibleAll[0].depth === 0, "Work depth should be 0");
    assert(visibleAll[1].depth === 1, "ProjectA depth should be 1");
    assert(visibleAll[2].depth === 2, "SubTask1 depth should be 2");
    assert(visibleAll[3].depth === 0, "Personal depth should be 0");

    // Collapsed
    const expandedNone = new Set<string>();
    const visibleNone = flattenVisibleLabelTree(tree, expandedNone);
    assert(visibleNone.length === 2, "When collapsed, only 2 root labels should be visible");
    assert(visibleNone[0].label.id === "lbl-work", "First visible should be Work");
    assert(visibleNone[1].label.id === "lbl-personal", "Second visible should be Personal");

    console.log("  PASS: test_sidebar_renders_tree");
    passed++;
  } catch (err: any) {
    console.error("  test_sidebar_renders_tree failed:", err?.message);
  }

  // 2. test_parent_click_filters_descendants
  try {
    const workSubtree = getSubtreeLabelIds("lbl-work", mockLabels);
    assert(workSubtree.includes("lbl-work"), "Work subtree must include Work");
    assert(workSubtree.includes("lbl-project-a"), "Work subtree must include ProjectA");
    assert(workSubtree.includes("lbl-subtask-1"), "Work subtree must include SubTask1");
    assert(!workSubtree.includes("lbl-personal"), "Work subtree must NOT include Personal");

    // Filter verification with messages
    const workSubtreeSet = new Set(workSubtree);
    const msgWorkDirect = { id: "m1", labelIds: ["lbl-work"] };
    const msgSubtask = { id: "m2", labelIds: ["lbl-subtask-1"] };
    const msgPersonal = { id: "m3", labelIds: ["lbl-personal"] };

    assert(
      msgWorkDirect.labelIds.some((lid) => workSubtreeSet.has(lid)),
      "Parent click should match direct message"
    );
    assert(
      msgSubtask.labelIds.some((lid) => workSubtreeSet.has(lid)),
      "Parent click should match descendant message"
    );
    assert(
      !msgPersonal.labelIds.some((lid) => workSubtreeSet.has(lid)),
      "Parent click should not match non-descendant message"
    );

    // Child click filter
    const childSubtree = getSubtreeLabelIds("lbl-project-a", mockLabels);
    const childSubtreeSet = new Set(childSubtree);
    assert(
      !msgWorkDirect.labelIds.some((lid) => childSubtreeSet.has(lid)),
      "Child click should NOT match parent message"
    );
    assert(
      msgSubtask.labelIds.some((lid) => childSubtreeSet.has(lid)),
      "Child click should match its own descendant message"
    );

    console.log("  PASS: test_parent_click_filters_descendants");
    passed++;
  } catch (err: any) {
    console.error("  test_parent_click_filters_descendants failed:", err?.message);
  }

  // 3. test_expand_state_persists
  try {
    const memoryStorage: Record<string, string> = {};
    const originalLocalStorage = globalThis.localStorage;
    (globalThis as any).localStorage = {
      getItem: (key: string) => memoryStorage[key] || null,
      setItem: (key: string, val: string) => {
        memoryStorage[key] = val;
      },
      removeItem: (key: string) => {
        delete memoryStorage[key];
      },
      clear: () => {
        for (const k of Object.keys(memoryStorage)) delete memoryStorage[k];
      },
    };

    try {
      const boxId = "mailbox-test-persist-123";
      const toSave = new Set(["lbl-work", "lbl-project-a"]);
      saveExpandedLabels(boxId, toSave);

      // Verify raw storage
      assert(
        Boolean(memoryStorage[`byos_expanded_labels_${boxId}`]),
        "Storage key should be written"
      );

      // Simulate reload: load state back
      const loaded = loadExpandedLabels(boxId);
      assert(loaded.size === 2, "Loaded set should have size 2");
      assert(loaded.has("lbl-work"), "Loaded set must contain lbl-work");
      assert(loaded.has("lbl-project-a"), "Loaded set must contain lbl-project-a");

      // Verify per-mailbox isolation
      const otherBox = loadExpandedLabels("mailbox-other-456");
      assert(otherBox.size === 0, "Different mailbox should have empty expanded set");

      console.log("  PASS: test_expand_state_persists");
      passed++;
    } finally {
      (globalThis as any).localStorage = originalLocalStorage;
    }
  } catch (err: any) {
    console.error("  test_expand_state_persists failed:", err?.message);
  }

  // 4. test_reparent_cycle_blocked_ui
  try {
    // Attempt reparenting Work into its child ProjectA
    const resChild = validateReparent("lbl-work", "lbl-project-a", mockLabels);
    assert(!resChild.valid, "Reparenting into child must be blocked");
    assert(
      Boolean(resChild.error && resChild.error.toLowerCase().includes("descendant")),
      `Expected error about descendant/cycle, got: ${resChild.error}`
    );

    // Attempt reparenting Work into grandchild SubTask1
    const resGrandChild = validateReparent("lbl-work", "lbl-subtask-1", mockLabels);
    assert(!resGrandChild.valid, "Reparenting into grandchild must be blocked");
    assert(
      Boolean(resGrandChild.error && resGrandChild.error.toLowerCase().includes("descendant")),
      `Expected error about descendant/cycle, got: ${resGrandChild.error}`
    );

    // Attempt reparenting Work into itself
    const resSelf = validateReparent("lbl-work", "lbl-work", mockLabels);
    assert(!resSelf.valid, "Reparenting into self must be blocked");

    // Valid reparenting into Personal
    const resValid = validateReparent("lbl-project-a", "lbl-personal", mockLabels);
    assert(resValid.valid, "Reparenting ProjectA into Personal should be valid");

    // Depth limit validation (create a 5-level deep chain and attempt to exceed)
    const deepLabels: MailboxLabel[] = [
      { id: "d1", mailbox_id: "m", name: "D1", color: "#000", color_name: "c", created_at: "", parent_label_id: null },
      { id: "d2", mailbox_id: "m", name: "D2", color: "#000", color_name: "c", created_at: "", parent_label_id: "d1" },
      { id: "d3", mailbox_id: "m", name: "D3", color: "#000", color_name: "c", created_at: "", parent_label_id: "d2" },
      { id: "d4", mailbox_id: "m", name: "D4", color: "#000", color_name: "c", created_at: "", parent_label_id: "d3" },
      { id: "d5", mailbox_id: "m", name: "D5", color: "#000", color_name: "c", created_at: "", parent_label_id: "d4" },
      { id: "branch", mailbox_id: "m", name: "Branch", color: "#000", color_name: "c", created_at: "", parent_label_id: null },
      { id: "subbranch", mailbox_id: "m", name: "SubBranch", color: "#000", color_name: "c", created_at: "", parent_label_id: "branch" },
    ];
    // Moving branch (height 1) under d5 (depth 5) would yield depth 5 + 1 + 1 = 7 > 5
    const resDepth = validateReparent("branch", "d5", deepLabels);
    assert(!resDepth.valid, "Reparenting that exceeds depth 5 must be blocked");
    assert(
      Boolean(resDepth.error && resDepth.error.includes("5")),
      `Expected depth 5 error, got: ${resDepth.error}`
    );

    console.log("  PASS: test_reparent_cycle_blocked_ui");
    passed++;
  } catch (err: any) {
    console.error("  test_reparent_cycle_blocked_ui failed:", err?.message);
  }

  return { passed, failed };
}
