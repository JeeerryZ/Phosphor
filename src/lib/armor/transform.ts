import type { DestinyInventoryItemDefinition, DestinyItemComponent, DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { getItemDefinition, getSocketCategoryDefinition } from "../manifest/definitions";
import {
  ARMOR_BUCKET_HASHES,
  ARMOR_STAT_HASHES,
  EMPTY_ARMOR_STATS,
  type ArmorInventory,
  type ArmorItem,
  type ArmorSlot,
  type ArmorStatName,
  type ArmorStats,
} from "./types";
import { readArmorTuning, STAT_TUNING_PLUGS, type ArmorTuning } from "./tuning";

const BUCKET_TO_SLOT = new Map<number, ArmorSlot>(
  Object.entries(ARMOR_BUCKET_HASHES).map(([slot, hash]) => [hash, slot as ArmorSlot])
);

/** Socket type hash for the general stat-mod socket (accepts enhancements.v2_general plugs). */
const GENERAL_MOD_SOCKET_TYPE = 1718047805;

const TIER_EXOTIC = 6;
const TIER_LEGENDARY = 5;

/** Display name of the socket category holding an exotic class item's real (non-cosmetic) perks. */
const ARMOR_PERKS_CATEGORY_NAME = "ARMOR PERKS";

/** ItemState bit flag (from bungie-api-ts's ambient ItemState enum) set when a masterwork plug is inserted. */
const ITEM_STATE_MASTERWORK_BIT = 4;

/**
 * Extracts the randomly-rolled exotic perks from a class item's "ARMOR PERKS" socket
 * categories (there can be more than one such category, and more than 2 perk sockets
 * total — observed as 4, split across two categories, on every known exotic class item).
 * Reading by category membership (rather than scanning all sockets with a blacklist)
 * avoids picking up cosmetic sockets (shaders, ornaments) that also have a name and
 * description and would otherwise be scanned first.
 */
export function readExoticPerks(
  itemInstanceId: string,
  definition: DestinyInventoryItemDefinition,
  profile: DestinyProfileResponse
): { name: string; description: string; icon: string }[] {
  const sockets = profile.itemComponents.sockets.data?.[itemInstanceId]?.sockets ?? [];
  const perkSocketIndexes = (definition.sockets?.socketCategories ?? [])
    .filter((category) => getSocketCategoryDefinition(category.socketCategoryHash)?.displayProperties.name === ARMOR_PERKS_CATEGORY_NAME)
    .flatMap((category) => category.socketIndexes ?? [])
    .sort((a, b) => a - b);

  const perks: { name: string; description: string; icon: string }[] = [];

  for (const index of perkSocketIndexes) {
    const plugHash = sockets[index]?.plugHash;
    if (!plugHash) continue;

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

/**
 * Legendary armor's tuning socket lists the same 30-plug superset in its static manifest
 * definition for every item -- Bungie narrows it per-instance via the live
 * `ItemReusablePlugs` profile component instead. Returns the single stat every insertable
 * directional plug agrees on increasing, or undefined if that can't be determined (no live
 * data, or -- unexpectedly -- more than one distinct increase stat).
 */
export function readLegendaryTuningIncreaseStat(
  itemInstanceId: string,
  tuningSocketIndex: number,
  profile: DestinyProfileResponse
): ArmorStatName | undefined {
  const livePlugs = profile.itemComponents.reusablePlugs.data?.[itemInstanceId]?.plugs[tuningSocketIndex] ?? [];
  const increaseStats = new Set<ArmorStatName>();

  for (const plug of livePlugs) {
    if (!plug.canInsert) continue;
    const directional = STAT_TUNING_PLUGS[plug.plugItemHash];
    if (directional) increaseStats.add(directional.increasedStat);
  }

  return increaseStats.size === 1 ? [...increaseStats][0] : undefined;
}

function buildStats(itemInstanceId: string | undefined, profile: DestinyProfileResponse): ArmorStats {
  if (!itemInstanceId) {
    return { ...EMPTY_ARMOR_STATS };
  }

  const statsData = profile.itemComponents.stats.data?.[itemInstanceId]?.stats;
  if (!statsData) {
    return { ...EMPTY_ARMOR_STATS };
  }

  const result = { ...EMPTY_ARMOR_STATS };
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
}

function readInstanceInfo(itemInstanceId: string | undefined, profile: DestinyProfileResponse): InstanceInfo {
  const instance = itemInstanceId ? profile.itemComponents.instances.data?.[itemInstanceId] : undefined;
  return {
    power: instance?.primaryStat?.value ?? 0,
    gearTier: instance?.gearTier,
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
  const { power, gearTier } = readInstanceInfo(item.itemInstanceId, profile);
  // Every armor piece now sits at 11/11 energy capacity regardless of masterwork status,
  // so masterwork must be read from the item's state bitmask instead of energy capacity.
  const isMasterworked = ((item.state ?? 0) & ITEM_STATE_MASTERWORK_BIT) !== 0;
  const { tuning, tuningSocketIndex } = readTuning(item.itemInstanceId, profile);

  const socketEntries = definition.sockets?.socketEntries ?? [];
  const statModSocketIndex = socketEntries.findIndex(
    (e) => ((e.socketTypeHash ?? 0) >>> 0) === GENERAL_MOD_SOCKET_TYPE
  );

  const exoticPerks =
    tierType === TIER_EXOTIC && slot === "classItem"
      ? readExoticPerks(item.itemInstanceId, definition, profile)
      : undefined;

  const legendaryTuningIncreaseStat =
    tierType === TIER_LEGENDARY && tuningSocketIndex !== undefined
      ? readLegendaryTuningIncreaseStat(item.itemInstanceId, tuningSocketIndex, profile)
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
    legendaryTuningIncreaseStat,
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
