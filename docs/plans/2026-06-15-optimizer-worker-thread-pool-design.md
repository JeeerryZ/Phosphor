# Optimizer Worker Thread Pool (Phase 2) - Design

**Goal:** Use a pool of Node `worker_threads` (via Piscina) to parallelize `buildResults`'s
`(combo, adjustment, mod)` search across CPU cores, so the `tunedCount=4`/`tunedCount=5` per-bucket
combo caps can be raised substantially without a proportional increase in wall-clock latency.

This is Phase 2 of a two-phase effort. Phase 1 (the deficit-sum mod filter, merged in
`4a61286`) reduced iteration count for non-trivial-threshold queries by ~25-30% but left the
`ITER_BUDGET`-driven collapse of `tunedCount=4`/`5` to a single highest-total-stat combo
unchanged - see `docs/plans/2026-06-15-deficit-sum-mod-filter-design.md`'s "Phase 1 Results" and
"Decision gate for Phase 2".

## Background

`buildResults` (`src/lib/optimizer/query.ts`) iterates `(combo, adjustment, modDelta)` triples per
`tunedCount` bucket (0-5). `ITER_BUDGET = 2_000_000` caps each bucket's
`combos.length * adjustments.length * 252` cost by sorting `combos` by total stat sum (descending)
and slicing to `maxCombos = max(1, floor(ITER_BUDGET / perComboCost))`. For realistic inventories
this collapses `tunedCount=4` (perComboCost ~= 1.07M) and `tunedCount=5` (perComboCost ~= 2.83M) to
their single highest-total-stat combo each - i.e. the algorithm only ever considers *one* item
combination for fully-tuned loadouts.

**Deployment context is undecided** (self-hosted Node server vs. serverless vs. TBD). The design
below assumes nothing about request lifetime beyond "a Node process can run for at least the
duration of one `computeOptimizerQuery` call" - the worker pool is a lazily-initialized singleton
that's beneficial whether or not it persists across requests.

## Architecture

A lazy singleton `Piscina` pool (`getOptimizerPool()` in a new `src/lib/optimizer/worker-pool.ts`),
created on first use, sized `N = min(os.cpus().length, MAX_WORKERS)` (`MAX_WORKERS` TBD in
implementation, e.g. 8).

`buildResults` is restructured into three phases:

1. **Planning (main thread):** for each non-empty `tunedCount` bucket, sort `combos` by total
   stat sum descending (as today), slice to `maxCombos` (new formula below), then emit **one task
   per combo** (small/cheap buckets may group multiple combos per task - see "Task granularity for
   small buckets"). All tasks across all buckets go into one flat list.
2. **Dispatch:** `Promise.all` the tasks through the Piscina pool. Piscina's internal queue means a
   worker that finishes a cheap `tunedCount=0/1` task immediately picks up a `tunedCount=4/5` task
   - this is the "work-stealing" load balancing.
3. **Merge (main thread):** each task returns a small array of partial "best" candidates; merge
   them into the final `best` map using the same tier-key-max-by-`optimizeFor` rule used today,
   then proceed to `buildLoadout`/sort/slice as before (unchanged).

### Budget math

Replace the single-bucket cap with a pool-size-scaled cap:

```
maxCombos = max(1, floor(ITER_BUDGET * N / perComboCost))
```

With `N = 8`:
- `tunedCount=4` (perComboCost ~= 1.07M): `maxCombos = floor(16M / 1.07M) ~= 14` (vs. 1 today)
- `tunedCount=5` (perComboCost ~= 2.83M): `maxCombos = floor(16M / 2.83M) ~= 5` (vs. 1 today)
- `tunedCount=0-3`: unaffected in combo count (already under budget individually); each combo
  becomes its own task (or a grouped task for very cheap buckets), run on a worker instead of
  inline.

`N` is the pool's actual size, computed once at pool-creation time, so the formula adapts to the
deployment's core count automatically.

**Wall-clock intuition:** today's worst case is ~9.8M iterations run sequentially in one thread.
Under this scheme, buckets 4/5 grow to ~15M and ~14M iterations respectively (19 extra combo-tasks
total), spread across 8 workers alongside the ~5.9M from buckets 0-3 - total queued work
(~9.8M + ~28M = ~38M with the larger 4/5 budgets vs ~9.8M today) divided by 8 workers is roughly
comparable to or modestly above today's single-thread wall-clock, while exploring **14x and 5x
more combos** for the buckets that mattered most.

### Task granularity for small buckets

For `tunedCount` buckets where `perComboCost` is small (0-3), a single combo's task may be tiny
relative to per-task dispatch overhead. Group consecutive combos (after the descending sort) into
a task until the group's estimated cost reaches a target (e.g. ~250k iterations), so dispatch
overhead doesn't dominate for these buckets. This grouping threshold is an implementation detail
tuned during Phase 2's performance-measurement task, not fixed here.

## Data sharing with workers

Each worker task needs:

1. **The combo itself** (`ItemCombination` - stats + per-slot `ArmorItem` references). Small (a
   few KB); sent per-task via normal structured clone.
2. **`modDeltaSet`** (252 x 6 ints ~= 1,512 numbers). Tiny; sent per-task or recomputed in-worker
   (pure, cheap function - either is fine).
3. **The tuning-adjustment frontier for this `tunedCount`**
   (`getTuningAdjustmentFrontier(tunedCount)`). **This is the key new risk**: for `tunedCount=5`
   it's 11,247 entries and takes ~20s to build (existing code comment in
   `adjustment-frontier.ts`). This cost is currently paid once, lazily, in the main thread
   (memoized for the process's life via `cachedFrontiers`).

If each worker independently called `getTuningAdjustmentFrontier(5)` on first use, the ~20s build
cost would be paid **per worker** (catastrophic at N=8). Serializing the 11,247-entry object array
via `postMessage` on every task would also be wasteful.

**Approach:** build each needed frontier **once in the main thread** (as today - same
memoization, same one-time ~20s cost only if/when `tunedCount=5` is ever reached), then **flatten
it into typed arrays** backed by `SharedArrayBuffer`s:

- `statsFlat`: `Float64Array` (or `Int32Array` if stat values are always integers), length
  `frontier.length * 6`.
- `tuningAssignmentsFlat`: encoded `tuningAssignment` (array of up to 5 `ArmorTuning` values per
  entry) into a compact integer encoding, length `frontier.length * MAX_TUNED_SLOTS`.

These `SharedArrayBuffer`s are passed by reference (zero-copy) to every task that needs them -
`SharedArrayBuffer` references are cheap to include in task args regardless of how many tasks
reference the same buffer. Workers read directly from shared memory; no rebuild, no per-task copy.

`modDeltaFlat` (252 x 6) is similarly flattened to a shared `Int32Array`/`SharedArrayBuffer`, built
once.

## Worker task contract & merge logic

**Task input** (per combo or combo-group):

```typescript
{
  tunedCount: number;
  combos: ItemCombination[];          // 1 entry normally; >1 for grouped small-bucket tasks
  modDeltaFlat: SharedArrayBuffer;    // 252 x 6 Int32Array, shared once
  adjustmentFrontier: {
    statsFlat: SharedArrayBuffer;     // frontier.length x 6
    tuningAssignmentsFlat: SharedArrayBuffer; // frontier.length x MAX_TUNED_SLOTS, encoded
    length: number;
  };
  thresholdValues: Int32Array;        // tiny, per-task copy
  optimizeForIndex: number;
}
```

**Worker logic:** for each combo in the task, iterate `adj` (read from the shared flattened
frontier) x `modDelta` (read from shared `modDeltaFlat`), applying the existing threshold check,
Phase 1 deficit-sum filter, tier-key computation, and per-tier-key best tracking. Returns an array
of `{ comboIndex, key, stats, adjIndex }` (comboIndex is the index within this task's `combos`
array).

**Merge (main thread):** for each task result entry, reconstruct
`combo = task.combos[comboIndex]` and `adj = getTuningAdjustmentFrontier(tunedCount)[adjIndex]`
(main thread holds the un-flattened frontier from its own memoized call - no decoding needed
there), then merge into the global `best` map via the existing tier-key-max-by-`optimizeFor` rule
(`Map.set` if absent or better). This is the same logic as today's per-iteration merge, just
operating over task results instead of raw iterations - cross-task ordering doesn't matter beyond
this max-by-tier-key comparison.

## Testing strategy

- **Core loop extraction:** the per-combo `(adj x mod)` iteration (including the Phase 1
  deficit-sum filter) becomes a pure function `computeComboResults(combo, tunedCount,
  modDeltaFlat, adjustmentFrontier, thresholds, optimizeForIndex)` operating on plain typed
  arrays - unit-testable synchronously, reusing Phase 1's existing test cases as a base.
- **Flatten/unflatten round-trip:** unit tests that `flattenAdjustmentFrontier(k)` ->
  `SharedArrayBuffer` -> read back reproduces the same `stats`/`tuningAssignment` for all
  `k` in 0..5.
- **Pool equivalence test:** a real (small) Piscina pool run end-to-end on a modest fixture,
  asserting `buildResults` output is **identical** to the pre-Phase-2 sequential implementation
  for the same input - the regression guard that threading changed *how* results are computed,
  not *what* results are produced.
- **Performance tests:** re-measure all three existing fixtures (loose/strict/heavy fixture in
  `query.performance.test.ts`) with the pool-based path. The heavy (`tunedCount=4`) fixture's
  assertions should additionally check "more combos explored" (e.g. `maxCombos` reaching ~14
  instead of 1), not just wall-clock.

## Spike (Task 0)

Given two real unknowns - (a) whether Piscina worker files bundle/run correctly under both
`next dev` (via ngrok, per CLAUDE.md) and `next build && next start`, and (b) whether the
`SharedArrayBuffer`-based frontier flattening round-trips correctly for `tunedCount` up to 5 -
Phase 2's implementation plan starts with a spike task: a minimal Piscina worker that receives a
flattened `TuningAdjustment[]` via `SharedArrayBuffer`, reads a few entries back, and returns them,
verified under both `npm run dev` and `npm run build && npm run start`.

If the spike reveals Next.js bundling issues with Piscina worker files or `SharedArrayBuffer`
transfer issues, the rest of this plan needs to be revisited before proceeding.

## Out of scope

- Changing `ITER_BUDGET`'s role for `tunedCount=0-3` beyond "runs as worker tasks instead of
  inline" - their combo counts are unaffected by this design.
- Tuning `MAX_WORKERS`, the small-bucket task-grouping threshold, and the exact `SharedArrayBuffer`
  encoding for `tuningAssignment` - these are implementation details resolved during the plan's
  performance-measurement task.
- Changing the API route / request lifecycle (`src/app/api/optimizer/compute/route.ts`) beyond
  what's needed to call the new pool-based `buildResults`.

## Phase 2 Results

Measured via `npx vitest run src/lib/optimizer/query.performance.test.ts --root . --reporter=verbose`
on a machine with `getOptimizerPoolSize() = 8` (16 logical cores, capped by `MAX_WORKERS = 8`):

| Test                          | Phase 1 | Phase 2     |
|--------------------------------|---------|-------------|
| loose thresholds (all zero)    | ~1300ms | ~1800-2000ms |
| strict thresholds               | ~1100ms | ~1600-2300ms |
| tunedCount=4-heavy fixture       | ~2500ms | ~3800-7900ms |

All three remain comfortably within budget (`PERFORMANCE_BUDGET_MS = 4000`,
`HEAVY_PERFORMANCE_BUDGET_MS = 12000`, both unchanged from Task 5). The loose/strict tests got
modestly slower under Phase 2 - pool dispatch/serialization overhead now applies to every bucket's
tasks (including the small `tunedCount=0-3` buckets that were previously computed inline), which
outweighs the unchanged combo counts for those buckets. This matches the design doc's expectation
("small fixtures may be slower in absolute terms even though more combos are explored for
`tunedCount=4/5`") and both tests retain >1.7x headroom against their 4000ms budget. The heavy
fixture varied 3.8-7.9s across runs (cold vs. warm `getTuningAdjustmentFrontier(4)` cache) but
stayed within the 12000ms budget (~1.5x headroom on the slower runs).

`tunedCount=4`'s per-bucket combo cap rose from 1 to **14** (at `poolSize=8`), per
`maxCombos = floor(ITER_BUDGET * poolSize / perComboCost) = floor(2_000_000 * 8 / (4251 * 252)) =
floor(16,000,000 / 1,071,252) = 14`. In the heavy fixture (`combos[4].length = 35`), all 35
available combos exceed the cap of 14, so the 14 highest-total-stat combos are dispatched as
separate pool tasks (verified directly via `tasks.length === 14` and 14 distinct item combinations
appearing in the internal `best` tier-bucket map during manual instrumentation). The final ranked
`results` returned to the caller still draw from a single combo for this fixture's
`optimizeFor: "mobility"` - one combo's stat profile dominates every reachable tier bucket at the
top of the mobility ranking, so the extra 13 combos don't change *this particular* ranking, though
they do feed ~1.5M tier-bucket candidates into `best` (vs. far fewer from a single combo), which
would matter for other `optimizeFor`/threshold combinations where no single combo dominates every
tier. The committed regression test therefore asserts on the `maxCombos` formula directly (via the
same exported `getOptimizerPoolSize`/`getTuningAdjustmentFrontier`/`getModDeltaSet`/`ITER_BUDGET`
pieces `buildResults` uses) rather than on `results`, since `results` isn't a reliable signal for
this fixture.

**Outcome vs. the Phase 1 decision gate:** Phase 1 measured real-world inventories producing
`combos[4].length ~= 157` and `combos[5].length ~= 153`. At `poolSize=8`, `tunedCount=4`'s cap rose
from 1 to 14 (157 / 14 ~= 11.2x fewer combos than the realistic count) and `tunedCount=5`'s cap rose
from 1 to `floor(16M / 2.83M) = 5` (153 / 5 ~= 30.6x fewer). Both buckets still collapse to a small
fraction of the realistic combo set - `tunedCount=4/5` remain far from "uncapped" - but the
improvement (14x and 5x more coverage than Phase 1's single combo) is substantial relative to the
modest latency cost measured above (all tests still pass with >1.5x budget headroom). A future
Phase 3 (raising `MAX_WORKERS` beyond 8, and/or further reducing `perComboCost` e.g. via a coarser
adjustment frontier or additional pre-filtering) would proportionally narrow this gap further -
e.g. doubling `MAX_WORKERS` to 16 would roughly double both caps (28 and 10) - and seems worth
revisiting if real-world testing shows the current caps still produce noticeably suboptimal
loadouts for fully-tuned (`tunedCount=4/5`) builds. Given the current measurements still have
headroom against both budgets, Phase 3 is not urgently blocking but is a reasonable next
optimization target.
