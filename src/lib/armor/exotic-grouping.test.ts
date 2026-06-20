import { describe, it, expect } from "vitest";
import type { ArmorItem, ArmorSlot } from "@/lib/armor/types";
import { groupExoticVariants } from "./exotic-grouping";

function makeExotic(overrides: Partial<ArmorItem> & { itemInstanceId: string; slot: ArmorSlot }): ArmorItem {
  return {
    itemHash: 100,
    name: "Test Exotic",
    icon: "",
    tierType: 6,
    classType: 1,
    stats: { mobility: 0, resilience: 0, recovery: 0, discipline: 0, intellect: 0, strength: 0 },
    tuning: { kind: "none" },
    power: 0,
    gearTier: undefined,
    isMasterworked: true,
    location: "vault",
    ...overrides,
  };
}

describe("groupExoticVariants", () => {
  it("keeps both copies of a class item exotic when their perk pairs differ", () => {
    const items = [
      makeExotic({
        itemInstanceId: "a",
        slot: "classItem",
        exoticPerks: [{ name: "Perk A", description: "", icon: "" }, { name: "Perk B", description: "", icon: "" }],
      }),
      makeExotic({
        itemInstanceId: "b",
        slot: "classItem",
        exoticPerks: [{ name: "Perk C", description: "", icon: "" }, { name: "Perk D", description: "", icon: "" }],
      }),
    ];
    const result = groupExoticVariants(items);
    expect(result.map((i) => i.itemInstanceId).sort()).toEqual(["a", "b"]);
  });

  it("collapses copies with an identical perk pair, keeping the highest-stat one", () => {
    const items = [
      makeExotic({
        itemInstanceId: "low-stats",
        slot: "classItem",
        stats: { mobility: 2, resilience: 0, recovery: 0, discipline: 0, intellect: 0, strength: 0 },
        exoticPerks: [{ name: "Perk A", description: "", icon: "" }, { name: "Perk B", description: "", icon: "" }],
      }),
      makeExotic({
        itemInstanceId: "high-stats",
        slot: "classItem",
        stats: { mobility: 20, resilience: 0, recovery: 0, discipline: 0, intellect: 0, strength: 0 },
        exoticPerks: [{ name: "Perk B", description: "", icon: "" }, { name: "Perk A", description: "", icon: "" }],
      }),
    ];
    const result = groupExoticVariants(items);
    expect(result.map((i) => i.itemInstanceId)).toEqual(["high-stats"]);
  });

  it("collapses non-class-item exotics by itemHash alone, ignoring perks entirely", () => {
    const items = [
      makeExotic({ itemInstanceId: "helmet-low", slot: "helmet", itemHash: 200,
        stats: { mobility: 2, resilience: 0, recovery: 0, discipline: 0, intellect: 0, strength: 0 } }),
      makeExotic({ itemInstanceId: "helmet-high", slot: "helmet", itemHash: 200,
        stats: { mobility: 20, resilience: 0, recovery: 0, discipline: 0, intellect: 0, strength: 0 } }),
    ];
    const result = groupExoticVariants(items);
    expect(result.map((i) => i.itemInstanceId)).toEqual(["helmet-high"]);
  });
});
