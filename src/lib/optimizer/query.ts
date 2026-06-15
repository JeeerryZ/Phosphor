import type { ArmorItem, ArmorSlot, ArmorStatName, ArmorStats } from "@/lib/armor/types";
import type { ArmorTuning } from "@/lib/armor/tuning";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { getTuningAdjustmentFrontier, MAX_TUNED_SLOTS, type TuningAdjustment } from "./adjustment-frontier";
import { ALL_SLOTS, selectItemCombinations, type ItemCombination, type SlotCandidate } from "./combine";
import { getModDeltaSet } from "./mod-deltas";
import { tuningDeltaVector } from "./tuning-variants";
import { addVectors, flattenStatVectors, zeroVector, type StatVector } from "./vectors";
import { getOptimizerPoolSize, runComboTask } from "./worker-pool";

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
 * Per-`tunedCount` bucket, the (combo x adjustment x mod) cross-product is capped to roughly
 * `ITER_BUDGET * poolSize` iterations by sorting `combos` by total stat sum (descending) and
 * slicing to `max(1, floor(ITER_BUDGET * poolSize / (adjustments.length * modDeltaSet.length)))`,
 * where `poolSize` is the worker pool's thread count (`getOptimizerPoolSize()`). Each
 * surviving `(tunedCount, combo)` pair becomes one task dispatched to the pool (Phase 2) - see
 * docs/plans/2026-06-15-optimizer-worker-thread-pool-design.md.
 *
 * Sizing at `poolSize = 8`: `adjustments(4).length * 252 ~= 4251 * 252 ~= 1.07M`, so
 * `tunedCount=4` gets `floor(16M / 1.07M) ~= 14` combos (vs. 1 at the Phase 1 single-bucket cap).
 * `adjustments(5).length * 252 ~= 11247 * 252 ~= 2.83M`, so `tunedCount=5` gets
 * `floor(16M / 2.83M) ~= 5` combos (vs. 1). `tunedCount <= 3` stays effectively uncapped at
 * realistic inventory sizes, as before.
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
 * Each `(tunedCount, combo)` pair becomes one task dispatched to the worker pool (Phase 2) - see
 * docs/plans/2026-06-15-optimizer-worker-thread-pool-design.md. `buildLoadout` is deferred until
 * after tier-dedup and ranking, since it allocates a full per-slot loadout object and only
 * `RESULT_LIMIT` of them are ever needed.
 */
export async function buildResults(
  itemSelectionFrontier: ItemCombination[][],
  query: OptimizerQuery
): Promise<OptimizerResult[]> {
  const statCount = ARMOR_STAT_ORDER.length;
  const modDeltaSet = getModDeltaSet();
  const modDeltaFlat = flattenStatVectors(modDeltaSet);
  const thresholdValues = Int32Array.from(ARMOR_STAT_ORDER, (stat) => query.thresholds[stat]);
  const optimizeForIndex = ARMOR_STAT_ORDER.indexOf(query.optimizeFor);
  const poolSize = getOptimizerPoolSize();

  interface Task {
    tunedCount: number;
    combo: ItemCombination;
  }

  const tasks: Task[] = [];
  const adjustmentsByTunedCount = new Map<number, TuningAdjustment[]>();
  const adjustmentStatsFlatByTunedCount = new Map<number, Int32Array>();

  for (let tunedCount = 0; tunedCount <= MAX_TUNED_SLOTS; tunedCount++) {
    let combos = itemSelectionFrontier[tunedCount];
    if (combos.length === 0) continue;

    const adjustments = getTuningAdjustmentFrontier(tunedCount);
    adjustmentsByTunedCount.set(tunedCount, adjustments);
    adjustmentStatsFlatByTunedCount.set(tunedCount, flattenStatVectors(adjustments.map((a) => a.stats)));

    const perComboCost = adjustments.length * modDeltaSet.length;
    const maxCombos = Math.max(1, Math.floor((ITER_BUDGET * poolSize) / perComboCost));
    if (combos.length > maxCombos) {
      combos = [...combos].sort((a, b) => totalStats(b.stats) - totalStats(a.stats)).slice(0, maxCombos);
    }

    for (const combo of combos) {
      tasks.push({ tunedCount, combo });
    }
  }

  const best = new Map<number, BestEntry>();

  const taskResults = await Promise.all(
    tasks.map((task) => {
      const adjustments = adjustmentsByTunedCount.get(task.tunedCount)!;
      const adjustmentStatsFlat = adjustmentStatsFlatByTunedCount.get(task.tunedCount)!;
      const comboStats = flattenStatVectors([task.combo.stats]);

      return runComboTask({
        comboStats,
        adjustmentStatsFlat,
        adjustmentCount: adjustments.length,
        modDeltaFlat,
        modCount: modDeltaSet.length,
        thresholdValues,
        optimizeForIndex,
        statCount,
      });
    })
  );

  for (let t = 0; t < tasks.length; t++) {
    const { tunedCount, combo } = tasks[t];
    const adjustments = adjustmentsByTunedCount.get(tunedCount)!;

    for (const entry of taskResults[t]) {
      const existing = best.get(entry.key);
      if (!existing || entry.stats[optimizeForIndex] > existing.stats[query.optimizeFor]) {
        const stats = zeroVector();
        for (let i = 0; i < statCount; i++) {
          stats[ARMOR_STAT_ORDER[i]] = entry.stats[i];
        }
        best.set(entry.key, { stats, combo, adj: adjustments[entry.adjIndex] });
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
export async function computeOptimizerQuery(
  exotic: ArmorItem,
  candidatesBySlot: Partial<Record<ArmorSlot, ArmorItem[]>>,
  query: OptimizerQuery
): Promise<OptimizerResult[]> {
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
    results = await buildResults(itemSelectionFrontier, query);

    if (results.length >= RESULT_LIMIT || topK >= maxAvailable) {
      break;
    }

    topK = Math.min(topK * 2, maxAvailable);
  }

  return results;
}
