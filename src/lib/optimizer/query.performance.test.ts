import { describe, it, expect } from "vitest";
import type { ArmorItem, ArmorSlot, ArmorStatName, ArmorStats } from "@/lib/armor/types";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { computeOptimizerQuery } from "./query";
import { zeroVector } from "./vectors";

const ITEMS_PER_SLOT = 14;

// The tunedCount=3 cross-product (~5.9M iterations: frontier(3)=1281 entries x 252 mod-deltas x
// ~15 combos) costs ~2.5-3.5s even after the query.ts hot-loop optimization. 4000ms gives
// headroom for CI variance while still guarding strongly against a regression back to the
// original ~20s+ blowup.
const PERFORMANCE_BUDGET_MS = 4000;

// Only these non-exotic slots ever have tuned (gearTier === 5) candidates, so tunedCount never
// exceeds 3 and getTuningAdjustmentFrontier(4|5) is never built.
const TUNED_SLOTS: ArmorSlot[] = ["gauntlets", "chest", "legs"];

const STAT_OFFSETS: Record<ArmorStatName, number> = {
  mobility: 1,
  resilience: 3,
  recovery: 5,
  discipline: 7,
  intellect: 11,
  strength: 13,
};

function generateStats(seed: number): ArmorStats {
  const stats = zeroVector();
  for (const stat of ARMOR_STAT_ORDER) {
    stats[stat] = ((seed * STAT_OFFSETS[stat]) % 7) * 5 + 5;
  }
  return stats;
}

function makeItem(slot: ArmorSlot, index: number, tuned: boolean): ArmorItem {
  return {
    itemInstanceId: `${slot}-${index}`,
    itemHash: 0,
    name: `${slot}-${index}`,
    icon: "",
    slot,
    tierType: 5,
    classType: 0,
    stats: generateStats(index + 1),
    tuning: { kind: "none" },
    power: 0,
    gearTier: tuned ? 5 : undefined,
    isMasterworked: true,
    location: "vault",
  };
}

function buildCandidates(): Partial<Record<ArmorSlot, ArmorItem[]>> {
  const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {};
  for (const slot of ["gauntlets", "chest", "legs", "classItem"] as ArmorSlot[]) {
    const tuned = TUNED_SLOTS.includes(slot);
    candidates[slot] = Array.from({ length: ITEMS_PER_SLOT }, (_, i) => makeItem(slot, i, tuned && i % 2 === 0));
  }
  return candidates;
}

const exotic: ArmorItem = { ...makeItem("helmet", 0, false), tierType: 6 };

describe("computeOptimizerQuery performance", () => {
  it("completes within budget with loose thresholds (all zero)", () => {
    const start = Date.now();
    const results = computeOptimizerQuery(exotic, buildCandidates(), {
      thresholds: zeroVector(),
      optimizeFor: "mobility",
    });
    expect(Date.now() - start).toBeLessThan(PERFORMANCE_BUDGET_MS);
    expect(results.length).toBeGreaterThan(0);
  });

  it("completes within budget with strict thresholds", () => {
    const thresholds = { ...zeroVector(), mobility: 30, resilience: 30 };
    const start = Date.now();
    const results = computeOptimizerQuery(exotic, buildCandidates(), {
      thresholds,
      optimizeFor: "mobility",
    });
    expect(Date.now() - start).toBeLessThan(PERFORMANCE_BUDGET_MS);
    expect(Array.isArray(results)).toBe(true);
  });
});
