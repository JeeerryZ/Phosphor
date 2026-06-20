import { describe, it, expect, vi } from "vitest";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";

vi.mock("@/lib/manifest/definitions", () => ({
  getItemDefinition: (hash: number) => {
    const defs: Record<number, { investmentStats: { statTypeHash: number; value: number }[] }> = {
      1001: { investmentStats: [{ statTypeHash: 392767087, value: 10 }] }, // +10 Resilience
      1002: {
        investmentStats: [
          { statTypeHash: 2996146975, value: -10 }, // -10 Mobility
          { statTypeHash: 1943323491, value: 5 }, // +5 Recovery
        ],
      },
      1003: { investmentStats: [] }, // Aspect, no stat investment
      1004: { investmentStats: [{ statTypeHash: 999999999, value: 50 }] }, // irrelevant stat, must be ignored
    };
    return defs[hash];
  },
}));

const SUBCLASS_BUCKET_HASH = 3284755031;

function makeProfile(socketPlugHashes: (number | undefined)[]): DestinyProfileResponse {
  return {
    characterEquipment: {
      data: {
        char1: { items: [{ itemHash: 0, itemInstanceId: "subclass-1", bucketHash: SUBCLASS_BUCKET_HASH }] },
      },
    },
    itemComponents: {
      sockets: {
        data: {
          "subclass-1": { sockets: socketPlugHashes.map((plugHash) => ({ plugHash, isEnabled: true })) },
        },
      },
    },
  } as unknown as DestinyProfileResponse;
}

describe("getEquippedFragmentStats", () => {
  it("sums investmentStats across fragment sockets, ignoring aspects and non-armor stats", async () => {
    const { getEquippedFragmentStats } = await import("./fragments");
    const profile = makeProfile([1001, 1002, 1003, 1004, undefined]);
    const result = getEquippedFragmentStats(profile, "char1");
    expect(result).toEqual({
      mobility: -10,
      resilience: 10,
      recovery: 5,
      discipline: 0,
      intellect: 0,
      strength: 0,
    });
  });

  it("returns undefined when the character has no equipped subclass", async () => {
    const { getEquippedFragmentStats } = await import("./fragments");
    const profile = {
      characterEquipment: { data: { char1: { items: [] } } },
      itemComponents: { sockets: { data: {} } },
    } as unknown as DestinyProfileResponse;
    expect(getEquippedFragmentStats(profile, "char1")).toBeUndefined();
  });
});
