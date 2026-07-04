import { EMPTY_ARMOR_STATS } from "@/lib/armor/types";
import type { ArmorStats } from "@/lib/armor/types";
import { ALL_STAT_NAMES } from "./mods";

// Subclass fragments are a free stat source outside of mods, so they reduce what
// mods need to cover. Returns, per stat, how much the mod solver still needs to
// make up after subtracting the fragment bonus (never negative).
export function adjustTargetsForFragments(targets: ArmorStats, fragmentBonuses: ArmorStats): ArmorStats {
  const result: ArmorStats = { ...EMPTY_ARMOR_STATS };
  for (const stat of ALL_STAT_NAMES) {
    result[stat] = Math.max(0, targets[stat] - fragmentBonuses[stat]);
  }
  return result;
}

// A stat's input ceiling is normally capped by what mods alone can produce
// (maxStat). A positive fragment bonus raises that ceiling by the same amount,
// since mods still only need to cover up to maxStat of it. Negative bonuses
// don't lower the ceiling -- an unreachable target just shows as a deficit.
export function effectiveStatCap(maxStat: number, fragmentBonus: number): number {
  return maxStat + Math.max(0, fragmentBonus);
}
