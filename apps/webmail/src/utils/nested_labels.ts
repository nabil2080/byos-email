import { MailboxLabel } from "../api";

export interface LabelTreeNode {
  label: MailboxLabel;
  depth: number; // 0-indexed: 0 = root (level 1), 4 = level 5
  children: LabelTreeNode[];
  descendantCount: number;
}

export interface FlatLabelItem {
  label: MailboxLabel;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  descendantCount: number;
}

/**
 * Builds a hierarchical tree from a flat list of MailboxLabels.
 */
export function buildLabelTree(labels: MailboxLabel[]): LabelTreeNode[] {
  if (!labels || labels.length === 0) return [];

  const childrenMap = new Map<string, MailboxLabel[]>();
  const rootLabels: MailboxLabel[] = [];

  for (const lbl of labels) {
    if (!lbl.parent_label_id) {
      rootLabels.push(lbl);
    } else {
      const arr = childrenMap.get(lbl.parent_label_id) || [];
      arr.push(lbl);
      childrenMap.set(lbl.parent_label_id, arr);
    }
  }

  // Sort by sort_order ASC, then name ASC
  const sortFn = (a: MailboxLabel, b: MailboxLabel) => {
    if ((a.sort_order ?? 0) !== (b.sort_order ?? 0)) {
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    }
    return a.name.localeCompare(b.name);
  };

  rootLabels.sort(sortFn);

  function buildNode(label: MailboxLabel, depth: number): LabelTreeNode {
    const rawChildren = childrenMap.get(label.id) || [];
    rawChildren.sort(sortFn);

    const children: LabelTreeNode[] = [];
    let count = 0;
    for (const child of rawChildren) {
      const childNode = buildNode(child, depth + 1);
      children.push(childNode);
      count += 1 + childNode.descendantCount;
    }

    return {
      label,
      depth,
      children,
      descendantCount: count,
    };
  }

  return rootLabels.map((root) => buildNode(root, 0));
}

/**
 * Flattens tree into visible items based on expanded set.
 */
export function flattenVisibleLabelTree(
  nodes: LabelTreeNode[],
  expandedIds: Set<string>
): FlatLabelItem[] {
  const result: FlatLabelItem[] = [];

  function walk(node: LabelTreeNode) {
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedIds.has(node.label.id);

    result.push({
      label: node.label,
      depth: node.depth,
      hasChildren,
      isExpanded,
      descendantCount: node.descendantCount,
    });

    if (hasChildren && isExpanded) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  for (const n of nodes) {
    walk(n);
  }

  return result;
}

/**
 * Returns all label IDs in the subtree of rootId (inclusive).
 */
export function getSubtreeLabelIds(rootId: string, labels: MailboxLabel[]): string[] {
  const childrenMap = new Map<string, string[]>();
  for (const l of labels) {
    if (l.parent_label_id) {
      const arr = childrenMap.get(l.parent_label_id) || [];
      arr.push(l.id);
      childrenMap.set(l.parent_label_id, arr);
    }
  }

  const ids: string[] = [];
  function walk(id: string) {
    ids.push(id);
    const children = childrenMap.get(id) || [];
    for (const child of children) {
      walk(child);
    }
  }

  walk(rootId);
  return ids;
}

/**
 * Calculates height of subtree rooted at labelId (0 if no children, 1 if direct children have no children, etc.)
 */
export function getSubtreeHeight(labelId: string, labels: MailboxLabel[]): number {
  const childrenMap = new Map<string, string[]>();
  for (const l of labels) {
    if (l.parent_label_id) {
      const arr = childrenMap.get(l.parent_label_id) || [];
      arr.push(l.id);
      childrenMap.set(l.parent_label_id, arr);
    }
  }

  function calc(id: string): number {
    const children = childrenMap.get(id) || [];
    if (children.length === 0) return 0;
    let maxChildHeight = 0;
    for (const ch of children) {
      const h = 1 + calc(ch);
      if (h > maxChildHeight) maxChildHeight = h;
    }
    return maxChildHeight;
  }

  return calc(labelId);
}

/**
 * Calculates depth of a label (1-indexed: root is 1).
 */
export function getLabelDepth(labelId: string, labels: MailboxLabel[]): number {
  const byId = new Map<string, MailboxLabel>();
  for (const l of labels) byId.set(l.id, l);

  let depth = 1;
  let curr = byId.get(labelId);
  const visited = new Set<string>();

  while (curr?.parent_label_id) {
    depth++;
    if (visited.has(curr.parent_label_id) || depth > 20) break;
    visited.add(curr.parent_label_id);
    curr = byId.get(curr.parent_label_id);
  }

  return depth;
}

/**
 * Validates moving targetLabelId under newParentId.
 */
export function validateReparent(
  targetLabelId: string,
  newParentId: string | null | undefined,
  labels: MailboxLabel[]
): { valid: boolean; error?: string } {
  if (!newParentId) {
    return { valid: true };
  }

  if (targetLabelId === newParentId) {
    return { valid: false, error: "A label cannot be its own parent." };
  }

  const subtreeIds = getSubtreeLabelIds(targetLabelId, labels);
  if (subtreeIds.includes(newParentId)) {
    return { valid: false, error: "Cannot move a label into its own descendant (cycle detected)." };
  }

  const parentDepth = getLabelDepth(newParentId, labels);
  const targetSubtreeHeight = getSubtreeHeight(targetLabelId, labels);

  // New level of target will be parentDepth + 1. Total max depth in subtree will be parentDepth + 1 + targetSubtreeHeight.
  if (parentDepth + 1 + targetSubtreeHeight > 5) {
    return { valid: false, error: "Maximum label nesting depth of 5 exceeded." };
  }

  const target = labels.find((l) => l.id === targetLabelId);
  if (target) {
    const duplicateSibling = labels.some(
      (l) =>
        l.id !== targetLabelId &&
        l.parent_label_id === newParentId &&
        l.name.trim().toLowerCase() === target.name.trim().toLowerCase()
    );
    if (duplicateSibling) {
      return { valid: false, error: `A label named "${target.name}" already exists under the selected parent.` };
    }
  }

  return { valid: true };
}

/**
 * LocalStorage persistence for expanded state per mailbox.
 */
export function loadExpandedLabels(mailboxId: string): Set<string> {
  if (typeof window === "undefined" || !mailboxId) return new Set<string>();
  try {
    const raw = localStorage.getItem(`byos_expanded_labels_${mailboxId}`);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set<string>(parsed);
    }
  } catch {}
  return new Set<string>();
}

export function saveExpandedLabels(mailboxId: string, expanded: Set<string>): void {
  if (typeof window === "undefined" || !mailboxId) return;
  try {
    localStorage.setItem(`byos_expanded_labels_${mailboxId}`, JSON.stringify(Array.from(expanded)));
  } catch {}
}
