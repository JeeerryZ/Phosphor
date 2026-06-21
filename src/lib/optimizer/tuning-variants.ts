import { ARMOR_STAT_ORDER } from "@/styles/theme";
import type { ArmorTuning } from "@/lib/armor/tuning";
import { zeroVector, type StatVector } from "./vectors";

function balancedDelta(): StatVector {
  const delta = zeroVector();
  for (const stat of ARMOR_STAT_ORDER) {
    delta[stat] = 1;
  }
  return delta;
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
