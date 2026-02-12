import { describe, test, expect } from "bun:test";
import {
  withImmediateTransaction,
  updateAggregateBlob,
  getBlobValue,
  setBlobValue,
} from "./blob.js";
import { openDb, applySchema, upsertControl, getOrCreateAggregateRow } from "./db.js";
import { holdIndex } from "./indices.js";

describe("transactional RMW sanity", () => {
  test("two transactions (sequential) increment same cell; final value is sum", async () => {
    const db = openDb(":memory:");
    try {
      applySchema(db);
      const controlId = "test-control";
      const modelId = "m1";
      const quarterIndex = 0;
      const numStates = 6;

      upsertControl(db, controlId, "slider", numStates, null);
      await withImmediateTransaction(db, () => {
        getOrCreateAggregateRow(db, controlId, modelId, quarterIndex, numStates);
      });

      const cellIndex = holdIndex(0, 0, 0);
      const increment = 100;

      await withImmediateTransaction(db, () => {
        updateAggregateBlob(db, controlId, modelId, quarterIndex, numStates, (dv) => {
          const v = getBlobValue(dv, cellIndex);
          setBlobValue(dv, cellIndex, v + increment);
        });
      });
      await withImmediateTransaction(db, () => {
        updateAggregateBlob(db, controlId, modelId, quarterIndex, numStates, (dv) => {
          const v = getBlobValue(dv, cellIndex);
          setBlobValue(dv, cellIndex, v + increment);
        });
      });

      const row = db
        .query(
          "SELECT blob FROM aggregates WHERE control_id = ? AND model_id = ? AND quarter_index = ?"
        )
        .get(controlId, modelId, quarterIndex) as { blob: Uint8Array };
      expect(row).toBeDefined();
      const dv = new DataView(
        row.blob.buffer.slice(row.blob.byteOffset, row.blob.byteOffset + row.blob.byteLength)
      );
      const finalValue = getBlobValue(dv, cellIndex);
      expect(finalValue).toBe(2 * increment);
    } finally {
      db.close();
    }
  });
});
