import type { ArmorTuning } from "./tuning";

/** Stat hashes for the 6 armor stats, stable across Destiny 2's lifetime. */
export const ARMOR_STAT_HASHES = {
  mobility: 2996146975,
  resilience: 392767087,
  recovery: 1943323491,
  discipline: 1735777505,
  intellect: 144602215,
  strength: 4244567218,
} as const;

export type ArmorStatName = keyof typeof ARMOR_STAT_HASHES;

export type ArmorStats = Record<ArmorStatName, number>;

export const EMPTY_ARMOR_STATS: ArmorStats = {
  mobility: 0,
  resilience: 0,
  recovery: 0,
  discipline: 0,
  intellect: 0,
  strength: 0,
};

/** Inventory bucket hashes for the 5 armor slots, stable across Destiny 2's lifetime. */
export const ARMOR_BUCKET_HASHES = {
  helmet: 3448274439,
  gauntlets: 3551918588,
  chest: 14239492,
  legs: 20886954,
  classItem: 1585787867,
} as const;

export type ArmorSlot = keyof typeof ARMOR_BUCKET_HASHES;

export interface ArmorItem {
  itemInstanceId: string;
  itemHash: number;
  name: string;
  icon: string;
  slot: ArmorSlot;
  tierType: number;
  classType: number;
  stats: ArmorStats;
  /** Tier 5 stat-tuning currently applied to this piece, if any. */
  tuning: ArmorTuning;
  /** Item power level. */
  power: number;
  /** Gear tier (e.g. 5 for Edge of Fate "Tier 5" armor), if known. */
  gearTier: number | undefined;
  /** Whether the item has a masterwork plug inserted (all armor sits at 11/11 energy regardless). */
  isMasterworked: boolean;
  /** "vault" or a characterId */
  location: string;
  /** Index of the Tier 5 stat-tuning socket within this item's socket array, if present. */
  tuningSocketIndex?: number;
  /** Index of the general stat-mod socket (enhancements.v2_general) within this item's socket array, if present. */
  statModSocketIndex?: number;
  /**
   * For legendary (non-exotic) armor with a Tier 5 tuning socket: the one stat this
   * specific item instance is allowed to increase via tuning (the decrease stat is freely
   * chosen among the other 5). Undefined for exotics (free-choice) and for legendary items
   * where this couldn't be determined from live plug data.
   */
  legendaryTuningIncreaseStat?: ArmorStatName;
  /**
   * Exotic perks extracted from sockets — only populated for exotic class items,
   * where the two randomly-rolled perks are the key differentiator between copies.
   */
  exoticPerks?: { name: string; description: string; icon: string }[];
}

export interface ArmorInventory {
  vault: ArmorItem[];
  characters: Record<string, ArmorItem[]>;
}
