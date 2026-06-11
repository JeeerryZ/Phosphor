import { ARMOR_STAT_ORDER } from "@/styles/theme";
import type { StatVector } from "./vectors";

/** True if `a` is at least as good as `b` in every stat and strictly better in at least one. */
export function dominates(a: StatVector, b: StatVector): boolean {
  let strictlyBetter = false;
  for (const stat of ARMOR_STAT_ORDER) {
    if (a[stat] < b[stat]) return false;
    if (a[stat] > b[stat]) strictlyBetter = true;
  }
  return strictlyBetter;
}

/**
 * Returns the subset of `items` whose stat vectors are not dominated by any other item's
 * vector. Assumes duplicate stat vectors have already been removed (see `dedupeByStats`).
 */
export function paretoFrontier<T extends { stats: StatVector }>(items: T[]): T[] {
  return items.filter((candidate) => !items.some((other) => dominates(other.stats, candidate.stats)));
}
