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
import { readArmorTuning, STAT_TUNING_PLUGS, BALANCED_TUNING_PLUG_HASH, EMPTY_TUNING_PLUG_HASH, type ArmorTuning } from "./tuning";
import { STAT_MOD_PLUG_HASHES } from "../bungie/loadout";

const BUCKET_TO_SLOT = new Map<number, ArmorSlot>(
  Object.entries(ARMOR_BUCKET_HASHES).map(([slot, hash]) => [hash, slot as ArmorSlot])
);

/** Socket type hash for the general stat-mod socket (accepts enhancements.v2_general plugs). */
const GENERAL_MOD_SOCKET_TYPE = 1718047805;

const TIER_EXOTIC = 6;

/**
 * Set of all "technical" plug hashes that are never player-facing exotic perks:
 * T5 tuning plugs, stat mods, and the balanced/empty tuning sentinels.
 */
const TECHNICAL_PLUG_HASHES: Set<number> = new Set([
  ...Object.keys(STAT_TUNING_PLUGS).map(Number),
  BALANCED_TUNING_PLUG_HASH,
  EMPTY_TUNING_PLUG_HASH,
  ...Object.values(STAT_MOD_PLUG_HASHES),
]);

/**
 * Extracts the two randomly-rolled exotic perks from an exotic class item's sockets.
 * Returns up to 2 perks — items with both a name and description that aren't technical plugs.
 */
function readExoticPerks(
  itemInstanceId: string,
  profile: DestinyProfileResponse
): { name: string; description: string; icon: string }[] {
  const sockets = profile.itemComponents.sockets.data?.[itemInstanceId]?.sockets ?? [];
  const perks: { name: string; description: string; icon: string }[] = [];

  for (const socket of sockets) {
    if (perks.length >= 2) break;
    const plugHash = socket.plugHash;
    if (!plugHash || TECHNICAL_PLUG_HASHES.has(plugHash)) continue;

    const plugDef = getItemDefinition(plugHash);
    if (!plugDef) continue;

    const name = plugDef.displayProperties.name ?? "";
    const description = plugDef.displayProperties.description ?? "";
    const icon = plugDef.displayProperties.icon ?? "";
    if (name && description && !perks.some((p) => p.name === name)) {
      perks.push({ name, description, icon });
    }
  }

  return perks;
}

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

function readTuning(
  itemInstanceId: string | undefined,
  profile: DestinyProfileResponse
): { tuning: ArmorTuning; tuningSocketIndex?: number } {
  if (!itemInstanceId) return { tuning: { kind: "none" } };
  const sockets = profile.itemComponents.sockets.data?.[itemInstanceId]?.sockets;
  if (!sockets) return { tuning: { kind: "none" } };
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

  const tierType = definition.inventory?.tierType ?? 0;
  const { power, gearTier, isMasterworked } = readInstanceInfo(item.itemInstanceId, profile);
  const { tuning, tuningSocketIndex } = readTuning(item.itemInstanceId, profile);

  const socketEntries = definition.sockets?.socketEntries ?? [];
  const statModSocketIndex = socketEntries.findIndex(
    (e) => ((e.socketTypeHash ?? 0) >>> 0) === GENERAL_MOD_SOCKET_TYPE
  );

  const exoticPerks =
    tierType === TIER_EXOTIC && slot === "classItem"
      ? readExoticPerks(item.itemInstanceId, profile)
      : undefined;

  return {
    itemInstanceId: item.itemInstanceId,
    itemHash: item.itemHash,
    name: definition.displayProperties.name,
    icon: definition.displayProperties.icon,
    slot,
    tierType,
    classType: definition.classType,
    stats: buildStats(item.itemInstanceId, profile),
    tuning,
    tuningSocketIndex,
    statModSocketIndex: statModSocketIndex >= 0 ? statModSocketIndex : undefined,
    power,
    gearTier,
    isMasterworked,
    location,
    exoticPerks: exoticPerks?.length ? exoticPerks : undefined,
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
