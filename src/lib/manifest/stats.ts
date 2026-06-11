import { ARMOR_STAT_HASHES, type ArmorStatName } from "@/lib/armor/types";
import { getStatDefinition } from "./definitions";

/** Bungie.net icon path for each armor stat, from the manifest's stat definitions. */
export function getArmorStatIcons(): Record<ArmorStatName, string> {
  const icons = {} as Record<ArmorStatName, string>;
  for (const [stat, hash] of Object.entries(ARMOR_STAT_HASHES) as [ArmorStatName, number][]) {
    icons[stat] = getStatDefinition(hash)?.displayProperties.icon ?? "";
  }
  return icons;
}
