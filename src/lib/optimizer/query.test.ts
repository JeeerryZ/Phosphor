import { describe, it, expect } from "vitest";
import type { ArmorItem, ArmorSlot, ArmorStats } from "@/lib/armor/types";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import type { ItemCombination } from "./combine";
import { MAX_TUNED_SLOTS } from "./adjustment-frontier";
import { buildResults, computeDeficitSum, computeOptimizerQuery, ITER_BUDGET } from "./query";
import { zeroVector } from "./vectors";

function makeItem(
  slot: ArmorSlot,
  name: string,
  stats: ArmorStats,
  options: { tierType?: number; gearTier?: number } = {}
): ArmorItem {
  return {
    itemInstanceId: name,
    itemHash: 0,
    name,
    icon: "",
    slot,
    tierType: options.tierType ?? 5,
    classType: 0,
    stats,
    tuning: { kind: "none" },
    power: 0,
    gearTier: options.gearTier,
    isMasterworked: true,
    location: "vault",
  };
}

describe("computeOptimizerQuery", () => {
  it("locks the exotic into its slot and combines it with the best candidate per slot", () => {
    const exotic = makeItem("helmet", "Exotic Helmet", { ...zeroVector(), mobility: 10 }, { tierType: 6 });
    const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {
      gauntlets: [makeItem("gauntlets", "Gauntlets", { ...zeroVector(), resilience: 10 })],
      chest: [makeItem("chest", "Chest", { ...zeroVector(), recovery: 10 })],
      legs: [makeItem("legs", "Legs", { ...zeroVector(), discipline: 10 })],
      classItem: [makeItem("classItem", "Class Item", { ...zeroVector(), intellect: 10 })],
    };

    const results = computeOptimizerQuery(exotic, candidates, {
      thresholds: zeroVector(),
      optimizeFor: "mobility",
    });

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.loadout.helmet?.item.name).toBe("Exotic Helmet");
      expect(result.stats.mobility).toBeGreaterThanOrEqual(10);
      expect(result.stats.resilience).toBeGreaterThanOrEqual(10);
      expect(result.stats.recovery).toBeGreaterThanOrEqual(10);
      expect(result.stats.discipline).toBeGreaterThanOrEqual(10);
      expect(result.stats.intellect).toBeGreaterThanOrEqual(10);
    }
  });

  it("returns an empty array when a non-exotic slot has no candidates", () => {
    const exotic = makeItem("helmet", "Exotic Helmet", zeroVector(), { tierType: 6 });
    const results = computeOptimizerQuery(exotic, {}, { thresholds: zeroVector(), optimizeFor: "mobility" });
    expect(results).toEqual([]);
  });

  it("filters out combinations that don't meet thresholds", () => {
    const exotic = makeItem("helmet", "Exotic Helmet", zeroVector(), { tierType: 6 });
    const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {
      gauntlets: [makeItem("gauntlets", "Gauntlets", zeroVector())],
      chest: [makeItem("chest", "Chest", zeroVector())],
      legs: [makeItem("legs", "Legs", zeroVector())],
      classItem: [makeItem("classItem", "Class Item", zeroVector())],
    };

    // Every item contributes 0; mods alone can add at most 50 to any single stat.
    const thresholds = { ...zeroVector(), resilience: 60 };
    const results = computeOptimizerQuery(exotic, candidates, { thresholds, optimizeFor: "mobility" });

    expect(results).toEqual([]);
  });

  it("sorts results by optimizeFor descending", () => {
    const exotic = makeItem("helmet", "Exotic Helmet", zeroVector(), { tierType: 6 });
    const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {
      gauntlets: [makeItem("gauntlets", "Gauntlets", zeroVector())],
      chest: [makeItem("chest", "Chest", zeroVector())],
      legs: [makeItem("legs", "Legs", zeroVector())],
      classItem: [makeItem("classItem", "Class Item", zeroVector())],
    };

    const results = computeOptimizerQuery(exotic, candidates, {
      thresholds: zeroVector(),
      optimizeFor: "strength",
    });

    expect(results.length).toBeGreaterThan(1);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].stats.strength).toBeGreaterThanOrEqual(results[i].stats.strength);
    }
    // The mod-delta set includes +50 to a single stat, so the best result reaches it.
    expect(results[0].stats.strength).toBe(50);
  });

  it("tier-dedups results: no two results share a tier bucket (floor(value/5) per stat)", () => {
    const exotic = makeItem("helmet", "Exotic Helmet", zeroVector(), { tierType: 6 });
    const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {
      gauntlets: [makeItem("gauntlets", "Gauntlets", zeroVector())],
      chest: [makeItem("chest", "Chest", zeroVector())],
      legs: [makeItem("legs", "Legs", zeroVector())],
      classItem: [makeItem("classItem", "Class Item", zeroVector())],
    };

    const results = computeOptimizerQuery(exotic, candidates, {
      thresholds: zeroVector(),
      optimizeFor: "mobility",
    });

    const tierKeys = results.map((r) => ARMOR_STAT_ORDER.map((stat) => Math.floor(r.stats[stat] / 5)).join(","));
    expect(new Set(tierKeys).size).toBe(tierKeys.length);
  });

  it("widens topK when strict thresholds eliminate the top-ranked candidates", () => {
    const exotic = makeItem("helmet", "Exotic Helmet", zeroVector(), { tierType: 6 });

    const legsCandidates: ArmorItem[] = [];
    for (let i = 0; i < 5; i++) {
      legsCandidates.push(makeItem("legs", `legs-high-${i}`, { ...zeroVector(), mobility: 40 }));
    }
    for (let i = 0; i < 5; i++) {
      legsCandidates.push(makeItem("legs", `legs-intellect-${i}`, { ...zeroVector(), mobility: 10, intellect: 15 }));
    }

    const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {
      gauntlets: [makeItem("gauntlets", "Gauntlets", zeroVector())],
      chest: [makeItem("chest", "Chest", zeroVector())],
      legs: legsCandidates,
      classItem: [makeItem("classItem", "Class Item", zeroVector())],
    };

    // Top-5 legs items contribute 0 intellect; max achievable via mods alone is 50 (< 60).
    const thresholds = { ...zeroVector(), intellect: 60 };
    const results = computeOptimizerQuery(exotic, candidates, { thresholds, optimizeFor: "intellect" });

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.stats.intellect).toBeGreaterThanOrEqual(60);
      expect(result.loadout.legs?.item.name).toMatch(/^legs-intellect-/);
    }
  });
});

describe("buildResults: per-tunedCount-bucket combo cap", () => {
  /** Builds a synthetic combo whose only choice is `helmet`, with `mobility = totalStats`. */
  function makeCombo(index: number, mobility: number): ItemCombination {
    const stats = { ...zeroVector(), mobility };
    const item: ArmorItem = {
      itemInstanceId: `combo-${index}`,
      itemHash: 0,
      name: `combo-${index}`,
      icon: "",
      slot: "helmet",
      tierType: 5,
      classType: 0,
      stats,
      tuning: { kind: "none" },
      power: 0,
      gearTier: undefined,
      isMasterworked: true,
      location: "vault",
    };
    return {
      choices: { helmet: { item, stats, hasTuning: false } },
      stats,
      tunedCount: 3,
    };
  }

  function buildFrontier(comboCount: number): ItemCombination[][] {
    const frontier: ItemCombination[][] = Array.from({ length: MAX_TUNED_SLOTS + 1 }, () => []);
    // Descending total-stat sums: combo-0 has the highest mobility (and thus the highest total).
    frontier[3] = Array.from({ length: comboCount }, (_, i) => makeCombo(i, (comboCount - i) * 5));
    return frontier;
  }

  it("does not cap small (tunedCount<=3-sized) combo sets", () => {
    // getTuningAdjustmentFrontier(3) has 1281 entries; 1281 * 252 ~= 322,812 per combo, well
    // under ITER_BUDGET even for a handful of combos.
    const frontier = buildFrontier(5);
    const results = buildResults(frontier, { thresholds: zeroVector(), optimizeFor: "mobility" });

    expect(results.length).toBeGreaterThan(0);
    // All 5 combos should be eligible (no capping), so the best mobility comes from combo-0.
    expect(results[0].loadout.helmet?.item.name).toBe("combo-0");
  });

  it("caps a large combo set to the highest-total-stat combo(s) without throwing", () => {
    // 100 combos x getTuningAdjustmentFrontier(3) (1281) x 252 mods ~= 32.3M iterations, far
    // exceeding ITER_BUDGET (2,000,000) - this mirrors the real tunedCount=4/5 blowup
    // (157 x 4251 x 252 ~= 168M and 153 x 11247 x 252 ~= 433M) at a much smaller scale.
    const comboCount = 100;
    const perComboCost = 1281 * 252;
    expect(comboCount * perComboCost).toBeGreaterThan(ITER_BUDGET);

    const frontier = buildFrontier(comboCount);

    const start = Date.now();
    const results = buildResults(frontier, { thresholds: zeroVector(), optimizeFor: "mobility" });
    const elapsed = Date.now() - start;

    expect(results.length).toBeGreaterThan(0);

    // Only the highest-total-stat combo(s) should be considered: maxCombos = floor(ITER_BUDGET /
    // perComboCost) = floor(2,000,000 / 322,812) = 6, so only combo-0..combo-5 are eligible.
    const maxCombos = Math.max(1, Math.floor(ITER_BUDGET / perComboCost));
    expect(maxCombos).toBeLessThan(comboCount);

    const eligibleNames = new Set(Array.from({ length: maxCombos }, (_, i) => `combo-${i}`));
    for (const result of results) {
      const name = result.loadout.helmet?.item.name;
      expect(name).toBeDefined();
      expect(eligibleNames.has(name as string)).toBe(true);
    }

    // The best result (optimizing for mobility) should come from combo-0, the highest-total-stat
    // combo - not from a lower-ranked one.
    expect(results[0].loadout.helmet?.item.name).toBe("combo-0");

    // Sanity: post-cap cost is ~6 combos x 1281 x 252 ~= 1.9M iterations, so this should run
    // quickly despite the uncapped size being ~32.3M.
    expect(elapsed).toBeLessThan(2000);
  });
});

describe("computeDeficitSum", () => {
  it("sums positive shortfalls and ignores stats already at/above threshold", () => {
    const baseValues = Int32Array.from([5, 20, -3, 0, 10, 8]);
    const thresholdValues = Int32Array.from([10, 15, 0, 0, 10, 20]);
    // shortfalls: 5, 0 (20>=15), 3, 0, 0, 12 => sum = 20
    expect(computeDeficitSum(baseValues, thresholdValues, 6)).toBe(20);
  });

  it("returns 0 when every stat already meets its threshold", () => {
    const baseValues = Int32Array.from([10, 10, 10, 10, 10, 10]);
    const thresholdValues = Int32Array.from([10, 10, 10, 10, 10, 10]);
    expect(computeDeficitSum(baseValues, thresholdValues, 6)).toBe(0);
  });
});
