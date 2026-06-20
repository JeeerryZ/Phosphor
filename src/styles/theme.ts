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

/**
 * Per-stat cooldown/value hint at each tier (T0–T10).
 * Mobility = Hunter dodge; Resilience = PvE resist; Recovery = class regen/rift.
 * Grenade/Melee use a standard ability as reference. Super uses a mid-range super type.
 * Values are approximate — exact figures vary by ability type and season balance.
 */
export const STAT_TIER_HINTS: Record<ArmorStatName, readonly string[]> = {
  mobility:    ["29s","26s","23s","21s","19s","17s","15s","13s","11s","10s","9s"],
  resilience:  ["0%","8%","9%","10%","11%","11%","12%","13%","14%","15%","40%"],
  recovery:    ["33s","30s","27s","24s","21s","19s","17s","15s","14s","13s","12s"],
  discipline:  ["182s","164s","148s","133s","120s","109s","100s","91s","83s","76s","64s"],
  intellect:   ["8:00","7:28","6:59","6:33","6:10","5:50","5:31","5:15","5:00","4:46","4:33"],
  strength:    ["182s","164s","148s","133s","120s","109s","100s","91s","83s","76s","64s"],
};

/** Short ability label for each stat's cooldown hint. */
export const STAT_TIER_HINT_LABELS: Record<ArmorStatName, string> = {
  mobility:    "dodge",
  resilience:  "resist",
  recovery:    "rift",
  discipline:  "grenade",
  intellect:   "super",
  strength:    "melee",
};

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
