import type { ArmorTuning } from "@/lib/armor/tuning";
import { tuningDeltas } from "./tuning-variants";
import { paretoFrontier } from "./pareto";
import { addVectors, dedupeByStats, zeroVector, type StatVector } from "./vectors";

/** A loadout has exactly 5 armor slots, so at most 5 items can have a tuning socket. */
export const MAX_TUNED_SLOTS = 5;

export interface TuningAdjustment {
  stats: StatVector;
  tuningAssignment: ArmorTuning[];
}

const cachedFrontiers: (TuningAdjustment[] | undefined)[] = new Array(MAX_TUNED_SLOTS + 1);

/**
 * The Pareto frontier of stat-vector sums from choosing `tunedSlots` independent picks from the
 * 32-entry `tuningDeltas()` menu, paired with the tuning choices that produced each sum.
 *
 * Each k is cached independently and lazily: requesting k builds (and caches) 1..k as needed.
 * k=5 costs ~20s to build, so callers that never request it never pay that cost.
 */
export function getTuningAdjustmentFrontier(tunedSlots: number): TuningAdjustment[] {
  if (tunedSlots < 0 || tunedSlots > MAX_TUNED_SLOTS) {
    throw new RangeError(`tunedSlots must be between 0 and ${MAX_TUNED_SLOTS}, got ${tunedSlots}`);
  }

  const cached = cachedFrontiers[tunedSlots];
  if (cached) {
    return cached;
  }

  if (tunedSlots === 0) {
    const base: TuningAdjustment[] = [{ stats: zeroVector(), tuningAssignment: [] }];
    cachedFrontiers[0] = base;
    return base;
  }

  const previous = getTuningAdjustmentFrontier(tunedSlots - 1);
  const deltas = tuningDeltas();

  const next = paretoFrontier(
    dedupeByStats(
      previous.flatMap((prev) =>
        deltas.map((td) => ({
          stats: addVectors(prev.stats, td.delta),
          tuningAssignment: [...prev.tuningAssignment, td.tuning],
        }))
      )
    )
  );

  cachedFrontiers[tunedSlots] = next;
  return next;
}
