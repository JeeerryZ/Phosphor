import { equipItems, insertSocketPlugFree, transferItem } from "bungie-api-ts/destiny2";
import type { BungieMembershipType } from "bungie-api-ts/destiny2";
import type { ArmorStatName } from "@/lib/armor/types";
import type { ArmorTuning } from "@/lib/armor/tuning";
import { tuningPlugHash } from "@/lib/armor/tuning";
import { createBungieClient } from "./client";

/** Plug hashes for +10 general stat mods (enhancements.v2_general socket, index 0 on Tier 5 armor). */
export const STAT_MOD_PLUG_HASHES: Record<ArmorStatName, number> = {
  mobility: 4183296050,
  resilience: 1180408010,
  recovery: 4204488676,
  discipline: 1435557120,
  intellect: 2724608735,
  strength: 4287799666,
};

export interface LoadoutItem {
  itemInstanceId: string;
  itemHash: number;
  /** "vault" or a characterId */
  location: string;
  /** Index of the stat-tuning socket (only present for Tier 5 armor). */
  tuningSocketIndex?: number;
  /** The tuning state we want to apply after equipping. */
  desiredTuning?: ArmorTuning;
  /** Index of the general stat-mod socket (index 0 on Tier 5 armor). */
  statModSocketIndex?: number;
  /** The +10 stat mod to apply after equipping, if any committed slot targets this piece. */
  statMod?: ArmorStatName;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Transfers any items not already on `targetCharacterId` to the character,
 * equips all 5 at once, then applies T5 stat tuning to each item that needs it.
 * The character must be in orbit, a social space, or offline.
 */
export async function transferAndEquipItems(
  accessToken: string,
  {
    items,
    targetCharacterId,
    destinyMembershipId,
    membershipType,
  }: {
    items: LoadoutItem[];
    targetCharacterId: string;
    destinyMembershipId: string;
    membershipType: BungieMembershipType;
  }
): Promise<void> {
  const http = createBungieClient(accessToken);

  // Transfer items not already on the target character.
  for (const item of items) {
    if (item.location === targetCharacterId) continue;

    // If on another character (not vault), move to vault first.
    if (item.location !== "vault") {
      await transferItem(http, {
        itemReferenceHash: item.itemHash,
        stackSize: 1,
        transferToVault: true,
        itemId: item.itemInstanceId,
        characterId: item.location,
        membershipType,
      });
      await sleep(100);
    }

    // Move from vault to target character.
    await transferItem(http, {
      itemReferenceHash: item.itemHash,
      stackSize: 1,
      transferToVault: false,
      itemId: item.itemInstanceId,
      characterId: targetCharacterId,
      membershipType,
    });
    await sleep(100);
  }

  // Equip all 5 at once.
  await equipItems(http, {
    itemIds: items.map((i) => i.itemInstanceId),
    characterId: targetCharacterId,
    membershipType,
  });

  // Apply T5 stat tuning and stat mods (0.5s gap required between socket plug calls).
  for (const item of items) {
    const { desiredTuning, tuningSocketIndex, statMod, statModSocketIndex } = item;

    if (desiredTuning && desiredTuning.kind !== "none" && tuningSocketIndex !== undefined) {
      const plugItemHash = tuningPlugHash(desiredTuning);
      if (plugItemHash) {
        await sleep(500);
        await insertSocketPlugFree(http, {
          plug: {
            socketIndex: tuningSocketIndex,
            socketArrayType: 0, // DestinySocketArrayType.Default
            plugItemHash,
          },
          itemId: item.itemInstanceId,
          characterId: targetCharacterId,
          membershipType,
        });
      }
    }

    if (statMod && statModSocketIndex !== undefined) {
      const plugItemHash = STAT_MOD_PLUG_HASHES[statMod];
      await sleep(500);
      await insertSocketPlugFree(http, {
        plug: {
          socketIndex: statModSocketIndex,
          socketArrayType: 0,
          plugItemHash,
        },
        itemId: item.itemInstanceId,
        characterId: targetCharacterId,
        membershipType,
      });
    }
  }
}
