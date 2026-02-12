/**
 * Five clocks: UTC, Local, Mean solar, Apparent solar, Unequal hours.
 * All five implemented; solar clocks use SunCalc (Milestone 7).
 */

import { Temporal } from "@js-temporal/polyfill";
import * as SunCalc from "suncalc";

export interface BucketSlice {
  bucketIndex: number;
  startTimeMs: number;
  endTimeMs: number;
}

/** Context passed to clocks that need location or timezone. */
export interface ClockContext {
  timeZone: string;
  latitudeDeg: number;
  longitudeDeg: number;
}

/** Unified clock interface: bucketAt and splitInterval may return undefined (e.g. polar unequal hours). */
export interface Clock {
  bucketAt(ms: number, ctx?: ClockContext): number | undefined;
  splitInterval(
    startTimeMs: number,
    endTimeMs: number,
    ctx?: ClockContext
  ): BucketSlice[] | undefined;
}

/** 5-minute bucket duration in ms. */
const BUCKET_MS = 5 * 60 * 1000;
/** Ms per day. */
const DAY_MS = 24 * 60 * 60 * 1000;
/** Ms per week. */
const WEEK_MS = 7 * DAY_MS;
/** Buckets per day. */
const BUCKETS_PER_DAY = 288;

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

/** UTC ms at end of 5-min bucket containing ms. */
function utcBucketEndMs(ms: number): number {
  return utcBucketStartMs(ms) + BUCKET_MS;
}

/**
 * Split [startTimeMs, endTimeMs) into 5-min bucket slices using the given
 * bucket index and bucket end calculators. Returns BucketSlice[] with
 * sum(slice.endTimeMs - slice.startTimeMs) === endTimeMs - startTimeMs.
 */
function splitIntervalGeneric(
  startTimeMs: number,
  endTimeMs: number,
  bucketAt: (ms: number) => number,
  bucketEndMs: (ms: number) => number
): BucketSlice[] {
  const slices: BucketSlice[] = [];
  let current = startTimeMs;
  while (current < endTimeMs) {
    const bucketIndex = bucketAt(current);
    const bucketEnd = bucketEndMs(current);
    if (bucketEnd < current) {
      throw new Error("bucketEndMs returned time before current");
    }
    const sliceEndMs = Math.min(endTimeMs, bucketEnd);
    slices.push({
      bucketIndex,
      startTimeMs: current,
      endTimeMs: sliceEndMs,
    });
    current = Math.max(sliceEndMs, current + 1);
  }
  return slices;
}

/** UTC clock: always defined. */
export const UtcClock: Clock = {
  bucketAt(ms: number): number {
    return utcBucketAt(ms);
  },
  splitInterval(startTimeMs: number, endTimeMs: number): BucketSlice[] {
    return splitIntervalGeneric(
      startTimeMs,
      endTimeMs,
      utcBucketAt,
      utcBucketEndMs
    );
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

/** Local clock: requires timeZone in context; always defined. */
export const LocalClock: Clock = {
  bucketAt(ms: number, ctx?: ClockContext): number {
    if (!ctx) return localBucketAt(ms, "UTC");
    return localBucketAt(ms, ctx.timeZone);
  },
  splitInterval(
    startTimeMs: number,
    endTimeMs: number,
    ctx?: ClockContext
  ): BucketSlice[] {
    const tz = ctx?.timeZone ?? "UTC";
    return splitIntervalGeneric(
      startTimeMs,
      endTimeMs,
      (ms) => localBucketAt(ms, tz),
      (ms) => localBucketEndMs(ms, tz)
    );
  },
};

/** Start of Monday 00:00 UTC for the week containing utcMs. */
function weekStartMs(utcMs: number): number {
  const d = new Date(utcMs);
  const utcDay = d.getUTCDay(); // 0=Sun .. 6=Sat
  const daysFromMonday = (utcDay + 6) % 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - daysFromMonday);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.getTime();
}

/** Mean solar: LMT = UTC + (longitude/15) hours. Always defined. */
function meanSolarBucketAt(ms: number, longitudeDeg: number): number {
  const weekStart = weekStartMs(ms);
  const meanSolarMsInWeek =
    (ms - weekStart) + (longitudeDeg / 15) * (60 * 60 * 1000);
  const normalized = ((meanSolarMsInWeek % WEEK_MS) + WEEK_MS) % WEEK_MS;
  const dayIndex = Math.floor(normalized / DAY_MS) % 7;
  const msInDay = normalized % DAY_MS;
  const bucketOfDay = Math.floor(msInDay / BUCKET_MS);
  return dayIndex * BUCKETS_PER_DAY + bucketOfDay;
}

/** UTC ms at end of mean-solar 5-min bucket containing utcMs. */
function meanSolarBucketEndMs(ms: number, longitudeDeg: number): number {
  const weekStart = weekStartMs(ms);
  const meanSolarMsInWeek =
    (ms - weekStart) + (longitudeDeg / 15) * (60 * 60 * 1000);
  const normalized = ((meanSolarMsInWeek % WEEK_MS) + WEEK_MS) % WEEK_MS;
  const bucketInWeek = Math.floor(normalized / BUCKET_MS);
  const nextBucketMeanSolarMs = (bucketInWeek + 1) * BUCKET_MS;
  let nextBucketUtcMs =
    weekStart +
    ((nextBucketMeanSolarMs - (longitudeDeg / 15) * (60 * 60 * 1000) + WEEK_MS) %
      WEEK_MS);
  if (nextBucketUtcMs <= ms) {
    nextBucketUtcMs += WEEK_MS;
  }
  return nextBucketUtcMs;
}

/** Mean solar clock: requires longitudeDeg in context; always defined. */
export const MeanSolarClock: Clock = {
  bucketAt(ms: number, ctx?: ClockContext): number {
    const lon = ctx?.longitudeDeg ?? 0;
    return meanSolarBucketAt(ms, lon);
  },
  splitInterval(
    startTimeMs: number,
    endTimeMs: number,
    ctx?: ClockContext
  ): BucketSlice[] {
    const lon = ctx?.longitudeDeg ?? 0;
    return splitIntervalGeneric(
      startTimeMs,
      endTimeMs,
      (ms) => meanSolarBucketAt(ms, lon),
      (ms) => meanSolarBucketEndMs(ms, lon)
    );
  },
};

/** Solar noon (UTC ms) for the calendar day containing utcMs at (lat, lon). */
function solarNoonMsForDay(
  utcMs: number,
  lat: number,
  lon: number
): number {
  const d = new Date(utcMs);
  const times = SunCalc.getTimes(d, lat, lon);
  return times.solarNoon.getTime();
}

/** Apparent solar: time of day = offset from solar noon; 24h clock, Monday=0. Always defined. */
function apparentSolarBucketAt(
  ms: number,
  lat: number,
  lon: number
): number {
  const noonMs = solarNoonMsForDay(ms, lat, lon);
  const dayStart = new Date(noonMs);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayStartMs = dayStart.getTime();
  const apparentMsInDay = ((ms - noonMs) % DAY_MS + DAY_MS) % DAY_MS;
  const d = new Date(dayStartMs + apparentMsInDay);
  const dayIndex = utcDayIndex(d.getTime());
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const bucketOfDay = hour * 12 + Math.floor(minute / 5);
  return dayIndex * BUCKETS_PER_DAY + bucketOfDay;
}

/** UTC ms at end of apparent-solar 5-min bucket. */
function apparentSolarBucketEndMs(
  ms: number,
  lat: number,
  lon: number
): number {
  const noonMs = solarNoonMsForDay(ms, lat, lon);
  const apparentMsInDay = ((ms - noonMs) % DAY_MS + DAY_MS) % DAY_MS;
  const bucketOfDay = Math.floor(apparentMsInDay / BUCKET_MS);
  const nextBucketApparentMs = (bucketOfDay + 1) * BUCKET_MS;
  if (nextBucketApparentMs < DAY_MS) {
    return noonMs + nextBucketApparentMs;
  }
  const nextNoonMs = solarNoonMsForDay(noonMs + DAY_MS, lat, lon);
  return nextNoonMs + (nextBucketApparentMs - DAY_MS);
}

/** Apparent solar clock: requires lat/lon in context; always defined. */
export const ApparentSolarClock: Clock = {
  bucketAt(ms: number, ctx?: ClockContext): number | undefined {
    if (ctx === undefined) return undefined;
    return apparentSolarBucketAt(ms, ctx.latitudeDeg, ctx.longitudeDeg);
  },
  splitInterval(
    startTimeMs: number,
    endTimeMs: number,
    ctx?: ClockContext
  ): BucketSlice[] | undefined {
    if (ctx === undefined) return undefined;
    const lat = ctx.latitudeDeg;
    const lon = ctx.longitudeDeg;
    return splitIntervalGeneric(
      startTimeMs,
      endTimeMs,
      (ms) => apparentSolarBucketAt(ms, lat, lon),
      (ms) => apparentSolarBucketEndMs(ms, lat, lon)
    );
  },
};

/** Check if a Date from SunCalc is valid (e.g. not polar day/night). */
function isValidSunTime(date: Date): boolean {
  return isFinite(date.getTime());
}

/** Unequal hours: 6:00 = sunrise, 18:00 = sunset; 12 day hours, 12 night hours. Undefined if no sunrise/sunset. */
function unequalHoursBucketAt(
  ms: number,
  lat: number,
  lon: number
): number | undefined {
  const d = new Date(ms);
  const times = SunCalc.getTimes(d, lat, lon);
  const sunrise = times.sunrise;
  const sunset = times.sunset;
  if (!isValidSunTime(sunrise) || !isValidSunTime(sunset)) return undefined;
  const riseMs = sunrise.getTime();
  const setMs = sunset.getTime();
  if (setMs <= riseMs) return undefined;
  const dayLengthMs = setMs - riseMs;
  const nightLengthMs = DAY_MS - dayLengthMs;
  if (nightLengthMs <= 0 || dayLengthMs <= 0) return undefined;

  const dayStart = new Date(riseMs);
  dayStart.setUTCHours(0, 0, 0, 0);
  const weekStart = weekStartMs(ms);
  const dayStartMs = dayStart.getTime();
  let dayIndex = Math.floor((dayStartMs - weekStart) / DAY_MS);
  dayIndex = ((dayIndex % 7) + 7) % 7;

  let unequalBucketInDay: number;
  if (ms >= riseMs && ms < setMs) {
    const frac = (ms - riseMs) / dayLengthMs;
    unequalBucketInDay = Math.min(Math.floor(frac * 144), 143);
  } else {
    let msInNight: number;
    if (ms >= setMs) {
      msInNight = ms - setMs;
    } else {
      msInNight = ms - (setMs - DAY_MS);
    }
    const frac = Math.min(msInNight / nightLengthMs, 1);
    unequalBucketInDay = Math.min(144 + Math.floor(frac * 144), 287);
  }

  return dayIndex * BUCKETS_PER_DAY + unequalBucketInDay;
}

function unequalHoursBucketEndMs(
  ms: number,
  lat: number,
  lon: number
): number | undefined {
  const d = new Date(ms);
  const times = SunCalc.getTimes(d, lat, lon);
  const sunrise = times.sunrise;
  const sunset = times.sunset;
  if (!isValidSunTime(sunrise) || !isValidSunTime(sunset)) return undefined;
  const riseMs = sunrise.getTime();
  const setMs = sunset.getTime();
  if (setMs <= riseMs) return undefined;
  const dayLengthMs = setMs - riseMs;
  const nightLengthMs = DAY_MS - dayLengthMs;
  if (nightLengthMs <= 0 || dayLengthMs <= 0) return undefined;

  if (ms >= riseMs && ms < setMs) {
    const msSinceRise = ms - riseMs;
    const dayBucket = Math.floor(msSinceRise / (dayLengthMs / 144));
    const nextBucketStart = riseMs + (dayBucket + 1) * (dayLengthMs / 144);
    return Math.min(nextBucketStart, setMs);
  }
  if (ms >= setMs) {
    const msSinceSet = ms - setMs;
    const nightBucket = Math.floor(msSinceSet / (nightLengthMs / 144));
    const nextBucketStart = setMs + (nightBucket + 1) * (nightLengthMs / 144);
    const nightEndMs = riseMs + DAY_MS;
    return Math.min(nextBucketStart, nightEndMs);
  }
  const msSincePrevMidnight = ms - (setMs - DAY_MS);
  const nightBucket = Math.floor(msSincePrevMidnight / (nightLengthMs / 144));
  const nextBucketStart =
    setMs - DAY_MS + (nightBucket + 1) * (nightLengthMs / 144);
  return Math.min(nextBucketStart, riseMs);
}

/** Unequal hours clock: undefined when sun doesn't rise or set. */
export const UnequalHoursClock: Clock = {
  bucketAt(ms: number, ctx?: ClockContext): number | undefined {
    if (ctx === undefined) return undefined;
    return unequalHoursBucketAt(ms, ctx.latitudeDeg, ctx.longitudeDeg);
  },
  splitInterval(
    startTimeMs: number,
    endTimeMs: number,
    ctx?: ClockContext
  ): BucketSlice[] | undefined {
    if (ctx === undefined) return undefined;
    const lat = ctx.latitudeDeg;
    const lon = ctx.longitudeDeg;
    const slices: BucketSlice[] = [];
    let current = startTimeMs;
    while (current < endTimeMs) {
      const bucket = unequalHoursBucketAt(current, lat, lon);
      if (bucket === undefined) return undefined;
      const bucketEndMs = unequalHoursBucketEndMs(current, lat, lon);
      if (bucketEndMs === undefined) return undefined;
      const sliceEndMs = Math.min(endTimeMs, Math.max(bucketEndMs, current + 1));
      slices.push({
        bucketIndex: bucket,
        startTimeMs: current,
        endTimeMs: sliceEndMs,
      });
      current = sliceEndMs;
    }
    return slices;
  },
};

/** Returns all five clocks in canonical order: UTC, Local, Mean solar, Apparent solar, Unequal hours. */
export function createClocks(): Clock[] {
  return [
    UtcClock,
    LocalClock,
    MeanSolarClock,
    ApparentSolarClock,
    UnequalHoursClock,
  ];
}
