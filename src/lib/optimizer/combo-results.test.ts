import { describe, it, expect } from "vitest";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { computeComboResults } from "./combo-results";
import { flattenStatVectors, zeroVector, type StatVector } from "./vectors";
import { getModDeltaSet, MOD_BUDGET } from "./mod-deltas";

const statCount = ARMOR_STAT_ORDER.length;
const modDeltaFlat = flattenStatVectors(getModDeltaSet());
const modCount = getModDeltaSet().length;

function flatten(vector: StatVector): Int32Array {
  return flattenStatVectors([vector]);
}

describe("computeComboResults", () => {
  it("returns entries for adjustments/mods that meet thresholds, keyed by stat tier", () => {
    const comboStats = flatten(zeroVector());
    // One adjustment: no change.
    const adjustmentStatsFlat = flatten(zeroVector());
    const thresholdValues = flatten(zeroVector());

    const results = computeComboResults(
      comboStats,
      adjustmentStatsFlat,
      1,
      modDeltaFlat,
      modCount,
      thresholdValues,
      ARMOR_STAT_ORDER.indexOf("strength"),
      statCount
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.adjIndex === 0)).toBe(true);
    // The mod-delta set includes +50 to a single stat.
    const best = results.reduce((max, r) => Math.max(max, r.stats[ARMOR_STAT_ORDER.indexOf("strength")]), 0);
    expect(best).toBe(50);
  });

  it("excludes a combo whose deficit sum exceeds MOD_BUDGET (mirrors Phase 1 Case A)", () => {
    const comboStats = flatten(zeroVector());
    const adjustmentStatsFlat = flatten(zeroVector());
    const thresholds: StatVector = {
      mobility: 10,
      resilience: 10,
      recovery: 10,
      discipline: 10,
      intellect: 10,
      strength: 10,
    };

    const results = computeComboResults(
      comboStats,
      adjustmentStatsFlat,
      1,
      modDeltaFlat,
      modCount,
      flatten(thresholds),
      ARMOR_STAT_ORDER.indexOf("mobility"),
      statCount
    );

    // deficitSum = 60 > MOD_BUDGET (50) - no mod can cover it.
    expect(MOD_BUDGET).toBe(50);
    expect(results).toEqual([]);
  });

  it("still excludes a combo whose deficit sum is within MOD_BUDGET but no mod covers every stat (mirrors Phase 1 Case B)", () => {
    const combo: StatVector = {
      mobility: 9,
      resilience: 9,
      recovery: 9,
      discipline: 9,
      intellect: 9,
      strength: 9,
    };
    const thresholds: StatVector = {
      mobility: 10,
      resilience: 10,
      recovery: 10,
      discipline: 10,
      intellect: 10,
      strength: 10,
    };

    const results = computeComboResults(
      flatten(combo),
      flatten(zeroVector()),
      1,
      modDeltaFlat,
      modCount,
      flatten(thresholds),
      ARMOR_STAT_ORDER.indexOf("mobility"),
      statCount
    );

    expect(results).toEqual([]);
  });
});
