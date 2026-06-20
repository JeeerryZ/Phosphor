/**
 * Per-stat tier values (`floor(value / 5)`) are shifted by this offset to stay non-negative
 * (stat sums can dip slightly below zero from directional tuning swaps), then packed into a
 * single integer using this radix. `128^6 ~= 4.4e12`, far below `Number.MAX_SAFE_INTEGER`.
 */
const TIER_KEY_OFFSET = 32;
const TIER_KEY_RADIX = 128;

const MOD_SLOTS = 5;
const MOD_VALUE = 10;

export interface ComboResultEntry {
  adjIndex: number;
  key: number;
  /** combo + adjustment + minimum mods committed to meet thresholds, length `statCount`. */
  stats: Int32Array;
  total: number;
  /** Mod slots consumed meeting thresholds; remaining (MOD_SLOTS - slotsCommitted) are free. */
  slotsCommitted: number;
}

/**
 * For each tuning adjustment, checks whether per-stat deficits can be covered by `MOD_SLOTS`
 * mods of `+MOD_VALUE` each. For each passing adjustment the result stats are:
 *   - threshold stats: combined + ceil(deficit / MOD_VALUE) * MOD_VALUE  (exact minimum mods)
 *   - other stats:     combined  (no mods committed)
 *
 * This replaces the previous 252-entry mod-delta enumeration with an O(statCount) check per
 * adjustment, reducing per-combo work from O(adjustments × 252) to O(adjustments).
 *
 * Within each tier-bucket key, the entry with the highest total wins.
 */
export function computeComboResults(
  comboStats: Int32Array,
  adjustmentStatsFlat: Int32Array,
  adjustmentCount: number,
  thresholdValues: Int32Array,
  statCount: number
): ComboResultEntry[] {
  const best = new Map<number, ComboResultEntry>();
  const combined = new Int32Array(statCount);
  const finalStats = new Int32Array(statCount);

  for (let adjIdx = 0; adjIdx < adjustmentCount; adjIdx++) {
    const adjOffset = adjIdx * statCount;

    let slotsNeeded = 0;
    let feasible = true;

    for (let s = 0; s < statCount; s++) {
      combined[s] = comboStats[s] + adjustmentStatsFlat[adjOffset + s];
      const threshold = thresholdValues[s];
      if (threshold > 0 && combined[s] < threshold) {
        slotsNeeded += Math.ceil((threshold - combined[s]) / MOD_VALUE);
        if (slotsNeeded > MOD_SLOTS) {
          feasible = false;
          break;
        }
      }
    }

    if (!feasible) continue;

    let key = 0;
    let total = 0;

    for (let s = 0; s < statCount; s++) {
      const threshold = thresholdValues[s];
      const val =
        threshold > 0 && combined[s] < threshold
          ? combined[s] + Math.ceil((threshold - combined[s]) / MOD_VALUE) * MOD_VALUE
          : combined[s];
      finalStats[s] = val;
      total += val;
      key = key * TIER_KEY_RADIX + (Math.floor(val / 5) + TIER_KEY_OFFSET);
    }

    const existing = best.get(key);
    if (!existing || total > existing.total) {
      best.set(key, {
        adjIndex: adjIdx,
        key,
        stats: Int32Array.from(finalStats),
        total,
        slotsCommitted: slotsNeeded,
      });
    }
  }

  return [...best.values()];
}
