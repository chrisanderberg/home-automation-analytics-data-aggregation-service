import { describe, test, expect } from "bun:test";
import { UtcClock, LocalClock } from "./clocks.js";
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
import { holdIndex } from "./indices.js";
import { splitByUtcQuarter } from "./quarters.js";

const TIME_ZONE = "America/Los_Angeles";

/** 2026-03-31T23:59:00.000Z (Q1 2026, 1 min before Q2). */
const Q1_END_MINUS_1MIN = Date.UTC(2026, 2, 31, 23, 59, 0, 0);
/** 2026-04-01T00:01:00.000Z (Q2 2026, 1 min after Q2 start). */
const Q2_START_PLUS_1MIN = Date.UTC(2026, 3, 1, 0, 1, 0, 0);

describe("holding ingestion E2E: cross-quarter interval updates two aggregate rows", () => {
  test("ingest 2026-03-31T23:59:00Z → 2026-04-01T00:01:00Z in state 0; Q1 and Q2 rows have 60k ms each in expected UTC buckets", async () => {
    const db = openDb(":memory:");
    applySchema(db);
    const controlId = "test-control";
    const modelId = "m1";
    const state = 0;
    const numStates = 6;

    upsertControl(db, controlId, "discrete", numStates, null);
    const control = getControl(db, controlId);
    expect(control).not.toBeNull();
    expect(control!.numStates).toBe(numStates);

    const slices = splitByUtcQuarter(Q1_END_MINUS_1MIN, Q2_START_PLUS_1MIN);
    expect(slices).toHaveLength(2);
    expect(slices[0].endTimeMs - slices[0].startTimeMs).toBe(60_000);
    expect(slices[1].endTimeMs - slices[1].startTimeMs).toBe(60_000);

    await withImmediateTransaction(db, () => {
      for (const slice of slices) {
        getOrCreateAggregateRow(
          db,
          controlId,
          modelId,
          slice.quarterIndex,
          numStates
        );
        updateAggregateBlob(
          db,
          controlId,
          modelId,
          slice.quarterIndex,
          numStates,
          (dv) => {
            const utcSlices = UtcClock.splitInterval(
              slice.startTimeMs,
              slice.endTimeMs
            );
            for (const bs of utcSlices) {
              const idx = holdIndex(state, 0, bs.bucketIndex);
              const prev = getBlobValue(dv, idx);
              setBlobValue(dv, idx, prev + (bs.endTimeMs - bs.startTimeMs));
            }
            const localSlices = LocalClock.splitInterval(
              slice.startTimeMs,
              slice.endTimeMs,
              TIME_ZONE
            );
            for (const bs of localSlices) {
              const idx = holdIndex(state, 1, bs.bucketIndex);
              const prev = getBlobValue(dv, idx);
              setBlobValue(dv, idx, prev + (bs.endTimeMs - bs.startTimeMs));
            }
          }
        );
      }
    });

    const q1Row = db
      .query(
        "SELECT blob FROM aggregates WHERE control_id = ? AND model_id = ? AND quarter_index = ?"
      )
      .get(controlId, modelId, 224) as { blob: Uint8Array } | undefined;
    expect(q1Row).toBeDefined();
    const q1Buf = q1Row!.blob.buffer.slice(
      q1Row!.blob.byteOffset,
      q1Row!.blob.byteOffset + q1Row!.blob.byteLength
    );
    const q1Dv = new DataView(q1Buf);
    const q1Bucket = UtcClock.bucketAt(Q1_END_MINUS_1MIN);
    expect(getBlobValue(q1Dv, holdIndex(state, 0, q1Bucket))).toBe(60_000);

    const q2Row = db
      .query(
        "SELECT blob FROM aggregates WHERE control_id = ? AND model_id = ? AND quarter_index = ?"
      )
      .get(controlId, modelId, 225) as { blob: Uint8Array } | undefined;
    expect(q2Row).toBeDefined();
    const q2Buf = q2Row!.blob.buffer.slice(
      q2Row!.blob.byteOffset,
      q2Row!.blob.byteOffset + q2Row!.blob.byteLength
    );
    const q2Dv = new DataView(q2Buf);
    const q2Bucket = UtcClock.bucketAt(Date.UTC(2026, 3, 1, 0, 0, 0, 0));
    expect(getBlobValue(q2Dv, holdIndex(state, 0, q2Bucket))).toBe(60_000);
  });
});
