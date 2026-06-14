import type { ArmorItem, ArmorSlot, ArmorStatName, ArmorStats } from "@/lib/armor/types";
import type { ArmorTuning } from "@/lib/armor/tuning";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { getTuningAdjustmentFrontier, MAX_TUNED_SLOTS, type TuningAdjustment } from "./adjustment-frontier";
import { ALL_SLOTS, selectItemCombinations, type ItemCombination, type SlotCandidate } from "./combine";
import { getModDeltaSet } from "./mod-deltas";
import { tuningDeltaVector } from "./tuning-variants";
import { addVectors, zeroVector, type StatVector } from "./vectors";

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

/**
 * Per-stat tier values (`floor(value / 5)`) are shifted by this offset to stay non-negative
 * (stat sums can dip slightly below zero from directional tuning swaps), then packed into a
 * single integer using this radix - both bounded well above any realistic tier value.
 */
const TIER_KEY_OFFSET = 16;
const TIER_KEY_RADIX = 64;

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

/** A candidate winner for a tier-dedup bucket: enough to rebuild the full `OptimizerResult` later. */
interface BestEntry {
  stats: StatVector;
  combo: ItemCombination;
  adj: TuningAdjustment;
}

/**
 * Crosses each `tunedCount` bucket of `itemSelectionFrontier` with its tuning-adjustment frontier
 * and the mod-delta set, filters by `query.thresholds`, tier-dedups (keeping the best-by-
 * `optimizeFor` per tier), and returns the top `RESULT_LIMIT` sorted by `optimizeFor` descending.
 *
 * `buildLoadout` is deferred until after tier-dedup and ranking, since it allocates a full
 * per-slot loadout object and only `RESULT_LIMIT` of them are ever needed.
 */
function buildResults(itemSelectionFrontier: ItemCombination[][], query: OptimizerQuery): OptimizerResult[] {
  // Flatten the mod-delta set, thresholds, and `optimizeFor` index to typed arrays/plain numbers
  // once, so the hot (combo, adj, mod) loop below does scalar arithmetic over contiguous numeric
  // memory instead of per-iteration StatVector allocations and property lookups.
  const statCount = ARMOR_STAT_ORDER.length;
  const modDeltaSet = getModDeltaSet();
  const modDeltaFlat = new Int32Array(modDeltaSet.length * statCount);
  modDeltaSet.forEach((mod, modIndex) => {
    for (let i = 0; i < statCount; i++) {
      modDeltaFlat[modIndex * statCount + i] = mod[ARMOR_STAT_ORDER[i]];
    }
  });
  const thresholdValues = Int32Array.from(ARMOR_STAT_ORDER, (stat) => query.thresholds[stat]);
  const optimizeForIndex = ARMOR_STAT_ORDER.indexOf(query.optimizeFor);

  const best = new Map<number, BestEntry>();
  const baseValues = new Int32Array(statCount);
  const sumValues = new Int32Array(statCount);

  for (let tunedCount = 0; tunedCount <= MAX_TUNED_SLOTS; tunedCount++) {
    const combos = itemSelectionFrontier[tunedCount];
    if (combos.length === 0) continue;

    const adjustments = getTuningAdjustmentFrontier(tunedCount);

    for (const combo of combos) {
      for (const adj of adjustments) {
        // `combo.stats + adj.stats` is invariant across the mod-delta loop; hoist it out so each
        // of the 252 mod deltas only does one addition per stat instead of two.
        for (let i = 0; i < statCount; i++) {
          baseValues[i] = combo.stats[ARMOR_STAT_ORDER[i]] + adj.stats[ARMOR_STAT_ORDER[i]];
        }

        for (let modIndex = 0; modIndex < modDeltaSet.length; modIndex++) {
          const modOffset = modIndex * statCount;
          let meetsThresholds = true;
          let key = 0;

          for (let i = 0; i < statCount; i++) {
            const value = baseValues[i] + modDeltaFlat[modOffset + i];
            if (value < thresholdValues[i]) {
              meetsThresholds = false;
              break;
            }
            sumValues[i] = value;
            key = key * TIER_KEY_RADIX + (Math.floor(value / 5) + TIER_KEY_OFFSET);
          }

          if (!meetsThresholds) continue;

          const existing = best.get(key);
          if (!existing || sumValues[optimizeForIndex] > existing.stats[query.optimizeFor]) {
            const stats = zeroVector();
            for (let i = 0; i < statCount; i++) {
              stats[ARMOR_STAT_ORDER[i]] = sumValues[i];
            }
            best.set(key, { stats, combo, adj });
          }
        }
      }
    }
  }

  return [...best.values()]
    .sort((a, b) => b.stats[query.optimizeFor] - a.stats[query.optimizeFor])
    .slice(0, RESULT_LIMIT)
    .map((entry) => ({ stats: entry.stats, loadout: buildLoadout(entry.combo.choices, entry.adj.tuningAssignment) }));
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
