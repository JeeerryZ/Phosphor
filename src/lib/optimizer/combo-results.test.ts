import { describe, it, expect } from "vitest";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { computeComboResults } from "./combo-results";
import { flattenStatVectors, zeroVector, type StatVector } from "./vectors";

const statCount = ARMOR_STAT_ORDER.length;

function flatten(vector: StatVector): Int32Array {
  return flattenStatVectors([vector]);
}

// Single no-op adjustment (zero delta, zero tuning): the simplest frontier for tunedCount=0.
const zeroAdjFlat = flatten(zeroVector());

describe("computeComboResults", () => {
  it("returns entries for adjustments that meet thresholds (all zero thresholds)", () => {
    const results = computeComboResults(
      flatten(zeroVector()),
      zeroAdjFlat,
      1,
      flatten(zeroVector()),
      statCount
    );

    // Zero thresholds: the zero combo passes. One result per unique tier bucket.
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.adjIndex === 0)).toBe(true);
    // No mods committed (all thresholds 0), so total = sum of base combo stats = 0 here.
    expect(results[0].slotsCommitted).toBe(0);
  });

  it("excludes a combo whose slot count exceeds MOD_SLOTS (every stat short by 10 → 6 slots needed > 5)", () => {
    const thresholds: StatVector = {
      mobility: 10,
      resilience: 10,
      recovery: 10,
      discipline: 10,
      intellect: 10,
      strength: 10,
    };

    const results = computeComboResults(
      flatten(zeroVector()),
      zeroAdjFlat,
      1,
      flatten(thresholds),
      statCount
    );

    // 6 stats × ceil(10/10)=1 slot each = 6 > 5 → excluded.
    expect(results).toEqual([]);
  });

  it("excludes a combo where 6 stats each need 1 slot (Case B: sum=50 but still needs 6 slots)", () => {
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
      zeroAdjFlat,
      1,
      flatten(thresholds),
      statCount
    );

    // 6 slots needed > 5 → excluded even though total deficit is only 6 < 50.
    expect(results).toEqual([]);
  });

  it("commits minimum mods per threshold stat and reports correct slotsCommitted", () => {
    const combo: StatVector = {
      mobility: 40,
      resilience: 40,
      recovery: 40,
      discipline: 40,
      intellect: 40,
      strength: 40,
    };
    // Need 20 more on mobility (2 slots) and 10 more on resilience (1 slot) = 3 committed.
    const thresholds: StatVector = {
      mobility: 60,
      resilience: 50,
      recovery: 0,
      discipline: 0,
      intellect: 0,
      strength: 0,
    };

    const results = computeComboResults(
      flatten(combo),
      zeroAdjFlat,
      1,
      flatten(thresholds),
      statCount
    );

    const mobIdx = ARMOR_STAT_ORDER.indexOf("mobility");
    const resIdx = ARMOR_STAT_ORDER.indexOf("resilience");
    const recIdx = ARMOR_STAT_ORDER.indexOf("recovery");

    expect(results.length).toBe(1);
    expect(results[0].slotsCommitted).toBe(3);
    expect(results[0].stats[mobIdx]).toBe(60); // mobility: 40 + 20 committed
    expect(results[0].stats[resIdx]).toBe(50); // resilience: 40 + 10 committed
    expect(results[0].stats[recIdx]).toBe(40); // recovery: no commitment
  });
});
