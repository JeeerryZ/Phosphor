import type { ArmorStatName } from "./types";

/**
 * Tier 5 "Stat Tuning" mod plugs (plugCategoryIdentifier
 * "core.gear_systems.armor_tiering.plugs.tuning.mods"). Each non-balanced/empty
 * plug moves 5 points from one armor stat to another.
 */
export const STAT_TUNING_PLUGS: Record<
  number,
  { increasedStat: ArmorStatName; decreasedStat: ArmorStatName }
> = {
  2244422610: { increasedStat: "intellect", decreasedStat: "mobility" },
  3121760799: { increasedStat: "mobility", decreasedStat: "resilience" },
  3284443097: { increasedStat: "mobility", decreasedStat: "discipline" },
  3310526732: { increasedStat: "resilience", decreasedStat: "recovery" },
  3554800389: { increasedStat: "intellect", decreasedStat: "recovery" },
  3681082702: { increasedStat: "resilience", decreasedStat: "discipline" },
  3946669007: { increasedStat: "intellect", decreasedStat: "discipline" },
  4020349587: { increasedStat: "strength", decreasedStat: "mobility" },
  4026414261: { increasedStat: "intellect", decreasedStat: "resilience" },
  4030660414: { increasedStat: "recovery", decreasedStat: "resilience" },
  4088823605: { increasedStat: "resilience", decreasedStat: "intellect" },
  4116389173: { increasedStat: "discipline", decreasedStat: "mobility" },
  4164883102: { increasedStat: "strength", decreasedStat: "resilience" },
  4210715468: { increasedStat: "strength", decreasedStat: "recovery" },
  309000506: { increasedStat: "discipline", decreasedStat: "strength" },
  311164277: { increasedStat: "strength", decreasedStat: "intellect" },
  323635379: { increasedStat: "recovery", decreasedStat: "mobility" },
  388618952: { increasedStat: "resilience", decreasedStat: "strength" },
  455024236: { increasedStat: "discipline", decreasedStat: "resilience" },
  534630542: { increasedStat: "strength", decreasedStat: "discipline" },
  673231129: { increasedStat: "intellect", decreasedStat: "strength" },
  691392383: { increasedStat: "mobility", decreasedStat: "strength" },
  891771298: { increasedStat: "mobility", decreasedStat: "intellect" },
  957763733: { increasedStat: "recovery", decreasedStat: "intellect" },
  1510949672: { increasedStat: "recovery", decreasedStat: "strength" },
  1672416975: { increasedStat: "discipline", decreasedStat: "intellect" },
  1879022254: { increasedStat: "recovery", decreasedStat: "discipline" },
  1918710127: { increasedStat: "mobility", decreasedStat: "recovery" },
  1922571986: { increasedStat: "discipline", decreasedStat: "recovery" },
  2125798995: { increasedStat: "resilience", decreasedStat: "mobility" },
};

/** "+1 to all stats" plug, used as a fallback before a directional tuning is chosen. */
export const BALANCED_TUNING_PLUG_HASH = 3122197216;

/** No tuning applied. */
export const EMPTY_TUNING_PLUG_HASH = 2121121504;

export type ArmorTuning =
  | { kind: "directional"; increasedStat: ArmorStatName; decreasedStat: ArmorStatName }
  | { kind: "balanced" }
  | { kind: "empty" }
  | { kind: "none" };

/** Reads the Tier 5 stat-tuning state from an item's socket plug hashes. */
export function readArmorTuning(plugHashes: (number | undefined)[]): ArmorTuning {
  for (const plugHash of plugHashes) {
    if (plugHash === undefined) continue;

    const directional = STAT_TUNING_PLUGS[plugHash];
    if (directional) {
      return { kind: "directional", ...directional };
    }

    if (plugHash === BALANCED_TUNING_PLUG_HASH) {
      return { kind: "balanced" };
    }

    if (plugHash === EMPTY_TUNING_PLUG_HASH) {
      return { kind: "empty" };
    }
  }

  return { kind: "none" };
}
