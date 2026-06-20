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

/** Per-stat accent colors — vibrant on dark backgrounds. */
export const ARMOR_STAT_COLORS: Record<ArmorStatName, string> = {
  resilience: "#f87171",
  strength:   "#fb923c",
  discipline: "#c084fc",
  intellect:  "#38bdf8",  // cyan — avoids clash with amber fg
  recovery:   "#4ade80",
  mobility:   "#a78bfa",
};

/** Short stat identifiers for compact displays. */
export const ARMOR_STAT_SHORT: Record<ArmorStatName, string> = {
  resilience: "HP",
  strength: "MEL",
  discipline: "GRN",
  intellect: "SUP",
  recovery: "CLS",
  mobility: "WPN",
};

export const ARMOR_STAT_ORDER: ArmorStatName[] = [
  "resilience",
  "strength",
  "discipline",
  "intellect",
  "recovery",
  "mobility",
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
