# Deficit-Sum Mod Filter (Phase 1) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Skip provably-infeasible `(combo, adjustment)` pairs in `buildResults`'s hot loop before
the 252-entry mod-delta loop runs, speeding up real (non-trivial-threshold) optimizer queries
without changing any results.

**Architecture:** A small pure helper (`computeDeficitSum`) sums each stat's shortfall below its
threshold (`max(0, threshold[i] - baseValues[i])`). Since every mod-delta vector sums to exactly
`MOD_BUDGET` (50) across its 6 stats, a `deficitSum > MOD_BUDGET` proves no mod-delta can satisfy
all thresholds simultaneously - so the inner 252-iteration loop is skipped via `continue`. This is
purely an iteration-count optimization: outputs are unchanged, which is why the new tests are
phrased as regression/behavior checks rather than classic TDD reds for the integration step.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

---

## Background (read before starting)

See `docs/plans/2026-06-15-deficit-sum-mod-filter-design.md` for the full design and the math
proof of why `deficitSum > MOD_BUDGET` is conclusive.

Current baseline timings (captured on master before this work, via
`npx vitest run src/lib/optimizer/query.performance.test.ts --root . --reporter=verbose`):

```
loose thresholds (all zero):  1834ms  (budget 4000ms)
strict thresholds:             1685ms  (budget 4000ms)
tunedCount=4-heavy fixture:    3020ms  (budget 6000ms) — capped to 1 combo, thresholds=zeroVector()
```

**Important finding from the design discussion:** the heavy fixture uses `thresholds:
zeroVector()`. With all-zero thresholds, `deficit[i] = max(0, 0 - baseValues[i])` is only positive
when a stat goes negative (only directional tuning can do this, bounded to roughly ±25 per stat),
so `deficitSum` essentially never exceeds `MOD_BUDGET=50` for this fixture. **The filter is
expected to provide ~0 speedup on the heavy fixture.** This phase does **not** attempt to raise
`ITER_BUDGET` - Task 4 documents this finding and the resulting Phase 2 decision.

---

### Task 1: Export `MOD_BUDGET` from `mod-deltas.ts`

**Files:**
- Modify: `src/lib/optimizer/mod-deltas.ts`
- Test: `src/lib/optimizer/mod-deltas.test.ts`

**Step 1: Write the failing test**

Add this `it` block inside the existing `describe("getModDeltaSet", ...)` in
`src/lib/optimizer/mod-deltas.test.ts` (after the "every entry has stat values..." test), and add
`MOD_BUDGET` to the existing import on line 2:

```typescript
import { getModDeltaSet, MOD_BUDGET } from "./mod-deltas";
```

```typescript
  it("MOD_BUDGET (50) equals the total of every mod-delta entry", () => {
    expect(MOD_BUDGET).toBe(50);
    for (const delta of getModDeltaSet()) {
      const total = Object.values(delta).reduce((sum, value) => sum + value, 0);
      expect(total).toBe(MOD_BUDGET);
    }
  });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/optimizer/mod-deltas.test.ts --root .`
Expected: FAIL - `MOD_BUDGET` is `undefined` (not yet exported), so `expect(undefined).toBe(50)`
fails.

**Step 3: Write minimal implementation**

In `src/lib/optimizer/mod-deltas.ts`, change:

```typescript
const MOD_SLOTS_PER_LOADOUT = 5;
const MOD_BONUS = 10;
```

to:

```typescript
const MOD_SLOTS_PER_LOADOUT = 5;
const MOD_BONUS = 10;

/**
 * Maximum total stat points mods can contribute across all stats combined: each of the
 * `MOD_SLOTS_PER_LOADOUT` general mod slots adds at most `MOD_BONUS` to one stat. Every entry in
 * `getModDeltaSet()` sums to exactly this value.
 */
export const MOD_BUDGET = MOD_SLOTS_PER_LOADOUT * MOD_BONUS;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/optimizer/mod-deltas.test.ts --root .`
Expected: PASS (6 tests in this file).

**Step 5: Commit**

```bash
git add src/lib/optimizer/mod-deltas.ts src/lib/optimizer/mod-deltas.test.ts
git commit -m "feat(optimizer): export MOD_BUDGET constant from mod-deltas"
```

---

### Task 2: Add `computeDeficitSum` helper (TDD)

**Files:**
- Modify: `src/lib/optimizer/query.ts`
- Test: `src/lib/optimizer/query.test.ts`

**Step 1: Write the failing tests**

Add this new `describe` block to `src/lib/optimizer/query.test.ts` (e.g. after the
`describe("computeOptimizerQuery", ...)` block), and add `computeDeficitSum` to the existing
import from `"./query"` on line 6:

```typescript
import { buildResults, computeDeficitSum, computeOptimizerQuery, ITER_BUDGET } from "./query";
```

```typescript
describe("computeDeficitSum", () => {
  it("sums positive shortfalls and ignores stats already at/above threshold", () => {
    const baseValues = Int32Array.from([5, 20, -3, 0, 10, 8]);
    const thresholdValues = Int32Array.from([10, 15, 0, 0, 10, 20]);
    // shortfalls: 5, 0 (20>=15), 3, 0, 0, 12 => sum = 20
    expect(computeDeficitSum(baseValues, thresholdValues, 6)).toBe(20);
  });

  it("returns 0 when every stat already meets its threshold", () => {
    const baseValues = Int32Array.from([10, 10, 10, 10, 10, 10]);
    const thresholdValues = Int32Array.from([10, 10, 10, 10, 10, 10]);
    expect(computeDeficitSum(baseValues, thresholdValues, 6)).toBe(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/optimizer/query.test.ts --root . -t computeDeficitSum`
Expected: FAIL - `computeDeficitSum` is not exported from `./query` (TypeScript/import error or
`undefined is not a function`).

**Step 3: Write minimal implementation**

In `src/lib/optimizer/query.ts`, add this function just before the `BestEntry` interface
(currently around line 127):

```typescript
/**
 * Sum of per-stat shortfalls (`threshold - value`, floored at 0) across the first `statCount`
 * entries. If this exceeds `MOD_BUDGET`, no mod-delta vector (each summing to exactly
 * `MOD_BUDGET` across its stats) can cover every stat's shortfall simultaneously - see
 * docs/plans/2026-06-15-deficit-sum-mod-filter-design.md.
 */
export function computeDeficitSum(baseValues: Int32Array, thresholdValues: Int32Array, statCount: number): number {
  let deficitSum = 0;
  for (let i = 0; i < statCount; i++) {
    const deficit = thresholdValues[i] - baseValues[i];
    if (deficit > 0) deficitSum += deficit;
  }
  return deficitSum;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/optimizer/query.test.ts --root . -t computeDeficitSum`
Expected: PASS (2 tests).

**Step 5: Commit**

```bash
git add src/lib/optimizer/query.ts src/lib/optimizer/query.test.ts
git commit -m "feat(optimizer): add computeDeficitSum helper"
```

---

### Task 3: Wire the deficit-sum filter into `buildResults`'s hot loop

**Files:**
- Modify: `src/lib/optimizer/query.ts`
- Test: `src/lib/optimizer/query.test.ts`

**Step 1: Write the regression tests and confirm they pass on current code**

These two cases are already correctly handled (infeasible -> empty results) *before* this
change - they exist to lock in that the filter doesn't alter outcomes for these edge cases. Add
this new `describe` block to `src/lib/optimizer/query.test.ts`:

```typescript
describe("buildResults: deficit-sum mod filter", () => {
  /** Builds a tunedCount=0 combo (no tuning adjustment to account for) with the given stats. */
  function frontierWithCombo(stats: ArmorStats): ItemCombination[][] {
    const item: ArmorItem = {
      itemInstanceId: "combo",
      itemHash: 0,
      name: "combo",
      icon: "",
      slot: "helmet",
      tierType: 5,
      classType: 0,
      stats,
      tuning: { kind: "none" },
      power: 0,
      gearTier: undefined,
      isMasterworked: true,
      location: "vault",
    };
    const frontier: ItemCombination[][] = Array.from({ length: MAX_TUNED_SLOTS + 1 }, () => []);
    frontier[0] = [{ choices: { helmet: { item, stats, hasTuning: false } }, stats, tunedCount: 0 }];
    return frontier;
  }

  it("excludes a combo whose deficit sum exceeds MOD_BUDGET (every stat short by 10, sum 60 > 50)", () => {
    const thresholds: ArmorStats = {
      mobility: 10,
      resilience: 10,
      recovery: 10,
      discipline: 10,
      intellect: 10,
      strength: 10,
    };
    const results = buildResults(frontierWithCombo(zeroVector()), { thresholds, optimizeFor: "mobility" });
    expect(results).toEqual([]);
  });

  it("still excludes a combo whose deficit sum is within MOD_BUDGET but no single mod covers every stat (6 stats short by 1, only 5 mod slots)", () => {
    const combo: ArmorStats = {
      mobility: 9,
      resilience: 9,
      recovery: 9,
      discipline: 9,
      intellect: 9,
      strength: 9,
    };
    const thresholds: ArmorStats = {
      mobility: 10,
      resilience: 10,
      recovery: 10,
      discipline: 10,
      intellect: 10,
      strength: 10,
    };
    const results = buildResults(frontierWithCombo(combo), { thresholds, optimizeFor: "mobility" });
    expect(results).toEqual([]);
  });
});
```

Run: `npx vitest run src/lib/optimizer/query.test.ts --root . -t "deficit-sum mod filter"`
Expected: PASS (2 tests) - this confirms current behavior before wiring in the filter.

**Step 2: Wire the filter into the hot loop**

In `src/lib/optimizer/query.ts`:

1. Update the import on line 6 from:

```typescript
import { getModDeltaSet } from "./mod-deltas";
```

to:

```typescript
import { getModDeltaSet, MOD_BUDGET } from "./mod-deltas";
```

2. In `buildResults`, inside the `for (const adj of adjustments)` loop, after the existing
   `baseValues` hoisting loop and before the `for (let modIndex = ...)` loop (currently
   `query.ts:177-181`), add:

```typescript
        for (let i = 0; i < statCount; i++) {
          baseValues[i] = combo.stats[ARMOR_STAT_ORDER[i]] + adj.stats[ARMOR_STAT_ORDER[i]];
        }

        if (computeDeficitSum(baseValues, thresholdValues, statCount) > MOD_BUDGET) {
          continue;
        }

        for (let modIndex = 0; modIndex < modDeltaSet.length; modIndex++) {
```

**Step 3: Run the full optimizer test suite to verify nothing broke**

Run: `npx vitest run src/lib/optimizer --root .`
Expected: PASS - all existing tests (50 passed / 1 skipped before this plan, now +5 new tests from
Tasks 1-3) plus the two new regression tests from Step 1, all green.

**Step 4: Commit**

```bash
git add src/lib/optimizer/query.ts src/lib/optimizer/query.test.ts
git commit -m "feat(optimizer): skip mod-delta loop for provably-infeasible combo/adjustment pairs"
```

---

### Task 4: Measure performance impact and document findings

**Files:**
- Modify: `docs/plans/2026-06-15-deficit-sum-mod-filter-design.md`

**Step 1: Run the performance tests and record new timings**

Run: `npx vitest run src/lib/optimizer/query.performance.test.ts --root . --reporter=verbose`

Record the three `computeOptimizerQuery performance` timings (loose thresholds, strict
thresholds, heavy fixture). Compare against the baseline recorded at the top of this plan:

```
loose thresholds (all zero):  1834ms  (budget 4000ms)
strict thresholds:             1685ms  (budget 4000ms)
tunedCount=4-heavy fixture:    3020ms  (budget 6000ms)
```

**Step 2: Append a "Phase 1 Results" section to the design doc**

Append this section to `docs/plans/2026-06-15-deficit-sum-mod-filter-design.md` (fill in the
`<measured>` placeholders with the Step 1 numbers):

```markdown
## Phase 1 Results

Measured via `npx vitest run src/lib/optimizer/query.performance.test.ts --root . --reporter=verbose`:

| Test                          | Before | After       |
|--------------------------------|--------|-------------|
| loose thresholds (all zero)    | 1834ms | <measured>ms |
| strict thresholds               | 1685ms | <measured>ms |
| tunedCount=4-heavy fixture       | 3020ms | <measured>ms |

As predicted, the heavy fixture (all-zero thresholds) saw <negligible/measured> change, since
`deficitSum` essentially never exceeds `MOD_BUDGET=50` when thresholds are zero - the filter only
fires when a stat is meaningfully below a non-trivial threshold.

**`ITER_BUDGET` is not raised in this phase.** The `tunedCount=4`/`tunedCount=5` collapse-to-1-combo
behavior is unchanged for the loose-threshold case, which is the case `ITER_BUDGET` must stay safe
for. The deficit-sum filter remains a real win for queries with non-trivial thresholds (the
realistic case), speeding up each `buildResults` call in `computeOptimizerQuery`'s topK-widening
retry loop.

**Phase 2 decision:** loosening/removing the cap for `tunedCount=4`/`5` under loose-threshold
conditions still requires the worker_threads-based parallelization described as "Phase 2" in the
original design - not addressed by this filter alone.
```

**Step 3: Commit**

```bash
git add docs/plans/2026-06-15-deficit-sum-mod-filter-design.md
git commit -m "docs(optimizer): record phase 1 deficit-sum filter measurements"
```
