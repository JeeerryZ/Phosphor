import { describe, it, expect } from "vitest";
import { getTuningAdjustmentFrontier, MAX_TUNED_SLOTS } from "./adjustment-frontier";
import { zeroVector } from "./vectors";

describe("getTuningAdjustmentFrontier", () => {
  it("k=0 is a single zero-stat entry with an empty tuning assignment", () => {
    const frontier = getTuningAdjustmentFrontier(0);
    expect(frontier).toHaveLength(1);
    expect(frontier[0].stats).toEqual(zeroVector());
    expect(frontier[0].tuningAssignment).toEqual([]);
  });

  it("k=1 has 31 entries, each with a single tuning assignment", () => {
    const frontier = getTuningAdjustmentFrontier(1);
    expect(frontier).toHaveLength(31);
    for (const entry of frontier) {
      expect(entry.tuningAssignment).toHaveLength(1);
    }
  });

  it("k=2 has 271 entries, each with two tuning assignments", () => {
    const frontier = getTuningAdjustmentFrontier(2);
    expect(frontier).toHaveLength(271);
    for (const entry of frontier) {
      expect(entry.tuningAssignment).toHaveLength(2);
    }
  });

  it("k=3 has 1281 entries, each with three tuning assignments", () => {
    const frontier = getTuningAdjustmentFrontier(3);
    expect(frontier).toHaveLength(1281);
    for (const entry of frontier) {
      expect(entry.tuningAssignment).toHaveLength(3);
    }
  });

  it("is memoized across calls", () => {
    expect(getTuningAdjustmentFrontier(2)).toBe(getTuningAdjustmentFrontier(2));
  });

  it("throws for out-of-range k", () => {
    expect(() => getTuningAdjustmentFrontier(-1)).toThrow();
    expect(() => getTuningAdjustmentFrontier(MAX_TUNED_SLOTS + 1)).toThrow();
  });

  // Building k=4/k=5 from scratch takes ~20s (Pareto-pruning ~4251 x 32 raw combinations at k=5).
  // Skipped by default to keep `npm test` fast; remove `.skip` to verify these sizes manually.
  it.skip("k=4 and k=5 have the measured sizes (slow, ~20s)", () => {
    expect(getTuningAdjustmentFrontier(4)).toHaveLength(4251);
    expect(getTuningAdjustmentFrontier(5)).toHaveLength(11247);
  });
});
