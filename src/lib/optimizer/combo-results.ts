import { MOD_BUDGET } from "./mod-deltas";

/**
 * Per-stat tier values (`floor(value / 5)`) are shifted by this offset to stay non-negative
 * (stat sums can dip slightly below zero from directional tuning swaps), then packed into a
 * single integer using this radix - both bounded well above any realistic tier value.
 *
 * See the original derivation in `query.ts`'s history (Phase 1 and earlier): `128^6 ~= 4.4e12`,
 * far below `Number.MAX_SAFE_INTEGER`, so the packed key for 6 stats cannot overflow.
 */
const TIER_KEY_OFFSET = 32;
const TIER_KEY_RADIX = 128;

export interface ComboResultEntry {
  /** Index into the adjustment frontier this entry's `stats` were computed against. */
  adjIndex: number;
  /** Tier-bucket dedup key, identical to the one computed in `buildResults`. */
  key: number;
  /** This entry's final per-stat values (`combo + adjustment + mod`), length `statCount`. */
  stats: Int32Array;
}

/**
 * Sum of per-stat shortfalls (`threshold - value`, floored at 0) across the first `statCount`
 * entries. If this exceeds `MOD_BUDGET`, no mod-delta vector (each summing to exactly
 * `MOD_BUDGET` across its stats) can cover every stat's shortfall simultaneously - see
 * docs/plans/2026-06-15-deficit-sum-mod-filter-design.md.
 *
 * This is a local copy of `query.ts`'s `computeDeficitSum`, kept separate so this module has no
 * dependency on `query.ts` - see Task 4 of
 * docs/plans/2026-06-15-optimizer-worker-thread-pool-implementation.md for the planned
 * reconciliation.
 */
function computeDeficitSum(baseValues: Int32Array, thresholdValues: Int32Array, statCount: number): number {
  let deficitSum = 0;
  for (let i = 0; i < statCount; i++) {
    const deficit = thresholdValues[i] - baseValues[i];
    if (deficit > 0) deficitSum += deficit;
  }
  return deficitSum;
}

/**
 * For one combo (given as its flattened `statCount`-length stat vector), computes the
 * tier-deduped best result for every `(adjustment, mod)` pair that meets `thresholdValues`,
 * applying the Phase 1 deficit-sum filter to skip provably-infeasible adjustments.
 *
 * This is the per-combo unit of work dispatched to worker threads in Phase 2 - see
 * docs/plans/2026-06-15-optimizer-worker-thread-pool-design.md.
 *
 * Array-length invariants: `adjustmentStatsFlat.length === adjustmentCount * statCount`,
 * `modDeltaFlat.length === modCount * statCount`, and `thresholdValues.length === statCount`.
 */
export function computeComboResults(
  comboStats: Int32Array,
  adjustmentStatsFlat: Int32Array,
  adjustmentCount: number,
  modDeltaFlat: Int32Array,
  modCount: number,
  thresholdValues: Int32Array,
  optimizeForIndex: number,
  statCount: number
): ComboResultEntry[] {
  const best = new Map<number, ComboResultEntry>();
  const baseValues = new Int32Array(statCount);
  const sumValues = new Int32Array(statCount);

  for (let adjIndex = 0; adjIndex < adjustmentCount; adjIndex++) {
    const adjOffset = adjIndex * statCount;
    for (let i = 0; i < statCount; i++) {
      baseValues[i] = comboStats[i] + adjustmentStatsFlat[adjOffset + i];
    }

    if (computeDeficitSum(baseValues, thresholdValues, statCount) > MOD_BUDGET) {
      continue;
    }

    for (let modIndex = 0; modIndex < modCount; modIndex++) {
      const modOffset = modIndex * statCount;
      let meetsThresholds = true;
      let key = 0;

      for (let i = 0; i < statCount; i++) {
        const value = baseValues[i] + modDeltaFlat[modOffset + i];
        if (value < thresholdValues[i]) {
          meetsThresholds = false;
          break;
        }
        sumValues[i] = value;
        key = key * TIER_KEY_RADIX + (Math.floor(value / 5) + TIER_KEY_OFFSET);
      }

      if (!meetsThresholds) continue;

      const existing = best.get(key);
      if (!existing || sumValues[optimizeForIndex] > existing.stats[optimizeForIndex]) {
        best.set(key, { adjIndex, key, stats: Int32Array.from(sumValues) });
      }
    }
  }

  return [...best.values()];
}
