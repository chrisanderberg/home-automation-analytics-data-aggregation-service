/**
 * Five clocks: UTC, Local, Mean solar, Apparent solar, Unequal hours.
 * UTC and Local implemented (Milestone 3); solar clocks TODO (Milestone 7).
 */

import { Temporal } from "@js-temporal/polyfill";

export interface BucketSlice {
  bucketIndex: number;
  startTimeMs: number;
  endTimeMs: number;
}

/** 5-minute bucket duration in ms. */
const BUCKET_MS = 5 * 60 * 1000;

/** UTC: Monday = 0, ..., Sunday = 6. */
function utcDayIndex(ms: number): number {
  const d = new Date(ms);
  const utcDay = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  return (utcDay + 6) % 7;
}

/** UTC bucket containing timestamp (0..2015). */
export function utcBucketAt(ms: number): number {
  const d = new Date(ms);
  const dayIndex = utcDayIndex(ms);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const bucketOfDay = hour * 12 + Math.floor(minute / 5);
  return dayIndex * 288 + bucketOfDay;
}

/** UTC ms at start of bucket containing ms. */
function utcBucketStartMs(ms: number): number {
  const d = new Date(ms);
  d.setUTCMilliseconds(0);
  d.setUTCSeconds(0);
  d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 5) * 5);
  return d.getTime();
}

export const UtcClock = {
  bucketAt: utcBucketAt,

  /** Split [start,end) into 5-min bucket slices; sum(ms) === end - start. */
  splitInterval(startTimeMs: number, endTimeMs: number): BucketSlice[] {
    const slices: BucketSlice[] = [];
    let current = startTimeMs;
    while (current < endTimeMs) {
      const bucketIndex = utcBucketAt(current);
      const bucketEndMs = utcBucketStartMs(current) + BUCKET_MS;
      const sliceEndMs = Math.min(endTimeMs, bucketEndMs);
      slices.push({
        bucketIndex,
        startTimeMs: current,
        endTimeMs: sliceEndMs,
      });
      current = sliceEndMs;
    }
    return slices;
  },
};

/** Local: Monday = 0, ..., Sunday = 6; IANA timezone. */
export function localBucketAt(ms: number, timeZone: string): number {
  const instant = Temporal.Instant.fromEpochMilliseconds(ms);
  const zdt = instant.toZonedDateTimeISO(timeZone);
  const dayOfWeek = zdt.dayOfWeek; // 1=Mon .. 7=Sun
  const dayIndex = dayOfWeek - 1;
  const hour = zdt.hour;
  const minute = zdt.minute;
  const bucketOfDay = hour * 12 + Math.floor(minute / 5);
  return dayIndex * 288 + bucketOfDay;
}

/** Local: real ms at end of 5-min bucket containing ms (in given timezone). */
function localBucketEndMs(ms: number, timeZone: string): number {
  const instant = Temporal.Instant.fromEpochMilliseconds(ms);
  const zdt = instant.toZonedDateTimeISO(timeZone);
  const min = zdt.minute;
  const bucketMin = Math.floor(min / 5) * 5;
  const bucketStart = zdt.with(
    { minute: bucketMin, second: 0, millisecond: 0 },
    { overflow: "constrain" }
  );
  const bucketEnd = bucketStart.add({ minutes: 5 });
  return bucketEnd.epochMilliseconds;
}

export const LocalClock = {
  bucketAt: localBucketAt,

  /** Split [start,end) by local 5-min buckets in configurable IANA timezone. */
  splitInterval(
    startTimeMs: number,
    endTimeMs: number,
    timeZone: string
  ): BucketSlice[] {
    const slices: BucketSlice[] = [];
    let current = startTimeMs;
    while (current < endTimeMs) {
      const bucketIndex = localBucketAt(current, timeZone);
      const bucketEndMs = localBucketEndMs(current, timeZone);
      const sliceEndMs = Math.min(endTimeMs, bucketEndMs);
      slices.push({
        bucketIndex,
        startTimeMs: current,
        endTimeMs: sliceEndMs,
      });
      current = sliceEndMs;
    }
    return slices;
  },
};
