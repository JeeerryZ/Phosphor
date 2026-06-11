import { describe, it, expect } from "vitest";
import type { ArmorInventory, ArmorItem, ArmorSlot } from "@/lib/armor/types";
import { buildCandidatesBySlot, findItemByInstanceId } from "./candidates";

function makeItem(overrides: Partial<ArmorItem> & { itemInstanceId: string; slot: ArmorSlot }): ArmorItem {
  return {
    itemHash: 0,
    name: overrides.itemInstanceId,
    icon: "",
    tierType: 5,
    classType: 0,
    stats: { mobility: 0, resilience: 0, recovery: 0, discipline: 0, intellect: 0, strength: 0 },
    tuning: { kind: "none" },
    power: 0,
    gearTier: undefined,
    isMasterworked: true,
    location: "vault",
    ...overrides,
  };
}

describe("findItemByInstanceId", () => {
  it("finds an item across vault and characters", () => {
    const inventory: ArmorInventory = {
      vault: [makeItem({ itemInstanceId: "vault-1", slot: "helmet" })],
      characters: { char1: [makeItem({ itemInstanceId: "char-1", slot: "chest" })] },
    };

    expect(findItemByInstanceId(inventory, "char-1")?.itemInstanceId).toBe("char-1");
    expect(findItemByInstanceId(inventory, "missing")).toBeUndefined();
  });
});

describe("buildCandidatesBySlot", () => {
  it("excludes the exotic's slot, exotics, and other classes; includes class-agnostic items", () => {
    const exotic = makeItem({ itemInstanceId: "exotic", slot: "helmet", tierType: 6, classType: 0 });
    const inventory: ArmorInventory = {
      vault: [
        makeItem({ itemInstanceId: "same-slot-legendary", slot: "helmet", tierType: 5, classType: 0 }),
        makeItem({ itemInstanceId: "other-class", slot: "gauntlets", tierType: 5, classType: 1 }),
        makeItem({ itemInstanceId: "other-exotic", slot: "chest", tierType: 6, classType: 0 }),
        makeItem({ itemInstanceId: "good-legendary", slot: "legs", tierType: 5, classType: 0 }),
        makeItem({ itemInstanceId: "class-agnostic", slot: "classItem", tierType: 5, classType: 3 }),
      ],
      characters: {},
    };

    const candidates = buildCandidatesBySlot(inventory, exotic);

    expect(candidates.helmet).toBeUndefined();
    expect(candidates.gauntlets).toBeUndefined();
    expect(candidates.chest).toBeUndefined();
    expect(candidates.legs?.map((i) => i.itemInstanceId)).toEqual(["good-legendary"]);
    expect(candidates.classItem?.map((i) => i.itemInstanceId)).toEqual(["class-agnostic"]);
  });
});
