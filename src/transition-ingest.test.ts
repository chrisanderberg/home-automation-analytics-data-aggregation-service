import { describe, test, expect } from "bun:test";
import { UtcClock, LocalClock, type ClockContext } from "./clocks.js";
import {
  withImmediateTransaction,
  updateAggregateBlob,
  getBlobValue,
  setBlobValue,
} from "./blob.js";
import {
  openDb,
  applySchema,
  upsertControl,
  getControl,
  getOrCreateAggregateRow,
} from "./db.js";
import { transIndex } from "./indices.js";
import { quarterIndexAt } from "./quarters.js";

const CTX: ClockContext = {
  timeZone: "America/Los_Angeles",
  latitudeDeg: 37.77,
  longitudeDeg: -122.42,
};

/** 2026-02-02T00:02:00.000Z (Monday 00:02 UTC => UTC bucket 0). */
const TRANSITION_TS = Date.UTC(2026, 1, 2, 0, 2, 0, 0);

describe("transition ingestion E2E: UTC and Local transIndex increments", () => {
  test("ingest transition at 2026-02-02T00:02:00Z 5→2; UTC transIndex(5,2,0,0,6)=1 and Local transIndex(5,2,1,localBucket,6)=1", async () => {
    const db = openDb(":memory:");
    try {
      applySchema(db);
      const controlId = "test-control";
      const modelId = "m1";
      const fromState = 5;
      const toState = 2;
      const numStates = 6;

      upsertControl(db, controlId, "discrete", numStates, null);
      const control = getControl(db, controlId);
      expect(control).not.toBeNull();
      expect(control!.numStates).toBe(numStates);

      const quarterIndex = quarterIndexAt(TRANSITION_TS);
      await withImmediateTransaction(db, () => {
        getOrCreateAggregateRow(
          db,
          controlId,
          modelId,
          quarterIndex,
          numStates
        );
        updateAggregateBlob(
          db,
          controlId,
          modelId,
          quarterIndex,
          numStates,
          (dv) => {
            const utcBucket = UtcClock.bucketAt(TRANSITION_TS);
            const utcIdx = transIndex(fromState, toState, 0, utcBucket!, numStates);
            const utcPrev = getBlobValue(dv, utcIdx);
            setBlobValue(dv, utcIdx, utcPrev + 1);
            const localBucket = LocalClock.bucketAt(TRANSITION_TS, CTX);
            expect(localBucket).toBeDefined();
            const localIdx = transIndex(fromState, toState, 1, localBucket!, numStates);
            const localPrev = getBlobValue(dv, localIdx);
            setBlobValue(dv, localIdx, localPrev + 1);
          }
        );
      });

      const row = db
        .query(
          "SELECT blob FROM aggregates WHERE control_id = ? AND model_id = ? AND quarter_index = ?"
        )
        .get(controlId, modelId, quarterIndex) as { blob: Uint8Array } | undefined;
      expect(row).toBeDefined();
      const buf = row!.blob.buffer.slice(
        row!.blob.byteOffset,
        row!.blob.byteOffset + row!.blob.byteLength
      );
      const dv = new DataView(buf);

      expect(UtcClock.bucketAt(TRANSITION_TS)).toBe(0);
      expect(getBlobValue(dv, transIndex(5, 2, 0, 0, 6))).toBe(1);

      const localBucket = LocalClock.bucketAt(TRANSITION_TS, CTX);
      expect(localBucket).toBeDefined();
      expect(getBlobValue(dv, transIndex(5, 2, 1, localBucket!, 6))).toBe(1);
    } finally {
      db.close();
    }
  });
});
