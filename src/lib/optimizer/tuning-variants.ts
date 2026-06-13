import { ARMOR_STAT_ORDER } from "@/styles/theme";
import type { ArmorStatName } from "@/lib/armor/types";
import type { ArmorTuning } from "@/lib/armor/tuning";
import { zeroVector, type StatVector } from "./vectors";

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
 * The universal set of 32 Tier 5 tuning deltas available to any item with a tuning socket: empty
 * (no change), balanced (+1 to every stat), and the 30 directional +5/-5 swaps. Every tuned item
 * shares this exact menu, independent of its base stats.
 */
export function tuningDeltas(): Array<{ tuning: ArmorTuning; delta: StatVector }> {
  const deltas: Array<{ tuning: ArmorTuning; delta: StatVector }> = [
    { tuning: { kind: "empty" }, delta: zeroVector() },
    { tuning: { kind: "balanced" }, delta: balancedDelta() },
  ];

  for (const { increasedStat, decreasedStat } of directionalTuningPairs()) {
    const delta = zeroVector();
    delta[increasedStat] += 5;
    delta[decreasedStat] -= 5;
    deltas.push({ tuning: { kind: "directional", increasedStat, decreasedStat }, delta });
  }

  return deltas;
}

/** The stat delta contributed by a given tuning choice (zero for "none" and "empty"). */
export function tuningDeltaVector(tuning: ArmorTuning): StatVector {
  if (tuning.kind === "balanced") {
    return balancedDelta();
  }
  if (tuning.kind === "directional") {
    const delta = zeroVector();
    delta[tuning.increasedStat] += 5;
    delta[tuning.decreasedStat] -= 5;
    return delta;
  }
  return zeroVector();
}
