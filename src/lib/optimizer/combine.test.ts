import { describe, it, expect } from "vitest";
import type { ArmorItem, ArmorSlot, ArmorStats } from "@/lib/armor/types";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { ALL_SLOTS, MAX_TUNED_SLOTS, selectItemCombinations, type SlotCandidate } from "./combine";
import { zeroVector } from "./vectors";

function makeCandidate(slot: ArmorSlot, name: string, stats: ArmorStats, hasTuning = false): SlotCandidate {
  const item: ArmorItem = {
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
    gearTier: hasTuning ? 5 : undefined,
    isMasterworked: true,
    location: "vault",
  };
  return { item, stats, hasTuning, allowedIncreaseStats: hasTuning ? ARMOR_STAT_ORDER : [] };
}

describe("selectItemCombinations", () => {
  it("sums stats across one choice per slot and groups by tunedCount", () => {
    const itemsBySlot: Partial<Record<ArmorSlot, SlotCandidate[]>> = {};
    for (const slot of ALL_SLOTS) {
      itemsBySlot[slot] = [makeCandidate(slot, `${slot}-a`, { ...zeroVector(), mobility: 10 })];
    }

    const buckets = selectItemCombinations(itemsBySlot);

    expect(buckets).toHaveLength(MAX_TUNED_SLOTS + 1);
    expect(buckets[0]).toHaveLength(1);
    expect(buckets[0][0].stats).toEqual({ ...zeroVector(), mobility: 50 });
    expect(buckets[0][0].tunedCount).toBe(0);
    for (let k = 1; k <= MAX_TUNED_SLOTS; k++) {
      expect(buckets[k]).toHaveLength(0);
    }
  });

  it("counts tunedCount from items with a tuning socket (hasTuning)", () => {
    const itemsBySlot: Partial<Record<ArmorSlot, SlotCandidate[]>> = {};
    for (const slot of ALL_SLOTS) {
      itemsBySlot[slot] = [makeCandidate(slot, `${slot}-a`, zeroVector(), slot === "helmet" || slot === "chest")];
    }

    const buckets = selectItemCombinations(itemsBySlot);

    expect(buckets[0]).toHaveLength(0);
    expect(buckets[2]).toHaveLength(1);
    expect(buckets[2][0].tunedCount).toBe(2);
  });

  it("prunes dominated combinations within each tunedCount bucket", () => {
    const itemsBySlot: Partial<Record<ArmorSlot, SlotCandidate[]>> = {
      helmet: [
        makeCandidate("helmet", "helmet-a", { ...zeroVector(), mobility: 10, resilience: 10 }),
        makeCandidate("helmet", "helmet-b", { ...zeroVector(), mobility: 10, resilience: 5 }),
      ],
    };
    for (const slot of ALL_SLOTS) {
      if (slot === "helmet") continue;
      itemsBySlot[slot] = [makeCandidate(slot, `${slot}-a`, zeroVector())];
    }

    const buckets = selectItemCombinations(itemsBySlot);

    // helmet-b is dominated by helmet-a in every combination, so only one survives.
    expect(buckets[0]).toHaveLength(1);
    expect(buckets[0][0].choices.helmet?.item.name).toBe("helmet-a");
  });

  it("returns all-empty buckets if any slot has no candidates", () => {
    const itemsBySlot: Partial<Record<ArmorSlot, SlotCandidate[]>> = {
      helmet: [makeCandidate("helmet", "helmet-a", zeroVector())],
      // other slots intentionally missing
    };

    const buckets = selectItemCombinations(itemsBySlot);

    expect(buckets).toHaveLength(MAX_TUNED_SLOTS + 1);
    for (const bucket of buckets) {
      expect(bucket).toHaveLength(0);
    }
  });

  it("carries each candidate's allowedIncreaseStats through to the resulting combination", () => {
    const itemsBySlot: Partial<Record<ArmorSlot, SlotCandidate[]>> = {};
    for (const slot of ALL_SLOTS) {
      const candidate = makeCandidate(slot, `${slot}-a`, zeroVector(), slot === "helmet");
      candidate.allowedIncreaseStats = slot === "helmet" ? ["discipline"] : [];
      itemsBySlot[slot] = [candidate];
    }

    const buckets = selectItemCombinations(itemsBySlot);

    expect(buckets[1]).toHaveLength(1);
    expect(buckets[1][0].choices.helmet?.allowedIncreaseStats).toEqual(["discipline"]);
  });

  // Characterization test for the gap tracked in
  // docs/plans/2026-06-20-pareto-pruning-tuning-domain-followup.md: dedupeByStats/paretoFrontier
  // key only on accumulated `stats`, not on `allowedIncreaseStats`. Two legendary candidates in
  // the same slot with identical stats but different fixed tuning stats are therefore
  // indistinguishable to the pruning step, even though they lead to genuinely different
  // downstream tuning outcomes in buildResults's enumerateBoostCombinations.
  it("[characterization] collapses two same-stat candidates with different allowedIncreaseStats to one", () => {
    const identicalStats = { ...zeroVector(), mobility: 10, resilience: 10 };
    const helmetDiscipline = makeCandidate("helmet", "helmet-discipline", identicalStats, true);
    helmetDiscipline.allowedIncreaseStats = ["discipline"];
    const helmetResilience = makeCandidate("helmet", "helmet-resilience", identicalStats, true);
    helmetResilience.allowedIncreaseStats = ["resilience"];

    const itemsBySlot: Partial<Record<ArmorSlot, SlotCandidate[]>> = {
      helmet: [helmetDiscipline, helmetResilience],
    };
    for (const slot of ALL_SLOTS) {
      if (slot === "helmet") continue;
      itemsBySlot[slot] = [makeCandidate(slot, `${slot}-a`, zeroVector())];
    }

    const buckets = selectItemCombinations(itemsBySlot);

    // Observed behavior: only ONE of the two helmets survives -- dedupeByStats's first-occurrence-
    // wins semantics collapse them at the very first slot fold (both have tunedCount=1 and
    // identical accumulated stats). This is the gap, not the desired behavior -- see the
    // follow-up doc for next steps.
    expect(buckets[1]).toHaveLength(1);
    expect(["helmet-discipline", "helmet-resilience"]).toContain(buckets[1][0].choices.helmet?.item.name);
  });
});
