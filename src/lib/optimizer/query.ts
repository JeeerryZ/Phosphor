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
 *
 * Per-stat `value = combo.stats[i] + adj.stats[i] + mod[i]` is assumed to stay within
 * [-150, 450]: `adj.stats[i] ∈ [-25, 25]` and `mod[i] ∈ [0, 50]`, leaving `combo.stats[i]`
 * generous headroom even though `ARMOR_STAT_MAX = 40` per item over 5 items caps it at 200
 * (and realistically far lower). That gives `floor(value/5) ∈ [-30, 90]`, so with
 * `TIER_KEY_OFFSET = 32` the shifted digit lands in [2, 122], comfortably inside the
 * [0, TIER_KEY_RADIX - 1] = [0, 127] range. `128^6 ≈ 4.4e12`, far below
 * `Number.MAX_SAFE_INTEGER` (~9e15), so the packed key for 6 stats cannot overflow.
 */
const TIER_KEY_OFFSET = 32;
const TIER_KEY_RADIX = 128;

/**
 * Per-`tunedCount` bucket, the (combo x adjustment x mod) cross-product is capped to roughly this
 * many iterations by sorting `combos` by total stat sum (descending) and slicing to
 * `max(1, floor(ITER_BUDGET / (adjustments.length * modDeltaSet.length)))`.
 *
 * T5 armor pieces always contribute more total raw stats than lower-tier pieces, so for buckets
 * where the adjustment+mod frontier is huge (tunedCount 4/5), restricting to the highest-total-
 * stat combo(s) is correct-enough: the full (uncapped) adjustment+mod frontier still performs the
 * fine-grained per-stat redistribution on top of those combos. For tunedCount <= 3 this is a
 * no-op with realistic inventories, since `combos.length * adjustments.length * 252` stays well
 * under the budget there (the tunedCount=3 case alone is ~5.9M per the performance test).
 *
 * Sizing: `adjustments(5).length * 252 ~= 11247 * 252 ~= 2.83M`, which already exceeds most
 * reasonable budgets - so tunedCount=5 always collapses to its single highest-total-stat combo
 * (~2.83M iterations on its own). With `ITER_BUDGET = 2_000_000`, tunedCount=4
 * (`4251 * 252 ~= 1.07M` per combo) also collapses to 1 combo (~1.07M iterations). Combined with
 * the ~5.9M from tunedCount 0-3, the worst-case total across all 6 buckets is
 * ~5.9M + 2.83M + 1.07M ~= 9.8M iterations - comfortably under the ~10-15M target and close to
 * the ~1.5M iterations/sec the existing performance test budgets for.
 */
export const ITER_BUDGET = 2_000_000;

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
export function buildResults(itemSelectionFrontier: ItemCombination[][], query: OptimizerQuery): OptimizerResult[] {
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
    let combos = itemSelectionFrontier[tunedCount];
    if (combos.length === 0) continue;

    const adjustments = getTuningAdjustmentFrontier(tunedCount);
    const perComboCost = adjustments.length * modDeltaSet.length;

    if (combos.length * perComboCost > ITER_BUDGET) {
      const maxCombos = Math.max(1, Math.floor(ITER_BUDGET / perComboCost));
      combos = [...combos].sort((a, b) => totalStats(b.stats) - totalStats(a.stats)).slice(0, maxCombos);
    }

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
