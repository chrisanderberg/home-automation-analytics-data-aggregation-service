import { B, G } from "./constants.js";

/**
 * Offset within the (from) block for transition pair (from, to).
 * Requires from !== to.
 */
export function offsetWithinFromBlock(from: number, to: number): number {
  return to < from ? to : to - 1;
}

/**
 * Transition group index for pair (from, to); range [0, N*(N-1)).
 * Requires from !== to.
 */
export function transGroupIndex(from: number, to: number, N: number): number {
  return from * (N - 1) + offsetWithinFromBlock(from, to);
}

/**
 * Holding time index: state s, clock c, bucket b.
 * Result in [0, N*G) for s in [0, N-1], c in [0, 4], b in [0, 2015].
 */
export function holdIndex(s: number, c: number, b: number): number {
  return s * G + c * B + b;
}

/**
 * Transition count index: (from, to), clock c, bucket b.
 * Requires from !== to. Result in [N*G, N²*G).
 */
export function transIndex(
  from: number,
  to: number,
  c: number,
  b: number,
  N: number
): number {
  return N * G + transGroupIndex(from, to, N) * G + c * B + b;
}
