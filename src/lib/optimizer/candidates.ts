import { ARMOR_STAT_HASHES, type ArmorInventory, type ArmorItem, type ArmorSlot, type ArmorStatName } from "@/lib/armor/types";

const TIER_LEGENDARY = 5;

/** DestinyClass value meaning "any class" (used by some class-agnostic items). */
const CLASS_TYPE_ANY = 3;

/**
 * Masterwork bonus applied to each of an armor piece's 3 non-main stats (its main 3
 * stats — the ones its roll actually invests in — are already nonzero and unaffected).
 */
const MASTERWORK_STAT_BONUS = 2;

/**
 * Returns `item` as if it were fully masterworked, bumping its 3 non-main stats (the
 * ones currently at 0) by the masterwork bonus they haven't already earned. Used by
 * "assume masterworked" mode, which assumes every candidate will eventually be
 * masterworked rather than filtering down to only pieces that already are (masterworking
 * is cheap/eventual, so excluding un-masterworked gear just hides otherwise-good sets).
 */
export function withAssumedMasterwork(item: ArmorItem): ArmorItem {
  if (item.isMasterworked) return item;
  const stats = { ...item.stats };
  for (const stat of Object.keys(ARMOR_STAT_HASHES) as ArmorStatName[]) {
    if (stats[stat] === 0) stats[stat] += MASTERWORK_STAT_BONUS;
  }
  return { ...item, stats };
}

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
    (candidates[item.slot] ??= []).push(masterworkOnly ? withAssumedMasterwork(item) : item);
  }

  // Locked items override the candidate list for their slot.
  for (const [slotKey, instanceId] of Object.entries(lockedItemInstanceIds)) {
    const slot = slotKey as ArmorSlot;
    if (exotic && slot === exotic.slot) continue; // exotic slot is already fixed
    const locked = allItemsList.find((i) => i.itemInstanceId === instanceId);
    if (locked) candidates[slot] = [masterworkOnly ? withAssumedMasterwork(locked) : locked];
  }

  return candidates;
}

function allItems(inventory: ArmorInventory): ArmorItem[] {
  return [...inventory.vault, ...Object.values(inventory.characters).flat()];
}
