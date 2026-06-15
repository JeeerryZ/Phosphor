import { describe, it, expect } from "vitest";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { getOptimizerPool, getOptimizerPoolSize, runComboTask } from "./worker-pool";
import { flattenStatVectors, zeroVector } from "./vectors";
import { getModDeltaSet } from "./mod-deltas";

const statCount = ARMOR_STAT_ORDER.length;

describe("getOptimizerPool", () => {
  it("returns a singleton pool with a positive thread count", () => {
    const pool = getOptimizerPool();
    expect(pool).toBe(getOptimizerPool());
    expect(getOptimizerPoolSize()).toBeGreaterThan(0);
  });
});

describe("runComboTask", () => {
  it("computes the same results as computeComboResults, via a worker", async () => {
    const comboStats = flattenStatVectors([zeroVector()]);
    const adjustmentStatsFlat = flattenStatVectors([zeroVector()]);
    const modDeltaFlat = flattenStatVectors(getModDeltaSet());
    const thresholdValues = flattenStatVectors([zeroVector()]);

    const results = await runComboTask({
      comboStats,
      adjustmentStatsFlat,
      adjustmentCount: 1,
      modDeltaFlat,
      modCount: getModDeltaSet().length,
      thresholdValues,
      optimizeForIndex: ARMOR_STAT_ORDER.indexOf("strength"),
      statCount,
    });

    expect(results.length).toBeGreaterThan(0);
    const best = results.reduce((max, r) => Math.max(max, r.stats[ARMOR_STAT_ORDER.indexOf("strength")]), 0);
    expect(best).toBe(50);
  });
});
