# Optimizer Stat Headroom ("Shadow Max") + Slider Prettify Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show each threshold slider's "headroom" - the highest each stat reaches among
loadouts that satisfy all current thresholds - as a shaded zone, and restyle the
sliders with a custom layered track.

**Architecture:** `buildResults` tracks a per-stat running max across all
threshold-passing `(combo, adj, mod)` candidates (a free byproduct of its existing
loop) and returns it alongside `results` as `maxStats: StatVector | null`.
`computeOptimizerQuery` carries this through its topK-widening loop. The API route,
client state, and a new `ThresholdSlider` component plumb `maxStats` down to render a
three-zone track: filled (0 to current threshold), shadow/headroom (threshold to
`maxStats[stat]`), and base/unreachable (`maxStats[stat]` to 200).

**Tech Stack:** TypeScript, Next.js App Router, Vitest, Tailwind CSS v4.

**Design doc:** `docs/plans/2026-06-14-optimizer-stat-headroom-design.md`

---

### Task 1: Track and return `maxStats` from `buildResults` and `computeOptimizerQuery`

**Files:**
- Modify: `src/lib/optimizer/query.ts`
- Modify: `src/lib/optimizer/query.test.ts`

**Context:** `buildResults` (query.ts:142-215) iterates every `(combo, adj, mod)`
candidate, checks `meetsThresholds`, and (if it passes) considers it for the
tier-deduped `best` map. `sumValues` (an `Int32Array`, one entry per stat in
`ARMOR_STAT_ORDER` order) is fully populated for every candidate that passes
`meetsThresholds` - exactly the candidates we want to track maxes over. Add a running
per-stat max (`maxStatValues`, an `Int32Array` initialized to `Int32Array`'s minimum
value so any real value - which per the `TIER_KEY_OFFSET` comment is always within
`[-150, 450]` - overwrites it) and a `hasPassingCandidate` boolean. Update both inside
the existing `if (!meetsThresholds) continue;` guard.

`computeOptimizerQuery` (query.ts:222-258) currently returns `OptimizerResult[]`
directly from its topK-widening `while` loop. Change it to carry the full
`{ results, maxStats }` object returned by `buildResults` through the loop instead of
just `results`.

**Step 1: Update existing tests to match the new return shape (red)**

In `src/lib/optimizer/query.test.ts`:

1. In the top-level `describe("computeOptimizerQuery", ...)` block, every test currently
   does `const results = computeOptimizerQuery(...)`. Change each to:
   ```typescript
   const { results } = computeOptimizerQuery(...);
   ```
   (6 call sites: "locks the exotic...", "returns an empty array...", "filters out
   combinations...", "sorts results by optimizeFor...", "tier-dedups results...",
   "widens topK...". For "returns an empty array when a non-exotic slot has no
   candidates", also change the assertion from `expect(results).toEqual([])` to
   `expect(results).toEqual([])` - unchanged, just destructure first.)

2. In `describe("buildResults: per-tunedCount-bucket combo cap", ...)`, both tests
   currently do `const results = buildResults(frontier, {...})`. Change each to:
   ```typescript
   const { results } = buildResults(frontier, {...});
   ```
   (The `elapsed`/`Date.now()` timing wrapper in the second test stays around the
   `buildResults` call itself, only the destructuring changes.)

**Step 2: Run tests to verify they fail with a clear type/shape error**

Run: `npm test -- --run query.test.ts`
Expected: FAIL - `results.length` / `results[0]` / `results.map` etc. are now
`undefined` (or TS errors if running `tsc`), because `buildResults`/
`computeOptimizerQuery` still return a bare array, not `{ results, maxStats }`.

**Step 3: Add new tests for `maxStats`**

Add a new `describe` block in `query.test.ts`, after the existing
`describe("buildResults: per-tunedCount-bucket combo cap", ...)` block:

```typescript
describe("buildResults: maxStats (per-stat headroom)", () => {
  /** A single tunedCount=0 combo with the given base stats and no tuning. */
  function makeZeroTuningCombo(stats: ArmorStats): ItemCombination {
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
    return {
      choices: { helmet: { item, stats, hasTuning: false } },
      stats,
      tunedCount: 0,
    };
  }

  function frontierWithCombo(stats: ArmorStats): ItemCombination[][] {
    const frontier: ItemCombination[][] = Array.from({ length: MAX_TUNED_SLOTS + 1 }, () => []);
    frontier[0] = [makeZeroTuningCombo(stats)];
    return frontier;
  }

  it("returns maxStats: null when no candidate passes the thresholds", () => {
    // Base stats are all 0; the mod-delta set adds at most 50 to any single stat, so a
    // threshold of 60 on any stat is unreachable.
    const frontier = frontierWithCombo(zeroVector());
    const thresholds = { ...zeroVector(), resilience: 60 };

    const { results, maxStats } = buildResults(frontier, { thresholds, optimizeFor: "mobility" });

    expect(results).toEqual([]);
    expect(maxStats).toBeNull();
  });

  it("tracks each stat's max across all threshold-passing candidates, beyond what the top results show", () => {
    // Base stats are all 0; with zero thresholds every one of the 252 mod-delta
    // combinations passes. The mod-delta set's frontier includes a vector that puts all
    // 5 "+10" tokens on a single stat (value 50), for every stat - so maxStats for each
    // stat should be 50, even though no single result maximizes every stat at once.
    const frontier = frontierWithCombo(zeroVector());

    const { results, maxStats } = buildResults(frontier, { thresholds: zeroVector(), optimizeFor: "mobility" });

    expect(maxStats).not.toBeNull();
    for (const stat of ARMOR_STAT_ORDER) {
      expect(maxStats![stat]).toBe(50);
    }

    // The best (optimizeFor=mobility) result maximizes mobility at the expense of other
    // stats - demonstrating maxStats.resilience (50) exceeds results[0].stats.resilience.
    expect(results[0].stats.mobility).toBe(50);
    expect(results[0].stats.resilience).toBeLessThan(maxStats!.resilience);
  });
});
```

This requires `ArmorStats` to already be imported in `query.test.ts` (it is, on line 2).

**Step 4: Run tests to verify the new tests fail**

Run: `npm test -- --run query.test.ts`
Expected: FAIL - `maxStats` is `undefined` (destructured from a plain array), so
`expect(maxStats).toBeNull()` and `expect(maxStats).not.toBeNull()` both fail, and
`maxStats![stat]` throws.

**Step 5: Implement `maxStats` tracking in `buildResults`**

In `src/lib/optimizer/query.ts`:

1. Add a new exported interface after `OptimizerResult` (after line 24):
   ```typescript
   export interface OptimizerQueryResult {
     results: OptimizerResult[];
     maxStats: StatVector | null;
   }
   ```

2. Change `buildResults`'s signature (line 142) from:
   ```typescript
   export function buildResults(itemSelectionFrontier: ItemCombination[][], query: OptimizerQuery): OptimizerResult[] {
   ```
   to:
   ```typescript
   export function buildResults(itemSelectionFrontier: ItemCombination[][], query: OptimizerQuery): OptimizerQueryResult {
   ```

3. After the existing accumulator declarations (around line 157-159):
   ```typescript
   const best = new Map<number, BestEntry>();
   const baseValues = new Int32Array(statCount);
   const sumValues = new Int32Array(statCount);
   ```
   add:
   ```typescript
   // Per-stat running max across every candidate that passes `meetsThresholds` - the
   // "headroom" each stat could reach without violating any current threshold. Seeded
   // with Int32Array's minimum so the first passing candidate always overwrites it; real
   // values are always within [-150, 450] per the TIER_KEY_OFFSET/TIER_KEY_RADIX comment.
   const maxStatValues = new Int32Array(statCount).fill(-2_147_483_648);
   let hasPassingCandidate = false;
   ```

4. Inside the innermost loop, immediately after `if (!meetsThresholds) continue;`
   (around line 196), add:
   ```typescript
   hasPassingCandidate = true;
   for (let i = 0; i < statCount; i++) {
     if (sumValues[i] > maxStatValues[i]) {
       maxStatValues[i] = sumValues[i];
     }
   }
   ```

5. Change the `return` statement (lines 211-214) from:
   ```typescript
   return [...best.values()]
     .sort((a, b) => b.stats[query.optimizeFor] - a.stats[query.optimizeFor])
     .slice(0, RESULT_LIMIT)
     .map((entry) => ({ stats: entry.stats, loadout: buildLoadout(entry.combo.choices, entry.adj.tuningAssignment) }));
   ```
   to:
   ```typescript
   const results = [...best.values()]
     .sort((a, b) => b.stats[query.optimizeFor] - a.stats[query.optimizeFor])
     .slice(0, RESULT_LIMIT)
     .map((entry) => ({ stats: entry.stats, loadout: buildLoadout(entry.combo.choices, entry.adj.tuningAssignment) }));

   const maxStats = hasPassingCandidate
     ? ARMOR_STAT_ORDER.reduce((acc, stat, i) => {
         acc[stat] = maxStatValues[i];
         return acc;
       }, zeroVector())
     : null;

   return { results, maxStats };
   ```

**Step 6: Update `computeOptimizerQuery` to carry `maxStats` through**

In `src/lib/optimizer/query.ts`, change `computeOptimizerQuery` (lines 222-258):

1. Change its return type (line 226) from `): OptimizerResult[] {` to
   `): OptimizerQueryResult {`.

2. Change the early-return for missing candidates (line 235) from:
   ```typescript
       if (!items || items.length === 0) {
         return [];
       }
   ```
   to:
   ```typescript
       if (!items || items.length === 0) {
         return { results: [], maxStats: null };
       }
   ```

3. Change the topK-widening loop (lines 242-257) from:
   ```typescript
     let topK = Math.min(INITIAL_TOP_K, maxAvailable);
     let results: OptimizerResult[] = [];

     while (true) {
       const itemsBySlot = sliceTopK(rankedBySlot, exotic, topK);
       const itemSelectionFrontier = selectItemCombinations(itemsBySlot);
       results = buildResults(itemSelectionFrontier, query);

       if (results.length >= RESULT_LIMIT || topK >= maxAvailable) {
         break;
       }

       topK = Math.min(topK * 2, maxAvailable);
     }

     return results;
   ```
   to:
   ```typescript
     let topK = Math.min(INITIAL_TOP_K, maxAvailable);
     let output: OptimizerQueryResult = { results: [], maxStats: null };

     while (true) {
       const itemsBySlot = sliceTopK(rankedBySlot, exotic, topK);
       const itemSelectionFrontier = selectItemCombinations(itemsBySlot);
       output = buildResults(itemSelectionFrontier, query);

       if (output.results.length >= RESULT_LIMIT || topK >= maxAvailable) {
         break;
       }

       topK = Math.min(topK * 2, maxAvailable);
     }

     return output;
   ```

**Step 7: Run tests to verify everything passes**

Run: `npm test -- --run`
Expected: PASS - all tests in `query.test.ts` (and the rest of the suite) pass.

**Step 8: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean.

**Step 9: Commit**

```bash
git add src/lib/optimizer/query.ts src/lib/optimizer/query.test.ts
git commit -m "feat(optimizer): track per-stat headroom (maxStats) in buildResults"
```

---

### Task 2: Plumb `maxStats` through `index.ts` and the API route

**Files:**
- Modify: `src/lib/optimizer/index.ts`
- Modify: `src/app/api/optimizer/compute/route.ts`

**Context:** `index.ts` re-exports the optimizer's public types/functions for use by
the API route and components. The route currently returns `{ results }`; it should now
also return `maxStats`.

**Step 1: Export `OptimizerQueryResult` from `index.ts`**

In `src/lib/optimizer/index.ts`, add `OptimizerQueryResult` to the existing type
re-export line. Change:
```typescript
export type { OptimizerQuery, OptimizerResult, SlotChoice } from "./query";
```
to:
```typescript
export type { OptimizerQuery, OptimizerQueryResult, OptimizerResult, SlotChoice } from "./query";
```

**Step 2: Update the API route to return `maxStats`**

In `src/app/api/optimizer/compute/route.ts`, change the final two lines from:
```typescript
  const candidatesBySlot = buildCandidatesBySlot(inventory, exotic);
  const results = computeOptimizerQuery(exotic, candidatesBySlot, { thresholds, optimizeFor });

  return NextResponse.json({ results });
```
to:
```typescript
  const candidatesBySlot = buildCandidatesBySlot(inventory, exotic);
  const { results, maxStats } = computeOptimizerQuery(exotic, candidatesBySlot, { thresholds, optimizeFor });

  return NextResponse.json({ results, maxStats });
```

**Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean. (No test file changes in this task - `index.ts` and the API
route have no dedicated unit tests; correctness here is covered by Task 1's tests plus
Task 6's full-suite/manual verification.)

**Step 4: Commit**

```bash
git add src/lib/optimizer/index.ts src/app/api/optimizer/compute/route.ts
git commit -m "feat(optimizer): return maxStats from the compute API route"
```

---

### Task 3: Add `maxStats` state to `OptimizerClient`

**Files:**
- Modify: `src/components/optimizer/OptimizerClient.tsx`

**Context:** `OptimizerClient` holds `results`, `thresholds`, `optimizeFor`, etc. as
state, fetches `/api/optimizer/compute` in `runQuery`, and resets state when the exotic
or class changes. Add `maxStats: ArmorStats | null` alongside `results`, updated from
the same response and reset in the same places `results` is reset.

**Step 1: Add the `maxStats` state**

In `src/components/optimizer/OptimizerClient.tsx`, after the `results` state
declaration (line 35):
```typescript
  const [results, setResults] = useState<OptimizerResult[]>([]);
```
add:
```typescript
  const [maxStats, setMaxStats] = useState<ArmorStats | null>(null);
```

**Step 2: Parse and store `maxStats` from the response**

Change the response-handling block in `runQuery` (lines 60-63) from:
```typescript
      const data = (await response.json()) as { results: OptimizerResult[] };
      if (requestIdRef.current !== requestId) return;
      setResults(data.results);
      setStatus("idle");
```
to:
```typescript
      const data = (await response.json()) as { results: OptimizerResult[]; maxStats: ArmorStats | null };
      if (requestIdRef.current !== requestId) return;
      setResults(data.results);
      setMaxStats(data.maxStats);
      setStatus("idle");
```

**Step 3: Reset `maxStats` alongside `results`**

In `handleSelectExotic` (lines 80-86), change:
```typescript
  function handleSelectExotic(item: ArmorItem) {
    requestIdRef.current += 1;
    setSelectedExotic(item);
    setResults([]);
    setThresholds(zeroThresholds());
    setOptimizeFor(ARMOR_STAT_ORDER[0]);
  }
```
to:
```typescript
  function handleSelectExotic(item: ArmorItem) {
    requestIdRef.current += 1;
    setSelectedExotic(item);
    setResults([]);
    setMaxStats(null);
    setThresholds(zeroThresholds());
    setOptimizeFor(ARMOR_STAT_ORDER[0]);
  }
```

In the `onSelectClassType` handler inside the JSX (lines 93-99), change:
```typescript
        onSelectClassType={(next) => {
          requestIdRef.current += 1;
          setClassType(next);
          setSelectedExotic(null);
          setResults([]);
          setStatus("idle");
        }}
```
to:
```typescript
        onSelectClassType={(next) => {
          requestIdRef.current += 1;
          setClassType(next);
          setSelectedExotic(null);
          setResults([]);
          setMaxStats(null);
          setStatus("idle");
        }}
```

**Step 4: Pass `maxStats` to `OptimizerControls`**

In the JSX, change the `<OptimizerControls ... />` call (lines 106-112) from:
```typescript
          <OptimizerControls
            thresholds={thresholds}
            onThresholdChange={(stat, value) => setThresholds((prev) => ({ ...prev, [stat]: value }))}
            optimizeFor={optimizeFor}
            onOptimizeForChange={setOptimizeFor}
            statIcons={statIcons}
          />
```
to:
```typescript
          <OptimizerControls
            thresholds={thresholds}
            onThresholdChange={(stat, value) => setThresholds((prev) => ({ ...prev, [stat]: value }))}
            optimizeFor={optimizeFor}
            onOptimizeForChange={setOptimizeFor}
            statIcons={statIcons}
            maxStats={maxStats}
          />
```

This will cause a type error until Task 5 adds the `maxStats` prop to
`OptimizerControlsProps` - that's expected and resolved in Task 5. `ArmorStats` is
already imported in this file (line 4).

**Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: FAIL - `Property 'maxStats' does not exist on type 'OptimizerControlsProps'`.
This is the expected, temporary state until Task 5. Do not attempt to fix it here.

**Step 6: Commit**

```bash
git add src/components/optimizer/OptimizerClient.tsx
git commit -m "feat(optimizer): add maxStats state to OptimizerClient"
```

Note: this commit intentionally leaves the build in a type-error state (Task 5 fixes
it in the same session, immediately after). If you need a clean intermediate state,
combine this task's changes with Task 5's into a single commit instead - but keep them
as separate implementation steps for review clarity.

---

### Task 4: Create the `ThresholdSlider` component and its styling

**Files:**
- Create: `src/components/optimizer/ThresholdSlider.tsx`
- Modify: `src/app/globals.css`

**Context:** This replaces the plain `<input type="range">` currently inline in
`OptimizerControls` (see Task 5) with a custom three-zone track: filled (0 to
`value`), shadow/headroom (`value` to `shadowMax`, if any), and base track (the rest,
up to `max`). The native range input is overlaid transparently on top so its thumb
remains the interactive element; `globals.css` strips the native track and restyles
the thumb to match the theme's accent color (`--color-arc`).

**Step 1: Create `ThresholdSlider.tsx`**

```typescript
"use client";

import { cn } from "@/lib/utils/cn";

interface ThresholdSliderProps {
  value: number;
  max: number;
  step: number;
  shadowMax: number | null;
  onChange: (value: number) => void;
  ariaLabel: string;
  highlighted: boolean;
}

function clampPct(pct: number): number {
  return Math.min(100, Math.max(0, pct));
}

export function ThresholdSlider({ value, max, step, shadowMax, onChange, ariaLabel, highlighted }: ThresholdSliderProps) {
  const valuePct = clampPct((value / max) * 100);
  const shadowPct = shadowMax !== null ? clampPct((shadowMax / max) * 100) : null;
  const showShadow = shadowPct !== null && shadowPct > valuePct;

  return (
    <div className="relative h-2 w-full">
      <div className="absolute inset-0 rounded-full bg-panel-raised" />
      {showShadow && (
        <div
          className="absolute inset-y-0 rounded-full bg-arc/20"
          style={{ left: `${valuePct}%`, width: `${shadowPct! - valuePct}%` }}
        />
      )}
      <div
        className={cn("absolute inset-y-0 left-0 rounded-full bg-arc", highlighted && "glow-arc")}
        style={{ width: `${valuePct}%` }}
      />
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={ariaLabel}
        className="threshold-slider absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent"
      />
    </div>
  );
}
```

**Step 2: Add thumb/track styling to `globals.css`**

Append to `src/app/globals.css`:

```css
.threshold-slider {
  --thumb-size: 14px;
}

.threshold-slider::-webkit-slider-runnable-track {
  background: transparent;
}

.threshold-slider::-moz-range-track {
  background: transparent;
}

.threshold-slider::-webkit-slider-thumb {
  appearance: none;
  width: var(--thumb-size);
  height: var(--thumb-size);
  border-radius: 50%;
  background: var(--color-arc);
  border: 2px solid var(--color-panel);
  cursor: pointer;
  transition: box-shadow 0.15s ease;
}

.threshold-slider::-moz-range-thumb {
  width: var(--thumb-size);
  height: var(--thumb-size);
  border-radius: 50%;
  background: var(--color-arc);
  border: 2px solid var(--color-panel);
  cursor: pointer;
  transition: box-shadow 0.15s ease;
}

.threshold-slider:hover::-webkit-slider-thumb,
.threshold-slider:focus-visible::-webkit-slider-thumb,
.threshold-slider:hover::-moz-range-thumb,
.threshold-slider:focus-visible::-moz-range-thumb {
  box-shadow: 0 0 12px 1px rgba(111, 198, 232, 0.6);
}
```

This mirrors the existing `.glow-arc` utility's color/spread for consistency.

**Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean. (`ThresholdSlider` is not yet imported anywhere, so it's dead
code until Task 5 - this is fine, ESLint's `no-unused-vars` doesn't flag unused
exports.)

**Step 4: Commit**

```bash
git add src/components/optimizer/ThresholdSlider.tsx src/app/globals.css
git commit -m "feat(optimizer): add ThresholdSlider component with headroom shadow"
```

---

### Task 5: Wire `ThresholdSlider` into `OptimizerControls`

**Files:**
- Modify: `src/components/optimizer/OptimizerControls.tsx`

**Context:** `OptimizerControls` currently renders a plain `<input type="range">` per
stat inline (lines 59-69), with the icon/label/value around it. Replace the range
input with `<ThresholdSlider>`, passing `shadowMax={maxStats?.[stat] ?? null}` and
`highlighted={stat === optimizeFor}`. This also resolves the type error left by Task 3.

**Step 1: Add the `maxStats` prop and import `ThresholdSlider`**

In `src/components/optimizer/OptimizerControls.tsx`:

1. Add the import (after line 6):
   ```typescript
   import { ThresholdSlider } from "./ThresholdSlider";
   ```

2. Add `maxStats` to `OptimizerControlsProps` (after line 13):
   ```typescript
   interface OptimizerControlsProps {
     thresholds: ArmorStats;
     onThresholdChange: (stat: ArmorStatName, value: number) => void;
     optimizeFor: ArmorStatName;
     onOptimizeForChange: (stat: ArmorStatName) => void;
     statIcons: Record<ArmorStatName, string>;
     maxStats: ArmorStats | null;
   }
   ```

3. Destructure it in the function signature (line 16-22):
   ```typescript
   export function OptimizerControls({
     thresholds,
     onThresholdChange,
     optimizeFor,
     onOptimizeForChange,
     statIcons,
     maxStats,
   }: OptimizerControlsProps) {
   ```

**Step 2: Replace the inline `<input type="range">` with `<ThresholdSlider>`**

Change the per-stat row (lines 44-71) from:
```typescript
        {ARMOR_STAT_ORDER.map((stat) => (
          <div key={stat} className="flex items-center gap-2">
            {statIcons[stat] && (
              <div className="relative h-5 w-5 shrink-0">
                <Image src={`https://www.bungie.net${statIcons[stat]}`} alt="" fill className="object-contain" />
              </div>
            )}
            <span
              className={cn(
                "w-20 shrink-0 text-xs uppercase tracking-wider",
                stat === optimizeFor ? "text-arc" : "text-foreground/60"
              )}
            >
              {ARMOR_STAT_LABELS[stat]}
            </span>
            <input
              type="range"
              min={0}
              max={OPTIMIZER_STAT_MAX}
              step={OPTIMIZER_STAT_STEP}
              value={thresholds[stat]}
              onChange={(e) => onThresholdChange(stat, Number(e.target.value))}
              aria-label={`${ARMOR_STAT_LABELS[stat]} threshold`}
              className="flex-1"
            />
            <span className="w-10 shrink-0 text-right text-xs tabular-nums">{thresholds[stat]}</span>
          </div>
        ))}
```
to:
```typescript
        {ARMOR_STAT_ORDER.map((stat) => (
          <div key={stat} className="flex items-center gap-2">
            {statIcons[stat] && (
              <div className="relative h-5 w-5 shrink-0">
                <Image src={`https://www.bungie.net${statIcons[stat]}`} alt="" fill className="object-contain" />
              </div>
            )}
            <span
              className={cn(
                "w-20 shrink-0 text-xs uppercase tracking-wider",
                stat === optimizeFor ? "text-arc" : "text-foreground/60"
              )}
            >
              {ARMOR_STAT_LABELS[stat]}
            </span>
            <div className="flex-1">
              <ThresholdSlider
                value={thresholds[stat]}
                max={OPTIMIZER_STAT_MAX}
                step={OPTIMIZER_STAT_STEP}
                shadowMax={maxStats?.[stat] ?? null}
                onChange={(value) => onThresholdChange(stat, value)}
                ariaLabel={`${ARMOR_STAT_LABELS[stat]} threshold`}
                highlighted={stat === optimizeFor}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-xs tabular-nums">{thresholds[stat]}</span>
          </div>
        ))}
```

**Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean - the type error left by Task 3 is now resolved.

**Step 4: Run the full test suite**

Run: `npm test -- --run`
Expected: PASS - all backend tests still pass (no logic in `lib/optimizer` changed in
this task).

**Step 5: Commit**

```bash
git add src/components/optimizer/OptimizerControls.tsx
git commit -m "feat(optimizer): use ThresholdSlider with headroom shadow in OptimizerControls"
```

---

### Task 6: Full verification and manual e2e

**Files:** none (verification only)

**Step 1: Full automated check**

Run: `npm test -- --run && npm run lint && npx tsc --noEmit`
Expected: all clean (47 passed / 1 skipped, as before Task 1 - Task 1 added 2 new
tests, so expect 49 passed / 1 skipped).

**Step 2: Production build**

Run: `npm run build`
Expected: build succeeds with no type errors.

**Step 3: Manual e2e via browser**

The dev server should already be running and reachable at the ngrok URL
(`https://evenly-deep-terrapin.ngrok-free.app/optimizer` per `.env.local`'s
`NEXT_PUBLIC_APP_URL`). If not, start it with `npm run dev` in the background.

Using the Playwright MCP tools, navigate to `/optimizer` and verify:

1. **Visual**: each of the 6 sliders renders the new layered track (filled zone in
   accent color from 0 to the current threshold, no shadow zone yet since
   `maxStats` is `null` before the first query).
2. **Shadow appears after a query**: select an exotic (any Hunter/Titan/Warlock
   exotic with armor in the vault/characters). After the debounced query resolves,
   confirm at least one slider shows a visibly lighter "headroom" zone extending past
   its current value (most sliders start at threshold=0, so the shadow should span
   from 0 to that stat's `maxStats` value).
3. **Shadow updates on threshold change**: raise one slider's threshold partway (e.g.
   to 60). After the debounced re-query, confirm:
   - The filled zone grows to match the new value.
   - The shadow zone (if present) starts at the new value and reflects the updated
     `maxStats` for that stat.
4. **Empty state hides shadows**: raise a threshold to an impossible value (e.g. 200)
   so the results list shows "No combination meets the current thresholds...". Confirm
   the sliders no longer show a shadow zone (since `maxStats` is `null` when `results`
   is empty) - the filled zone (0 to 200) should still render, just with no shadow
   beyond it.
5. **Exotic switching resets shadows**: select a different exotic and confirm
   `maxStats` resets (no shadow zones until the new query resolves), alongside the
   existing threshold/optimizeFor reset.

**Step 4: No commit for this task** (verification only - if any issue is found, fix it
as part of the relevant earlier task and re-run this task's checks).
