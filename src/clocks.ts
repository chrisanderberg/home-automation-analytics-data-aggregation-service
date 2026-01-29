/**
 * Five clocks: UTC, Local, Mean solar, Apparent solar, Unequal hours.
 * TODO: UtcClock.splitInterval, LocalClock.splitInterval (Milestone 3).
 * TODO: Solar clock mapping implementations — MeanSolarClock, ApparentSolarClock,
 * UnequalHoursClock using SunCalc (Milestone 7).
 */

export interface BucketSlice {
  bucketIndex: number;
  startTimeMs: number;
  endTimeMs: number;
}

export const UtcClock = {
  /** TODO: implement; Milestone 3. Split [start,end) into 5-min bucket slices; sum(ms) === end - start. */
  splitInterval(_startTimeMs: number, _endTimeMs: number): BucketSlice[] {
    throw new Error("UtcClock.splitInterval not implemented");
  },
};

export const LocalClock = {
  /** TODO: implement; Milestone 3. Local time in configurable IANA timezone (Temporal). */
  splitInterval(_startTimeMs: number, _endTimeMs: number): BucketSlice[] {
    throw new Error("LocalClock.splitInterval not implemented");
  },
};
