# Optimizer On-Demand Redesign - Design

## Background

`docs/plans/2026-06-12-optimizer-combine-redesign-design.md` proposed splitting the optimizer's
combination step into item selection (Steps 1-2) and a precomputed adjustment frontier `ADJ[k]`
(tuning deltas x mod deltas, Step 3), then crossing the two once (Step 4) to produce the full
`OptimizerResult[]` frontier - same contract as today, computed correctly instead of via the
old `combineSlots`, which exploded combinatorially.

That redesign's Step 3 turned out to be infeasible: `ADJ[k]` (tuning deltas crossed with the
252-vector mod-delta set, then Pareto-pruned) reaches 15,227 entries at k=2 (19s) and 91,505 at
k=3 (12 minutes), because ~98.6% of raw 6D combinations at k=2 are mutually non-dominated. An
exact, fully-precomputed Pareto frontier at raw-point granularity is both uncomputable in
reasonable time and not useful for display - tens of thousands of near-identical results.

This document supersedes that redesign from Step 3 onward. Steps 1-3 of the *original* Phase 1
implementation plan (already committed on `optimizer-combine-redesign`) remain valid building
blocks:

- `src/lib/optimizer/pareto.ts` - `dominates`/`paretoFrontier` (incremental O(n x frontier)).
- `src/lib/optimizer/mod-deltas.ts` - `getModDeltaSet()`, the exact 252-vector mod-delta set.
- `src/lib/optimizer/vectors.ts` - `zeroVector`, `addVectors`, `subtractVectors`, `dedupeByStats`.
- `src/lib/optimizer/tuning-variants.ts` - `tuningDeltas()` (32-entry universal tuning-delta menu:
  1 empty/zero, 1 balanced/+1-all, 30 directional +-5 pairs) and `tuningDeltaVector`.

## Two reframings

**1. Result granularity.** Destiny 2 awards stat bonuses in increments, so two loadouts whose
final stat vectors agree after `floor(value / 5)` per stat are functionally equivalent for
display. The optimizer should group/dedupe results at this granularity (multiples of 5) rather
than at raw-point precision.

A prototype confirmed that applying this "tier-vector" grouping *during* `ADJ_TUNING[k]`
construction does **not** shrink it (11,253 vs 11,247 entries at k=5) - the 32-entry tuning
deltas are already aligned to multiples of 5 (except the "+1 to all" balanced delta, which
doesn't accumulate enough to cause much merging). So tier grouping is a *display/dedup* step
applied to final results, not a way to shrink intermediate frontiers.

**2. On-demand computation.** Rather than precomputing one global frontier and filtering it
client-side, the server computes results for the *current query* (`thresholds` +
`optimizeFor`), treating thresholds as hard constraints that prune the search and `optimizeFor`
as the sort objective. This bounds the work to "find the top N results for this query" instead
of "find every Pareto-optimal result that could ever exist."

## Algorithm

### Precomputed once (module-scope, memoized)

**`getTuningAdjustmentFrontier(k)` for k = 0..5** - the Pareto frontier of sums of `k` picks from
the 32-entry `tuningDeltas()` menu, *not* crossed with mod deltas:

```
ADJ_TUNING[0] = [{ stats: zeroVector(), tuningAssignment: [] }]
ADJ_TUNING[k] = paretoFrontier(dedupeByStats(
  ADJ_TUNING[k-1].flatMap(prev => tuningDeltas().map(td => ({
    stats: addVectors(prev.stats, td.delta),
    tuningAssignment: [...prev.tuningAssignment, td.tuning],
  })))
))
```

Measured sizes: 1, 31, 271, 1281, 4251, 11253 for k=0..5; ~2s total to build all six, one time,
cached for the process lifetime.

`getModDeltaSet()` (252 entries) is reused as-is, uncombined with `ADJ_TUNING`.

### Per-request, query-independent

**Rank each slot's candidates** by total base-stat sum (sum of all 6 stats), descending. This
doesn't depend on `thresholds`/`optimizeFor`, so it's computed once per request regardless of how
many queries follow (in practice, once per exotic selection).

### Per query (`thresholds: ArmorStats`, `optimizeFor: ArmorStatName`)

1. `K = 5` (initial top-K candidates per non-exotic slot; the exotic's slot always has exactly 1).
2. `itemSelectionFrontier[k] = selectItemCombinations(top-K items per slot)` for k = 0..5 - the
   per-slot tuned/untuned pruning + cartesian combine from Steps 1-2 of the prior design, run over
   the top-K slice instead of the full candidate list.
3. For each combo in `itemSelectionFrontier[k]`, for each `adj` in `getTuningAdjustmentFrontier(k)`,
   for each `mod` in the 252 mod deltas: compute `final = combo.stats + adj.stats + mod`. Keep it
   only if `final[s] >= thresholds[s]` for every stat `s`.
4. **Tier-dedup**: key each surviving result by `(floor(final[s] / 5) for s in stats)`. Keep one
   representative per key - the one with the highest `final[optimizeFor]`.
5. Sort by `final[optimizeFor]` descending, take the top N (e.g. 50).
6. If fewer than N results survive (including zero), **widen**: double `K` (capped at the number
   of candidates in the slot) and retry from step 2. Stop widening once `K` covers every
   candidate in every slot.

With `thresholds` all zero (the default), step 3 keeps nearly everything, so `K=5` already
produces >= N results and widening never triggers. Widening only activates when strict thresholds
mean the top-5-per-slot items can't satisfy them, pulling in lower-overall-stat items that may
have better tuning options or stat distributions in the needed dimensions.

## API and client changes

- `POST /api/optimizer/compute` request body becomes `{ exoticItemInstanceId, thresholds,
  optimizeFor }`. Response remains `{ results: OptimizerResult[] }`, now pre-filtered, deduped,
  and sorted (top N).
- `OptimizerClient`: re-POST (debounced, ~300ms) whenever `thresholds` or `optimizeFor` change, in
  addition to the existing POST on exotic selection. Reuses the existing `requestIdRef`
  stale-response guard. The initial POST (on exotic selection) uses zero thresholds and the
  default `optimizeFor`.
- `OptimizerResults`: remove the client-side `filter`/`sort` `useMemo` - the server result is
  already final. Keep the existing empty-state message ("No combination meets the current
  thresholds...").

## Files affected

- `src/lib/optimizer/adjustment-frontier.ts` (+ test) - rework to `getTuningAdjustmentFrontier(k)`
  as described above (tuning deltas only, no mod crossing). The current untracked draft (which
  crosses with mods) is replaced.
- `src/lib/optimizer/combine.ts` (+ test) - replace `combineSlots` with `selectItemCombinations`
  (Steps 1-2 from the prior design: per-slot tuned/untuned pruning, then cartesian combine tagged
  by tuned-count `k`), operating on a caller-supplied top-K slice per slot.
- New `src/lib/optimizer/query.ts` (+ test) - `computeOptimizerQuery(exotic, candidatesBySlot,
  query: { thresholds, optimizeFor })`: ranking, the K-widening loop, threshold filtering,
  tier-dedup, sort, top-N.
- `src/lib/optimizer/index.ts` - `computeOptimizerResults` is replaced by
  `computeOptimizerQuery`; `OptimizerResult` type unchanged.
- `src/app/api/optimizer/compute/route.ts` - accept `thresholds`/`optimizeFor` in the request
  body, pass through to `computeOptimizerQuery`.
- `src/components/optimizer/OptimizerClient.tsx` - debounced re-fetch on
  `thresholds`/`optimizeFor` change.
- `src/components/optimizer/OptimizerResults.tsx` - remove client-side filter/sort.
- `src/lib/optimizer/mod-deltas.ts`, `pareto.ts`, `vectors.ts`, `tuning-variants.ts` - unchanged,
  reused as-is.

## Testing

- `adjustment-frontier.test.ts`: `getTuningAdjustmentFrontier(k)` sizes/correctness against a
  brute-force reference at small k; memoization (same array instance / no recompute on repeat
  calls).
- `combine.test.ts`: `selectItemCombinations` over small synthetic top-K slices, including the
  tuned/untuned pruning rule from the prior design.
- `query.test.ts`: end-to-end on a synthetic inventory - threshold filtering, tier-dedup
  (multiple raw results collapsing to one tier-bucket), sort order by `optimizeFor`, and the
  widening loop (a case where `K=5` yields nothing but widening to `K=10` succeeds; a case where
  no `K` satisfies thresholds returns empty).
- Performance guard: realistic inventory (~14 items/slot, full 32-tuning menus), assert a query
  completes within a fixed wall-clock budget (e.g. 1s) for both loose (`thresholds` all 0) and
  strict thresholds.

## Out of scope

- No change to `OptimizerResult` shape, `mod-deltas.ts`, `pareto.ts`, or `vectors.ts`.
- No multi-stat/weighted `optimizeFor` - remains a single stat.
- No persistence of query results across exotic selections.
