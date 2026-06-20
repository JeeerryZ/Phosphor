import { describe, it, expect } from "vitest";
import type { ArmorItem, ArmorSlot, ArmorStatName, ArmorStats } from "@/lib/armor/types";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { computeOptimizerQuery } from "./query";
import { zeroVector } from "./vectors";

const ITEMS_PER_SLOT = 14;

// The optimizer runs entirely on the main thread with a slot-count feasibility check
// (O(6) per combo×adjustment pair). 12000ms is generous; typical runs are under 500ms.
const PERFORMANCE_BUDGET_MS = 12000;

// Only these non-exotic slots have tuned (gearTier === 5) candidates, so tunedCount ≤ 3.
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

// All 4 non-exotic slots are fully tuned (gearTier === 5), so tunedCount === 4 for every combo.
const HEAVY_ITEMS_PER_SLOT = 14;

function buildHeavyCandidates(): Partial<Record<ArmorSlot, ArmorItem[]>> {
  const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {};
  for (const slot of ["gauntlets", "chest", "legs", "classItem"] as ArmorSlot[]) {
    candidates[slot] = Array.from({ length: HEAVY_ITEMS_PER_SLOT }, (_, i) => makeItem(slot, i, true));
  }
  return candidates;
}

describe("computeOptimizerQuery performance", () => {
  it(
    "completes within budget with loose thresholds (all zero)",
    async () => {
      const start = Date.now();
      const { results } = await computeOptimizerQuery(exotic, buildCandidates(), {
        thresholds: zeroVector(),
      });
      expect(Date.now() - start).toBeLessThan(PERFORMANCE_BUDGET_MS);
      expect(results.length).toBeGreaterThan(0);
    },
    PERFORMANCE_BUDGET_MS + 5000
  );

  it(
    "completes within budget with strict thresholds",
    async () => {
      const thresholds = { ...zeroVector(), mobility: 30, resilience: 30 };
      const start = Date.now();
      const { results } = await computeOptimizerQuery(exotic, buildCandidates(), {
        thresholds,
      });
      expect(Date.now() - start).toBeLessThan(PERFORMANCE_BUDGET_MS);
      expect(Array.isArray(results)).toBe(true);
    },
    PERFORMANCE_BUDGET_MS + 5000
  );

  it(
    "completes within budget for a tunedCount=4-heavy fixture",
    async () => {
      const start = Date.now();
      const { results } = await computeOptimizerQuery(exotic, buildHeavyCandidates(), {
        thresholds: zeroVector(),
      });
      expect(Date.now() - start).toBeLessThan(PERFORMANCE_BUDGET_MS);
      expect(results.length).toBeGreaterThan(0);
    },
    PERFORMANCE_BUDGET_MS + 5000
  );
});
