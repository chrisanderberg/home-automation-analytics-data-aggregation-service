import { describe, test, expect } from "bun:test";
import {
  UtcClock,
  LocalClock,
  MeanSolarClock,
  ApparentSolarClock,
  UnequalHoursClock,
  createClocks,
  type ClockContext,
} from "./clocks.js";

/** UTC ms for 2026-02-02T00:00:00.000Z (Monday 00:00 UTC). */
const MONDAY_00_00_UTC_MS = Date.UTC(2026, 1, 2, 0, 0, 0, 0);
/** UTC ms for 2026-02-01T23:59:59.999Z (Sunday 23:59 UTC). */
const SUNDAY_23_59_UTC_MS = Date.UTC(2026, 1, 1, 23, 59, 59, 999);
/** UTC ms for 2026-02-04T12:34:56.789Z (Wednesday 12:34 UTC). */
const WED_12_34_UTC_MS = Date.UTC(2026, 1, 4, 12, 34, 56, 789);

const LA = "America/Los_Angeles";
/** LA context for Local and solar clocks. */
const LA_CTX: ClockContext = {
  timeZone: LA,
  latitudeDeg: 37.77,
  longitudeDeg: -122.42,
};

describe("UTC bucketAt goldens (Monday=0)", () => {
  test("2026-02-02T00:00:00.000Z => bucket 0", () => {
    expect(UtcClock.bucketAt(MONDAY_00_00_UTC_MS)).toBe(0);
  });

  test("2026-02-01T23:59:59.999Z => bucket 2015", () => {
    expect(UtcClock.bucketAt(SUNDAY_23_59_UTC_MS)).toBe(2015);
  });

  test("2026-02-04T12:34:56.789Z => bucket 726", () => {
    expect(UtcClock.bucketAt(WED_12_34_UTC_MS)).toBe(726);
  });
});

describe("UTC splitInterval goldens", () => {
  test("single bucket: [Mon 00:00, Mon 00:05) one slice, sum(ms) = 300000", () => {
    const start = MONDAY_00_00_UTC_MS;
    const end = start + 5 * 60 * 1000;
    const slices = UtcClock.splitInterval(start, end) ?? [];
    expect(slices).toHaveLength(1);
    expect(slices[0].bucketIndex).toBe(0);
    expect(slices[0].startTimeMs).toBe(start);
    expect(slices[0].endTimeMs).toBe(end);
    const sumMs = slices.reduce((s, x) => s + (x.endTimeMs - x.startTimeMs), 0);
    expect(sumMs).toBe(end - start);
  });

  test("two buckets: [Mon 00:00, Mon 00:10) two slices, exact ms allocations", () => {
    const start = MONDAY_00_00_UTC_MS;
    const end = start + 10 * 60 * 1000;
    const slices = UtcClock.splitInterval(start, end) ?? [];
    expect(slices).toHaveLength(2);
    expect(slices[0].bucketIndex).toBe(0);
    expect(slices[0].startTimeMs).toBe(start);
    expect(slices[0].endTimeMs).toBe(start + 5 * 60 * 1000);
    expect(slices[1].bucketIndex).toBe(1);
    expect(slices[1].startTimeMs).toBe(start + 5 * 60 * 1000);
    expect(slices[1].endTimeMs).toBe(end);
    const sumMs = slices.reduce((s, x) => s + (x.endTimeMs - x.startTimeMs), 0);
    expect(sumMs).toBe(end - start);
  });

  test("spanning midnight UTC: [Sun 23:55, Mon 00:10) multiple slices, conservation", () => {
    const start = Date.UTC(2026, 1, 1, 23, 55, 0, 0); // Sunday 23:55
    const end = start + 20 * 60 * 1000; // +20 min => Mon 00:15
    const slices = UtcClock.splitInterval(start, end) ?? [];
    const sumMs = slices.reduce((s, x) => s + (x.endTimeMs - x.startTimeMs), 0);
    expect(sumMs).toBe(end - start);
    slices.forEach((s) => {
      expect(s.bucketIndex).toBeGreaterThanOrEqual(0);
      expect(s.bucketIndex).toBeLessThanOrEqual(2015);
    });
  });
});

describe("Local (America/Los_Angeles) DST invariant tests", () => {
  test("sum(ms) equals elapsed for 1-hour interval in winter", () => {
    const start = Date.UTC(2026, 0, 15, 18, 0, 0, 0);
    const end = start + 60 * 60 * 1000;
    const slices = LocalClock.splitInterval(start, end, LA_CTX) ?? [];
    const sumMs = slices.reduce((s, x) => s + (x.endTimeMs - x.startTimeMs), 0);
    expect(sumMs).toBe(end - start);
  });

  test("all bucket indices in range 0..2015", () => {
    const start = Date.UTC(2026, 0, 15, 18, 0, 0, 0);
    const end = start + 60 * 60 * 1000;
    const slices = LocalClock.splitInterval(start, end, LA_CTX) ?? [];
    slices.forEach((s) => {
      expect(s.bucketIndex).toBeGreaterThanOrEqual(0);
      expect(s.bucketIndex).toBeLessThanOrEqual(2015);
    });
  });

  test("sum(ms) equals elapsed for interval crossing DST (spring forward)", () => {
    const start = Date.UTC(2026, 2, 8, 9, 0, 0, 0);
    const end = start + 4 * 60 * 60 * 1000;
    const slices = LocalClock.splitInterval(start, end, LA_CTX) ?? [];
    const sumMs = slices.reduce((s, x) => s + (x.endTimeMs - x.startTimeMs), 0);
    expect(sumMs).toBe(end - start);
  });

  test("sum(ms) equals elapsed for interval crossing DST (fall back)", () => {
    const start = Date.UTC(2026, 10, 1, 8, 0, 0, 0);
    const end = start + 4 * 60 * 60 * 1000;
    const slices = LocalClock.splitInterval(start, end, LA_CTX) ?? [];
    const sumMs = slices.reduce((s, x) => s + (x.endTimeMs - x.startTimeMs), 0);
    expect(sumMs).toBe(end - start);
  });
});

describe("Five clocks (mid-latitude): all defined, conservation", () => {
  test("createClocks returns five clocks in canonical order", () => {
    const clocks = createClocks();
    expect(clocks).toHaveLength(5);
  });

  test("all five clocks return defined bucketAt for normal mid-latitude date", () => {
    const ms = Date.UTC(2026, 6, 15, 14, 30, 0, 0);
    expect(UtcClock.bucketAt(ms)).toBeDefined();
    expect(LocalClock.bucketAt(ms, LA_CTX)).toBeDefined();
    expect(MeanSolarClock.bucketAt(ms, LA_CTX)).toBeDefined();
    expect(ApparentSolarClock.bucketAt(ms, LA_CTX)).toBeDefined();
    const unequal = UnequalHoursClock.bucketAt(ms, LA_CTX);
    expect(unequal).toBeDefined();
    if (unequal !== undefined) {
      expect(unequal).toBeGreaterThanOrEqual(0);
      expect(unequal).toBeLessThanOrEqual(2015);
    }
  });

  test("Mean solar splitInterval: conservation and indices in range", () => {
    const start = Date.UTC(2026, 6, 15, 12, 0, 0, 0);
    const end = start + 60 * 60 * 1000;
    const slices = MeanSolarClock.splitInterval(start, end, LA_CTX);
    expect(slices).toBeDefined();
    const sumMs = (slices ?? []).reduce(
      (s, x) => s + (x.endTimeMs - x.startTimeMs),
      0
    );
    expect(sumMs).toBe(end - start);
    (slices ?? []).forEach((slice) => {
      expect(slice.bucketIndex).toBeGreaterThanOrEqual(0);
      expect(slice.bucketIndex).toBeLessThanOrEqual(2015);
    });
  });

  test("Apparent solar splitInterval: conservation and indices in range", () => {
    const start = Date.UTC(2026, 6, 15, 12, 0, 0, 0);
    const end = start + 60 * 60 * 1000;
    const slices = ApparentSolarClock.splitInterval(start, end, LA_CTX);
    expect(slices).toBeDefined();
    const sumMs = (slices ?? []).reduce(
      (s, x) => s + (x.endTimeMs - x.startTimeMs),
      0
    );
    expect(sumMs).toBe(end - start);
    (slices ?? []).forEach((slice) => {
      expect(slice.bucketIndex).toBeGreaterThanOrEqual(0);
      expect(slice.bucketIndex).toBeLessThanOrEqual(2015);
    });
  });

  test("Unequal hours splitInterval (mid-latitude): conservation when defined", () => {
    const start = Date.UTC(2026, 6, 15, 14, 0, 0, 0);
    const end = start + 30 * 60 * 1000;
    const slices = UnequalHoursClock.splitInterval(start, end, LA_CTX);
    if (slices !== undefined) {
      const sumMs = slices.reduce(
        (s, x) => s + (x.endTimeMs - x.startTimeMs),
        0
      );
      expect(sumMs).toBe(end - start);
      slices.forEach((slice) => {
        expect(slice.bucketIndex).toBeGreaterThanOrEqual(0);
        expect(slice.bucketIndex).toBeLessThanOrEqual(2015);
      });
    }
  });
});

describe("Unequal hours undefined (polar day/night)", () => {
  /** Longyearbyen ~78°N: polar night in December — sun does not rise. */
  const POLAR_CTX: ClockContext = {
    timeZone: "Arctic/Longyearbyen",
    latitudeDeg: 78.2,
    longitudeDeg: 15.6,
  };

  test("polar night: UnequalHoursClock.bucketAt returns undefined", () => {
    const ms = Date.UTC(2026, 11, 21, 12, 0, 0, 0);
    const bucket = UnequalHoursClock.bucketAt(ms, POLAR_CTX);
    expect(bucket).toBeUndefined();
  });

  test("polar night: other four clocks still defined", () => {
    const ms = Date.UTC(2026, 11, 21, 12, 0, 0, 0);
    expect(UtcClock.bucketAt(ms)).toBeDefined();
    expect(LocalClock.bucketAt(ms, POLAR_CTX)).toBeDefined();
    expect(MeanSolarClock.bucketAt(ms, POLAR_CTX)).toBeDefined();
    expect(ApparentSolarClock.bucketAt(ms, POLAR_CTX)).toBeDefined();
    expect(UnequalHoursClock.bucketAt(ms, POLAR_CTX)).toBeUndefined();
  });

  test("polar night: UnequalHoursClock.splitInterval returns undefined", () => {
    const start = Date.UTC(2026, 11, 21, 10, 0, 0, 0);
    const end = start + 60 * 60 * 1000;
    const slices = UnequalHoursClock.splitInterval(start, end, POLAR_CTX);
    expect(slices).toBeUndefined();
  });
});
