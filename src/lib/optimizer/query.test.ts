import { describe, it, expect } from "vitest";
import type { ArmorItem, ArmorSlot, ArmorStats } from "@/lib/armor/types";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import type { ItemCombination } from "./combine";
import { MAX_TUNED_SLOTS } from "./adjustment-frontier";
import { buildResults, computeOptimizerQuery, enumerateBoostCombinations } from "./query";
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
  it("locks the exotic into its slot and combines it with the best candidate per slot", async () => {
    const exotic = makeItem("helmet", "Exotic Helmet", { ...zeroVector(), mobility: 10 }, { tierType: 6 });
    const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {
      gauntlets: [makeItem("gauntlets", "Gauntlets", { ...zeroVector(), resilience: 10 })],
      chest: [makeItem("chest", "Chest", { ...zeroVector(), recovery: 10 })],
      legs: [makeItem("legs", "Legs", { ...zeroVector(), discipline: 10 })],
      classItem: [makeItem("classItem", "Class Item", { ...zeroVector(), intellect: 10 })],
    };

    const { results } = await computeOptimizerQuery(exotic, candidates, { thresholds: zeroVector() });

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
    const { results } = await computeOptimizerQuery(exotic, {}, { thresholds: zeroVector() });
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

    // All stats 0; 6 thresholds of 10 each need 6 mod slots > 5 available.
    const thresholds = { ...zeroVector(), resilience: 60 };
    const { results } = await computeOptimizerQuery(exotic, candidates, { thresholds });

    expect(results).toEqual([]);
  });

  it("sorts results by total stat sum descending", async () => {
    const exotic = makeItem("helmet", "Exotic Helmet", { ...zeroVector(), mobility: 10 }, { tierType: 6 });
    const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {
      gauntlets: [
        makeItem("gauntlets", "Gauntlets A", { ...zeroVector(), resilience: 30 }),
        makeItem("gauntlets", "Gauntlets B", { ...zeroVector(), recovery: 25 }),
      ],
      chest: [makeItem("chest", "Chest", { ...zeroVector(), recovery: 20 })],
      legs: [makeItem("legs", "Legs", { ...zeroVector(), discipline: 10 })],
      classItem: [makeItem("classItem", "Class Item", { ...zeroVector(), intellect: 5 })],
    };

    const { results } = await computeOptimizerQuery(exotic, candidates, { thresholds: zeroVector() });

    expect(results.length).toBeGreaterThan(1);
    for (let i = 1; i < results.length; i++) {
      const totalA = ARMOR_STAT_ORDER.reduce((s, stat) => s + results[i - 1].stats[stat], 0);
      const totalB = ARMOR_STAT_ORDER.reduce((s, stat) => s + results[i].stats[stat], 0);
      expect(totalA).toBeGreaterThanOrEqual(totalB);
    }
  });

  it("tier-dedups results: no two results share a tier bucket (floor(value/5) per stat)", async () => {
    const exotic = makeItem("helmet", "Exotic Helmet", zeroVector(), { tierType: 6 });
    const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {
      gauntlets: [makeItem("gauntlets", "Gauntlets", zeroVector())],
      chest: [makeItem("chest", "Chest", zeroVector())],
      legs: [makeItem("legs", "Legs", zeroVector())],
      classItem: [makeItem("classItem", "Class Item", zeroVector())],
    };

    const { results } = await computeOptimizerQuery(exotic, candidates, { thresholds: zeroVector() });

    const tierKeys = results.map((r) => ARMOR_STAT_ORDER.map((stat) => Math.floor(r.stats[stat] / 5)).join(","));
    expect(new Set(tierKeys).size).toBe(tierKeys.length);
  });

  it("finds results matching strict thresholds even when top-total-stat items can't meet them", async () => {
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

    // legs-high items have intellect=0; need 4 slots to reach 40 (0+40), which is within 5.
    // legs-intellect items have intellect=15; need 3 slots to reach 40 (15+30).
    const thresholds = { ...zeroVector(), intellect: 40 };
    const { results } = await computeOptimizerQuery(exotic, candidates, { thresholds });

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.stats.intellect).toBeGreaterThanOrEqual(40);
    }
  });

  it("each result includes freeSlots: 5 - committed mod slots", async () => {
    const exotic = makeItem("helmet", "Exotic Helmet", zeroVector(), { tierType: 6 });
    const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {
      gauntlets: [makeItem("gauntlets", "Gauntlets", { ...zeroVector(), resilience: 30 })],
      chest: [makeItem("chest", "Chest", { ...zeroVector(), resilience: 30 })],
      legs: [makeItem("legs", "Legs", { ...zeroVector(), resilience: 30 })],
      classItem: [makeItem("classItem", "Class Item", { ...zeroVector(), resilience: 30 })],
    };

    // resilience = 120 from armor, threshold = 150 → deficit 30 → 3 slots committed.
    const thresholds = { ...zeroVector(), resilience: 150 };
    const { results } = await computeOptimizerQuery(exotic, candidates, { thresholds });

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.freeSlots).toBe(2); // 5 - 3 committed
    }
  });
});

describe("enumerateBoostCombinations", () => {
  it("yields the Cartesian product across asymmetric per-slot domains", () => {
    const results = [...enumerateBoostCombinations([["discipline"], ["mobility", "resilience"]])];
    expect(results).toEqual([
      ["discipline", "mobility"],
      ["discipline", "resilience"],
    ]);
  });

  it("yields a single empty tuple when there are no tuned slots", () => {
    expect([...enumerateBoostCombinations([])]).toEqual([[]]);
  });

  it("yields nothing if any slot's domain is empty", () => {
    expect([...enumerateBoostCombinations([["discipline"], []])]).toEqual([]);
  });

  it("yields exactly one combination when every domain has a single fixed stat (all-legendary case)", () => {
    const results = [...enumerateBoostCombinations([["discipline"], ["mobility"], ["resilience"]])];
    expect(results).toEqual([["discipline", "mobility", "resilience"]]);
  });
});

describe("buildResults: slot-count feasibility filter", () => {
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
    frontier[0] = [{ choices: { helmet: { item, stats, hasTuning: false, allowedIncreaseStats: [] } }, stats, tunedCount: 0 }];
    return frontier;
  }

  it("excludes a combo that needs 6 mod slots (every stat short by 10, 6 > 5)", async () => {
    const thresholds: ArmorStats = {
      mobility: 10,
      resilience: 10,
      recovery: 10,
      discipline: 10,
      intellect: 10,
      strength: 10,
    };
    const { results } = await buildResults(frontierWithCombo(zeroVector()), { thresholds });
    expect(results).toEqual([]);
  });

  it("excludes a combo where 6 stats each need 1 slot (sum=6 > 5, even though total deficit=6 < 50)", async () => {
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
    const { results } = await buildResults(frontierWithCombo(combo), { thresholds });
    expect(results).toEqual([]);
  });

  it("includes a combo where slot requirements can be satisfied within 5 slots", async () => {
    // Needs 2 slots for mobility (deficit 20) + 1 for resilience (deficit 10) = 3 ≤ 5.
    const combo: ArmorStats = {
      mobility: 30,
      resilience: 40,
      recovery: 50,
      discipline: 50,
      intellect: 50,
      strength: 50,
    };
    const thresholds: ArmorStats = {
      mobility: 50,
      resilience: 50,
      recovery: 0,
      discipline: 0,
      intellect: 0,
      strength: 0,
    };
    const { results } = await buildResults(frontierWithCombo(combo), { thresholds });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].freeSlots).toBe(2); // 5 - 3 committed
    expect(results[0].stats.mobility).toBe(50);
    expect(results[0].stats.resilience).toBe(50);
  });
});
