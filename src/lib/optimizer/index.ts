import { ARMOR_BUCKET_HASHES } from "@/lib/armor/types";
import type { ArmorItem, ArmorSlot } from "@/lib/armor/types";
import { computeTuningVariants } from "./tuning-variants";
import { paretoFrontier } from "./pareto";
import { combineSlots, type LoadoutCandidate, type SlotChoice } from "./combine";
import { getModDeltaSet } from "./mod-deltas";
import { addVectors, dedupeByStats, type StatVector } from "./vectors";

export type { LoadoutCandidate, SlotChoice } from "./combine";
export type { StatVector } from "./vectors";

export interface OptimizerResult {
  stats: StatVector;
  loadout: LoadoutCandidate["choices"];
}

const ALL_SLOTS = Object.keys(ARMOR_BUCKET_HASHES) as ArmorSlot[];

/**
 * Computes the Pareto frontier of achievable final stat totals for a loadout with `exotic`
 * locked into its slot, choosing one item per remaining slot from `candidatesBySlot`.
 *
 * Returns an empty array if any non-exotic slot has no candidates.
 */
export function computeOptimizerResults(
  exotic: ArmorItem,
  candidatesBySlot: Partial<Record<ArmorSlot, ArmorItem[]>>
): OptimizerResult[] {
  const slotVariants: SlotChoice[][] = [];

  for (const slot of ALL_SLOTS) {
    const items = slot === exotic.slot ? [exotic] : candidatesBySlot[slot] ?? [];
    if (items.length === 0) {
      return [];
    }

    const variants = items.flatMap((item) =>
      computeTuningVariants(item).map((variant) => ({
        item,
        tuning: variant.tuning,
        stats: variant.stats,
      }))
    );
    slotVariants.push(paretoFrontier(dedupeByStats(variants)));
  }

  const baseLoadouts = combineSlots(slotVariants);
  const modDeltas = getModDeltaSet();

  const withMods = baseLoadouts.flatMap((loadout) =>
    modDeltas.map((delta) => ({
      stats: addVectors(loadout.stats, delta),
      loadout: loadout.choices,
    }))
  );

  return paretoFrontier(dedupeByStats(withMods));
}
