import { ARMOR_STAT_ORDER } from "@/styles/theme";
import type { ArmorItem } from "@/lib/armor/types";

function statTotal(item: ArmorItem): number {
  return ARMOR_STAT_ORDER.reduce((sum, stat) => sum + item.stats[stat], 0);
}

function variantKey(item: ArmorItem): string {
  if (!item.exoticPerks?.length) return String(item.itemHash);
  const perkSignature = [...item.exoticPerks].map((p) => p.name).sort().join("|");
  return `${item.itemHash}:${perkSignature}`;
}

/**
 * Collapses owned copies of the same exotic down to one card per distinct
 * variant. Exotic class items roll two random perks per copy, so the variant
 * key includes the (sorted) perk pair; every other exotic slot only has one
 * possible roll, so copies collapse by itemHash alone.
 */
export function groupExoticVariants(items: ArmorItem[]): ArmorItem[] {
  const byVariant = new Map<string, ArmorItem>();
  for (const item of items) {
    const key = variantKey(item);
    const existing = byVariant.get(key);
    if (!existing || statTotal(item) > statTotal(existing)) {
      byVariant.set(key, item);
    }
  }
  return [...byVariant.values()];
}
