import { driver, Driver, DriveStep } from "driver.js";
import { controlPlaneSteps, CONTROL_PLANE_V1_ID } from "./control_plane_v1";
import { apiBase, getCpHeaders } from "../lib/api/client";

export interface TourStateRecord {
  completed_at: string | null;
  skipped_at: string | null;
  last_step: number;
}

export interface TourStateResponse {
  tours: Record<string, TourStateRecord>;
}

let activeDriver: Driver | null = null;

// Fetch persistent tour state from server
export async function fetchTourState(): Promise<Record<string, TourStateRecord>> {
  try {
    const res = await fetch(`${apiBase()}/v1/tours/state`, {
      headers: getCpHeaders({ Accept: "application/json" }),
      credentials: "include",
    });
    if (!res.ok) return {};
    const data: TourStateResponse = await res.json();
    return data.tours || {};
  } catch (err) {
    console.error("Failed to fetch tour state:", err);
    return {};
  }
}

// Mark tour completed on server
export async function recordTourComplete(tourId: string, lastStep: number): Promise<void> {
  try {
    await fetch(`${apiBase()}/v1/tours/${encodeURIComponent(tourId)}/complete`, {
      method: "POST",
      headers: getCpHeaders({ "Content-Type": "application/json" }),
      credentials: "include",
      body: JSON.stringify({ last_step: lastStep }),
    });
  } catch (err) {
    console.error("Failed to record tour completion:", err);
  }
}

// Mark tour skipped on server
export async function recordTourSkip(tourId: string, lastStep: number): Promise<void> {
  try {
    await fetch(`${apiBase()}/v1/tours/${encodeURIComponent(tourId)}/skip`, {
      method: "POST",
      headers: getCpHeaders({ "Content-Type": "application/json" }),
      credentials: "include",
      body: JSON.stringify({ last_step: lastStep }),
    });
  } catch (err) {
    console.error("Failed to record tour skip:", err);
  }
}

// Reset tour state on server
export async function recordTourReset(tourId: string): Promise<void> {
  try {
    await fetch(`${apiBase()}/v1/tours/${encodeURIComponent(tourId)}/reset`, {
      method: "POST",
      headers: getCpHeaders({ "Content-Type": "application/json" }),
      credentials: "include",
    });
  } catch (err) {
    console.error("Failed to reset tour state:", err);
  }
}

export interface RunTourOptions {
  force?: boolean;
}

/**
 * Runs the Control Panel guided walkthrough tour.
 *
 * NOTE: last_step is stored in the JSONB on the server for future resume support,
 * but per product specification, the current runner MUST ignore it and always start at step 1.
 * Restarting the tour unconditionally launches at step 1.
 */
export async function startControlPlaneTour(options: RunTourOptions = {}): Promise<void> {
  if (activeDriver) {
    activeDriver.destroy();
    activeDriver = null;
  }

  // Pre-flight check Policy A (Control Panel):
  // Filter missing steps, run with what's available, and log missing anchors to console.
  const availableSteps: DriveStep[] = [];
  for (const step of controlPlaneSteps) {
    const sel = typeof step.element === "string" ? step.element : null;
    if (sel) {
      const el = document.querySelector(sel);
      if (el) {
        availableSteps.push(step);
      } else {
        console.warn(`[Tour Pre-flight] Anchor missing for step "${step.popover?.title}": ${sel}`);
      }
    } else {
      availableSteps.push(step);
    }
  }

  if (availableSteps.length === 0) {
    console.warn("[Tour Pre-flight] No valid tour steps found in DOM. Skipping tour.");
    return;
  }

  let completedSuccessfully = false;
  let completeRecorded = false;
  let highestStepViewed = 1;

  function ensurePopoverWithinViewport(popoverWrapper?: HTMLElement | null): void {
    const el = popoverWrapper || document.querySelector<HTMLElement>(".driver-popover.byos-tour-popover");
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const padding = 10;

    if (vw <= 640) {
      el.style.setProperty("position", "fixed", "important");
      el.style.setProperty("left", "12px", "important");
      el.style.setProperty("right", "12px", "important");
      el.style.setProperty("top", "auto", "important");
      el.style.setProperty("bottom", "16px", "important");
      el.style.setProperty("max-width", `${vw - 24}px`, "important");
      el.style.setProperty("width", "auto", "important");
      el.style.setProperty("transform", "none", "important");
      return;
    }

    const rect = el.getBoundingClientRect();
    if (rect.left < padding) {
      el.style.setProperty("left", `${padding}px`, "important");
      el.style.setProperty("right", "auto", "important");
    } else if (rect.right > vw - padding) {
      el.style.setProperty("left", "auto", "important");
      el.style.setProperty("right", `${padding}px`, "important");
    }

    if (rect.top < padding) {
      el.style.setProperty("top", `${padding}px`, "important");
      el.style.setProperty("bottom", "auto", "important");
    } else if (rect.bottom > vh - padding) {
      el.style.setProperty("top", "auto", "important");
      el.style.setProperty("bottom", `${padding}px`, "important");
    }
  }

  const handleResize = () => ensurePopoverWithinViewport();
  window.addEventListener("resize", handleResize);

  activeDriver = driver({
    showProgress: true,
    animate: true,
    allowClose: true,
    overlayColor: "rgba(0, 0, 0, 0.55)",
    popoverClass: "byos-tour-popover",
    nextBtnText: "Next →",
    prevBtnText: "← Back",
    doneBtnText: "Finish Tour",
    progressText: "{{current}} of {{total}}",
    steps: availableSteps,
    onPopoverRender: (popoverDOM) => {
      ensurePopoverWithinViewport(popoverDOM.wrapper);
    },
    onHighlightStarted: (_el, _step, opts) => {
      ensurePopoverWithinViewport();
      const current = (opts.index ?? 0) + 1;
      if (current > highestStepViewed) {
        highestStepViewed = current;
      }
    },
    onHighlighted: () => {
      ensurePopoverWithinViewport();
    },
    onDoneClick: () => {
      completedSuccessfully = true;
      if (!completeRecorded) {
        completeRecorded = true;
        recordTourComplete(CONTROL_PLANE_V1_ID, availableSteps.length);
      }
      activeDriver?.destroy();
    },
    onDestroyed: (_el, _step, opts) => {
      window.removeEventListener("resize", handleResize);
      if (opts.reason === "done" || completedSuccessfully) {
        if (!completeRecorded) {
          completeRecorded = true;
          recordTourComplete(CONTROL_PLANE_V1_ID, availableSteps.length);
        }
      } else if (opts.reason !== "api") {
        const stepNum = (opts.index ?? 0) + 1;
        recordTourSkip(CONTROL_PLANE_V1_ID, stepNum);
      }
      activeDriver = null;
    },
  });

  // Always begin at index 0 (Step 1)
  activeDriver.drive(0);
}

export function destroyControlPlaneTour(): void {
  if (activeDriver) {
    activeDriver.destroy();
    activeDriver = null;
  }
}
