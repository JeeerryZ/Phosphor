// Plain CommonJS Piscina worker entry point. Kept as .js (not .ts) so it can be loaded by
// worker_threads at runtime without a separate build step - see Task 0 of
// docs/plans/2026-06-15-optimizer-worker-thread-pool-implementation.md.
//
// This file is loaded directly by worker_threads, bypassing Next.js's TS build pipeline, so it
// cannot `require("./combo-results")` (a `.ts` file compiled by that pipeline and not resolvable
// by plain Node `require`). Instead, this is a MANUALLY-SYNCED plain-JS copy of
// `computeComboResults` (and its small dependencies `computeDeficitSum` and `MOD_BUDGET`) ported
// from `src/lib/optimizer/combo-results.ts`.
//
// `combo-results.ts` is the source of truth, and is unit-tested directly (without a worker).
// `worker-pool.test.ts`'s "computes the same results as computeComboResults, via a worker" test
// is the regression guard for divergence between the two copies - if you change the logic in
// `combo-results.ts`, port the same change here, and that test will fail if the copies diverge.

/**
 * Maximum total stat points mods can contribute across all stats combined.
 * SYNC: must equal `MOD_BUDGET` exported from `src/lib/optimizer/mod-deltas.ts`.
 * Update here whenever that constant changes.
 */
const MOD_BUDGET = 50;

/**
 * Per-stat tier values (`floor(value / 5)`) are shifted by this offset to stay non-negative
 * (stat sums can dip slightly below zero from directional tuning swaps), then packed into a
 * single integer using this radix - both bounded well above any realistic tier value. See
 * `src/lib/optimizer/combo-results.ts` for the full derivation.
 */
const TIER_KEY_OFFSET = 32;
const TIER_KEY_RADIX = 128;

/**
 * Sum of per-stat shortfalls (`threshold - value`, floored at 0) across the first `statCount`
 * entries. Local copy of `combo-results.ts`'s `computeDeficitSum`.
 */
function computeDeficitSum(baseValues, thresholdValues, statCount) {
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
 * Within each tier bucket, the entry with the highest total stat sum wins.
 * Local copy of `combo-results.ts`'s `computeComboResults`.
 */
function computeComboResults(
  comboStats,
  adjustmentStatsFlat,
  adjustmentCount,
  modDeltaFlat,
  modCount,
  thresholdValues,
  statCount
) {
  const best = new Map();
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
      let total = 0;

      for (let i = 0; i < statCount; i++) {
        const value = baseValues[i] + modDeltaFlat[modOffset + i];
        if (value < thresholdValues[i]) {
          meetsThresholds = false;
          break;
        }
        sumValues[i] = value;
        total += value;
        key = key * TIER_KEY_RADIX + (Math.floor(value / 5) + TIER_KEY_OFFSET);
      }

      if (!meetsThresholds) continue;

      const existing = best.get(key);
      if (!existing || total > existing.total) {
        best.set(key, { adjIndex, key, stats: Int32Array.from(sumValues), total });
      }
    }
  }

  return [...best.values()];
}

module.exports = ({
  comboStats,
  adjustmentStatsFlat,
  adjustmentCount,
  modDeltaFlat,
  modCount,
  thresholdValues,
  statCount,
}) =>
  computeComboResults(
    comboStats,
    adjustmentStatsFlat,
    adjustmentCount,
    modDeltaFlat,
    modCount,
    thresholdValues,
    statCount
  );
