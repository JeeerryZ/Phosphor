import { describe, it, expect } from "vitest";
import type { ArmorItem, ArmorStats } from "@/lib/armor/types";
import type { ArmorTuning } from "@/lib/armor/tuning";
import { computeTuningVariants, directionalTuningPairs } from "./tuning-variants";

function makeItem(stats: ArmorStats, tuning: ArmorTuning): ArmorItem {
  return {
    itemInstanceId: "test-item",
    itemHash: 0,
    name: "Test Item",
    icon: "",
    slot: "helmet",
    tierType: 5,
    classType: 0,
    stats,
    tuning,
    power: 0,
    gearTier: tuning.kind === "none" ? undefined : 5,
    isMasterworked: true,
    location: "vault",
  };
}

const BASE_STATS: ArmorStats = {
  mobility: 10,
  resilience: 20,
  recovery: 30,
  discipline: 5,
  intellect: 15,
  strength: 0,
};

describe("directionalTuningPairs", () => {
  it("returns all 30 ordered pairs of distinct stats", () => {
    const pairs = directionalTuningPairs();
    expect(pairs).toHaveLength(30);
    expect(pairs.every((p) => p.increasedStat !== p.decreasedStat)).toBe(true);

    const keys = new Set(pairs.map((p) => `${p.increasedStat}->${p.decreasedStat}`));
    expect(keys.size).toBe(30);
  });
});

describe("computeTuningVariants", () => {
  it("returns a single unmodified variant for items without a tuning socket", () => {
    const item = makeItem(BASE_STATS, { kind: "none" });
    const variants = computeTuningVariants(item);

    expect(variants).toHaveLength(1);
    expect(variants[0]).toEqual({ tuning: { kind: "none" }, stats: BASE_STATS });
  });

  it("returns 32 variants for Tier 5 armor (empty + balanced + 30 directional)", () => {
    const item = makeItem(BASE_STATS, { kind: "empty" });
    const variants = computeTuningVariants(item);
    expect(variants).toHaveLength(32);
  });

  it("the balanced variant adds +1 to every stat", () => {
    const item = makeItem(BASE_STATS, { kind: "empty" });
    const variants = computeTuningVariants(item);
    const balanced = variants.find((v) => v.tuning.kind === "balanced");

    expect(balanced?.stats).toEqual({
      mobility: 11,
      resilience: 21,
      recovery: 31,
      discipline: 6,
      intellect: 16,
      strength: 1,
    });
  });

  it("a directional variant moves 5 points from the decreased stat to the increased stat", () => {
    const item = makeItem(BASE_STATS, { kind: "empty" });
    const variants = computeTuningVariants(item);
    const variant = variants.find(
      (v) =>
        v.tuning.kind === "directional" &&
        v.tuning.increasedStat === "intellect" &&
        v.tuning.decreasedStat === "mobility"
    );

    expect(variant?.stats).toEqual({
      ...BASE_STATS,
      mobility: BASE_STATS.mobility - 5,
      intellect: BASE_STATS.intellect + 5,
    });
  });

  it("the empty variant is unmodified", () => {
    const item = makeItem(BASE_STATS, { kind: "empty" });
    const variants = computeTuningVariants(item);
    const empty = variants.find((v) => v.tuning.kind === "empty");
    expect(empty?.stats).toEqual(BASE_STATS);
  });
});
