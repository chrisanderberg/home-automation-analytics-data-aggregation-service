import { describe, test, expect } from "bun:test";
import {
  quarterIndexAt,
  startOfQuarterMs,
  splitByUtcQuarter,
} from "./quarters.js";

/** 2026-03-31T23:59:00.000Z */
const Q1_END_MINUS_1MIN = Date.UTC(2026, 2, 31, 23, 59, 0, 0);
/** 2026-04-01T00:01:00.000Z (Q2 start + 1 min) */
const Q2_START_PLUS_1MIN = Date.UTC(2026, 3, 1, 0, 1, 0, 0);

describe("quarterIndexAt", () => {
  test("2026 Q1 (March) => (2026-1970)*4 + 0 = 224", () => {
    expect(quarterIndexAt(Q1_END_MINUS_1MIN)).toBe(224);
  });

  test("2026 Q2 (April) => (2026-1970)*4 + 1 = 225", () => {
    expect(quarterIndexAt(Q2_START_PLUS_1MIN)).toBe(225);
  });

  test("1970-01-01 UTC => 0", () => {
    expect(quarterIndexAt(Date.UTC(1970, 0, 1, 0, 0, 0, 0))).toBe(0);
  });

  test("1970-04-01 UTC => 1", () => {
    expect(quarterIndexAt(Date.UTC(1970, 3, 1, 0, 0, 0, 0))).toBe(1);
  });
});

describe("startOfQuarterMs", () => {
  test("quarter 224 (2026 Q1) => 2026-01-01T00:00:00.000Z", () => {
    const ms = startOfQuarterMs(224);
    expect(ms).toBe(Date.UTC(2026, 0, 1, 0, 0, 0, 0));
  });

  test("quarter 225 (2026 Q2) => 2026-04-01T00:00:00.000Z", () => {
    const ms = startOfQuarterMs(225);
    expect(ms).toBe(Date.UTC(2026, 3, 1, 0, 0, 0, 0));
  });

  test("negative quarterIndex -1 (1969 Q4) => 1969-10-01T00:00:00.000Z", () => {
    const ms = startOfQuarterMs(-1);
    expect(ms).toBe(Date.UTC(1969, 9, 1, 0, 0, 0, 0));
  });
});

describe("splitByUtcQuarter golden (plan.md acceptance)", () => {
  test("2026-03-31T23:59:00Z → 2026-04-01T00:01:00Z splits into two slices: 60k ms in Q1 and 60k ms in Q2", () => {
    const slices = splitByUtcQuarter(Q1_END_MINUS_1MIN, Q2_START_PLUS_1MIN);
    expect(slices).toHaveLength(2);
    expect(slices[0].quarterIndex).toBe(224);
    expect(slices[0].startTimeMs).toBe(Q1_END_MINUS_1MIN);
    expect(slices[0].endTimeMs).toBe(Date.UTC(2026, 3, 1, 0, 0, 0, 0));
    expect(slices[0].endTimeMs - slices[0].startTimeMs).toBe(60_000);

    expect(slices[1].quarterIndex).toBe(225);
    expect(slices[1].startTimeMs).toBe(Date.UTC(2026, 3, 1, 0, 0, 0, 0));
    expect(slices[1].endTimeMs).toBe(Q2_START_PLUS_1MIN);
    expect(slices[1].endTimeMs - slices[1].startTimeMs).toBe(60_000);
  });
});

describe("splitByUtcQuarter single quarter", () => {
  test("interval entirely inside one quarter => single slice", () => {
    const start = Date.UTC(2026, 1, 15, 10, 0, 0, 0);
    const end = start + 3600_000;
    const slices = splitByUtcQuarter(start, end);
    expect(slices).toHaveLength(1);
    expect(slices[0].quarterIndex).toBe(224);
    expect(slices[0].startTimeMs).toBe(start);
    expect(slices[0].endTimeMs).toBe(end);
    expect(slices[0].endTimeMs - slices[0].startTimeMs).toBe(3600_000);
  });
});

describe("splitByUtcQuarter three quarters", () => {
  test("interval spanning Q1–Q3 2026 => three slices", () => {
    const start = Date.UTC(2026, 2, 31, 23, 0, 0, 0); // end of Q1
    const end = Date.UTC(2026, 6, 1, 1, 0, 0, 0); // into Q3
    const slices = splitByUtcQuarter(start, end);
    expect(slices.length).toBe(3);
    const sumMs = slices.reduce(
      (s, x) => s + (x.endTimeMs - x.startTimeMs),
      0
    );
    expect(sumMs).toBe(end - start);
    expect(slices[0].quarterIndex).toBe(224);
    expect(slices[slices.length - 1].quarterIndex).toBe(226);
  });
});

describe("splitByUtcQuarter boundary at exact quarter start", () => {
  test("interval starts exactly at Q2 2026 => first slice is Q2", () => {
    const start = Date.UTC(2026, 3, 1, 0, 0, 0, 0);
    const end = start + 300_000;
    const slices = splitByUtcQuarter(start, end);
    expect(slices).toHaveLength(1);
    expect(slices[0].quarterIndex).toBe(225);
    expect(slices[0].startTimeMs).toBe(start);
    expect(slices[0].endTimeMs).toBe(end);
  });
});

describe("splitByUtcQuarter invalid", () => {
  test("endTimeMs <= startTimeMs => empty array", () => {
    expect(splitByUtcQuarter(1000, 1000)).toEqual([]);
    expect(splitByUtcQuarter(2000, 1000)).toEqual([]);
  });
});
