import type { DestinyItemComponent, DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { getItemDefinition } from "../manifest/definitions";
import {
  ARMOR_BUCKET_HASHES,
  ARMOR_STAT_HASHES,
  type ArmorInventory,
  type ArmorItem,
  type ArmorSlot,
  type ArmorStats,
} from "./types";
import { readArmorTuning, type ArmorTuning } from "./tuning";

const BUCKET_TO_SLOT = new Map<number, ArmorSlot>(
  Object.entries(ARMOR_BUCKET_HASHES).map(([slot, hash]) => [hash, slot as ArmorSlot])
);

const EMPTY_STATS: ArmorStats = {
  mobility: 0,
  resilience: 0,
  recovery: 0,
  discipline: 0,
  intellect: 0,
  strength: 0,
};

function buildStats(itemInstanceId: string | undefined, profile: DestinyProfileResponse): ArmorStats {
  if (!itemInstanceId) {
    return { ...EMPTY_STATS };
  }

  const statsData = profile.itemComponents.stats.data?.[itemInstanceId]?.stats;
  if (!statsData) {
    return { ...EMPTY_STATS };
  }

  const result = { ...EMPTY_STATS };
  for (const [statName, statHash] of Object.entries(ARMOR_STAT_HASHES) as [
    keyof ArmorStats,
    number,
  ][]) {
    result[statName] = statsData[statHash]?.value ?? 0;
  }
  return result;
}

function readTuning(itemInstanceId: string | undefined, profile: DestinyProfileResponse): ArmorTuning {
  if (!itemInstanceId) {
    return { kind: "none" };
  }

  const sockets = profile.itemComponents.sockets.data?.[itemInstanceId]?.sockets;
  if (!sockets) {
    return { kind: "none" };
  }

  return readArmorTuning(sockets.map((socket) => socket.plugHash));
}

interface InstanceInfo {
  power: number;
  gearTier: number | undefined;
  isMasterworked: boolean;
}

function readInstanceInfo(itemInstanceId: string | undefined, profile: DestinyProfileResponse): InstanceInfo {
  const instance = itemInstanceId ? profile.itemComponents.instances.data?.[itemInstanceId] : undefined;
  return {
    power: instance?.primaryStat?.value ?? 0,
    gearTier: instance?.gearTier,
    isMasterworked: instance?.energy?.energyCapacity === 10,
  };
}

function transformItem(
  item: DestinyItemComponent,
  profile: DestinyProfileResponse,
  location: string
): ArmorItem | null {
  if (!item.itemInstanceId) {
    return null;
  }

  const definition = getItemDefinition(item.itemHash);
  if (!definition) {
    return null;
  }

  // Vault items report bucketHash as the General Vault bucket, not their armor
  // slot, so derive the slot from the item's equip bucket instead.
  const slot = BUCKET_TO_SLOT.get(definition.inventory?.bucketTypeHash ?? item.bucketHash);
  if (!slot) {
    return null;
  }

  const { power, gearTier, isMasterworked } = readInstanceInfo(item.itemInstanceId, profile);

  return {
    itemInstanceId: item.itemInstanceId,
    itemHash: item.itemHash,
    name: definition.displayProperties.name,
    icon: definition.displayProperties.icon,
    slot,
    tierType: definition.inventory?.tierType ?? 0,
    classType: definition.classType,
    stats: buildStats(item.itemInstanceId, profile),
    tuning: readTuning(item.itemInstanceId, profile),
    power,
    gearTier,
    isMasterworked,
    location,
  };
}

/** Joins a Bungie profile response with manifest definitions into armor items grouped by location. */
export function transformProfileToArmorInventory(profile: DestinyProfileResponse): ArmorInventory {
  const vault: ArmorItem[] = [];
  const characters: Record<string, ArmorItem[]> = {};

  for (const item of profile.profileInventory.data?.items ?? []) {
    const armorItem = transformItem(item, profile, "vault");
    if (armorItem) {
      vault.push(armorItem);
    }
  }

  for (const characterId of Object.keys(profile.characters.data ?? {})) {
    const items: ArmorItem[] = [];

    for (const item of profile.characterInventories.data?.[characterId]?.items ?? []) {
      const armorItem = transformItem(item, profile, characterId);
      if (armorItem) {
        items.push(armorItem);
      }
    }

    for (const item of profile.characterEquipment.data?.[characterId]?.items ?? []) {
      const armorItem = transformItem(item, profile, characterId);
      if (armorItem) {
        items.push(armorItem);
      }
    }

    characters[characterId] = items;
  }

  return { vault, characters };
}
