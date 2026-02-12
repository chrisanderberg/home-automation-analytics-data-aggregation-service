/**
 * Dense blob layout constants (spec: time-of-week buckets, 5 clocks).
 * B = buckets per week, C = clocks, G = values per bucket group.
 */
export const B = 2016;
export const C = 5;
export const G = B * C; // 10080

/**
 * Total number of values in the blob for a control with N states.
 * Blob length = N² × G.
 */
export function blobLength(numStates: number): number {
  return numStates * numStates * G;
}
