import type { ArmorItem, ArmorSlot, ArmorStats, ArmorStatName } from "@/lib/armor/types";
import type { ArmorTuning } from "@/lib/armor/tuning";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { ALL_SLOTS, selectItemCombinations, type ItemCombination, type SlotCandidate } from "./combine";
import { tuningDeltaVector } from "./tuning-variants";
import { addVectors, zeroVector, type StatVector } from "./vectors";

export interface OptimizerQuery {
  thresholds: ArmorStats;
}

export interface SlotChoice {
  item: ArmorItem;
  tuning: ArmorTuning;
  stats: StatVector;
}

export interface OptimizerResult {
  stats: StatVector;
  loadout: Partial<Record<ArmorSlot, SlotChoice>>;
  /** Mod slots remaining after committing the minimum to meet thresholds (max 5). */
  freeSlots: number;
}

/** Maximum number of results returned per query. */
const RESULT_LIMIT = 50;

const MAX_TUNED_SLOTS = 5;
const TIER_KEY_OFFSET = 32;
const TIER_KEY_RADIX = 128;
const MOD_SLOTS = 5;
const MOD_VALUE = 10;

/**
 * Per-slot Cartesian product: yields every combination of one stat per domain in `domains`,
 * in order. Replaces the old "multiset of any 6 stats" enumeration now that each tuned
 * slot has its own allowed-stat domain (a single fixed stat for legendary items, all 6 for
 * exotics) -- domains are no longer interchangeable, so multiset enumeration would silently
 * drop or misassign stats relative to which physical item occupies which slot.
 */
export function* enumerateBoostCombinations(domains: ArmorStatName[][]): Generator<ArmorStatName[]> {
  if (domains.length === 0) {
    yield [];
    return;
  }
  const [first, ...rest] = domains;
  for (const stat of first) {
    for (const tail of enumerateBoostCombinations(rest)) {
      yield [stat, ...tail];
    }
  }
}

function totalStats(stats: StatVector): number {
  return ARMOR_STAT_ORDER.reduce((sum, stat) => sum + stats[stat], 0);
}

/**
 * Fast initial candidate cap per slot. Keeps the top N by total stat sum plus the single best item
 * per individual stat (so extreme single-stat items aren't excluded). At most N+6 items per slot.
 */
const MAX_CANDIDATES_PER_SLOT = 20;

/**
 * Whether `item` can actually be tuned, and which stats it's allowed to increase if so.
 * Exotics are free-choice (any of the 6 stats); legendary items are restricted to their
 * single live-determined increase stat, or not tunable at all if that couldn't be
 * determined. Centralized here so hasTuning and allowedIncreaseStats can never disagree.
 */
function deriveTuningFields(item: ArmorItem): { hasTuning: boolean; allowedIncreaseStats: ArmorStatName[] } {
  const isExotic = item.tierType === 6;
  const canTune = item.gearTier === 5 && (isExotic || item.legendaryTuningIncreaseStat !== undefined);
  return {
    hasTuning: canTune,
    allowedIncreaseStats: !canTune ? [] : isExotic ? ARMOR_STAT_ORDER : [item.legendaryTuningIncreaseStat!],
  };
}

function rankCandidates(items: ArmorItem[]): SlotCandidate[] {
  const sorted = [...items].sort((a, b) => totalStats(b.stats) - totalStats(a.stats));
  const topN = sorted.slice(0, MAX_CANDIDATES_PER_SLOT);
  const topNIds = new Set(topN.map((i) => i.itemInstanceId));

  // Add the best item per individual stat if it wasn't already included.
  for (const stat of ARMOR_STAT_ORDER) {
    let best = sorted[0];
    for (const item of sorted) {
      if (item.stats[stat] > best.stats[stat]) best = item;
    }
    if (!topNIds.has(best.itemInstanceId)) {
      topN.push(best);
      topNIds.add(best.itemInstanceId);
    }
  }

  return topN.map((item) => ({ item, stats: item.stats, ...deriveTuningFields(item) }));
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

interface BestEntry {
  stats: StatVector;
  total: number;
  freeSlots: number;
  combo: ItemCombination;
  tuningAssignment: ArmorTuning[];
}

export interface BuildResultsDebug {
  combosEvaluated: number;
  boostDistributionsChecked: number;
  feasibleCombinations: number;
  uniqueKeys: number;
}

export interface BuildResultsOutput {
  results: OptimizerResult[];
  /** Maximum achievable value per stat across all viable combinations (pre-slice). */
  perStatMax: Record<string, number>;
  debug: BuildResultsDebug;
}

/**
 * For each item combination, enumerates which stats to boost on each T5 slot (free +5 each),
 * then greedily assigns the mandatory -5 per slot to the stat with the most surplus above
 * threshold (excluding the stat being boosted on that same item). This models the actual player
 * decision: the -5 always goes to an unused stat, so T5 tuning is effectively a free +5.
 *
 * Space: the product of each tuned slot's own allowed-stat domain size (1 for legendary
 * items with a known fixed increase stat, 6 for exotics) — at most 6^tunedCount, but
 * typically far smaller since most tuned slots in a combo are legendary.
 */
export async function buildResults(
  itemSelectionFrontier: ItemCombination[][],
  query: OptimizerQuery
): Promise<BuildResultsOutput> {
  const thresholds = query.thresholds;
  const best = new Map<number, BestEntry>();

  let combosEvaluated = 0;
  let boostDistributionsChecked = 0;
  let feasibleCombinations = 0;

  for (let tunedCount = 0; tunedCount <= MAX_TUNED_SLOTS; tunedCount++) {
    const combos = itemSelectionFrontier[tunedCount];
    if (combos.length === 0) continue;
    combosEvaluated += combos.length;

    for (const combo of combos) {
      const tunedSlots = ALL_SLOTS.filter((slot) => combo.choices[slot]?.hasTuning);
      const domains = tunedSlots.map((slot) => combo.choices[slot]!.allowedIncreaseStats);

      for (const boosts of enumerateBoostCombinations(domains)) {
        boostDistributionsChecked++;
        // Apply all boosts from T5 slots.
        const state: StatVector = { ...combo.stats };
        for (const stat of boosts) state[stat] += 5;

        // Greedily assign each slot's mandatory -5 to the stat with the most surplus
        // (value - threshold), skipping the stat being boosted on the same item.
        const dumps: ArmorStatName[] = [];
        let tuningValid = true;
        for (let i = 0; i < tunedCount; i++) {
          let bestDump: ArmorStatName | null = null;
          let bestSurplus = -Infinity;
          for (const stat of ARMOR_STAT_ORDER) {
            if (stat === boosts[i]) continue;
            const surplus = state[stat] - thresholds[stat];
            if (surplus > bestSurplus) {
              bestSurplus = surplus;
              bestDump = stat;
            }
          }
          if (!bestDump) { tuningValid = false; break; }
          dumps.push(bestDump);
          state[bestDump] -= 5;
        }
        if (!tuningValid) continue;

        // Check feasibility: can mod slots cover remaining deficits?
        let slotsNeeded = 0;
        let feasible = true;
        for (const stat of ARMOR_STAT_ORDER) {
          const threshold = thresholds[stat];
          if (threshold > 0 && state[stat] < threshold) {
            slotsNeeded += Math.ceil((threshold - state[stat]) / MOD_VALUE);
            if (slotsNeeded > MOD_SLOTS) { feasible = false; break; }
          }
        }
        if (!feasible) continue;
        feasibleCombinations++;

        // Build final stat vector (committing minimum mods) and compute tier key.
        let key = 0;
        let total = 0;
        const finalStats = zeroVector();
        for (const stat of ARMOR_STAT_ORDER) {
          const threshold = thresholds[stat];
          const val =
            threshold > 0 && state[stat] < threshold
              ? state[stat] + Math.ceil((threshold - state[stat]) / MOD_VALUE) * MOD_VALUE
              : state[stat];
          finalStats[stat] = val;
          total += val;
          key = key * TIER_KEY_RADIX + (Math.floor(val / 5) + TIER_KEY_OFFSET);
        }

        const tuningAssignment: ArmorTuning[] = boosts.map((boost, i) => ({
          kind: "directional" as const,
          increasedStat: boost,
          decreasedStat: dumps[i],
        }));

        const existing = best.get(key);
        if (!existing || total > existing.total) {
          best.set(key, { stats: finalStats, total, freeSlots: MOD_SLOTS - slotsNeeded, combo, tuningAssignment });
        }
      }
    }
  }

  const allEntries = [...best.values()];

  const perStatMax: Record<string, number> = {};
  for (const stat of ARMOR_STAT_ORDER) perStatMax[stat] = 0;
  for (const entry of allEntries) {
    for (const stat of ARMOR_STAT_ORDER) {
      if (entry.stats[stat] > perStatMax[stat]) perStatMax[stat] = entry.stats[stat];
    }
  }

  const results = allEntries
    .sort((a, b) => b.total - a.total)
    .slice(0, RESULT_LIMIT)
    .map((entry) => ({
      stats: entry.stats,
      loadout: buildLoadout(entry.combo.choices, entry.tuningAssignment),
      freeSlots: entry.freeSlots,
    }));

  return {
    results,
    perStatMax,
    debug: { combosEvaluated, boostDistributionsChecked, feasibleCombinations, uniqueKeys: best.size },
  };
}

/**
 * Computes the top loadout results for `query`, with `exotic` locked into its slot and one item
 * chosen per remaining slot from `candidatesBySlot`. Returns an empty array if any non-exotic
 * slot has no candidates.
 *
 * All candidates are included from the start — `selectItemCombinations` Pareto-prunes the combo
 * space at each slot, so there is no benefit to restricting to a top-K subset first. A top-K
 * heuristic with iterative widening was previously used here, but it caused 4-6× redundant sweeps
 * and excluded items with strong single-stat profiles (e.g. high intellect) that would have met
 * strict thresholds.
 */
/**
 * Computes the top loadout results for `query`. When `exotic` is null (no-exotic mode),
 * all 5 slots are drawn from `candidatesBySlot` with no forced exotic.
 */
export async function computeOptimizerQuery(
  exotic: ArmorItem | null,
  candidatesBySlot: Partial<Record<ArmorSlot, ArmorItem[]>>,
  query: OptimizerQuery
): Promise<BuildResultsOutput> {
  const itemsBySlot: Partial<Record<ArmorSlot, SlotCandidate[]>> = {};
  const emptyResult: BuildResultsOutput = {
    results: [],
    perStatMax: {},
    debug: { combosEvaluated: 0, boostDistributionsChecked: 0, feasibleCombinations: 0, uniqueKeys: 0 },
  };

  for (const slot of ALL_SLOTS) {
    if (exotic && slot === exotic.slot) {
      itemsBySlot[slot] = [{ item: exotic, stats: exotic.stats, ...deriveTuningFields(exotic) }];
      continue;
    }

    const items = candidatesBySlot[slot];
    if (!items || items.length === 0) return emptyResult;
    itemsBySlot[slot] = rankCandidates(items);
  }

  return buildResults(selectItemCombinations(itemsBySlot), query);
}
