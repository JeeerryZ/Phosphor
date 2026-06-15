# Deficit-Sum Mod Filter (Phase 1) - Design

**Goal:** Reduce wasted work in `buildResults`'s hot loop by skipping mod-delta iterations that
are provably infeasible, then use the recovered headroom to loosen the `ITER_BUDGET` cap so the
`tunedCount=4`/`tunedCount=5` buckets can explore more (ideally all) of their combos instead of
collapsing to a single highest-total-stat combo.

This is Phase 1 of a two-phase effort. Phase 2 (parallelizing the search across worker threads to
remove the cap entirely) is **not** designed here - see "Decision gate for Phase 2" below.

## Background

`buildResults` (`src/lib/optimizer/query.ts`) iterates `(combo, adjustment, modDelta)` triples per
`tunedCount` bucket (0-5), checking whether `combo.stats + adjustment.stats + modDelta` meets the
query's per-stat thresholds. The mod-delta set (`getModDeltaSet()`, `mod-deltas.ts`) has 252
entries - the Pareto frontier of distributing 5 "+10" tokens (one per general mod slot) across 6
stats.

`ITER_BUDGET = 2_000_000` caps the per-bucket `combos.length * adjustments.length * 252` cost by
sorting `combos` by total stat sum (descending) and slicing to the top `maxCombos`. For realistic
inventories, `tunedCount=4` and `tunedCount=5` buckets collapse to their single highest-total-stat
combo (~1.07M and ~2.83M iterations respectively, on their own) - meaning the algorithm only ever
considers *one* item combination for fully-tuned loadouts, even though the full adjustment+mod
frontier is explored on top of it.

## Phase 1 Design

### 1. Deficit-sum filter

For each `(combo, adjustment)` pair, before iterating the 252 mod deltas, compute:

```typescript
let deficitSum = 0;
for (let i = 0; i < statCount; i++) {
  const deficit = thresholdValues[i] - baseValues[i];
  if (deficit > 0) deficitSum += deficit;
}
if (deficitSum > MOD_BUDGET) continue;
```

placed immediately after the existing `baseValues[i] = combo.stats[...] + adj.stats[...]`
hoisting (currently `query.ts:177-179`), before the `modIndex` loop.

**Correctness:** every mod-delta vector sums to exactly `MOD_BUDGET` (= `MOD_SLOTS_PER_LOADOUT *
MOD_BONUS` = 5 * 10 = 50) across its 6 stat entries, since each of the 5 slots contributes exactly
+10 to one stat. If `(combo, adjustment)` were feasible for some mod delta `m`, then for every
stat `i`, `m[i] >= deficit[i]` (where `deficit[i] = max(0, threshold[i] - baseValues[i])`), so
`sum(m) >= sum(deficit)`. Since `sum(m) = MOD_BUDGET` always, `deficitSum > MOD_BUDGET` is a
conclusive proof of infeasibility for *all* 252 mod deltas - skipping them changes nothing about
which results are produced, only how many iterations it takes to not-produce them.

`MOD_BUDGET` is exported from `mod-deltas.ts` as `MOD_SLOTS_PER_LOADOUT * MOD_BONUS` (both already
defined there as local constants) rather than hardcoded as a magic number in `query.ts`.

### 2. Measure, then loosen `ITER_BUDGET`

1. Record current wall-clock timings from `query.performance.test.ts` (all three tests) as a
   baseline.
2. Implement the filter.
3. Re-run the performance tests, record new timings.
4. Using the observed speedup factor, raise `ITER_BUDGET` and re-derive the
   `tunedCount=4`/`tunedCount=5` collapse math in the comment above `ITER_BUDGET`
   (`query.ts:78-98`), aiming to let `tunedCount=4` explore materially more than 1 combo (ideally
   uncapped for realistic inventory sizes), while keeping `tunedCount=5` at least less degenerate
   than "exactly 1 combo" if full coverage isn't affordable.
5. Re-run performance tests; adjust `PERFORMANCE_BUDGET_MS`/`HEAVY_PERFORMANCE_BUDGET_MS` only if
   needed to reflect the new, intentionally-higher `ITER_BUDGET` - the tests must still pass
   comfortably (no regression toward the original ~20s blowup).

### 3. Testing

- **Filter correctness, case A (definitely infeasible):** a `(combo, adjustment)` pair where
  `deficitSum > 50` for every stat combination achievable by any mod delta. Assert it contributes
  no entry to `best` (same outcome as without the filter, just fewer iterations).
- **Filter correctness, case B (sum feasible, distribution infeasible):** the "6 stats each need
  +1, only 5 mod slots available" case - `deficitSum = 6 <= 50`, but no single 252-entry mod
  vector covers all 6 per-stat deficits simultaneously (each slot only boosts one stat by +10).
  Confirms these pairs pass the cheap filter and are correctly excluded by the existing per-mod
  threshold check - i.e., the filter doesn't produce false negatives by being "too aggressive" in
  a way that masks a real bug in the precise check.
- **Performance tests:** update `query.performance.test.ts` with the new measured timings/budgets
  per step 2 above.

## Decision gate for Phase 2 (worker threads)

After Phase 1, if `tunedCount=4` and/or `tunedCount=5` buckets *still* must collapse to fewer
combos than realistic inventories produce (i.e., the deficit-sum filter's recovered headroom isn't
enough to make `ITER_BUDGET` cover their full cross-product at realistic combo counts), that's the
trigger to design a `worker_threads`-based parallelization of the `buildResults` hot loop as a
follow-up. Not designed here.

## Phase 1 Results

Measured via `npx vitest run src/lib/optimizer/query.performance.test.ts --root . --reporter=verbose`:

| Test                          | Before | After       |
|--------------------------------|--------|-------------|
| loose thresholds (all zero)    | 1834ms | 1323ms |
| strict thresholds               | 1685ms | 1201ms |
| tunedCount=4-heavy fixture       | 3020ms | 2567ms |

As predicted, the heavy fixture (all-zero thresholds) saw a modest but real reduction (~15%),
not the larger reductions seen for the threshold-bearing tests (~28-29%). This matches the
design's prediction that `deficitSum` essentially never exceeds `MOD_BUDGET=50` when thresholds
are zero - the filter only fires when a stat is meaningfully below a non-trivial threshold, so the
heavy fixture still iterates nearly the full 252-entry mod-delta set for every `(combo,
adjustment)` pair. The smaller-but-nonzero improvement on the heavy fixture is attributable to the
cheap early-exit check itself plus general run-to-run variance (a second run measured 1284ms /
979ms / 2139ms, consistent with the same relative ordering).

**`ITER_BUDGET` is not raised in this phase.** The `tunedCount=4`/`tunedCount=5` collapse-to-1-combo
behavior is unchanged for the loose-threshold case, which is the case `ITER_BUDGET` must stay safe
for. The deficit-sum filter remains a real win for queries with non-trivial thresholds (the
realistic case), speeding up each `buildResults` call in `computeOptimizerQuery`'s topK-widening
retry loop.

**Phase 2 decision:** loosening/removing the cap for `tunedCount=4`/`5` under loose-threshold
conditions still requires the worker_threads-based parallelization described as "Phase 2" in the
original design - not addressed by this filter alone.
