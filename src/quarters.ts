/**
 * UTC calendar quarter splitting for holding intervals.
 * quarterIndex = (utcYear - 1970) * 4 + (quarterNumber - 1);
 * Q1 = Jan–Mar, Q2 = Apr–Jun, Q3 = Jul–Sep, Q4 = Oct–Dec.
 */

export interface QuarterSlice {
  quarterIndex: number;
  startTimeMs: number;
  endTimeMs: number;
}

/**
 * Quarter index for a given UTC epoch ms.
 * Uses only UTC so tests are timezone-independent.
 */
export function quarterIndexAt(utcMs: number): number {
  const d = new Date(utcMs);
  const utcYear = d.getUTCFullYear();
  const utcMonth = d.getUTCMonth() + 1; // 1–12
  const quarterNumber = Math.floor((utcMonth - 1) / 3) + 1; // 1–4
  return (utcYear - 1970) * 4 + (quarterNumber - 1);
}

/**
 * UTC epoch ms of the first instant of the given quarter (00:00:00.000 UTC
 * on the first day of the quarter).
 */
export function startOfQuarterMs(quarterIndex: number): number {
  const year = 1970 + Math.floor(quarterIndex / 4);
  const quarterNumber = (quarterIndex % 4) + 1;
  const month = (quarterNumber - 1) * 3; // 0-based for Date
  return Date.UTC(year, month, 1, 0, 0, 0, 0);
}

/**
 * Split [startTimeMs, endTimeMs) into per-quarter slices.
 * Returns [] if endTimeMs <= startTimeMs.
 */
export function splitByUtcQuarter(
  startTimeMs: number,
  endTimeMs: number
): QuarterSlice[] {
  if (endTimeMs <= startTimeMs) {
    return [];
  }
  const slices: QuarterSlice[] = [];
  let current = startTimeMs;
  while (current < endTimeMs) {
    const q = quarterIndexAt(current);
    const endOfQuarterMs = startOfQuarterMs(q + 1);
    const sliceEndMs = Math.min(endTimeMs, endOfQuarterMs);
    slices.push({
      quarterIndex: q,
      startTimeMs: current,
      endTimeMs: sliceEndMs,
    });
    current = sliceEndMs;
  }
  return slices;
}
