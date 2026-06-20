import { ARMOR_BUCKET_HASHES } from "@/lib/armor/types";
import type { ArmorItem, ArmorSlot, ArmorStatName } from "@/lib/armor/types";
import { MAX_TUNED_SLOTS } from "./adjustment-frontier";
import { paretoFrontier } from "./pareto";
import { addVectors, dedupeByStats, zeroVector, type StatVector } from "./vectors";

/** Canonical iteration order for the 5 armor slots. */
export const ALL_SLOTS = Object.keys(ARMOR_BUCKET_HASHES) as ArmorSlot[];

export interface SlotCandidate {
  item: ArmorItem;
  stats: StatVector;
  /** True if this item has a Tier 5 tuning socket (`item.gearTier === 5`) AND tuning is actually usable (see allowedIncreaseStats). */
  hasTuning: boolean;
  /** Stats this candidate may increase via tuning. All 6 for exotics (free choice); a single
   *  fixed stat for legendary items where it's known; empty if unknown/unusable. */
  allowedIncreaseStats: ArmorStatName[];
}

export interface ItemCombination {
  choices: Partial<Record<ArmorSlot, SlotCandidate>>;
  stats: StatVector;
  /** Number of chosen slots whose item has a tuning socket (0..MAX_TUNED_SLOTS). */
  tunedCount: number;
}

/**
 * Cartesian-combines one candidate per slot (from `itemsBySlot`, over `ALL_SLOTS`) into
 * `ItemCombination`s, grouped by `tunedCount`. After each slot, each `tunedCount` bucket is
 * Pareto-pruned separately, since different buckets are later crossed with different
 * tuning-adjustment frontiers and aren't directly comparable.
 *
 * Returns an array indexed by `tunedCount` (0..MAX_TUNED_SLOTS). If any slot has no candidates,
 * every bucket is empty.
 */
export function selectItemCombinations(
  itemsBySlot: Partial<Record<ArmorSlot, SlotCandidate[]>>
): ItemCombination[][] {
  let buckets: ItemCombination[][] = Array.from({ length: MAX_TUNED_SLOTS + 1 }, () => []);
  buckets[0] = [{ choices: {}, stats: zeroVector(), tunedCount: 0 }];

  for (const slot of ALL_SLOTS) {
    const candidates = itemsBySlot[slot];
    if (!candidates || candidates.length === 0) {
      return Array.from({ length: MAX_TUNED_SLOTS + 1 }, () => []);
    }

    const next: ItemCombination[][] = Array.from({ length: MAX_TUNED_SLOTS + 1 }, () => []);
    for (const bucket of buckets) {
      for (const acc of bucket) {
        for (const candidate of candidates) {
          const tunedCount = acc.tunedCount + (candidate.hasTuning ? 1 : 0);
          next[tunedCount].push({
            choices: { ...acc.choices, [slot]: candidate },
            stats: addVectors(acc.stats, candidate.stats),
            tunedCount,
          });
        }
      }
    }

    buckets = next.map((combos) => paretoFrontier(dedupeByStats(combos)));
  }

  return buckets;
}
