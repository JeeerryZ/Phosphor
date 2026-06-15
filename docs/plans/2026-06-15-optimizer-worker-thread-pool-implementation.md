# Optimizer Worker Thread Pool (Phase 2) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Parallelize `buildResults`'s `(combo, adjustment, mod)` search across a Piscina-managed
`worker_threads` pool, raising the `tunedCount=4`/`5` per-bucket combo caps from 1 combo each to
roughly `14`/`5` (at pool size 8) without a proportional latency increase.

**Architecture:** See `docs/plans/2026-06-15-optimizer-worker-thread-pool-design.md` for the full
design and correctness reasoning. Summary: a lazy singleton Piscina pool runs one task per combo
(or grouped combos for cheap buckets); each task computes that combo's full
`(adjustment x mod)` cross-product via a pure `computeComboResults` function operating on flattened
`Int32Array`s (shared via `SharedArrayBuffer` where possible); the main thread merges per-task
partial results into the existing tier-key-deduped `best` map.

**Tech Stack:** TypeScript, Vitest, Node `worker_threads` via the `piscina` npm package.

---

## IMPORTANT: Task 0 is a gate

Task 0 is a spike that proves Piscina worker files load correctly under both `next dev` and
`next build && next start` in this repo. **Tasks 1-2 (pure functions) are independent of Task 0's
outcome and can proceed regardless.** Tasks 3-6 depend on Task 0's findings for exactly how the
worker file is packaged/located.

**After Task 0 completes, STOP and report findings before starting Task 3.** If the
straightforward `path.resolve(__dirname, "optimizer-worker.js")` approach doesn't survive a
production build, Tasks 3-6 need to be revised (e.g. different worker file location, a
`next.config.ts` `outputFileTracingIncludes` entry, or - in the worst case - a different pooling
approach) before continuing. Tasks 1-2 can be done in any order relative to Task 0.

---

### Task 0: Spike - Piscina worker pool under Next.js (GATE)

**Files:**
- Modify: `package.json` (add `piscina` dependency)
- Create: `src/lib/optimizer/optimizer-worker.js` (plain CommonJS worker - see rationale below)
- Create: `src/lib/optimizer/worker-pool.ts`
- Test: `src/lib/optimizer/worker-pool.test.ts`
- Create (temporary, for manual verification): `src/app/api/optimizer/spike/route.ts`

**Why a plain `.js` worker file:** Piscina's `filename` option points `worker_threads.Worker` at a
file on disk at runtime. This project's `package.json` has no `"type": "module"`, so a `.js` file
is loaded as CommonJS with no build step required - it doesn't need Next.js's TS pipeline to run.
Using `.js` (not `.ts`) for the worker entry sidesteps the question of whether Next.js's build
output includes a compiled version of an arbitrary TS file at a predictable path.

**Step 1: Add the `piscina` dependency**

```bash
npm install piscina
```

**Step 2: Create the worker file**

Create `src/lib/optimizer/optimizer-worker.js`:

```javascript
// Plain CommonJS Piscina worker entry point. Kept as .js (not .ts) so it can be loaded by
// worker_threads at runtime without a separate build step - see Task 0 of
// docs/plans/2026-06-15-optimizer-worker-thread-pool-implementation.md.
//
// For this spike, the worker simply echoes back the sum of an input SharedArrayBuffer's values,
// proving that (a) the worker file loads under both `next dev` and a production build, and (b) a
// SharedArrayBuffer round-trips correctly.
module.exports = ({ sharedBuffer, length }) => {
  const view = new Int32Array(sharedBuffer, 0, length);
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += view[i];
  }
  return sum;
};
```

**Step 3: Create the pool module**

Create `src/lib/optimizer/worker-pool.ts`:

```typescript
import os from "node:os";
import path from "node:path";
import Piscina from "piscina";

/** Upper bound on pool size, independent of the host's core count. */
const MAX_WORKERS = 8;

let pool: Piscina | undefined;

/** Lazily-created singleton Piscina pool, reused for the process's lifetime. */
export function getOptimizerPool(): Piscina {
  if (!pool) {
    pool = new Piscina({
      filename: path.resolve(__dirname, "optimizer-worker.js"),
      maxThreads: Math.min(os.cpus().length, MAX_WORKERS),
    });
  }
  return pool;
}

/** The pool's configured thread count, used to scale per-bucket iteration budgets. */
export function getOptimizerPoolSize(): number {
  return getOptimizerPool().maxThreads;
}
```

**Step 4: Write a vitest test exercising the pool with a `SharedArrayBuffer`**

Create `src/lib/optimizer/worker-pool.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getOptimizerPool, getOptimizerPoolSize } from "./worker-pool";

describe("getOptimizerPool", () => {
  it("returns a singleton pool with a positive thread count", () => {
    const pool = getOptimizerPool();
    expect(pool).toBe(getOptimizerPool());
    expect(getOptimizerPoolSize()).toBeGreaterThan(0);
  });

  it("runs a task that sums values from a SharedArrayBuffer", async () => {
    const sharedBuffer = new SharedArrayBuffer(4 * 4);
    new Int32Array(sharedBuffer).set([1, 2, 3, 4]);

    const result = await getOptimizerPool().run({ sharedBuffer, length: 4 });

    expect(result).toBe(10);
  });
});
```

**Step 5: Run the test**

Run: `npx vitest run src/lib/optimizer/worker-pool.test.ts --root .`
Expected: PASS (2 tests). If this fails, the issue is with Piscina/worker_threads itself (not
Next.js bundling) - investigate before proceeding to Step 6.

**Step 6: Verify under `npm run dev`**

Create a temporary route `src/app/api/optimizer/spike/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getOptimizerPool } from "@/lib/optimizer/worker-pool";

export async function GET() {
  const sharedBuffer = new SharedArrayBuffer(4 * 4);
  new Int32Array(sharedBuffer).set([1, 2, 3, 4]);

  const result = await getOptimizerPool().run({ sharedBuffer, length: 4 });

  return NextResponse.json({ result });
}
```

Run `npm run dev`, then (via the ngrok URL per CLAUDE.md) `GET /api/optimizer/spike`.
Expected: `{"result":10}`.

**Step 7: Verify under a production build**

```bash
npm run build
npm run start
```

Then `GET /api/optimizer/spike` against the production server (via ngrok or whatever the prod
config allows - localhost is fine for this check since it's not an OAuth-flow request).
Expected: `{"result":10}`.

**If Step 7 fails** (worker file not found / `ENOENT` / similar in the production build): try
adding to `next.config.ts`:

```typescript
const nextConfig: NextConfig = {
  // ...existing config...
  outputFileTracingIncludes: {
    "/api/optimizer/spike/route": ["./src/lib/optimizer/optimizer-worker.js"],
  },
};
```

(adjust the route key/glob to match whatever route ends up depending on the pool) and re-run Step
7. If this still fails after one or two reasonable attempts, **stop** - don't keep guessing at
Next.js config. Report the exact error and what was tried; Tasks 3-6 need to be redesigned (e.g.
moving the worker file to `public/` won't work for server code, so the fallback would likely be
inlining the worker via `new Worker(new URL(...))` with `node:worker_threads` directly, or
embedding the worker source as a string with `eval: true`).

**Step 8: Remove the temporary spike route, keep the rest**

```bash
rm src/app/api/optimizer/spike/route.ts
```

Keep `optimizer-worker.js` and `worker-pool.ts` - Task 3 extends them rather than replacing them.

**Step 9: Commit**

```bash
git add package.json package-lock.json src/lib/optimizer/optimizer-worker.js src/lib/optimizer/worker-pool.ts src/lib/optimizer/worker-pool.test.ts
git commit -m "feat(optimizer): add Piscina worker pool spike"
```

**STOP HERE.** Report findings (did Step 7 pass directly, or did it need the
`outputFileTracingIncludes` workaround, or did it fail entirely?) before proceeding to Task 3.

---

### Task 1: `flattenStatVectors` helper (TDD)

**Files:**
- Modify: `src/lib/optimizer/vectors.ts`
- Test: `src/lib/optimizer/vectors.test.ts`

This is independent of Task 0 and can be done in parallel.

**Step 1: Write the failing test**

Add to `src/lib/optimizer/vectors.test.ts` (check whether this file exists first; if not, create it
with this content plus imports for any other functions already in `vectors.ts` that lack tests -
but do NOT add tests for pre-existing untested functions, only for `flattenStatVectors`):

```typescript
import { describe, it, expect } from "vitest";
import { flattenStatVectors, type StatVector } from "./vectors";

describe("flattenStatVectors", () => {
  it("flattens an array of stat vectors into a row-major Int32Array using ARMOR_STAT_ORDER", () => {
    const vectors: StatVector[] = [
      { mobility: 1, resilience: 2, recovery: 3, discipline: 4, intellect: 5, strength: 6 },
      { mobility: 10, resilience: 20, recovery: 30, discipline: 40, intellect: 50, strength: 60 },
    ];

    expect(flattenStatVectors(vectors)).toEqual(Int32Array.from([1, 2, 3, 4, 5, 6, 10, 20, 30, 40, 50, 60]));
  });

  it("returns an empty Int32Array for an empty input", () => {
    expect(flattenStatVectors([])).toEqual(new Int32Array(0));
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/optimizer/vectors.test.ts --root .`
Expected: FAIL - `flattenStatVectors` is not exported from `./vectors`.

**Step 3: Write the minimal implementation**

In `src/lib/optimizer/vectors.ts`, add (after `addVectors`):

```typescript
/**
 * Flattens an array of stat vectors into a single row-major `Int32Array` (length
 * `vectors.length * ARMOR_STAT_ORDER.length`), each row ordered by `ARMOR_STAT_ORDER`. Used to
 * pass stat data to worker threads via plain typed arrays / `SharedArrayBuffer`s.
 */
export function flattenStatVectors(vectors: StatVector[]): Int32Array {
  const flat = new Int32Array(vectors.length * ARMOR_STAT_ORDER.length);
  vectors.forEach((vector, i) => {
    for (let j = 0; j < ARMOR_STAT_ORDER.length; j++) {
      flat[i * ARMOR_STAT_ORDER.length + j] = vector[ARMOR_STAT_ORDER[j]];
    }
  });
  return flat;
}
```

**Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/optimizer/vectors.test.ts --root .`
Expected: PASS (2 new tests, plus any pre-existing tests in this file still passing).

**Step 5: Commit**

```bash
git add src/lib/optimizer/vectors.ts src/lib/optimizer/vectors.test.ts
git commit -m "feat(optimizer): add flattenStatVectors helper"
```

---

### Task 2: Extract `computeComboResults` pure function (TDD)

**Files:**
- Create: `src/lib/optimizer/combo-results.ts`
- Modify: `src/lib/optimizer/query.ts` (remove the now-duplicated inline loop logic in a later
  task, NOT this one - this task only adds the new function and its tests)
- Test: `src/lib/optimizer/combo-results.test.ts`

This is independent of Task 0 and can be done in parallel. It extracts the innermost
`(adjustment x mod)` loop body from `buildResults` into a pure, flattened-array-based function -
the same function that will run inside each worker task in Task 3.

**Step 1: Write the failing tests**

Create `src/lib/optimizer/combo-results.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { computeComboResults } from "./combo-results";
import { flattenStatVectors, zeroVector, type StatVector } from "./vectors";
import { getModDeltaSet, MOD_BUDGET } from "./mod-deltas";

const statCount = ARMOR_STAT_ORDER.length;
const modDeltaFlat = flattenStatVectors(getModDeltaSet());
const modCount = getModDeltaSet().length;

function flatten(vector: StatVector): Int32Array {
  return flattenStatVectors([vector]);
}

describe("computeComboResults", () => {
  it("returns entries for adjustments/mods that meet thresholds, keyed by stat tier", () => {
    const comboStats = flatten(zeroVector());
    // One adjustment: no change.
    const adjustmentStatsFlat = flatten(zeroVector());
    const thresholdValues = flatten(zeroVector());

    const results = computeComboResults(
      comboStats,
      adjustmentStatsFlat,
      1,
      modDeltaFlat,
      modCount,
      thresholdValues,
      ARMOR_STAT_ORDER.indexOf("strength"),
      statCount
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.adjIndex === 0)).toBe(true);
    // The mod-delta set includes +50 to a single stat.
    const best = results.reduce((max, r) => Math.max(max, r.stats[ARMOR_STAT_ORDER.indexOf("strength")]), 0);
    expect(best).toBe(50);
  });

  it("excludes a combo whose deficit sum exceeds MOD_BUDGET (mirrors Phase 1 Case A)", () => {
    const comboStats = flatten(zeroVector());
    const adjustmentStatsFlat = flatten(zeroVector());
    const thresholds: StatVector = {
      mobility: 10,
      resilience: 10,
      recovery: 10,
      discipline: 10,
      intellect: 10,
      strength: 10,
    };

    const results = computeComboResults(
      comboStats,
      adjustmentStatsFlat,
      1,
      modDeltaFlat,
      modCount,
      flatten(thresholds),
      ARMOR_STAT_ORDER.indexOf("mobility"),
      statCount
    );

    // deficitSum = 60 > MOD_BUDGET (50) - no mod can cover it.
    expect(MOD_BUDGET).toBe(50);
    expect(results).toEqual([]);
  });

  it("still excludes a combo whose deficit sum is within MOD_BUDGET but no mod covers every stat (mirrors Phase 1 Case B)", () => {
    const combo: StatVector = {
      mobility: 9,
      resilience: 9,
      recovery: 9,
      discipline: 9,
      intellect: 9,
      strength: 9,
    };
    const thresholds: StatVector = {
      mobility: 10,
      resilience: 10,
      recovery: 10,
      discipline: 10,
      intellect: 10,
      strength: 10,
    };

    const results = computeComboResults(
      flatten(combo),
      flatten(zeroVector()),
      1,
      modDeltaFlat,
      modCount,
      flatten(thresholds),
      ARMOR_STAT_ORDER.indexOf("mobility"),
      statCount
    );

    expect(results).toEqual([]);
  });
});
```

**Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/optimizer/combo-results.test.ts --root .`
Expected: FAIL - `combo-results.ts` doesn't exist / `computeComboResults` is not exported.

**Step 3: Write the minimal implementation**

Create `src/lib/optimizer/combo-results.ts`:

```typescript
import { computeDeficitSum } from "./query";
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
 * For one combo (given as its flattened `statCount`-length stat vector), computes the
 * tier-deduped best result for every `(adjustment, mod)` pair that meets `thresholdValues`,
 * applying the Phase 1 deficit-sum filter to skip provably-infeasible adjustments.
 *
 * This is the per-combo unit of work dispatched to worker threads in Phase 2 - see
 * docs/plans/2026-06-15-optimizer-worker-thread-pool-design.md.
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
```

**Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/optimizer/combo-results.test.ts --root .`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add src/lib/optimizer/combo-results.ts src/lib/optimizer/combo-results.test.ts
git commit -m "feat(optimizer): extract computeComboResults pure function"
```

Note: `query.ts`'s `buildResults` still has its own inline copy of this logic at this point -
Task 4 replaces it. This task only adds the new, independently-tested function.

---

### Task 3: Real optimizer worker + pool wiring (depends on Task 0 findings)

**Files:**
- Modify: `src/lib/optimizer/optimizer-worker.js` (replace spike body with real
  `computeComboResults` call)
- Modify: `src/lib/optimizer/worker-pool.ts` (add a typed `runComboTask` wrapper)
- Test: `src/lib/optimizer/worker-pool.test.ts` (replace/extend the spike test)

**Before starting:** re-read Task 0's findings. If the worker file needed to move or be referenced
differently (e.g. `outputFileTracingIncludes`), apply that here too.

**Step 1: Write the failing test**

Replace the contents of `src/lib/optimizer/worker-pool.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { getOptimizerPool, getOptimizerPoolSize, runComboTask } from "./worker-pool";
import { flattenStatVectors, zeroVector } from "./vectors";
import { getModDeltaSet } from "./mod-deltas";

const statCount = ARMOR_STAT_ORDER.length;

describe("getOptimizerPool", () => {
  it("returns a singleton pool with a positive thread count", () => {
    const pool = getOptimizerPool();
    expect(pool).toBe(getOptimizerPool());
    expect(getOptimizerPoolSize()).toBeGreaterThan(0);
  });
});

describe("runComboTask", () => {
  it("computes the same results as computeComboResults, via a worker", async () => {
    const comboStats = flattenStatVectors([zeroVector()]);
    const adjustmentStatsFlat = flattenStatVectors([zeroVector()]);
    const modDeltaFlat = flattenStatVectors(getModDeltaSet());
    const thresholdValues = flattenStatVectors([zeroVector()]);

    const results = await runComboTask({
      comboStats,
      adjustmentStatsFlat,
      adjustmentCount: 1,
      modDeltaFlat,
      modCount: getModDeltaSet().length,
      thresholdValues,
      optimizeForIndex: ARMOR_STAT_ORDER.indexOf("strength"),
      statCount,
    });

    expect(results.length).toBeGreaterThan(0);
    const best = results.reduce((max, r) => Math.max(max, r.stats[ARMOR_STAT_ORDER.indexOf("strength")]), 0);
    expect(best).toBe(50);
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/optimizer/worker-pool.test.ts --root .`
Expected: FAIL - `runComboTask` is not exported from `./worker-pool`.

**Step 3: Replace the worker file body**

Replace `src/lib/optimizer/optimizer-worker.js` entirely:

```javascript
// Plain CommonJS Piscina worker entry point - see Task 0/3 of
// docs/plans/2026-06-15-optimizer-worker-thread-pool-implementation.md for why this is .js.
//
// Each task computes one combo's full (adjustment x mod) cross-product via
// computeComboResults. Inputs/outputs are plain typed arrays (no ArmorItem/StatVector
// objects), so no Next.js path aliases or TS-only types are needed here - this file is
// intentionally dependency-light.
const { computeComboResults } = require("./combo-results");

module.exports = (task) => {
  const {
    comboStats,
    adjustmentStatsFlat,
    adjustmentCount,
    modDeltaFlat,
    modCount,
    thresholdValues,
    optimizeForIndex,
    statCount,
  } = task;

  return computeComboResults(
    comboStats,
    adjustmentStatsFlat,
    adjustmentCount,
    modDeltaFlat,
    modCount,
    thresholdValues,
    optimizeForIndex,
    statCount
  );
};
```

**This requires `combo-results.ts` to be requireable from a CommonJS `.js` file at runtime.**
Since `combo-results.ts` is compiled by Next.js's pipeline (not directly runnable by Node), and
`optimizer-worker.js` is loaded directly by `worker_threads` (bypassing Next.js's pipeline), this
`require("./combo-results")` will NOT resolve at runtime as written.

**Resolve this by inlining `computeComboResults` (and its small dependencies
`computeDeficitSum`'s relevant logic and `MOD_BUDGET`) directly into `optimizer-worker.js` as plain
JS**, duplicating the ~40 lines from `combo-results.ts`. Add a comment cross-referencing
`combo-results.ts` as the source of truth and noting they must be kept in sync:

```javascript
// Plain CommonJS Piscina worker entry point - see Task 0/3 of
// docs/plans/2026-06-15-optimizer-worker-thread-pool-implementation.md for why this is .js.
//
// This is a manually-synced copy of the core loop in `combo-results.ts` (which is also unit
// tested directly, without a worker). It's duplicated here (rather than required) because this
// file is loaded directly by worker_threads, bypassing Next.js's TS build pipeline. If you change
// the logic in `combo-results.ts`'s `computeComboResults`, update this copy to match -
// `worker-pool.test.ts`'s "computes the same results as computeComboResults, via a worker" test
// will catch most divergences.

const MOD_BUDGET = 50;
const TIER_KEY_OFFSET = 32;
const TIER_KEY_RADIX = 128;

function computeDeficitSum(baseValues, thresholdValues, statCount) {
  let deficitSum = 0;
  for (let i = 0; i < statCount; i++) {
    const deficit = thresholdValues[i] - baseValues[i];
    if (deficit > 0) deficitSum += deficit;
  }
  return deficitSum;
}

function computeComboResults(
  comboStats,
  adjustmentStatsFlat,
  adjustmentCount,
  modDeltaFlat,
  modCount,
  thresholdValues,
  optimizeForIndex,
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

module.exports = (task) => {
  const {
    comboStats,
    adjustmentStatsFlat,
    adjustmentCount,
    modDeltaFlat,
    modCount,
    thresholdValues,
    optimizeForIndex,
    statCount,
  } = task;

  return computeComboResults(
    comboStats,
    adjustmentStatsFlat,
    adjustmentCount,
    modDeltaFlat,
    modCount,
    thresholdValues,
    optimizeForIndex,
    statCount
  );
};
```

**Step 4: Add `runComboTask` to the pool module**

In `src/lib/optimizer/worker-pool.ts`, add (the `ComboTaskInput`/`ComboResultEntry` types mirror
`combo-results.ts`'s shapes so callers get type safety even though the worker itself is untyped
JS):

```typescript
import type { ComboResultEntry } from "./combo-results";

export interface ComboTaskInput {
  comboStats: Int32Array;
  adjustmentStatsFlat: Int32Array;
  adjustmentCount: number;
  modDeltaFlat: Int32Array;
  modCount: number;
  thresholdValues: Int32Array;
  optimizeForIndex: number;
  statCount: number;
}

/** Runs one combo's `(adjustment x mod)` search on the worker pool. */
export function runComboTask(input: ComboTaskInput): Promise<ComboResultEntry[]> {
  return getOptimizerPool().run(input);
}
```

**Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/optimizer/worker-pool.test.ts --root .`
Expected: PASS (2 tests).

**Step 6: Verify under `npm run build && npm run start`**

This is the real test of the inlined-worker approach. Temporarily wire `runComboTask` into the
spike route from Task 0 (or write a fresh equivalent temporary route) calling `runComboTask` with
a small fixed input, run `npm run build && npm run start`, hit the route, confirm the response
matches the same input run through `computeComboResults` directly. Remove the temporary route
afterward.

**Step 7: Commit**

```bash
git add src/lib/optimizer/optimizer-worker.js src/lib/optimizer/worker-pool.ts src/lib/optimizer/worker-pool.test.ts
git commit -m "feat(optimizer): wire computeComboResults into the worker pool"
```

---

### Task 4: Rewrite `buildResults` to dispatch combo tasks through the pool

**Files:**
- Modify: `src/lib/optimizer/query.ts`
- Modify: `src/lib/optimizer/index.ts` (if `buildResults`'s exported type changes - check)
- Modify: `src/app/api/optimizer/compute/route.ts` (add `await` if `computeOptimizerQuery` becomes
  async - it already is `await`ed for other calls in this route, but confirm)
- Test: `src/lib/optimizer/query.test.ts` (this task makes `buildResults`/`computeOptimizerQuery`
  async - existing tests need `async`/`await`; see Task 5 for the full test-suite update, but this
  task must at least get the modified/added tests in `query.test.ts` passing)

**Step 1: Update `buildResults`'s signature and budget formula**

In `src/lib/optimizer/query.ts`:

1. Update imports - replace the `getModDeltaSet, MOD_BUDGET` import and remove now-unused
   `computeDeficitSum`'s direct use in this file (it's still exported from here per Task 2's
   `combo-results.ts` importing it - keep the export, just stop calling it inline):

```typescript
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { getTuningAdjustmentFrontier, MAX_TUNED_SLOTS, type TuningAdjustment } from "./adjustment-frontier";
import { ALL_SLOTS, selectItemCombinations, type ItemCombination, type SlotCandidate } from "./combine";
import { computeComboResults } from "./combo-results";
import { getModDeltaSet } from "./mod-deltas";
import { tuningDeltaVector } from "./tuning-variants";
import { addVectors, flattenStatVectors, zeroVector, type StatVector } from "./vectors";
import { getOptimizerPoolSize, runComboTask } from "./worker-pool";
```

2. Remove the `TIER_KEY_OFFSET`/`TIER_KEY_RADIX` constants and the `computeDeficitSum` function
   from `query.ts` entirely - they now live in `combo-results.ts` (Task 2). **Before removing
   `computeDeficitSum`, check `combo-results.ts`'s import** - Task 2 imported `computeDeficitSum`
   from `./query`. Move the function itself into `combo-results.ts` as a local (non-exported)
   helper instead, and remove the `query.ts` -> `combo-results.ts` import. `combo-results.test.ts`
   doesn't test `computeDeficitSum` directly (it's covered indirectly via the Phase 1-style cases),
   so no test changes needed for this move.

3. Rewrite `buildResults`:

```typescript
/**
 * Crosses each `tunedCount` bucket of `itemSelectionFrontier` with its tuning-adjustment frontier
 * and the mod-delta set, filters by `query.thresholds`, tier-dedups (keeping the best-by-
 * `optimizeFor` per tier), and returns the top `RESULT_LIMIT` sorted by `optimizeFor` descending.
 *
 * Each `(tunedCount, combo)` pair becomes one task dispatched to the worker pool (Phase 2) - see
 * docs/plans/2026-06-15-optimizer-worker-thread-pool-design.md. `buildLoadout` is deferred until
 * after tier-dedup and ranking, since it allocates a full per-slot loadout object and only
 * `RESULT_LIMIT` of them are ever needed.
 */
export async function buildResults(
  itemSelectionFrontier: ItemCombination[][],
  query: OptimizerQuery
): Promise<OptimizerResult[]> {
  const statCount = ARMOR_STAT_ORDER.length;
  const modDeltaSet = getModDeltaSet();
  const modDeltaFlat = flattenStatVectors(modDeltaSet);
  const thresholdValues = Int32Array.from(ARMOR_STAT_ORDER, (stat) => query.thresholds[stat]);
  const optimizeForIndex = ARMOR_STAT_ORDER.indexOf(query.optimizeFor);
  const poolSize = getOptimizerPoolSize();

  interface Task {
    tunedCount: number;
    combo: ItemCombination;
  }

  const tasks: Task[] = [];
  const adjustmentsByTunedCount = new Map<number, TuningAdjustment[]>();
  const adjustmentStatsFlatByTunedCount = new Map<number, Int32Array>();

  for (let tunedCount = 0; tunedCount <= MAX_TUNED_SLOTS; tunedCount++) {
    let combos = itemSelectionFrontier[tunedCount];
    if (combos.length === 0) continue;

    const adjustments = getTuningAdjustmentFrontier(tunedCount);
    adjustmentsByTunedCount.set(tunedCount, adjustments);
    adjustmentStatsFlatByTunedCount.set(tunedCount, flattenStatVectors(adjustments.map((a) => a.stats)));

    const perComboCost = adjustments.length * modDeltaSet.length;
    const maxCombos = Math.max(1, Math.floor((ITER_BUDGET * poolSize) / perComboCost));
    if (combos.length > maxCombos) {
      combos = [...combos].sort((a, b) => totalStats(b.stats) - totalStats(a.stats)).slice(0, maxCombos);
    }

    for (const combo of combos) {
      tasks.push({ tunedCount, combo });
    }
  }

  const best = new Map<number, BestEntry>();

  const taskResults = await Promise.all(
    tasks.map((task) => {
      const adjustments = adjustmentsByTunedCount.get(task.tunedCount)!;
      const adjustmentStatsFlat = adjustmentStatsFlatByTunedCount.get(task.tunedCount)!;
      const comboStats = flattenStatVectors([task.combo.stats]);

      return runComboTask({
        comboStats,
        adjustmentStatsFlat,
        adjustmentCount: adjustments.length,
        modDeltaFlat,
        modCount: modDeltaSet.length,
        thresholdValues,
        optimizeForIndex,
        statCount,
      });
    })
  );

  for (let t = 0; t < tasks.length; t++) {
    const { tunedCount, combo } = tasks[t];
    const adjustments = adjustmentsByTunedCount.get(tunedCount)!;

    for (const entry of taskResults[t]) {
      const existing = best.get(entry.key);
      if (!existing || entry.stats[optimizeForIndex] > existing.stats[query.optimizeFor]) {
        const stats = zeroVector();
        for (let i = 0; i < statCount; i++) {
          stats[ARMOR_STAT_ORDER[i]] = entry.stats[i];
        }
        best.set(entry.key, { stats, combo, adj: adjustments[entry.adjIndex] });
      }
    }
  }

  return [...best.values()]
    .sort((a, b) => b.stats[query.optimizeFor] - a.stats[query.optimizeFor])
    .slice(0, RESULT_LIMIT)
    .map((entry) => ({ stats: entry.stats, loadout: buildLoadout(entry.combo.choices, entry.adj.tuningAssignment) }));
}
```

4. Update the `ITER_BUDGET` doc comment (currently `query.ts:78-97`) to describe the new
   `ITER_BUDGET * poolSize` formula and worked examples for `poolSize = 8`:

```typescript
/**
 * Per-`tunedCount` bucket, the (combo x adjustment x mod) cross-product is capped to roughly
 * `ITER_BUDGET * poolSize` iterations by sorting `combos` by total stat sum (descending) and
 * slicing to `max(1, floor(ITER_BUDGET * poolSize / (adjustments.length * modDeltaSet.length)))`,
 * where `poolSize` is the worker pool's thread count (`getOptimizerPoolSize()`). Each
 * surviving `(tunedCount, combo)` pair becomes one task dispatched to the pool (Phase 2) - see
 * docs/plans/2026-06-15-optimizer-worker-thread-pool-design.md.
 *
 * Sizing at `poolSize = 8`: `adjustments(4).length * 252 ~= 4251 * 252 ~= 1.07M`, so
 * `tunedCount=4` gets `floor(16M / 1.07M) ~= 14` combos (vs. 1 at the Phase 1 single-bucket cap).
 * `adjustments(5).length * 252 ~= 11247 * 252 ~= 2.83M`, so `tunedCount=5` gets
 * `floor(16M / 2.83M) ~= 5` combos (vs. 1). `tunedCount <= 3` stays effectively uncapped at
 * realistic inventory sizes, as before.
 */
export const ITER_BUDGET = 2_000_000;
```

**Step 2: Update `computeOptimizerQuery` to await `buildResults`**

`computeOptimizerQuery` (same file) calls `buildResults` inside its `while (true)` loop. Make it
`async` and `await` the call:

```typescript
export async function computeOptimizerQuery(
  exotic: ArmorItem,
  candidatesBySlot: Partial<Record<ArmorSlot, ArmorItem[]>>,
  query: OptimizerQuery
): Promise<OptimizerResult[]> {
  // ...unchanged setup...

  while (true) {
    const itemsBySlot = sliceTopK(rankedBySlot, exotic, topK);
    const itemSelectionFrontier = selectItemCombinations(itemsBySlot);
    results = await buildResults(itemSelectionFrontier, query);

    if (results.length >= RESULT_LIMIT || topK >= maxAvailable) {
      break;
    }

    topK = Math.min(topK * 2, maxAvailable);
  }

  return results;
}
```

**Step 3: Update the API route**

Check `src/app/api/optimizer/compute/route.ts:46` - `computeOptimizerQuery` is currently called
without `await`. Add it:

```typescript
const results = await computeOptimizerQuery(exotic, candidatesBySlot, { thresholds, optimizeFor });
```

**Step 4: Run the optimizer test suite**

Run: `npx vitest run src/lib/optimizer --root .`
Expected: many failures - every existing test calling `buildResults(...)` or
`computeOptimizerQuery(...)` synchronously now gets a `Promise` instead of an array. This is
expected; Task 5 fixes all of these. **Do not attempt to fix all call sites in this task** - just
confirm the build/type-check itself succeeds for the production code changed in Steps 1-3:

Run: `npx tsc --noEmit -p tsconfig.json` (or `npm run lint` if faster) and confirm no NEW type
errors in `query.ts`, `index.ts`, or `route.ts` beyond the expected "Promise is not assignable"
errors in test files (test files are checked in Task 5).

**Step 5: Commit**

```bash
git add src/lib/optimizer/query.ts src/lib/optimizer/combo-results.ts src/app/api/optimizer/compute/route.ts
git commit -m "feat(optimizer): dispatch buildResults combo tasks through the worker pool"
```

Note: this commit intentionally leaves `query.test.ts` and `query.performance.test.ts` failing -
Task 5 fixes them. If your TDD tooling refuses to commit with failing tests, run Task 5
immediately after this task in the same session before committing either.

---

### Task 5: Update existing tests to async + add pool equivalence test

**Files:**
- Modify: `src/lib/optimizer/query.test.ts`
- Modify: `src/lib/optimizer/query.performance.test.ts`

**Step 1: Make every `buildResults`/`computeOptimizerQuery` call `await`ed**

In `src/lib/optimizer/query.test.ts`, every `it("...", () => { ... })` that calls `buildResults(...)`
or `computeOptimizerQuery(...)` needs to become `it("...", async () => { ... })` with `await`
added to those calls. This applies to all `it` blocks in both `describe("computeOptimizerQuery", ...)`
and `describe("buildResults: ...", ...)`. Mechanically: find every `= buildResults(` and
`= computeOptimizerQuery(`, prefix with `await `, and ensure the enclosing `it` callback is
`async`.

Do the same in `src/lib/optimizer/query.performance.test.ts` for its three `it` blocks (note these
also have `Date.now()`-based timing - keep the `start`/`elapsed` calculation around the `await`,
i.e. `const start = Date.now(); const results = await computeOptimizerQuery(...); const elapsed =
Date.now() - start;`).

**Step 2: Run the full optimizer suite**

Run: `npx vitest run src/lib/optimizer --root .`
Expected: PASS, same test count as before this Phase 2 work (51 passed / 1 skipped) plus Task 1's
2 new tests, Task 2's 3 new tests, and Task 3's 2 new tests (worker-pool.test.ts) = 58 passed / 1
skipped. Fix any remaining failures (likely just missed `await`s or async wrappers) before moving
on.

**Step 3: Add a pool equivalence regression test**

This is the key regression guard: confirm the pool-based `buildResults` produces results
equivalent to what the pre-Phase-2 sequential algorithm would have produced for a fixed input.
Since the sequential implementation no longer exists as a separate code path (Task 4 replaced it
in place), this test instead asserts a property that's true regardless of dispatch mechanism: for
a small, fully-deterministic fixture, the result set is stable and matches a hand-computed
expectation.

Add to `src/lib/optimizer/query.test.ts`, in the existing
`describe("buildResults: per-tunedCount-bucket combo cap", ...)` block (reuse its `makeCombo`/
`buildFrontier` helpers):

```typescript
it("produces deterministic results across repeated runs (pool dispatch doesn't introduce nondeterminism)", async () => {
  const frontier = buildFrontier(5);

  const first = await buildResults(frontier, { thresholds: zeroVector(), optimizeFor: "mobility" });
  const second = await buildResults(frontier, { thresholds: zeroVector(), optimizeFor: "mobility" });

  expect(first.map((r) => r.stats)).toEqual(second.map((r) => r.stats));
  expect(first.map((r) => r.loadout.helmet?.item.name)).toEqual(second.map((r) => r.loadout.helmet?.item.name));
});
```

**Step 4: Run the full optimizer suite again**

Run: `npx vitest run src/lib/optimizer --root .`
Expected: PASS (59 passed / 1 skipped).

**Step 5: Commit**

```bash
git add src/lib/optimizer/query.test.ts src/lib/optimizer/query.performance.test.ts
git commit -m "test(optimizer): update tests for async pool-based buildResults"
```

---

### Task 6: Measure performance, update budgets, document Phase 2 results

**Files:**
- Modify: `src/lib/optimizer/query.performance.test.ts` (only if budgets need adjusting - see
  Step 2)
- Modify: `docs/plans/2026-06-15-optimizer-worker-thread-pool-design.md`

**Step 1: Run the performance tests and record timings**

Run: `npx vitest run src/lib/optimizer/query.performance.test.ts --root . --reporter=verbose`

Record the three timings. Compare against the Phase 1 numbers (from
`docs/plans/2026-06-15-deficit-sum-mod-filter-design.md`'s "Phase 1 Results"):

```
loose thresholds (all zero):  ~1300ms (Phase 1)
strict thresholds:             ~1100ms (Phase 1)
tunedCount=4-heavy fixture:    ~2500ms (Phase 1)
```

Pool dispatch overhead (worker startup, message passing) may make small fixtures *slower* in
absolute terms even though more combos are explored for `tunedCount=4/5` - this is expected and
acceptable as long as the existing budgets (`PERFORMANCE_BUDGET_MS = 4000`,
`HEAVY_PERFORMANCE_BUDGET_MS = 6000`) still pass.

**Step 2: Adjust budgets only if needed**

If a test now fails its budget, increase the relevant `*_BUDGET_MS` constant in
`query.performance.test.ts` with an updated comment explaining the new number (following the
existing comment style at lines 9-13 and 15-28), but do not increase budgets beyond what's needed
to pass with reasonable headroom (similar margin to the existing ~2x headroom).

**Step 3: Verify the heavy fixture explores more combos**

The `tunedCount=4`-heavy fixture (`buildHeavyCandidates`, all 4 non-exotic slots tuned, so
`combos[4].length = 35` at `topK=5`) should now have `maxCombos ~= 14` (at `poolSize=8`) instead
of 1. Add a temporary `console.log` or a dedicated assertion in the heavy-fixture test verifying
more than one distinct `helmet`/slot item appears across `results` (showing more than 1 combo
contributed to the output) - if `poolSize` on the test machine isn't 8, adjust the expected
`maxCombos` figure accordingly using `getOptimizerPoolSize()`.

**Step 4: Append "Phase 2 Results" to the design doc**

Append to `docs/plans/2026-06-15-optimizer-worker-thread-pool-design.md`:

```markdown
## Phase 2 Results

Measured via `npx vitest run src/lib/optimizer/query.performance.test.ts --root . --reporter=verbose`
on a machine with `getOptimizerPoolSize() = <N>`:

| Test                          | Phase 1 | Phase 2     |
|--------------------------------|---------|-------------|
| loose thresholds (all zero)    | ~1300ms | <measured>ms |
| strict thresholds               | ~1100ms | <measured>ms |
| tunedCount=4-heavy fixture       | ~2500ms | <measured>ms |

`tunedCount=4`'s per-bucket combo cap rose from 1 to `<maxCombos>` (at `poolSize=<N>`), per the
`ITER_BUDGET * poolSize` formula. <Describe whether/how this changed the heavy fixture's results -
e.g. "results now draw from <N> distinct combos instead of 1".>

**Outcome vs. the Phase 1 decision gate:** <state whether tunedCount=4/5 still collapse to fewer
combos than realistic inventories would produce, and if so, by how much - this determines whether
a future Phase 3 (e.g. raising MAX_WORKERS, or further reducing perComboCost) is warranted>.
```

**Step 5: Commit**

```bash
git add docs/plans/2026-06-15-optimizer-worker-thread-pool-design.md src/lib/optimizer/query.performance.test.ts
git commit -m "docs(optimizer): record phase 2 worker pool measurements"
```
