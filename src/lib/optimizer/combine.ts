import type { ArmorItem, ArmorSlot } from "@/lib/armor/types";
import type { ArmorTuning } from "@/lib/armor/tuning";
import { addVectors, dedupeByStats, type StatVector } from "./vectors";
import { paretoFrontier } from "./pareto";

export interface SlotChoice {
  item: ArmorItem;
  tuning: ArmorTuning;
  stats: StatVector;
}

export interface LoadoutCandidate {
  choices: Partial<Record<ArmorSlot, SlotChoice>>;
  stats: StatVector;
}

/**
 * Combines per-slot candidate variants into loadout candidates (one choice per slot, stats
 * summed), Pareto-pruning the running set after each slot to keep the search tractable.
 */
export function combineSlots(slotVariants: SlotChoice[][]): LoadoutCandidate[] {
  if (slotVariants.length === 0) {
    return [];
  }

  let combined: LoadoutCandidate[] = slotVariants[0].map((choice) => ({
    choices: { [choice.item.slot]: choice },
    stats: choice.stats,
  }));
  combined = paretoFrontier(dedupeByStats(combined));

  for (let i = 1; i < slotVariants.length; i++) {
    const next: LoadoutCandidate[] = [];
    for (const acc of combined) {
      for (const choice of slotVariants[i]) {
        next.push({
          choices: { ...acc.choices, [choice.item.slot]: choice },
          stats: addVectors(acc.stats, choice.stats),
        });
      }
    }
    combined = paretoFrontier(dedupeByStats(next));
  }

  return combined;
}
