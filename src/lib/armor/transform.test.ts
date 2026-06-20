import { describe, it, expect, vi } from "vitest";
import type { DestinyInventoryItemDefinition, DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { STAT_TUNING_PLUGS } from "./tuning";

const SOCKET_CATEGORY_DEFS: Record<number, { displayProperties: { name: string } }> = {
  9001: { displayProperties: { name: "ARMOR MODS" } },
  9002: { displayProperties: { name: "ARMOR COSMETICS" } },
  9003: { displayProperties: { name: "ARMOR PERKS" } },
  9004: { displayProperties: { name: "ARMOR PERKS" } },
};

const ITEM_DEFS: Record<number, { displayProperties: { name: string; description: string; icon: string } }> = {
  5001: { displayProperties: { name: "Default Shader", description: "A shader.", icon: "" } },
  6001: { displayProperties: { name: "Perk A", description: "Does A.", icon: "" } },
  6002: { displayProperties: { name: "Perk B", description: "Does B.", icon: "" } },
  6003: { displayProperties: { name: "Perk C", description: "Does C.", icon: "" } },
  6004: { displayProperties: { name: "Perk D", description: "Does D.", icon: "" } },
};

vi.mock("@/lib/manifest/definitions", () => ({
  getItemDefinition: (hash: number) => ITEM_DEFS[hash],
  getSocketCategoryDefinition: (hash: number) => SOCKET_CATEGORY_DEFS[hash],
}));

// Mirrors the real socket layout of every known exotic class item (Solipsism, Relativism,
// Stoicism): 16 sockets, with the two genuine perks living in two separate "ARMOR PERKS"
// socket categories ([10,11] and [12,15]), and a shader (cosmetic) sitting at index 4 --
// sequentially before the real perks if scanned index-by-index.
const SOLIPSISM_DEFINITION = {
  sockets: {
    socketCategories: [
      { socketCategoryHash: 9001, socketIndexes: [0, 1, 2, 3, 5, 6, 14] },
      { socketCategoryHash: 9002, socketIndexes: [4, 13] },
      { socketCategoryHash: 9003, socketIndexes: [10, 11] },
      { socketCategoryHash: 9004, socketIndexes: [12, 15] },
    ],
  },
} as unknown as DestinyInventoryItemDefinition;

function makeProfile(socketPlugHashes: Record<number, number>): DestinyProfileResponse {
  const sockets = Array.from({ length: 16 }, (_, i) => ({ plugHash: socketPlugHashes[i], isEnabled: true }));
  return {
    itemComponents: {
      sockets: { data: { "item-1": { sockets } } },
    },
  } as unknown as DestinyProfileResponse;
}

describe("readExoticPerks", () => {
  it("reads exactly the sockets in 'ARMOR PERKS' categories, ignoring cosmetics and mods", async () => {
    const { readExoticPerks } = await import("./transform");
    const profile = makeProfile({ 4: 5001, 10: 6001, 11: 6002, 12: 6003, 15: 6004 });

    const perks = readExoticPerks("item-1", SOLIPSISM_DEFINITION, profile);

    expect(perks.map((p) => p.name)).toEqual(["Perk A", "Perk B", "Perk C", "Perk D"]);
  });
});

describe("readLegendaryTuningIncreaseStat", () => {
  function makeProfileWithReusablePlugs(
    plugs: { plugItemHash: number; canInsert: boolean }[]
  ): DestinyProfileResponse {
    return {
      itemComponents: {
        reusablePlugs: { data: { "item-1": { plugs: { 5: plugs } } } },
      },
    } as unknown as DestinyProfileResponse;
  }

  it("returns the single increase stat shared by all insertable directional plugs", async () => {
    const { readLegendaryTuningIncreaseStat } = await import("./transform");
    const disciplinePlugs = Object.entries(STAT_TUNING_PLUGS)
      .filter(([, v]) => v.increasedStat === "discipline")
      .map(([hash]) => ({ plugItemHash: Number(hash), canInsert: true }));
    const profile = makeProfileWithReusablePlugs(disciplinePlugs);

    expect(readLegendaryTuningIncreaseStat("item-1", 5, profile)).toBe("discipline");
  });

  it("ignores plugs that can't actually be inserted", async () => {
    const { readLegendaryTuningIncreaseStat } = await import("./transform");
    const [hash] = Object.entries(STAT_TUNING_PLUGS)[0];
    const profile = makeProfileWithReusablePlugs([
      { plugItemHash: Number(hash), canInsert: false },
    ]);

    expect(readLegendaryTuningIncreaseStat("item-1", 5, profile)).toBeUndefined();
  });

  it("returns undefined when no live reusable-plugs data exists for this socket", async () => {
    const { readLegendaryTuningIncreaseStat } = await import("./transform");
    const profile = { itemComponents: { reusablePlugs: { data: {} } } } as unknown as DestinyProfileResponse;

    expect(readLegendaryTuningIncreaseStat("item-1", 5, profile)).toBeUndefined();
  });

  it("returns undefined when insertable plugs disagree on which stat to increase", async () => {
    const { readLegendaryTuningIncreaseStat } = await import("./transform");
    const disciplinePlug = Object.entries(STAT_TUNING_PLUGS).find(([, v]) => v.increasedStat === "discipline")!;
    const mobilityPlug = Object.entries(STAT_TUNING_PLUGS).find(([, v]) => v.increasedStat === "mobility")!;
    const profile = makeProfileWithReusablePlugs([
      { plugItemHash: Number(disciplinePlug[0]), canInsert: true },
      { plugItemHash: Number(mobilityPlug[0]), canInsert: true },
    ]);

    expect(readLegendaryTuningIncreaseStat("item-1", 5, profile)).toBeUndefined();
  });
});
