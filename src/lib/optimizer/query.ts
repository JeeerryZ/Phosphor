import type { ArmorItem, ArmorSlot, ArmorStatName, ArmorStats } from "@/lib/armor/types";
import type { ArmorTuning } from "@/lib/armor/tuning";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { getTuningAdjustmentFrontier, MAX_TUNED_SLOTS, type TuningAdjustment } from "./adjustment-frontier";
import { ALL_SLOTS, selectItemCombinations, type ItemCombination, type SlotCandidate } from "./combine";
import { getModDeltaSet } from "./mod-deltas";
import { tuningDeltaVector } from "./tuning-variants";
import { addVectors, type StatVector } from "./vectors";

export interface OptimizerQuery {
  thresholds: ArmorStats;
  optimizeFor: ArmorStatName;
}

export interface SlotChoice {
  item: ArmorItem;
  tuning: ArmorTuning;
  stats: StatVector;
}

export interface OptimizerResult {
  stats: StatVector;
  loadout: Partial<Record<ArmorSlot, SlotChoice>>;
}

/** Initial number of top-ranked candidates considered per non-exotic slot. */
const INITIAL_TOP_K = 5;

/** Maximum number of results returned per query. */
const RESULT_LIMIT = 50;

function totalStats(stats: StatVector): number {
  return ARMOR_STAT_ORDER.reduce((sum, stat) => sum + stats[stat], 0);
}

/** Ranks a slot's candidates by total base-stat sum, descending. Query-independent. */
function rankCandidates(items: ArmorItem[]): SlotCandidate[] {
  return [...items]
    .sort((a, b) => totalStats(b.stats) - totalStats(a.stats))
    .map((item) => ({ item, stats: item.stats, hasTuning: item.gearTier === 5 }));
}

/** Builds the per-slot candidate slice for this iteration: the exotic in its slot, top-`topK` elsewhere. */
function sliceTopK(
  rankedBySlot: Partial<Record<ArmorSlot, SlotCandidate[]>>,
  exotic: ArmorItem,
  topK: number
): Partial<Record<ArmorSlot, SlotCandidate[]>> {
  const itemsBySlot: Partial<Record<ArmorSlot, SlotCandidate[]>> = {};

  for (const slot of ALL_SLOTS) {
    if (slot === exotic.slot) {
      itemsBySlot[slot] = [{ item: exotic, stats: exotic.stats, hasTuning: exotic.gearTier === 5 }];
    } else {
      itemsBySlot[slot] = rankedBySlot[slot]?.slice(0, topK);
    }
  }

  return itemsBySlot;
}

/** Tier-dedup key: `floor(value / 5)` per stat, in `ARMOR_STAT_ORDER`. */
function tierKey(stats: StatVector): string {
  return ARMOR_STAT_ORDER.map((stat) => Math.floor(stats[stat] / 5)).join(",");
}

/** Builds the per-slot loadout, assigning each tuned slot's stats/tuning from `tuningAssignment` in slot order. */
function buildLoadout(
  choices: ItemCombination["choices"],
  tuningAssignment: ArmorTuning[]
): OptimizerResult["loadout"] {
  const loadout: OptimizerResult["loadout"] = {};
  let tuningIndex = 0;

  for (const slot of ALL_SLOTS) {
    const candidate = choices[slot];
    if (!candidate) continue;

    if (candidate.hasTuning) {
      const tuning = tuningAssignment[tuningIndex++];
      loadout[slot] = {
        item: candidate.item,
        tuning,
        stats: addVectors(candidate.stats, tuningDeltaVector(tuning)),
      };
    } else {
      loadout[slot] = { item: candidate.item, tuning: { kind: "none" }, stats: candidate.stats };
    }
  }

  return loadout;
}

/** Sums `combo`, `adj`, and `mod`; returns the result only if it meets `thresholds`. */
function combineIfMeetsThresholds(
  combo: ItemCombination,
  adj: TuningAdjustment,
  mod: StatVector,
  thresholds: ArmorStats
): OptimizerResult | undefined {
  const stats = addVectors(addVectors(combo.stats, adj.stats), mod);

  for (const stat of ARMOR_STAT_ORDER) {
    if (stats[stat] < thresholds[stat]) {
      return undefined;
    }
  }

  return { stats, loadout: buildLoadout(combo.choices, adj.tuningAssignment) };
}

/**
 * Crosses each `tunedCount` bucket of `itemSelectionFrontier` with its tuning-adjustment frontier
 * and the mod-delta set, filters by `query.thresholds`, tier-dedups (keeping the best-by-
 * `optimizeFor` per tier), and returns the top `RESULT_LIMIT` sorted by `optimizeFor` descending.
 */
function buildResults(itemSelectionFrontier: ItemCombination[][], query: OptimizerQuery): OptimizerResult[] {
  const modDeltas = getModDeltaSet();
  const best = new Map<string, OptimizerResult>();

  for (let tunedCount = 0; tunedCount <= MAX_TUNED_SLOTS; tunedCount++) {
    const combos = itemSelectionFrontier[tunedCount];
    if (combos.length === 0) continue;

    const adjustments = getTuningAdjustmentFrontier(tunedCount);

    for (const combo of combos) {
      for (const adj of adjustments) {
        for (const mod of modDeltas) {
          const result = combineIfMeetsThresholds(combo, adj, mod, query.thresholds);
          if (!result) continue;

          const key = tierKey(result.stats);
          const existing = best.get(key);
          if (!existing || result.stats[query.optimizeFor] > existing.stats[query.optimizeFor]) {
            best.set(key, result);
          }
        }
      }
    }
  }

  return [...best.values()]
    .sort((a, b) => b.stats[query.optimizeFor] - a.stats[query.optimizeFor])
    .slice(0, RESULT_LIMIT);
}

/**
 * Computes the top loadout results for `query`, with `exotic` locked into its slot and one item
 * chosen per remaining slot from `candidatesBySlot`. Returns an empty array if any non-exotic
 * slot has no candidates.
 */
export function computeOptimizerQuery(
  exotic: ArmorItem,
  candidatesBySlot: Partial<Record<ArmorSlot, ArmorItem[]>>,
  query: OptimizerQuery
): OptimizerResult[] {
  const rankedBySlot: Partial<Record<ArmorSlot, SlotCandidate[]>> = {};
  let maxAvailable = 0;

  for (const slot of ALL_SLOTS) {
    if (slot === exotic.slot) continue;

    const items = candidatesBySlot[slot];
    if (!items || items.length === 0) {
      return [];
    }

    rankedBySlot[slot] = rankCandidates(items);
    maxAvailable = Math.max(maxAvailable, items.length);
  }

  let topK = Math.min(INITIAL_TOP_K, maxAvailable);
  let results: OptimizerResult[] = [];

  while (true) {
    const itemsBySlot = sliceTopK(rankedBySlot, exotic, topK);
    const itemSelectionFrontier = selectItemCombinations(itemsBySlot);
    results = buildResults(itemSelectionFrontier, query);

    if (results.length >= RESULT_LIMIT || topK >= maxAvailable) {
      break;
    }

    topK = Math.min(topK * 2, maxAvailable);
  }

  return results;
}
