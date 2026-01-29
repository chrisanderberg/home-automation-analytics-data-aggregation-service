/**
 * UTC calendar quarter splitting for holding intervals.
 * TODO: implement splitByUtcQuarter() — split [start, end) into per-quarter
 * slices (quarterIndex, startTimeMs, endTimeMs) for ingestion (Milestone 4).
 */

export interface QuarterSlice {
  quarterIndex: number;
  startTimeMs: number;
  endTimeMs: number;
}

export function splitByUtcQuarter(
  _startTimeMs: number,
  _endTimeMs: number
): QuarterSlice[] {
  // TODO: implement; Milestone 4
  throw new Error("splitByUtcQuarter not implemented");
}
