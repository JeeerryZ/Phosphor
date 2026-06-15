import { describe, it, expect } from "vitest";
import type { ArmorItem, ArmorSlot, ArmorStats } from "@/lib/armor/types";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import type { ItemCombination } from "./combine";
import { MAX_TUNED_SLOTS } from "./adjustment-frontier";
import { buildResults, computeOptimizerQuery, ITER_BUDGET } from "./query";
import { zeroVector } from "./vectors";
import { getOptimizerPoolSize } from "./worker-pool";

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
  it("locks the exotic into its slot and combines it with the best candidate per slot", async () => {
    const exotic = makeItem("helmet", "Exotic Helmet", { ...zeroVector(), mobility: 10 }, { tierType: 6 });
    const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {
      gauntlets: [makeItem("gauntlets", "Gauntlets", { ...zeroVector(), resilience: 10 })],
      chest: [makeItem("chest", "Chest", { ...zeroVector(), recovery: 10 })],
      legs: [makeItem("legs", "Legs", { ...zeroVector(), discipline: 10 })],
      classItem: [makeItem("classItem", "Class Item", { ...zeroVector(), intellect: 10 })],
    };

    const results = await computeOptimizerQuery(exotic, candidates, {
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

  it("returns an empty array when a non-exotic slot has no candidates", async () => {
    const exotic = makeItem("helmet", "Exotic Helmet", zeroVector(), { tierType: 6 });
    const results = await computeOptimizerQuery(exotic, {}, { thresholds: zeroVector(), optimizeFor: "mobility" });
    expect(results).toEqual([]);
  });

  it("filters out combinations that don't meet thresholds", async () => {
    const exotic = makeItem("helmet", "Exotic Helmet", zeroVector(), { tierType: 6 });
    const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {
      gauntlets: [makeItem("gauntlets", "Gauntlets", zeroVector())],
      chest: [makeItem("chest", "Chest", zeroVector())],
      legs: [makeItem("legs", "Legs", zeroVector())],
      classItem: [makeItem("classItem", "Class Item", zeroVector())],
    };

    // Every item contributes 0; mods alone can add at most 50 to any single stat.
    const thresholds = { ...zeroVector(), resilience: 60 };
    const results = await computeOptimizerQuery(exotic, candidates, { thresholds, optimizeFor: "mobility" });

    expect(results).toEqual([]);
  });

  it("sorts results by optimizeFor descending", async () => {
    const exotic = makeItem("helmet", "Exotic Helmet", zeroVector(), { tierType: 6 });
    const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {
      gauntlets: [makeItem("gauntlets", "Gauntlets", zeroVector())],
      chest: [makeItem("chest", "Chest", zeroVector())],
      legs: [makeItem("legs", "Legs", zeroVector())],
      classItem: [makeItem("classItem", "Class Item", zeroVector())],
    };

    const results = await computeOptimizerQuery(exotic, candidates, {
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

  it("tier-dedups results: no two results share a tier bucket (floor(value/5) per stat)", async () => {
    const exotic = makeItem("helmet", "Exotic Helmet", zeroVector(), { tierType: 6 });
    const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {
      gauntlets: [makeItem("gauntlets", "Gauntlets", zeroVector())],
      chest: [makeItem("chest", "Chest", zeroVector())],
      legs: [makeItem("legs", "Legs", zeroVector())],
      classItem: [makeItem("classItem", "Class Item", zeroVector())],
    };

    const results = await computeOptimizerQuery(exotic, candidates, {
      thresholds: zeroVector(),
      optimizeFor: "mobility",
    });

    const tierKeys = results.map((r) => ARMOR_STAT_ORDER.map((stat) => Math.floor(r.stats[stat] / 5)).join(","));
    expect(new Set(tierKeys).size).toBe(tierKeys.length);
  });

  it("widens topK when strict thresholds eliminate the top-ranked candidates", async () => {
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
    const results = await computeOptimizerQuery(exotic, candidates, { thresholds, optimizeFor: "intellect" });

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

  it("does not cap small (tunedCount<=3-sized) combo sets", async () => {
    // getTuningAdjustmentFrontier(3) has 1281 entries; 1281 * 252 ~= 322,812 per combo, well
    // under ITER_BUDGET even for a handful of combos.
    const frontier = buildFrontier(5);
    const results = await buildResults(frontier, { thresholds: zeroVector(), optimizeFor: "mobility" });

    expect(results.length).toBeGreaterThan(0);
    // All 5 combos should be eligible (no capping), so the best mobility comes from combo-0.
    expect(results[0].loadout.helmet?.item.name).toBe("combo-0");
  });

  it("caps a large combo set to the highest-total-stat combo(s) without throwing", async () => {
    // 100 combos x getTuningAdjustmentFrontier(3) (1281) x 252 mods ~= 32.3M iterations, far
    // exceeding ITER_BUDGET * poolSize - this mirrors the real tunedCount=4/5 blowup
    // (157 x 4251 x 252 ~= 168M and 153 x 11247 x 252 ~= 433M) at a much smaller scale.
    const comboCount = 100;
    const perComboCost = 1281 * 252;
    const poolSize = getOptimizerPoolSize();
    expect(comboCount * perComboCost).toBeGreaterThan(ITER_BUDGET * poolSize);

    const frontier = buildFrontier(comboCount);

    const start = Date.now();
    const results = await buildResults(frontier, { thresholds: zeroVector(), optimizeFor: "mobility" });
    const elapsed = Date.now() - start;

    expect(results.length).toBeGreaterThan(0);

    // Only the highest-total-stat combo(s) should be considered: maxCombos = floor(ITER_BUDGET *
    // poolSize / perComboCost).
    const maxCombos = Math.max(1, Math.floor((ITER_BUDGET * poolSize) / perComboCost));
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

    // Sanity: post-cap cost is ~maxCombos combos x 1281 x 252 iterations, so this should run
    // quickly despite the uncapped size being ~32.3M.
    expect(elapsed).toBeLessThan(2000);
  });

  it("produces deterministic results across repeated runs (pool dispatch doesn't introduce nondeterminism)", async () => {
    const frontier = buildFrontier(5);

    const first = await buildResults(frontier, { thresholds: zeroVector(), optimizeFor: "mobility" });
    const second = await buildResults(frontier, { thresholds: zeroVector(), optimizeFor: "mobility" });

    expect(first.map((r) => r.stats)).toEqual(second.map((r) => r.stats));
    expect(first.map((r) => r.loadout.helmet?.item.name)).toEqual(second.map((r) => r.loadout.helmet?.item.name));
  });
});

describe("buildResults: deficit-sum mod filter", () => {
  /** Builds a tunedCount=0 combo (no tuning adjustment to account for) with the given stats. */
  function frontierWithCombo(stats: ArmorStats): ItemCombination[][] {
    const item: ArmorItem = {
      itemInstanceId: "combo",
      itemHash: 0,
      name: "combo",
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
    const frontier: ItemCombination[][] = Array.from({ length: MAX_TUNED_SLOTS + 1 }, () => []);
    frontier[0] = [{ choices: { helmet: { item, stats, hasTuning: false } }, stats, tunedCount: 0 }];
    return frontier;
  }

  it("excludes a combo whose deficit sum exceeds MOD_BUDGET (every stat short by 10, sum 60 > 50)", async () => {
    const thresholds: ArmorStats = {
      mobility: 10,
      resilience: 10,
      recovery: 10,
      discipline: 10,
      intellect: 10,
      strength: 10,
    };
    const results = await buildResults(frontierWithCombo(zeroVector()), { thresholds, optimizeFor: "mobility" });
    expect(results).toEqual([]);
  });

  it("still excludes a combo whose deficit sum is within MOD_BUDGET but no single mod covers every stat (6 stats short by 1, only 5 mod slots)", async () => {
    const combo: ArmorStats = {
      mobility: 9,
      resilience: 9,
      recovery: 9,
      discipline: 9,
      intellect: 9,
      strength: 9,
    };
    const thresholds: ArmorStats = {
      mobility: 10,
      resilience: 10,
      recovery: 10,
      discipline: 10,
      intellect: 10,
      strength: 10,
    };
    const results = await buildResults(frontierWithCombo(combo), { thresholds, optimizeFor: "mobility" });
    expect(results).toEqual([]);
  });
});
