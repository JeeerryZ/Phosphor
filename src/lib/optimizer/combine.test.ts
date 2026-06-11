import { describe, it, expect } from "vitest";
import type { ArmorItem, ArmorStats } from "@/lib/armor/types";
import { combineSlots, type SlotChoice } from "./combine";
import { zeroVector } from "./vectors";

function makeItem(slot: ArmorItem["slot"], name: string, stats: ArmorStats): ArmorItem {
  return {
    itemInstanceId: name,
    itemHash: 0,
    name,
    icon: "",
    slot,
    tierType: 5,
    classType: 0,
    stats,
    tuning: { kind: "none" },
    power: 0,
    gearTier: undefined,
    isMasterworked: true,
    location: "vault",
  };
}

function choice(item: ArmorItem, stats: ArmorStats): SlotChoice {
  return { item, tuning: { kind: "none" }, stats };
}

describe("combineSlots", () => {
  it("sums stats across one choice per slot", () => {
    const helmet = makeItem("helmet", "Helmet", { ...zeroVector(), mobility: 10 });
    const gauntlets = makeItem("gauntlets", "Gauntlets", { ...zeroVector(), resilience: 20 });

    const result = combineSlots([
      [choice(helmet, helmet.stats)],
      [choice(gauntlets, gauntlets.stats)],
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].stats).toEqual({ ...zeroVector(), mobility: 10, resilience: 20 });
    expect(result[0].choices.helmet?.item.name).toBe("Helmet");
    expect(result[0].choices.gauntlets?.item.name).toBe("Gauntlets");
  });

  it("prunes dominated combinations after each slot", () => {
    const helmetA = makeItem("helmet", "Helmet A", { ...zeroVector(), mobility: 10, resilience: 10 });
    const helmetB = makeItem("helmet", "Helmet B", { ...zeroVector(), mobility: 10, resilience: 5 });
    const gauntlets = makeItem("gauntlets", "Gauntlets", { ...zeroVector(), recovery: 5 });

    const result = combineSlots([
      [choice(helmetA, helmetA.stats), choice(helmetB, helmetB.stats)],
      [choice(gauntlets, gauntlets.stats)],
    ]);

    // Helmet B is dominated by Helmet A in every combination, so only one result remains.
    expect(result).toHaveLength(1);
    expect(result[0].choices.helmet?.item.name).toBe("Helmet A");
  });
});
