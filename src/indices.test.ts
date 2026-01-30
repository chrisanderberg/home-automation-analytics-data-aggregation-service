import { describe, test, expect } from "bun:test";
import { G, blobLength } from "./constants.js";
import {
  holdIndex,
  transIndex,
  transGroupIndex,
} from "./indices.js";

describe("blob length", () => {
  for (const N of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    test(`blobLength(${N}) === N² × G`, () => {
      expect(blobLength(N)).toBe(N * N * G);
    });
  }
  test("blobLength(6) explicitly (slider)", () => {
    expect(blobLength(6)).toBe(6 * 6 * G);
  });
});

describe("holding region [0, N*G)", () => {
  for (const N of [2, 6, 10]) {
    test(`N=${N}: holdIndex(0,0,0) === 0`, () => {
      expect(holdIndex(0, 0, 0)).toBe(0);
    });
    test(`N=${N}: last holding index holdIndex(N-1, 4, 2015) === N*G - 1`, () => {
      expect(holdIndex(N - 1, 4, 2015)).toBe(N * G - 1);
    });
    test(`N=${N}: no holding index >= N*G`, () => {
      const maxHold = N * G;
      expect(holdIndex(N - 1, 4, 2015)).toBeLessThan(maxHold);
      expect(holdIndex(0, 0, 0)).toBeLessThan(maxHold);
    });
  }
});

describe("transition region [N*G, N²*G)", () => {
  for (const N of [2, 6, 10]) {
    test(`N=${N}: first transition index transIndex(0,1,0,0,N) === N*G`, () => {
      expect(transIndex(0, 1, 0, 0, N)).toBe(N * G);
    });
    test(`N=${N}: last transition index === N²*G - 1`, () => {
      const lastFrom = N - 1;
      const lastTo = N - 2;
      expect(transIndex(lastFrom, lastTo, 4, 2015, N)).toBe(N * N * G - 1);
    });
    test(`N=${N}: no transition index < N*G or >= N²*G`, () => {
      const lo = N * G;
      const hi = N * N * G;
      expect(transIndex(0, 1, 0, 0, N)).toBeGreaterThanOrEqual(lo);
      expect(transIndex(0, 1, 0, 0, N)).toBeLessThan(hi);
      const lastFrom = N - 1;
      const lastTo = N - 2;
      expect(transIndex(lastFrom, lastTo, 4, 2015, N)).toBeGreaterThanOrEqual(lo);
      expect(transIndex(lastFrom, lastTo, 4, 2015, N)).toBeLessThan(hi);
    });
  }
});

describe("transition groups cover all from != to exactly once", () => {
  for (const N of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    test(`N=${N}: exactly N*(N-1) distinct transGroupIndex values`, () => {
      const seen = new Set<number>();
      for (let from = 0; from < N; from++) {
        for (let to = 0; to < N; to++) {
          if (from === to) continue;
          const g = transGroupIndex(from, to, N);
          seen.add(g);
          expect(g).toBeGreaterThanOrEqual(0);
          expect(g).toBeLessThan(N * (N - 1));
        }
      }
      expect(seen.size).toBe(N * (N - 1));
    });
  }
  test("N=2: (0,1) and (1,0) exercise to<from and to>from", () => {
    const g01 = transGroupIndex(0, 1, 2);
    const g10 = transGroupIndex(1, 0, 2);
    expect(g01).not.toBe(g10);
    expect(g01).toBeGreaterThanOrEqual(0);
    expect(g01).toBeLessThan(2);
    expect(g10).toBeGreaterThanOrEqual(0);
    expect(g10).toBeLessThan(2);
  });
});

describe("dense index math goldens (deterministic, N=2 and N=6)", () => {
  test("holdIndex goldens: first cell 0, state 2 clock 0 bucket 0 = 20160, bucket 726 = 726", () => {
    expect(holdIndex(0, 0, 0)).toBe(0);
    expect(holdIndex(2, 0, 0)).toBe(2 * G);
    expect(holdIndex(0, 0, 726)).toBe(726);
  });

  test("holdIndex N=6: last holding cell (5,4,2015) = N*G - 1", () => {
    const N = 6;
    expect(holdIndex(5, 4, 2015)).toBe(N * G - 1);
  });

  test("transIndex N=6: first transition (0,1,0,0) = N*G; (5,2,0,0) = N*G + 27*G (plan golden)", () => {
    const N = 6;
    expect(transIndex(0, 1, 0, 0, N)).toBe(N * G);
    expect(transIndex(5, 2, 0, 0, N)).toBe(N * G + 27 * G);
  });

  test("transIndex N=6: (5,2,0,726) = trans group (5,2) + bucket 726 (bucket golden)", () => {
    const N = 6;
    const base = N * G + 27 * G;
    expect(transIndex(5, 2, 0, 726, N)).toBe(base + 726);
  });
});
