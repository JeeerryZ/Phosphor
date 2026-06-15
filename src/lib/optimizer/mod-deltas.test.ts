import { describe, it, expect } from "vitest";
import { getModDeltaSet, MOD_BUDGET } from "./mod-deltas";
import { dominates } from "./pareto";
import { vectorKey, type StatVector } from "./vectors";

describe("getModDeltaSet", () => {
  it("contains exactly the 252 ways to distribute 5 +10 mods across 6 stats", () => {
    const deltas = getModDeltaSet();
    // C(5 + 6 - 1, 5) = C(10, 5) = 252.
    expect(deltas.length).toBe(252);
  });

  it("includes +50 to a single stat (five +10 mods on the same stat)", () => {
    const deltas = getModDeltaSet();
    const maxMobility: StatVector = {
      mobility: 50,
      resilience: 0,
      recovery: 0,
      discipline: 0,
      intellect: 0,
      strength: 0,
    };
    expect(deltas.some((d) => vectorKey(d) === vectorKey(maxMobility))).toBe(true);
  });

  it("every entry has stat values that are multiples of 10 summing to 50", () => {
    for (const delta of getModDeltaSet()) {
      const total = Object.values(delta).reduce((sum, value) => sum + value, 0);
      expect(total).toBe(50);
      for (const value of Object.values(delta)) {
        expect(value % 10).toBe(0);
      }
    }
  });

  it("MOD_BUDGET (50) equals the total of every mod-delta entry", () => {
    expect(MOD_BUDGET).toBe(50);
    for (const delta of getModDeltaSet()) {
      const total = Object.values(delta).reduce((sum, value) => sum + value, 0);
      expect(total).toBe(MOD_BUDGET);
    }
  });

  it("contains no vector dominated by another (it is itself a Pareto frontier)", () => {
    const deltas = getModDeltaSet();
    for (const candidate of deltas) {
      expect(deltas.some((other) => dominates(other, candidate))).toBe(false);
    }
  });

  it("has no duplicate vectors", () => {
    const keys = getModDeltaSet().map(vectorKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is cached across calls", () => {
    expect(getModDeltaSet()).toBe(getModDeltaSet());
  });
});
