import type { ArmorStatName } from "@/lib/armor/types";

export const STAT_LABELS: Record<ArmorStatName, string> = {
  mobility: "Weapon",
  resilience: "Health",
  recovery: "Class",
  discipline: "Grenade",
  intellect: "Super",
  strength: "Melee",
};

export const ALL_STAT_NAMES: ArmorStatName[] = [
  "mobility",
  "resilience",
  "recovery",
  "discipline",
  "intellect",
  "strength",
];

export interface GhostMod {
  name: string;
  statA: ArmorStatName;
  statB: ArmorStatName;
}

export const GHOST_MODS: GhostMod[] = [
  { name: "Siegebreaker", statA: "resilience", statB: "discipline" },
  { name: "Bulwark",      statA: "resilience", statB: "recovery"   },
  { name: "Brawler",      statA: "strength",   statB: "resilience" },
  { name: "Skirmisher",   statA: "strength",   statB: "mobility"   },
  { name: "Grenadier",    statA: "discipline", statB: "intellect"  },
  { name: "Demolitionist",statA: "discipline", statB: "recovery"   },
  { name: "Colossus",     statA: "intellect",  statB: "resilience" },
  { name: "Paragon",      statA: "intellect",  statB: "strength"   },
  { name: "Reaver",       statA: "recovery",   statB: "strength"   },
  { name: "Specialist",   statA: "recovery",   statB: "mobility"   },
  { name: "Gunner",       statA: "mobility",   statB: "discipline" },
  { name: "Powerhouse",   statA: "mobility",   statB: "intellect"  },
];
