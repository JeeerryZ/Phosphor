import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { ARMOR_STAT_HASHES, type ArmorStatName, type ArmorStats } from "@/lib/armor/types";
import { getItemDefinition } from "@/lib/manifest/definitions";

/** Subclass inventory bucket hash, stable across Destiny 2's lifetime. */
const SUBCLASS_BUCKET_HASH = 3284755031;

const STAT_HASH_TO_NAME = new Map<number, ArmorStatName>(
  Object.entries(ARMOR_STAT_HASHES).map(([name, hash]) => [hash, name as ArmorStatName])
);

const EMPTY_STATS: ArmorStats = {
  mobility: 0,
  resilience: 0,
  recovery: 0,
  discipline: 0,
  intellect: 0,
  strength: 0,
};

/** Sums the stat bonuses (which can be negative) from a character's equipped subclass fragments. */
export function getEquippedFragmentStats(
  profile: DestinyProfileResponse,
  characterId: string
): ArmorStats | undefined {
  const equipment = profile.characterEquipment.data?.[characterId]?.items ?? [];
  const subclass = equipment.find((item) => item.bucketHash === SUBCLASS_BUCKET_HASH);
  if (!subclass?.itemInstanceId) {
    return undefined;
  }

  const sockets = profile.itemComponents.sockets.data?.[subclass.itemInstanceId]?.sockets ?? [];
  const result = { ...EMPTY_STATS };

  for (const socket of sockets) {
    const plugHash = socket.plugHash;
    if (!plugHash) continue;

    const plugDef = getItemDefinition(plugHash);
    if (!plugDef) continue;

    for (const stat of plugDef.investmentStats ?? []) {
      const statName = STAT_HASH_TO_NAME.get(stat.statTypeHash);
      if (statName) {
        result[statName] += stat.value;
      }
    }
  }

  return result;
}
