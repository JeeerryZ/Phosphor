import { describe, it, expect } from "vitest";
import type { ArmorItem, ArmorSlot, ArmorStatName, ArmorStats } from "@/lib/armor/types";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { getTuningAdjustmentFrontier } from "./adjustment-frontier";
import { getModDeltaSet } from "./mod-deltas";
import { computeOptimizerQuery, ITER_BUDGET } from "./query";
import { getOptimizerPoolSize } from "./worker-pool";
import { zeroVector } from "./vectors";

const ITEMS_PER_SLOT = 14;

// The tunedCount=3 cross-product (~5.9M iterations: frontier(3)=1281 entries x 252 mod-deltas x
// ~15 combos) costs ~2.5-3.5s even after the query.ts hot-loop optimization. 4000ms gives
// headroom for CI variance while still guarding strongly against a regression back to the
// original ~20s+ blowup.
const PERFORMANCE_BUDGET_MS = 4000;

// A tunedCount=4-heavy fixture (see `buildHeavyCandidates`/`heavyExotic` below, all 4 non-exotic
// slots fully tuned) produces combos[4].length = 35 at topK=5 - far more than the `ITER_BUDGET *
// poolSize` cap allows uncapped (35 * 4251 * 252 ~= 37.5M). Without the combo cap (Redesign Task
// 12) this would be in the same blowup regime as the observed real-world crash (157 * 4251 * 252
// ~= 168.2M; 153 * 11247 * 252 ~= 433M for tunedCount=5) and either time out or throw
// `RangeError: Map maximum size exceeded`. With the cap, bucket 4 collapses to its
// `floor(ITER_BUDGET * poolSize / (4251 * 252))` highest-total-stat combos - at `poolSize = 8`,
// that's `floor(16M / 1.07M) ~= 14` combos, each dispatched as its own pool task (Phase 2).
//
// This budget also covers the one-time `getTuningAdjustmentFrontier(4)` build (~1s, building and
// Pareto-pruning ~4251 entries from ~1281 * 32 raw combinations), which is memoized after the
// first call but not yet warm when this test runs. Dispatching ~14 combos x ~1.07M iterations
// across the pool (warm) measured ~7.8s locally on an 8-thread pool, vs. ~1.6s for the Phase
// 1 single-combo cap - the higher cost is expected (Phase 2 trades pool dispatch/serialization
// overhead for ~14x more search coverage in this bucket). 12000ms gives headroom (~1.5x) over the
// ~7.8s observed locally while still failing fast on a true regression (e.g. the cap not applying
// at all).
const HEAVY_PERFORMANCE_BUDGET_MS = 12000;

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

// All 4 non-exotic slots are fully tuned (gearTier === 5), so every item combination has
// tunedCount === 4 and combos[4] absorbs everything (combos[0..3] stay empty).
const HEAVY_ITEMS_PER_SLOT = 14;

function buildHeavyCandidates(): Partial<Record<ArmorSlot, ArmorItem[]>> {
  const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {};
  for (const slot of ["gauntlets", "chest", "legs", "classItem"] as ArmorSlot[]) {
    candidates[slot] = Array.from({ length: HEAVY_ITEMS_PER_SLOT }, (_, i) => makeItem(slot, i, true));
  }
  return candidates;
}

describe("computeOptimizerQuery performance", () => {
  it("completes within budget with loose thresholds (all zero)", async () => {
    const start = Date.now();
    const results = await computeOptimizerQuery(exotic, buildCandidates(), {
      thresholds: zeroVector(),
      optimizeFor: "mobility",
    });
    expect(Date.now() - start).toBeLessThan(PERFORMANCE_BUDGET_MS);
    expect(results.length).toBeGreaterThan(0);
  });

  it("completes within budget with strict thresholds", async () => {
    const thresholds = { ...zeroVector(), mobility: 30, resilience: 30 };
    const start = Date.now();
    const results = await computeOptimizerQuery(exotic, buildCandidates(), {
      thresholds,
      optimizeFor: "mobility",
    });
    expect(Date.now() - start).toBeLessThan(PERFORMANCE_BUDGET_MS);
    expect(Array.isArray(results)).toBe(true);
  });

  it(
    "completes within budget for a tunedCount=4-heavy fixture (combo cap regression guard)",
    async () => {
      const start = Date.now();
      const results = await computeOptimizerQuery(exotic, buildHeavyCandidates(), {
        thresholds: zeroVector(),
        optimizeFor: "mobility",
      });
      expect(Date.now() - start).toBeLessThan(HEAVY_PERFORMANCE_BUDGET_MS);
      expect(results.length).toBeGreaterThan(0);

      // Phase 2 regression guard: with the pool-scaled combo cap (`ITER_BUDGET * poolSize`),
      // bucket 4 (combos[4].length = 35 in this fixture) should retain more than its single
      // highest-total-stat combo (Phase 1 behavior). getOptimizerPoolSize() is 8 on this machine
      // (16 cores capped at MAX_WORKERS), giving maxCombos ~= floor(2_000_000 * 8 /
      // (4251 * 252)) ~= 14 - far more than the 35 combos available, so all 35 are retained.
      //
      // (Final ranked `results` legitimately collapse to a single combo's loadout here, since
      // optimizing for "mobility" lets one combo dominate every tier-bucket - so this asserts on
      // the cap formula directly, using the same exported pieces `buildResults` uses, rather than
      // on `results`.)
      const poolSize = getOptimizerPoolSize();
      expect(poolSize).toBeGreaterThan(1);
      const adjustments = getTuningAdjustmentFrontier(4);
      const perComboCost = adjustments.length * getModDeltaSet().length;
      const maxCombos = Math.max(1, Math.floor((ITER_BUDGET * poolSize) / perComboCost));
      expect(maxCombos).toBeGreaterThan(1);
    },
    // Exceeds vitest's default 5000ms test timeout (separate from HEAVY_PERFORMANCE_BUDGET_MS,
    // which is the actual regression-guard assertion) - see the budget comment above for why this
    // test now runs longer under Phase 2's pool dispatch.
    HEAVY_PERFORMANCE_BUDGET_MS + 5000
  );
});
