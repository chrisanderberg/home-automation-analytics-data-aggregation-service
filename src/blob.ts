/**
 * Transactional blob read-modify-write for aggregate updates.
 * Blob encoding: 64-bit little-endian unsigned integer per value (same as
 * blobLength(numStates) values; indices from indices.ts).
 */

import type { Database } from "bun:sqlite";
import { blobLength } from "./constants.js";
import { BLOB_VALUE_BYTES } from "./db.js";
import { IntegrityError } from "./errors.js";

/** Read value at slot index (64-bit LE). Values fit in number for holding ms and counts. */
export function getBlobValue(dv: DataView, index: number): number {
  const n = dv.getBigUint64(index * BLOB_VALUE_BYTES, true);
  return Number(n);
}

/** Write value at slot index (64-bit LE). */
export function setBlobValue(dv: DataView, index: number, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      "setBlobValue: value must be a finite number >= 0, got " + value
    );
  }
  dv.setBigUint64(index * BLOB_VALUE_BYTES, BigInt(Math.floor(value)), true);
}

/**
 * Run fn inside BEGIN IMMEDIATE ... COMMIT. On throw, ROLLBACK and rethrow.
 * If COMMIT throws, ROLLBACK is attempted (errors ignored) and the commit error is rethrown
 * so the transaction is not left open.
 * Use for all aggregate blob updates so concurrent writers do not lose updates.
 */
export async function withImmediateTransaction<T>(
  db: Database,
  fn: () => T | Promise<T>
): Promise<T> {
  db.run("BEGIN IMMEDIATE");
  try {
    const result = await fn();
    try {
      db.run("COMMIT");
    } catch (commitErr) {
      try {
        db.run("ROLLBACK");
      } catch (_) {
        /* ignore rollback error; caller sees commit failure */
      }
      throw commitErr;
    }
    return result;
  } catch (e) {
    db.run("ROLLBACK");
    throw e;
  }
}

/**
 * Read aggregate blob, run updater(DataView), write back. Must only be called
 * inside an active transaction (e.g. inside withImmediateTransaction callback).
 * Blob has blobLength(numStates) slots; use getBlobValue/setBlobValue on the
 * DataView to read/write by slot index (holdIndex, transIndex from indices.ts).
 */
export function updateAggregateBlob(
  db: Database,
  controlId: string,
  modelId: string,
  quarterIndex: number,
  numStates: number,
  updater: (dv: DataView) => void
): void {
  const row = db
    .query(
      "SELECT blob FROM aggregates WHERE control_id = ? AND model_id = ? AND quarter_index = ?"
    )
    .get(controlId, modelId, quarterIndex) as { blob: Uint8Array } | undefined;
  if (!row) {
    throw new Error("aggregate row missing; call getOrCreateAggregateRow first");
  }
  const expectedBytes = blobLength(numStates) * BLOB_VALUE_BYTES;
  if (row.blob.length !== expectedBytes) {
    throw new IntegrityError("aggregate blob length mismatch");
  }
  const buf = row.blob.buffer.slice(
    row.blob.byteOffset,
    row.blob.byteOffset + row.blob.byteLength
  );
  const dv = new DataView(buf);
  updater(dv);
  const updated = new Uint8Array(buf);
  db.run(
    "UPDATE aggregates SET blob = ? WHERE control_id = ? AND model_id = ? AND quarter_index = ?",
    [updated, controlId, modelId, quarterIndex]
  );
}
