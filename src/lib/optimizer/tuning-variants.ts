import { ARMOR_STAT_ORDER } from "@/styles/theme";
import type { ArmorItem, ArmorStatName } from "@/lib/armor/types";
import type { ArmorTuning } from "@/lib/armor/tuning";
import { addVectors, zeroVector, type StatVector } from "./vectors";

export interface TuningVariant {
  tuning: ArmorTuning;
  stats: StatVector;
}

/** All 30 ordered pairs of distinct stats - the directional Tier 5 tuning options. */
export function directionalTuningPairs(): Array<{
  increasedStat: ArmorStatName;
  decreasedStat: ArmorStatName;
}> {
  const pairs: Array<{ increasedStat: ArmorStatName; decreasedStat: ArmorStatName }> = [];
  for (const increasedStat of ARMOR_STAT_ORDER) {
    for (const decreasedStat of ARMOR_STAT_ORDER) {
      if (increasedStat !== decreasedStat) {
        pairs.push({ increasedStat, decreasedStat });
      }
    }
  }
  return pairs;
}

function balancedDelta(): StatVector {
  const delta = zeroVector();
  for (const stat of ARMOR_STAT_ORDER) {
    delta[stat] = 1;
  }
  return delta;
}

/**
 * All achievable stat vectors for an item across its Tier 5 tuning options. Items without a
 * tuning socket (`tuning.kind === "none"`) have exactly one variant: their unmodified stats.
 */
export function computeTuningVariants(item: ArmorItem): TuningVariant[] {
  if (item.tuning.kind === "none") {
    return [{ tuning: { kind: "none" }, stats: item.stats }];
  }

  const variants: TuningVariant[] = [
    { tuning: { kind: "empty" }, stats: item.stats },
    { tuning: { kind: "balanced" }, stats: addVectors(item.stats, balancedDelta()) },
  ];

  for (const { increasedStat, decreasedStat } of directionalTuningPairs()) {
    const delta = zeroVector();
    delta[increasedStat] += 5;
    delta[decreasedStat] -= 5;
    variants.push({
      tuning: { kind: "directional", increasedStat, decreasedStat },
      stats: addVectors(item.stats, delta),
    });
  }

  return variants;
}
