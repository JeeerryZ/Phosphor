import type { ArmorInventory, ArmorItem, ArmorSlot } from "@/lib/armor/types";

const TIER_LEGENDARY = 5;

/** DestinyClass value meaning "any class" (used by some class-agnostic items). */
const CLASS_TYPE_ANY = 3;

export function findItemByInstanceId(inventory: ArmorInventory, itemInstanceId: string): ArmorItem | undefined {
  return allItems(inventory).find((item) => item.itemInstanceId === itemInstanceId);
}

export interface CandidateOptions {
  masterworkOnly?: boolean;
  /** Required when exotic is null (no-exotic mode) to filter by class. */
  classType?: number;
  /** Force specific items as the only candidate for their slot. */
  lockedItemInstanceIds?: Partial<Record<ArmorSlot, string>>;
}

/**
 * Builds per-slot legendary armor candidates for the optimizer.
 * When `exotic` is null (no-exotic mode), all 5 slots are open and classType must be provided.
 * Locked items (if any) replace the candidate list for their slot entirely.
 */
export function buildCandidatesBySlot(
  inventory: ArmorInventory,
  exotic: ArmorItem | null,
  options: CandidateOptions = {}
): Partial<Record<ArmorSlot, ArmorItem[]>> {
  const { masterworkOnly, lockedItemInstanceIds = {} } = options;
  const resolvedClassType = exotic?.classType ?? options.classType;
  const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {};
  const allItemsList = allItems(inventory);

  for (const item of allItemsList) {
    if (exotic && item.slot === exotic.slot) continue;
    if (item.tierType !== TIER_LEGENDARY) continue;
    if (resolvedClassType !== undefined && item.classType !== resolvedClassType && item.classType !== CLASS_TYPE_ANY) continue;
    if (masterworkOnly && !item.isMasterworked) continue;
    (candidates[item.slot] ??= []).push(item);
  }

  // Locked items override the candidate list for their slot.
  for (const [slotKey, instanceId] of Object.entries(lockedItemInstanceIds)) {
    const slot = slotKey as ArmorSlot;
    if (exotic && slot === exotic.slot) continue; // exotic slot is already fixed
    const locked = allItemsList.find((i) => i.itemInstanceId === instanceId);
    if (locked) candidates[slot] = [locked];
  }

  return candidates;
}

function allItems(inventory: ArmorInventory): ArmorItem[] {
  return [...inventory.vault, ...Object.values(inventory.characters).flat()];
}
