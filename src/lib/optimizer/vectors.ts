import { ARMOR_STAT_ORDER } from "@/styles/theme";
import type { ArmorStats } from "@/lib/armor/types";

export type StatVector = ArmorStats;

export function zeroVector(): StatVector {
  return {
    mobility: 0,
    resilience: 0,
    recovery: 0,
    discipline: 0,
    intellect: 0,
    strength: 0,
  };
}

export function addVectors(a: StatVector, b: StatVector): StatVector {
  const result = zeroVector();
  for (const stat of ARMOR_STAT_ORDER) {
    result[stat] = a[stat] + b[stat];
  }
  return result;
}

/** Stable string key for a stat vector, suitable for Map/Set dedup. */
export function vectorKey(vector: StatVector): string {
  return ARMOR_STAT_ORDER.map((stat) => vector[stat]).join(",");
}

/** Keeps only the first item for each distinct stat vector (by `vectorKey`). */
export function dedupeByStats<T extends { stats: StatVector }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = vectorKey(item.stats);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}
