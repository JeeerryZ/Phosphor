import type { ArmorInventory, ArmorItem, ArmorSlot } from "@/lib/armor/types";

const TIER_LEGENDARY = 5;

/** DestinyClass value meaning "any class" (used by some class-agnostic items). */
const CLASS_TYPE_ANY = 3;

export function findItemByInstanceId(inventory: ArmorInventory, itemInstanceId: string): ArmorItem | undefined {
  return allItems(inventory).find((item) => item.itemInstanceId === itemInstanceId);
}

/**
 * Legendary armor matching the exotic's class (or class-agnostic), grouped by slot, excluding
 * the exotic's own slot - candidates for the optimizer's 4 open slots.
 */
export function buildCandidatesBySlot(
  inventory: ArmorInventory,
  exotic: ArmorItem
): Partial<Record<ArmorSlot, ArmorItem[]>> {
  const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {};

  for (const item of allItems(inventory)) {
    if (item.slot === exotic.slot) continue;
    if (item.tierType !== TIER_LEGENDARY) continue;
    if (item.classType !== exotic.classType && item.classType !== CLASS_TYPE_ANY) continue;

    (candidates[item.slot] ??= []).push(item);
  }

  return candidates;
}

function allItems(inventory: ArmorInventory): ArmorItem[] {
  return [...inventory.vault, ...Object.values(inventory.characters).flat()];
}
