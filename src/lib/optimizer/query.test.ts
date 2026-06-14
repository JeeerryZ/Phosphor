import { describe, it, expect } from "vitest";
import type { ArmorItem, ArmorSlot, ArmorStats } from "@/lib/armor/types";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { computeOptimizerQuery } from "./query";
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
