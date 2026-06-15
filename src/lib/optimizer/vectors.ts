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

/**
 * Flattens an array of stat vectors into a single row-major `Int32Array` (length
 * `vectors.length * ARMOR_STAT_ORDER.length`), each row ordered by `ARMOR_STAT_ORDER`. Used to
 * pass stat data to worker threads via plain typed arrays / `SharedArrayBuffer`s.
 */
export function flattenStatVectors(vectors: StatVector[]): Int32Array {
  const flat = new Int32Array(vectors.length * ARMOR_STAT_ORDER.length);
  vectors.forEach((vector, i) => {
    for (let j = 0; j < ARMOR_STAT_ORDER.length; j++) {
      flat[i * ARMOR_STAT_ORDER.length + j] = vector[ARMOR_STAT_ORDER[j]];
    }
  });
  return flat;
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
