import { describe, it, expect } from "vitest";
import type { ArmorItem, ArmorSlot, ArmorStats } from "@/lib/armor/types";
import type { ArmorTuning } from "@/lib/armor/tuning";
import { computeOptimizerResults } from "./index";
import { zeroVector } from "./vectors";

function makeItem(
  slot: ArmorSlot,
  name: string,
  stats: ArmorStats,
  tuning: ArmorTuning = { kind: "none" }
): ArmorItem {
  return {
    itemInstanceId: name,
    itemHash: 0,
    name,
    icon: "",
    slot,
    tierType: slot === "helmet" ? 6 : 5, // exotic helmet, legendary everything else
    classType: 0,
    stats,
    tuning,
    power: 0,
    gearTier: tuning.kind === "none" ? undefined : 5,
    isMasterworked: true,
    location: "vault",
  };
}

describe("computeOptimizerResults", () => {
  it("locks the exotic into its slot and combines it with the best candidate per slot", () => {
    const exotic = makeItem("helmet", "Exotic Helmet", { ...zeroVector(), mobility: 10 });
    const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {
      gauntlets: [makeItem("gauntlets", "Gauntlets", { ...zeroVector(), resilience: 10 })],
      chest: [makeItem("chest", "Chest", { ...zeroVector(), recovery: 10 })],
      legs: [makeItem("legs", "Legs", { ...zeroVector(), discipline: 10 })],
      classItem: [makeItem("classItem", "Class Item", { ...zeroVector(), intellect: 10 })],
    };

    const results = computeOptimizerResults(exotic, candidates);

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.loadout.helmet?.item.name).toBe("Exotic Helmet");
      // Base stats from all 5 slots are always present, plus whatever the mod-delta set adds.
      expect(result.stats.mobility).toBeGreaterThanOrEqual(10);
      expect(result.stats.resilience).toBeGreaterThanOrEqual(10);
      expect(result.stats.recovery).toBeGreaterThanOrEqual(10);
      expect(result.stats.discipline).toBeGreaterThanOrEqual(10);
      expect(result.stats.intellect).toBeGreaterThanOrEqual(10);
    }
  });

  it("returns an empty array when a non-exotic slot has no candidates", () => {
    const exotic = makeItem("helmet", "Exotic Helmet", zeroVector());
    const results = computeOptimizerResults(exotic, {});
    expect(results).toEqual([]);
  });
});
