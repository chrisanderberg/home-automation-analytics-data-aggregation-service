/**
 * Transactional blob read-modify-write for aggregate updates.
 * TODO: withImmediateTransaction(fn) — BEGIN IMMEDIATE, run fn, COMMIT/ROLLBACK (Milestone 2).
 * TODO: updateAggregateBlob() — used only inside a transaction (Milestone 2).
 */

import type { Database } from "bun:sqlite";

export async function withImmediateTransaction<T>(
  _db: Database,
  _fn: () => T | Promise<T>
): Promise<T> {
  // TODO: BEGIN IMMEDIATE; run fn; COMMIT or ROLLBACK; Milestone 2
  throw new Error("withImmediateTransaction not implemented");
}

export function updateAggregateBlob(
  _db: Database,
  _controlId: string,
  _modelId: string,
  _quarterIndex: number,
  _numStates: number,
  _updater: (buffer: ArrayBuffer) => void
): void {
  // TODO: read blob, run updater on buffer, write back; only inside transaction (Milestone 2)
  throw new Error("updateAggregateBlob not implemented");
}
