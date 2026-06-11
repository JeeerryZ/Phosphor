import type { ArmorStatName } from "@/lib/armor/types";

/** Display labels and ordering for the 6 armor stats (Edge of Fate naming). */
export const ARMOR_STAT_LABELS: Record<ArmorStatName, string> = {
  mobility: "Weapons",
  resilience: "Health",
  recovery: "Class",
  discipline: "Grenade",
  intellect: "Super",
  strength: "Melee",
};

export const ARMOR_STAT_ORDER: ArmorStatName[] = [
  "mobility",
  "resilience",
  "recovery",
  "discipline",
  "intellect",
  "strength",
];

/** Approximate max value of a single armor stat (legendary, masterworked + tuning). */
export const ARMOR_STAT_MAX = 40;

/** Slider range for the optimizer's per-stat thresholds (totals across a 5-piece loadout). */
export const OPTIMIZER_STAT_MAX = 200;
export const OPTIMIZER_STAT_STEP = 5;

export const ARMOR_SLOT_LABELS = {
  helmet: "Helmet",
  gauntlets: "Gauntlets",
  chest: "Chest Armor",
  legs: "Leg Armor",
  classItem: "Class Item",
} as const;

/** Destiny class type values from DestinyClass, used in DestinyInventoryItemDefinition.classType. */
export const CLASS_TYPE_LABELS: Record<number, string> = {
  0: "Titan",
  1: "Hunter",
  2: "Warlock",
  3: "Unknown",
};
