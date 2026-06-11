import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { getItemDefinition } from "../manifest/definitions";

const EMBLEM_BUCKET_HASH = 4274335291;

/**
 * Returns the high-resolution "details view" background art for a character's
 * equipped emblem, falling back to the lower-resolution emblemBackgroundPath
 * from the character component if no emblem is equipped or found.
 */
export function getCharacterEmblemBackground(
  profile: DestinyProfileResponse,
  characterId: string,
  fallback: string
): string {
  const equipment = profile.characterEquipment.data?.[characterId]?.items ?? [];
  const emblem = equipment.find((item) => item.bucketHash === EMBLEM_BUCKET_HASH);
  if (!emblem) {
    return fallback;
  }

  const definition = getItemDefinition(emblem.itemHash);
  return definition?.secondarySpecial || fallback;
}
