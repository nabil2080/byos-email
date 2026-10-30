import { DecryptedEventRecord } from "../components/calendar/CalendarSidebar";

export interface PositionedEvent {
  event: DecryptedEventRecord;
  top: number;
  height: number;
  leftPercent: number;
  widthPercent: number;
  zIndex?: number;
}

export interface LayoutOptions {
  /** If true, layout is computed for single Day View which has abundant width */
  isDayView?: boolean;
}

/**
 * Computes side-by-side and expanding column allocations for overlapping events.
 * Implements interval scheduling / column packing used by Google Calendar & FullCalendar:
 * 1. Clustering overlapping intervals into connected components
 * 2. Greedy lane assignment (sub-columns)
 * 3. Greedy rightward expansion (colSpan across non-conflicting adjacent lanes)
 * 4. High-concurrency cascading fallback in narrow views to maintain minimum readable card width
 */
export function layoutDayTimedEvents(
  events: DecryptedEventRecord[],
  hourHeight: number,
  options?: LayoutOptions
): PositionedEvent[] {
  if (!events || events.length === 0) return [];

  const isDayView = options?.isDayView ?? false;

  // 1. Calculate start minutes, end minutes, top, and height for each event
  const items = events.map((ev) => {
    const s = ev.startTime;
    const e = ev.endTime;
    const startMin = s.getHours() * 60 + s.getMinutes();
    let endMin = e.getHours() * 60 + e.getMinutes();

    // Guard against overnight spans or invalid zero-durations
    if (endMin <= startMin) {
      endMin = startMin + 30;
    }
    const durationMin = Math.max(25, endMin - startMin);

    const top = (startMin / 60) * hourHeight;
    const height = Math.max(22, (durationMin / 60) * hourHeight);

    return {
      event: ev,
      startMin,
      endMin: Math.max(startMin + 25, endMin),
      top,
      height,
    };
  });

  // 2. Sort by startMin ascending, then longer duration descending, then stable ID
  items.sort((a, b) => {
    if (a.startMin !== b.startMin) {
      return a.startMin - b.startMin;
    }
    const durA = a.endMin - a.startMin;
    const durB = b.endMin - b.startMin;
    if (durA !== durB) {
      return durB - durA; // Longer duration first
    }
    return (a.event.id || "").localeCompare(b.event.id || "");
  });

  // 3. Group overlapping events into clusters (connected components)
  const clusters: Array<typeof items> = [];
  let currentCluster: typeof items = [];
  let clusterMaxEnd = -1;

  for (const item of items) {
    if (currentCluster.length === 0) {
      currentCluster.push(item);
      clusterMaxEnd = item.endMin;
    } else if (item.startMin < clusterMaxEnd) {
      // Overlaps with current cluster
      currentCluster.push(item);
      if (item.endMin > clusterMaxEnd) {
        clusterMaxEnd = item.endMin;
      }
    } else {
      // Disjoint interval: close previous cluster and start new one
      clusters.push(currentCluster);
      currentCluster = [item];
      clusterMaxEnd = item.endMin;
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  // 4. Within each cluster, assign events to parallel lanes (columns) and expand
  const result: PositionedEvent[] = [];

  for (const cluster of clusters) {
    const laneEndTimes: number[] = [];

    // Assign lane greedily
    const assigned = cluster.map((item) => {
      let assignedLane = -1;
      for (let i = 0; i < laneEndTimes.length; i++) {
        if (laneEndTimes[i] <= item.startMin) {
          assignedLane = i;
          laneEndTimes[i] = item.endMin;
          break;
        }
      }
      if (assignedLane === -1) {
        assignedLane = laneEndTimes.length;
        laneEndTimes.push(item.endMin);
      }
      return {
        ...item,
        lane: assignedLane,
        colSpan: 1,
      };
    });

    const totalColumns = Math.max(1, laneEndTimes.length);

    // Greedy rightward expansion (colSpan):
    // If an event at lane c has no colliding events in lanes c+1, c+2, etc., expand its span!
    for (const item of assigned) {
      let span = 1;
      for (let c = item.lane + 1; c < totalColumns; c++) {
        const hasCollision = assigned.some(
          (other) =>
            other.lane === c &&
            other.startMin < item.endMin &&
            other.endMin > item.startMin
        );
        if (hasCollision) {
          break;
        }
        span++;
      }
      item.colSpan = span;
    }

    // Determine layout geometry
    // In Day View, screen space is wide (600px - 1400px), parallel columns fit easily up to 8 lanes.
    // In Week View, each day column is ~120px - 180px, so max 3 parallel columns fit comfortably.
    const maxParallelColumns = isDayView ? 8 : 3;

    if (totalColumns <= maxParallelColumns) {
      // Clean non-overlapping parallel columns with greedy expansion
      const colWidthPercent = 100 / totalColumns;
      for (const item of assigned) {
        result.push({
          event: item.event,
          top: item.top,
          height: item.height,
          leftPercent: item.lane * colWidthPercent,
          widthPercent: item.colSpan * colWidthPercent,
          zIndex: 10 + item.lane,
        });
      }
    } else {
      // High concurrency fallback in narrow columns (> 3 in Week, > 8 in Day)
      // Prevent squeezed toothpick slivers (< 20px) by maintaining a minimum readable card width
      // and cascading cards with solid opaque backgrounds and drop shadows
      const cardWidth = Math.max(62, 100 - (totalColumns - 1) * 6);
      const maxLane = totalColumns - 1;
      const step = (100 - cardWidth) / Math.max(1, maxLane);

      for (const item of assigned) {
        result.push({
          event: item.event,
          top: item.top,
          height: item.height,
          leftPercent: item.lane * step,
          widthPercent: cardWidth,
          zIndex: 10 + item.lane,
        });
      }
    }
  }

  return result;
}

/**
 * Calculates a 100% solid, fully-opaque RGB background color by blending
 * the calendar hex color over white (light theme) or #1E1F23 (dark theme).
 * Guarantees zero text shine-through and zero transparent bleed.
 */
export function getOpaqueEventBg(hex: string, isDark: boolean = false): string {
  const cleanHex = (hex || "#9E725F").replace("#", "");
  const r = parseInt(cleanHex.substring(0, 2), 16) || 158;
  const g = parseInt(cleanHex.substring(2, 4), 16) || 114;
  const b = parseInt(cleanHex.substring(4, 6), 16) || 95;

  if (isDark) {
    // Blend 20% color over #1E1F23 (rgb: 30, 31, 35)
    const br = Math.round(r * 0.20 + 30 * 0.80);
    const bg = Math.round(g * 0.20 + 31 * 0.80);
    const bb = Math.round(b * 0.20 + 35 * 0.80);
    return `rgb(${br}, ${bg}, ${bb})`;
  } else {
    // Blend 14% color over #FFFFFF (rgb: 255, 255, 255)
    const br = Math.round(r * 0.14 + 255 * 0.86);
    const bg = Math.round(g * 0.14 + 255 * 0.86);
    const bb = Math.round(b * 0.14 + 255 * 0.86);
    return `rgb(${br}, ${bg}, ${bb})`;
  }
}
