# Optimizer Combine Redesign - Design

## Background

The Phase 1 implementation of `computeOptimizerResults` (see
`docs/plans/2026-06-10-armor-optimizer-design.md`) computes, per slot, the Pareto frontier of all
item x tuning-variant stat vectors (up to 32 variants/item), then combines the 5 slots via
repeated cartesian product + Pareto pruning (`combineSlots`), then crosses the result with the
252-vector mod-delta set.

In practice, per-slot frontiers retain ~85-90% of their ~300-450 raw candidates (tuning variants
are mostly mutually non-dominated ±5 trades on a constant-sum vector), so the cartesian product
across slots explodes: combining just 2 slots produces ~107K candidates and a 13,470-entry
frontier, taking ~26s even with an O(n x frontier) incremental Pareto algorithm. A 3rd/4th slot is
computationally infeasible (estimated hours).

Two correct, already-implemented improvements are kept as-is and are building blocks for this
redesign:

- `src/lib/optimizer/pareto.ts` - incremental O(n x frontier) `paretoFrontier`.
- `src/lib/optimizer/mod-deltas.ts` - exact 252-vector closed-form mod-delta set (C(10,5) ways to
  distribute 5 "+10" tokens across 6 stats).

## Core insight

The explosion comes from multiplying each item's 32 tuning-delta options into the per-slot
candidate set before combining across slots. But the tuning deltas are a small, universal,
item-independent set:

- `empty` -> zero vector
- `balanced` -> +1 to all 6 stats
- 30 `directional` pairs -> +5 to one stat, -5 to another

Every item with a tuning socket (`tuning.kind !== "none"`) offers exactly this same 32-vector
menu, regardless of its base stats. Items without a tuning socket offer only the zero vector.

This means the problem splits into two independent combinatorial spaces:

1. **Item selection** - which 5 items (one per slot, including the locked exotic), considering
   only their *base* stats.
2. **Adjustment selection** - which tuning deltas (one per slot that has a tuning socket) plus
   which mod delta, considering only the small universal delta sets.

The final stat vector for a loadout is `sum(item.stats for item in loadout) + sum(tuning deltas)
+ mod delta`. Because addition distributes, we can compute the Pareto frontier of each space
independently and cross them at the end, instead of cross-multiplying per-slot tuning variants
before combining items.

## Algorithm

### Step 1: Per-slot base-stat frontier

For each of the 5 slots (4 open + the locked exotic's slot, which has exactly 1 candidate), build
the list of `(item, stats: item.stats, hasTuning: item.tuning.kind !== "none")`.

Prune within each slot, but **tuned and untuned items need different rules** because they have
different delta menus (tuned items can reach 32 vectors from their base; untuned items can only
stay at their base, i.e. delta = zero):

- Among **tuned** items: prune normally with `paretoFrontier`/`dedupeByStats` on `item.stats`. This
  is safe because all tuned items share the identical 32-delta menu, so if `B.stats` dominates
  `A.stats`, then `B.stats + d` dominates-or-equals `A.stats + d` for every shared delta `d`.
- Among **untuned** items: prune normally with `paretoFrontier`/`dedupeByStats` on `item.stats` (an
  untuned item's only contribution is its base stats).
- Then drop any surviving untuned item whose `stats` is dominated by any surviving **tuned**
  item's `stats` - a tuned item can always pick the zero (`empty`) delta, so it reproduces the
  untuned item's contribution exactly.
- **Do not** drop a tuned item just because an untuned item dominates it - the tuned item's
  non-zero deltas may reach vectors the untuned item can never match (e.g. untuned `B` dominates
  tuned `A` by a small margin in stat X, but `A`'s directional delta `+5` to stat X can still push
  `A` above `B` there).

The slot frontier is the union of the pruned tuned items and the surviving untuned items.

### Step 2: Item-selection frontier, tagged by tuning count `k`

Combine the 5 per-slot base frontiers via the existing incremental `combineSlots`-style
cartesian-product-then-prune (slot-by-slot, Pareto-pruning the running set after each step) -
but on the small per-slot base frontiers (~14 raw items each, likely pruned smaller), not on
32x-expanded tuning variants.

Each surviving combination carries `k` = the count of its 5 chosen items with `hasTuning === true`
(0-5). Group the final item-selection frontier by `k` (6 groups, `k = 0..5`).

### Step 3: Adjustment frontier `ADJ[k]`, precomputed once

Define the universal tuning-delta set `TUNING_DELTAS: Array<{ tuning: ArmorTuning; delta:
StatVector }>` - the same 32 `(label, vector)` pairs described above, factored out of
`tuning-variants.ts`.

Build `ADJ_TUNING[0] = [{ deltas: [], stats: zeroVector() }]` (one entry: no tuned slots, no
delta). For `k = 1..5`:

```
ADJ_TUNING[k] = paretoFrontier(dedupeByStats(
  ADJ_TUNING[k-1].flatMap(prev => TUNING_DELTAS.map(td => ({
    deltas: [...prev.deltas, td.tuning],
    stats: addVectors(prev.stats, td.delta),
  })))
))
```

Then cross with the mod-delta set:

```
ADJ[k] = paretoFrontier(dedupeByStats(
  ADJ_TUNING[k].flatMap(adj => modDeltas.map(modDelta => ({
    tuningAssignment: adj.deltas,   // length k, in some canonical order
    modDelta,
    stats: addVectors(adj.stats, modDelta),
  })))
))
```

Because `TUNING_DELTAS` and `modDeltas` are both small, item-independent sets of bounded-magnitude
vectors, `ADJ_TUNING[k]` and `ADJ[k]` stay small (expected low hundreds at most) even at `k=5`.
This is the key difference from the old design: the 32x/252x multipliers are applied to *each
other* (small x small), not to the (large) item-selection space.

Each `ADJ[k]` entry retains provenance: an ordered list of `k` `ArmorTuning` labels (one per tuned
slot in the loadout, assigned in a fixed canonical order - e.g. the order the tuned slots appear
in `ALL_SLOTS`) plus the chosen mod delta (not surfaced in the UI, but kept for symmetry/possible
future use).

### Step 4: Final cross and global frontier

For each `k = 0..5`:

```
candidatesForK = itemSelectionFrontier[k].flatMap(loadout =>
  ADJ[k].map(adj => ({
    stats: addVectors(loadout.stats, adj.stats),
    choices: assignTuning(loadout.choices, adj.tuningAssignment),
  }))
)
```

`assignTuning` walks the loadout's 5 slot choices in canonical order, assigns each tuned slot the
next `ArmorTuning` label from `adj.tuningAssignment` (in order), and assigns `{ kind: "none" }`
(or `{ kind: "empty" }`, matching current behavior for untuned items) to untuned slots.

Concatenate `candidatesForK` across all `k`, then `paretoFrontier(dedupeByStats(...))` once more
for the global result. This is the same `OptimizerResult[]` shape as today - no API/UI changes.

## Correctness argument

- Every vector in the final frontier is `sum(5 item base stats) + sum(k tuning deltas, one per
  tuned item) + 1 mod delta`, where each component is independently achievable (item stats are
  real, tuning deltas come from each tuned item's actual 32-option menu, mod delta comes from the
  real 252-vector set) - so every result is genuinely achievable.
- Every achievable vector is representable this way (the split is just regrouping the sum), and is
  not lost by any pruning step:
  - Step 1 pruning follows the tuned/untuned rule above: an item is only dropped when the
    survivor's delta menu is a superset of the dropped item's (tuned items are only dropped by
    other tuned items sharing the identical menu; untuned items are dropped by any item, since a
    tuned dominator can always pick its zero delta) - so no achievable per-slot base contribution
    is lost.
  - Step 2 pruning compares only raw item-stat sums, mixing loadouts with different tuned-item
    counts `k`. This is safe because `ADJ[k]` is monotonically "coverable" by `ADJ[k']` for `k' >
    k`: every adjustment in `ADJ[k]` is also achievable with `k'` tuned slots by assigning `empty`
    (zero delta) to the extra `k' - k` slots. So if loadout `L2` (with count `k2`) is dominated by
    `L4` (with count `k4 > k2`), then for every `adj2 in ADJ[k2]`, `L2.stats + adj2 <= L4.stats +
    adj2 <= L4.stats + adj4` for some `adj4 in ADJ[k4]` that dominates-or-equals `adj2` - so every
    final result reachable from `L2` is dominated by one reachable from `L4`, and dropping `L2`
    loses nothing.
  - Steps 3-4 use the existing, already-proven-correct `paretoFrontier`/`dedupeByStats` at each
    combination step; by transitivity of `dominates`, iterated pruning of maximal elements yields
    the same frontier as pruning the full cross product at once.

## Files affected

- `src/lib/optimizer/tuning-variants.ts` - add `tuningDeltas(): Array<{ tuning: ArmorTuning; delta:
  StatVector }>`, factored out of the existing `directionalTuningPairs`/`balancedDelta` logic.
  `computeTuningVariants` (per-item stats + tuning) is no longer used by the new combine path but
  may remain if still referenced elsewhere (check before removing).
- `src/lib/optimizer/mod-deltas.ts` - unchanged, reused as-is.
- `src/lib/optimizer/pareto.ts` - unchanged, reused as-is.
- New `src/lib/optimizer/adjustment-frontier.ts` - builds `ADJ[0..5]` with provenance (Step 3).
- `src/lib/optimizer/combine.ts` - replace `combineSlots` with the new per-slot base-stat
  combination (Steps 1-2) plus the final cross with `ADJ[k]` and `assignTuning` (Step 4). Exposes
  the same `LoadoutCandidate`/`SlotChoice`-shaped result as today.
- `src/lib/optimizer/index.ts` - update `computeOptimizerResults` orchestration to call the new
  combine path and `adjustment-frontier`. `OptimizerResult[]` output type unchanged.

## Testing

- `adjustment-frontier.test.ts`: `ADJ[k]` for small synthetic `TUNING_DELTAS`/mod-delta sets
  matches a brute-force reference; provenance round-trips (assigning the recorded tuning labels +
  mod delta reproduces the frontier vector).
- `combine.test.ts`: per-slot base-stat pruning (including the "untuned item dominated by any
  item" rule); item-selection frontier grouped by `k`; final cross matches a brute-force reference
  on a small synthetic inventory (e.g. 2-3 items/slot, 2 slots).
- `index.test.ts`: end-to-end on the existing synthetic fixtures, asserting the result set is
  unchanged in content from a brute-force reference (full enumeration) on a small inventory.
- Performance guard: a test using realistic sizes (~14 items/slot, 5 slots, items with full 32-tuning
  menus) asserts the whole computation completes within a fixed wall-clock budget (e.g. 2s), to
  catch regressions back toward combinatorial blowup.

## Out of scope

- No changes to `/api/optimizer/compute`, `OptimizerClient`, `OptimizerControls`, or
  `OptimizerResults` - the output contract (`OptimizerResult[]`) is unchanged.
- No changes to the mod-delta set (`mod-deltas.ts`) or the generic `paretoFrontier`/`dominates`
  (`pareto.ts`) - both are correct and already updated this session.
