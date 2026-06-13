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
 *
 * Maintains the frontier incrementally: each new candidate is checked only against the current
 * frontier (not the full input), and any frontier members it dominates are dropped. This keeps
 * the running frontier equal to the maximal elements seen so far, which by transitivity of
 * `dominates` equals the maximal elements of the full input - i.e. the same result as checking
 * every candidate against every item, but in O(items * frontier) instead of O(items^2).
 */
export function paretoFrontier<T extends { stats: StatVector }>(items: T[]): T[] {
  const frontier: T[] = [];

  for (const candidate of items) {
    let dominated = false;

    for (let i = frontier.length - 1; i >= 0; i--) {
      if (dominates(frontier[i].stats, candidate.stats)) {
        dominated = true;
        break;
      }
      if (dominates(candidate.stats, frontier[i].stats)) {
        frontier.splice(i, 1);
      }
    }

    if (!dominated) {
      frontier.push(candidate);
    }
  }

  return frontier;
}
