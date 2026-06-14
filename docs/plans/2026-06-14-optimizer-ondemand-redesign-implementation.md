# Optimizer On-Demand Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the broken `combineSlots`/`computeOptimizerResults` optimizer pipeline with an
on-demand, query-based pipeline (`computeOptimizerQuery`) that ranks candidates per slot, combines
a top-K slice grouped by tuned-item count, crosses each group with a lazily-cached tuning-adjustment
frontier and the 252-entry mod-delta set, filters by per-stat thresholds, tier-dedups, sorts by
`optimizeFor`, and widens K if too few results survive — producing the same `OptimizerResult[]`
shape as before.

**Architecture:** New `adjustment-frontier.ts` builds `getTuningAdjustmentFrontier(k)` for k=0..5,
each k cached independently and lazily (k=5 costs ~20s, so it's only built if a query actually
needs it). `combine.ts` is rewritten around `selectItemCombinations`, which cartesian-combines a
top-K slice per slot and Pareto-prunes separately per tuned-count bucket (0..5). New `query.ts`
owns `computeOptimizerQuery`: ranking, the top-K widening loop, crossing with adjustment frontiers
and mod deltas, threshold filtering, tier-dedup, and sorting. `index.ts` becomes a thin re-export.
The route and client are updated to pass `thresholds`/`optimizeFor` through and debounce re-queries.

**Tech Stack:** TypeScript, Next.js App Router, Vitest (`npm test` = `vitest run`), ESLint flat
config (`npm run lint`).

---

## Reference: shared types and helpers (unchanged, already in the codebase)

- `src/lib/armor/types.ts`: `ArmorStatName`, `ArmorStats`, `ArmorSlot`, `ARMOR_BUCKET_HASHES`,
  `ArmorItem` (has `gearTier: number | undefined`, `slot`, `stats`, `tuning`).
- `src/lib/armor/tuning.ts`: `ArmorTuning` (`{kind:"directional",...} | {kind:"balanced"} |
  {kind:"empty"} | {kind:"none"}`).
- `src/styles/theme.ts`: `ARMOR_STAT_ORDER: ArmorStatName[]` (6 stats, canonical order).
- `src/lib/optimizer/vectors.ts`: `StatVector = ArmorStats`, `zeroVector()`, `addVectors`,
  `subtractVectors`, `vectorKey`, `dedupeByStats<T extends {stats: StatVector}>`.
- `src/lib/optimizer/pareto.ts`: `dominates(a,b)`, `paretoFrontier<T extends {stats: StatVector}>`.
- `src/lib/optimizer/tuning-variants.ts`: `tuningDeltas(): Array<{tuning: ArmorTuning, delta:
  StatVector}>` (32 entries: 1 empty/zero, 1 balanced/+1-all, 30 directional ±5 pairs);
  `tuningDeltaVector(tuning): StatVector`.
- `src/lib/optimizer/mod-deltas.ts`: `getModDeltaSet(): StatVector[]` (cached 252-vector exact
  mod-delta set).

None of these files need to change in this plan.

---

### Task 1: `adjustment-frontier.ts` — lazy per-k tuning-adjustment frontier

**Files:**
- Create: `src/lib/optimizer/adjustment-frontier.ts`
- Test: `src/lib/optimizer/adjustment-frontier.test.ts`

**Background:** `getTuningAdjustmentFrontier(k)` is the Pareto frontier of stat-vector sums from
choosing `k` independent picks from the 32-entry `tuningDeltas()` menu, paired with the sequence of
tuning choices (`tuningAssignment`) that produced each sum. Measured sizes: k=0 → 1, k=1 → 31,
k=2 → 271, k=3 → 1281, k=4 → 4251, k=5 → 11247. Building k=5 from scratch takes ~20s (Pareto-pruning
~4251 × 32 raw combinations), so each k is cached **independently and lazily** — a query that never
needs k=5 (most queries) never pays that cost. Because k's frontier is built from k-1's frontier,
requesting k directly recursively builds and caches 1..k as needed.

**Step 1: Write the failing test**

```typescript
// src/lib/optimizer/adjustment-frontier.test.ts
import { describe, it, expect } from "vitest";
import { getTuningAdjustmentFrontier, MAX_TUNED_SLOTS } from "./adjustment-frontier";
import { zeroVector } from "./vectors";

describe("getTuningAdjustmentFrontier", () => {
  it("k=0 is a single zero-stat entry with an empty tuning assignment", () => {
    const frontier = getTuningAdjustmentFrontier(0);
    expect(frontier).toHaveLength(1);
    expect(frontier[0].stats).toEqual(zeroVector());
    expect(frontier[0].tuningAssignment).toEqual([]);
  });

  it("k=1 has 31 entries, each with a single tuning assignment", () => {
    const frontier = getTuningAdjustmentFrontier(1);
    expect(frontier).toHaveLength(31);
    for (const entry of frontier) {
      expect(entry.tuningAssignment).toHaveLength(1);
    }
  });

  it("k=2 has 271 entries, each with two tuning assignments", () => {
    const frontier = getTuningAdjustmentFrontier(2);
    expect(frontier).toHaveLength(271);
    for (const entry of frontier) {
      expect(entry.tuningAssignment).toHaveLength(2);
    }
  });

  it("k=3 has 1281 entries, each with three tuning assignments", () => {
    const frontier = getTuningAdjustmentFrontier(3);
    expect(frontier).toHaveLength(1281);
    for (const entry of frontier) {
      expect(entry.tuningAssignment).toHaveLength(3);
    }
  });

  it("is memoized across calls", () => {
    expect(getTuningAdjustmentFrontier(2)).toBe(getTuningAdjustmentFrontier(2));
  });

  it("throws for out-of-range k", () => {
    expect(() => getTuningAdjustmentFrontier(-1)).toThrow();
    expect(() => getTuningAdjustmentFrontier(MAX_TUNED_SLOTS + 1)).toThrow();
  });

  // Building k=4/k=5 from scratch takes ~20s (Pareto-pruning ~4251 x 32 raw combinations at k=5).
  // Skipped by default to keep `npm test` fast; remove `.skip` to verify these sizes manually.
  it.skip("k=4 and k=5 have the measured sizes (slow, ~20s)", () => {
    expect(getTuningAdjustmentFrontier(4)).toHaveLength(4251);
    expect(getTuningAdjustmentFrontier(5)).toHaveLength(11247);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- adjustment-frontier`
Expected: FAIL — `Cannot find module './adjustment-frontier'` (file doesn't exist yet).

**Step 3: Write the implementation**

```typescript
// src/lib/optimizer/adjustment-frontier.ts
import type { ArmorTuning } from "@/lib/armor/tuning";
import { tuningDeltas } from "./tuning-variants";
import { paretoFrontier } from "./pareto";
import { addVectors, dedupeByStats, zeroVector, type StatVector } from "./vectors";

/** A loadout has exactly 5 armor slots, so at most 5 items can have a tuning socket. */
export const MAX_TUNED_SLOTS = 5;

export interface TuningAdjustment {
  stats: StatVector;
  tuningAssignment: ArmorTuning[];
}

const cachedFrontiers: (TuningAdjustment[] | undefined)[] = new Array(MAX_TUNED_SLOTS + 1);

/**
 * The Pareto frontier of stat-vector sums from choosing `tunedSlots` independent picks from the
 * 32-entry `tuningDeltas()` menu, paired with the tuning choices that produced each sum.
 *
 * Each k is cached independently and lazily: requesting k builds (and caches) 1..k as needed.
 * k=5 costs ~20s to build, so callers that never request it never pay that cost.
 */
export function getTuningAdjustmentFrontier(tunedSlots: number): TuningAdjustment[] {
  if (tunedSlots < 0 || tunedSlots > MAX_TUNED_SLOTS) {
    throw new RangeError(`tunedSlots must be between 0 and ${MAX_TUNED_SLOTS}, got ${tunedSlots}`);
  }

  const cached = cachedFrontiers[tunedSlots];
  if (cached) {
    return cached;
  }

  if (tunedSlots === 0) {
    const base: TuningAdjustment[] = [{ stats: zeroVector(), tuningAssignment: [] }];
    cachedFrontiers[0] = base;
    return base;
  }

  const previous = getTuningAdjustmentFrontier(tunedSlots - 1);
  const deltas = tuningDeltas();

  const next = paretoFrontier(
    dedupeByStats(
      previous.flatMap((prev) =>
        deltas.map((td) => ({
          stats: addVectors(prev.stats, td.delta),
          tuningAssignment: [...prev.tuningAssignment, td.tuning],
        }))
      )
    )
  );

  cachedFrontiers[tunedSlots] = next;
  return next;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- adjustment-frontier`
Expected: PASS (6 tests; the `it.skip` test is skipped).

**Step 5: Commit**

```bash
git add src/lib/optimizer/adjustment-frontier.ts src/lib/optimizer/adjustment-frontier.test.ts
git commit -m "feat(optimizer): add lazy per-k tuning-adjustment frontier"
```

---

### Task 2: Rewrite `combine.ts` — `selectItemCombinations`

**Files:**
- Modify (full rewrite): `src/lib/optimizer/combine.ts`
- Modify (full rewrite): `src/lib/optimizer/combine.test.ts`

**Background:** Replace `combineSlots`/`LoadoutCandidate`/old `SlotChoice` with
`selectItemCombinations`, which cartesian-combines one `SlotCandidate` per slot (across
`ALL_SLOTS`, moved here from `index.ts`) into `ItemCombination`s, grouping by `tunedCount` (the
number of chosen items with `item.gearTier === 5`, i.e. `hasTuning`). After each slot, each
`tunedCount` bucket (0..`MAX_TUNED_SLOTS`) is Pareto-pruned **separately**, since different buckets
are later crossed with different `getTuningAdjustmentFrontier(k)` frontiers and aren't directly
comparable.

**Step 1: Write the failing test**

```typescript
// src/lib/optimizer/combine.test.ts
import { describe, it, expect } from "vitest";
import type { ArmorItem, ArmorSlot, ArmorStats } from "@/lib/armor/types";
import { MAX_TUNED_SLOTS } from "./adjustment-frontier";
import { ALL_SLOTS, selectItemCombinations, type SlotCandidate } from "./combine";
import { zeroVector } from "./vectors";

function makeCandidate(slot: ArmorSlot, name: string, stats: ArmorStats, hasTuning = false): SlotCandidate {
  const item: ArmorItem = {
    itemInstanceId: name,
    itemHash: 0,
    name,
    icon: "",
    slot,
    tierType: 5,
    classType: 0,
    stats,
    tuning: { kind: "none" },
    power: 0,
    gearTier: hasTuning ? 5 : undefined,
    isMasterworked: true,
    location: "vault",
  };
  return { item, stats, hasTuning };
}

describe("selectItemCombinations", () => {
  it("sums stats across one choice per slot and groups by tunedCount", () => {
    const itemsBySlot: Partial<Record<ArmorSlot, SlotCandidate[]>> = {};
    for (const slot of ALL_SLOTS) {
      itemsBySlot[slot] = [makeCandidate(slot, `${slot}-a`, { ...zeroVector(), mobility: 10 })];
    }

    const buckets = selectItemCombinations(itemsBySlot);

    expect(buckets).toHaveLength(MAX_TUNED_SLOTS + 1);
    expect(buckets[0]).toHaveLength(1);
    expect(buckets[0][0].stats).toEqual({ ...zeroVector(), mobility: 50 });
    expect(buckets[0][0].tunedCount).toBe(0);
    for (let k = 1; k <= MAX_TUNED_SLOTS; k++) {
      expect(buckets[k]).toHaveLength(0);
    }
  });

  it("counts tunedCount from items with a tuning socket (hasTuning)", () => {
    const itemsBySlot: Partial<Record<ArmorSlot, SlotCandidate[]>> = {};
    for (const slot of ALL_SLOTS) {
      itemsBySlot[slot] = [makeCandidate(slot, `${slot}-a`, zeroVector(), slot === "helmet" || slot === "chest")];
    }

    const buckets = selectItemCombinations(itemsBySlot);

    expect(buckets[0]).toHaveLength(0);
    expect(buckets[2]).toHaveLength(1);
    expect(buckets[2][0].tunedCount).toBe(2);
  });

  it("prunes dominated combinations within each tunedCount bucket", () => {
    const itemsBySlot: Partial<Record<ArmorSlot, SlotCandidate[]>> = {
      helmet: [
        makeCandidate("helmet", "helmet-a", { ...zeroVector(), mobility: 10, resilience: 10 }),
        makeCandidate("helmet", "helmet-b", { ...zeroVector(), mobility: 10, resilience: 5 }),
      ],
    };
    for (const slot of ALL_SLOTS) {
      if (slot === "helmet") continue;
      itemsBySlot[slot] = [makeCandidate(slot, `${slot}-a`, zeroVector())];
    }

    const buckets = selectItemCombinations(itemsBySlot);

    // helmet-b is dominated by helmet-a in every combination, so only one survives.
    expect(buckets[0]).toHaveLength(1);
    expect(buckets[0][0].choices.helmet?.item.name).toBe("helmet-a");
  });

  it("returns all-empty buckets if any slot has no candidates", () => {
    const itemsBySlot: Partial<Record<ArmorSlot, SlotCandidate[]>> = {
      helmet: [makeCandidate("helmet", "helmet-a", zeroVector())],
      // other slots intentionally missing
    };

    const buckets = selectItemCombinations(itemsBySlot);

    expect(buckets).toHaveLength(MAX_TUNED_SLOTS + 1);
    for (const bucket of buckets) {
      expect(bucket).toHaveLength(0);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- combine`
Expected: FAIL — `selectItemCombinations`/`ALL_SLOTS`/`SlotCandidate` not exported from `./combine`
(current file exports `combineSlots`/`LoadoutCandidate`/old `SlotChoice`).

**Step 3: Write the implementation**

```typescript
// src/lib/optimizer/combine.ts
import { ARMOR_BUCKET_HASHES } from "@/lib/armor/types";
import type { ArmorItem, ArmorSlot } from "@/lib/armor/types";
import { MAX_TUNED_SLOTS } from "./adjustment-frontier";
import { paretoFrontier } from "./pareto";
import { addVectors, dedupeByStats, zeroVector, type StatVector } from "./vectors";

/** Canonical iteration order for the 5 armor slots. */
export const ALL_SLOTS = Object.keys(ARMOR_BUCKET_HASHES) as ArmorSlot[];

export interface SlotCandidate {
  item: ArmorItem;
  stats: StatVector;
  /** True if this item has a Tier 5 tuning socket (`item.gearTier === 5`). */
  hasTuning: boolean;
}

export interface ItemCombination {
  choices: Partial<Record<ArmorSlot, SlotCandidate>>;
  stats: StatVector;
  /** Number of chosen slots whose item has a tuning socket (0..MAX_TUNED_SLOTS). */
  tunedCount: number;
}

/**
 * Cartesian-combines one candidate per slot (from `itemsBySlot`, over `ALL_SLOTS`) into
 * `ItemCombination`s, grouped by `tunedCount`. After each slot, each `tunedCount` bucket is
 * Pareto-pruned separately, since different buckets are later crossed with different
 * tuning-adjustment frontiers and aren't directly comparable.
 *
 * Returns an array indexed by `tunedCount` (0..MAX_TUNED_SLOTS). If any slot has no candidates,
 * every bucket is empty.
 */
export function selectItemCombinations(
  itemsBySlot: Partial<Record<ArmorSlot, SlotCandidate[]>>
): ItemCombination[][] {
  let buckets: ItemCombination[][] = Array.from({ length: MAX_TUNED_SLOTS + 1 }, () => []);
  buckets[0] = [{ choices: {}, stats: zeroVector(), tunedCount: 0 }];

  for (const slot of ALL_SLOTS) {
    const candidates = itemsBySlot[slot];
    if (!candidates || candidates.length === 0) {
      return Array.from({ length: MAX_TUNED_SLOTS + 1 }, () => []);
    }

    const next: ItemCombination[][] = Array.from({ length: MAX_TUNED_SLOTS + 1 }, () => []);
    for (const bucket of buckets) {
      for (const acc of bucket) {
        for (const candidate of candidates) {
          const tunedCount = acc.tunedCount + (candidate.hasTuning ? 1 : 0);
          next[tunedCount].push({
            choices: { ...acc.choices, [slot]: candidate },
            stats: addVectors(acc.stats, candidate.stats),
            tunedCount,
          });
        }
      }
    }

    buckets = next.map((combos) => paretoFrontier(dedupeByStats(combos)));
  }

  return buckets;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- combine`
Expected: PASS (4 tests). Note: `npm test` (full suite) will still fail at this point because
`index.ts`/`index.test.ts` reference the old `combine.ts` exports — that's resolved in Task 4.

**Step 5: Commit**

```bash
git add src/lib/optimizer/combine.ts src/lib/optimizer/combine.test.ts
git commit -m "refactor(optimizer): replace combineSlots with selectItemCombinations"
```

---

### Task 3: New `query.ts` — `computeOptimizerQuery`

**Files:**
- Create: `src/lib/optimizer/query.ts`
- Create: `src/lib/optimizer/query.test.ts`

**Background:** `computeOptimizerQuery(exotic, candidatesBySlot, query)` is the new top-level
entry point:

1. Rank each non-exotic slot's candidates by total base-stat sum, descending (query-independent).
2. `topK = min(INITIAL_TOP_K, maxAvailable)` where `maxAvailable` is the largest candidate count
   across non-exotic slots.
3. Slice the top `topK` candidates per slot (the exotic's slot always has exactly 1: the exotic),
   run `selectItemCombinations`, then for each `tunedCount` bucket cross every combination with
   `getTuningAdjustmentFrontier(tunedCount)` and the 252-entry mod-delta set, keeping only sums
   that meet `thresholds` (checked before building the `OptimizerResult`, to avoid wasted
   allocation).
4. Tier-dedup survivors by `floor(value / 5)` per stat, keeping the best-by-`optimizeFor`
   representative per tier.
5. Sort by `optimizeFor` descending, take the top `RESULT_LIMIT`.
6. If fewer than `RESULT_LIMIT` results survive and `topK < maxAvailable`, double `topK` (capped
   at `maxAvailable`) and retry from step 3. `topK` strictly increases each retry, so the loop
   terminates.

**Step 1: Write the failing test**

```typescript
// src/lib/optimizer/query.test.ts
import { describe, it, expect } from "vitest";
import type { ArmorItem, ArmorSlot, ArmorStats } from "@/lib/armor/types";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { computeOptimizerQuery } from "./query";
import { zeroVector } from "./vectors";

function makeItem(
  slot: ArmorSlot,
  name: string,
  stats: ArmorStats,
  options: { tierType?: number; gearTier?: number } = {}
): ArmorItem {
  return {
    itemInstanceId: name,
    itemHash: 0,
    name,
    icon: "",
    slot,
    tierType: options.tierType ?? 5,
    classType: 0,
    stats,
    tuning: { kind: "none" },
    power: 0,
    gearTier: options.gearTier,
    isMasterworked: true,
    location: "vault",
  };
}

describe("computeOptimizerQuery", () => {
  it("locks the exotic into its slot and combines it with the best candidate per slot", () => {
    const exotic = makeItem("helmet", "Exotic Helmet", { ...zeroVector(), mobility: 10 }, { tierType: 6 });
    const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {
      gauntlets: [makeItem("gauntlets", "Gauntlets", { ...zeroVector(), resilience: 10 })],
      chest: [makeItem("chest", "Chest", { ...zeroVector(), recovery: 10 })],
      legs: [makeItem("legs", "Legs", { ...zeroVector(), discipline: 10 })],
      classItem: [makeItem("classItem", "Class Item", { ...zeroVector(), intellect: 10 })],
    };

    const results = computeOptimizerQuery(exotic, candidates, {
      thresholds: zeroVector(),
      optimizeFor: "mobility",
    });

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.loadout.helmet?.item.name).toBe("Exotic Helmet");
      expect(result.stats.mobility).toBeGreaterThanOrEqual(10);
      expect(result.stats.resilience).toBeGreaterThanOrEqual(10);
      expect(result.stats.recovery).toBeGreaterThanOrEqual(10);
      expect(result.stats.discipline).toBeGreaterThanOrEqual(10);
      expect(result.stats.intellect).toBeGreaterThanOrEqual(10);
    }
  });

  it("returns an empty array when a non-exotic slot has no candidates", () => {
    const exotic = makeItem("helmet", "Exotic Helmet", zeroVector(), { tierType: 6 });
    const results = computeOptimizerQuery(exotic, {}, { thresholds: zeroVector(), optimizeFor: "mobility" });
    expect(results).toEqual([]);
  });

  it("filters out combinations that don't meet thresholds", () => {
    const exotic = makeItem("helmet", "Exotic Helmet", zeroVector(), { tierType: 6 });
    const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {
      gauntlets: [makeItem("gauntlets", "Gauntlets", zeroVector())],
      chest: [makeItem("chest", "Chest", zeroVector())],
      legs: [makeItem("legs", "Legs", zeroVector())],
      classItem: [makeItem("classItem", "Class Item", zeroVector())],
    };

    // Every item contributes 0; mods alone can add at most 50 to any single stat.
    const thresholds = { ...zeroVector(), resilience: 60 };
    const results = computeOptimizerQuery(exotic, candidates, { thresholds, optimizeFor: "mobility" });

    expect(results).toEqual([]);
  });

  it("sorts results by optimizeFor descending", () => {
    const exotic = makeItem("helmet", "Exotic Helmet", zeroVector(), { tierType: 6 });
    const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {
      gauntlets: [makeItem("gauntlets", "Gauntlets", zeroVector())],
      chest: [makeItem("chest", "Chest", zeroVector())],
      legs: [makeItem("legs", "Legs", zeroVector())],
      classItem: [makeItem("classItem", "Class Item", zeroVector())],
    };

    const results = computeOptimizerQuery(exotic, candidates, {
      thresholds: zeroVector(),
      optimizeFor: "strength",
    });

    expect(results.length).toBeGreaterThan(1);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].stats.strength).toBeGreaterThanOrEqual(results[i].stats.strength);
    }
    // The mod-delta set includes +50 to a single stat, so the best result reaches it.
    expect(results[0].stats.strength).toBe(50);
  });

  it("tier-dedups results: no two results share a tier bucket (floor(value/5) per stat)", () => {
    const exotic = makeItem("helmet", "Exotic Helmet", zeroVector(), { tierType: 6 });
    const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {
      gauntlets: [makeItem("gauntlets", "Gauntlets", zeroVector())],
      chest: [makeItem("chest", "Chest", zeroVector())],
      legs: [makeItem("legs", "Legs", zeroVector())],
      classItem: [makeItem("classItem", "Class Item", zeroVector())],
    };

    const results = computeOptimizerQuery(exotic, candidates, {
      thresholds: zeroVector(),
      optimizeFor: "mobility",
    });

    const tierKeys = results.map((r) => ARMOR_STAT_ORDER.map((stat) => Math.floor(r.stats[stat] / 5)).join(","));
    expect(new Set(tierKeys).size).toBe(tierKeys.length);
  });

  it("widens topK when strict thresholds eliminate the top-ranked candidates", () => {
    const exotic = makeItem("helmet", "Exotic Helmet", zeroVector(), { tierType: 6 });

    const legsCandidates: ArmorItem[] = [];
    for (let i = 0; i < 5; i++) {
      legsCandidates.push(makeItem("legs", `legs-high-${i}`, { ...zeroVector(), mobility: 40 }));
    }
    for (let i = 0; i < 5; i++) {
      legsCandidates.push(makeItem("legs", `legs-intellect-${i}`, { ...zeroVector(), mobility: 10, intellect: 15 }));
    }

    const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {
      gauntlets: [makeItem("gauntlets", "Gauntlets", zeroVector())],
      chest: [makeItem("chest", "Chest", zeroVector())],
      legs: legsCandidates,
      classItem: [makeItem("classItem", "Class Item", zeroVector())],
    };

    // Top-5 legs items contribute 0 intellect; max achievable via mods alone is 50 (< 60).
    const thresholds = { ...zeroVector(), intellect: 60 };
    const results = computeOptimizerQuery(exotic, candidates, { thresholds, optimizeFor: "intellect" });

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.stats.intellect).toBeGreaterThanOrEqual(60);
      expect(result.loadout.legs?.item.name).toMatch(/^legs-intellect-/);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- query`
Expected: FAIL — `Cannot find module './query'`.

**Step 3: Write the implementation**

```typescript
// src/lib/optimizer/query.ts
import type { ArmorItem, ArmorSlot, ArmorStatName, ArmorStats } from "@/lib/armor/types";
import type { ArmorTuning } from "@/lib/armor/tuning";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { getTuningAdjustmentFrontier, MAX_TUNED_SLOTS, type TuningAdjustment } from "./adjustment-frontier";
import { ALL_SLOTS, selectItemCombinations, type ItemCombination, type SlotCandidate } from "./combine";
import { getModDeltaSet } from "./mod-deltas";
import { tuningDeltaVector } from "./tuning-variants";
import { addVectors, type StatVector } from "./vectors";

export interface OptimizerQuery {
  thresholds: ArmorStats;
  optimizeFor: ArmorStatName;
}

export interface SlotChoice {
  item: ArmorItem;
  tuning: ArmorTuning;
  stats: StatVector;
}

export interface OptimizerResult {
  stats: StatVector;
  loadout: Partial<Record<ArmorSlot, SlotChoice>>;
}

/** Initial number of top-ranked candidates considered per non-exotic slot. */
const INITIAL_TOP_K = 5;

/** Maximum number of results returned per query. */
const RESULT_LIMIT = 50;

function totalStats(stats: StatVector): number {
  return ARMOR_STAT_ORDER.reduce((sum, stat) => sum + stats[stat], 0);
}

/** Ranks a slot's candidates by total base-stat sum, descending. Query-independent. */
function rankCandidates(items: ArmorItem[]): SlotCandidate[] {
  return [...items]
    .sort((a, b) => totalStats(b.stats) - totalStats(a.stats))
    .map((item) => ({ item, stats: item.stats, hasTuning: item.gearTier === 5 }));
}

/** Builds the per-slot candidate slice for this iteration: the exotic in its slot, top-`topK` elsewhere. */
function sliceTopK(
  rankedBySlot: Partial<Record<ArmorSlot, SlotCandidate[]>>,
  exotic: ArmorItem,
  topK: number
): Partial<Record<ArmorSlot, SlotCandidate[]>> {
  const itemsBySlot: Partial<Record<ArmorSlot, SlotCandidate[]>> = {};

  for (const slot of ALL_SLOTS) {
    if (slot === exotic.slot) {
      itemsBySlot[slot] = [{ item: exotic, stats: exotic.stats, hasTuning: exotic.gearTier === 5 }];
    } else {
      itemsBySlot[slot] = rankedBySlot[slot]?.slice(0, topK);
    }
  }

  return itemsBySlot;
}

/** Tier-dedup key: `floor(value / 5)` per stat, in `ARMOR_STAT_ORDER`. */
function tierKey(stats: StatVector): string {
  return ARMOR_STAT_ORDER.map((stat) => Math.floor(stats[stat] / 5)).join(",");
}

/** Builds the per-slot loadout, assigning each tuned slot's stats/tuning from `tuningAssignment` in slot order. */
function buildLoadout(
  choices: ItemCombination["choices"],
  tuningAssignment: ArmorTuning[]
): OptimizerResult["loadout"] {
  const loadout: OptimizerResult["loadout"] = {};
  let tuningIndex = 0;

  for (const slot of ALL_SLOTS) {
    const candidate = choices[slot];
    if (!candidate) continue;

    if (candidate.hasTuning) {
      const tuning = tuningAssignment[tuningIndex++];
      loadout[slot] = {
        item: candidate.item,
        tuning,
        stats: addVectors(candidate.stats, tuningDeltaVector(tuning)),
      };
    } else {
      loadout[slot] = { item: candidate.item, tuning: { kind: "none" }, stats: candidate.stats };
    }
  }

  return loadout;
}

/** Sums `combo`, `adj`, and `mod`; returns the result only if it meets `thresholds`. */
function combineIfMeetsThresholds(
  combo: ItemCombination,
  adj: TuningAdjustment,
  mod: StatVector,
  thresholds: ArmorStats
): OptimizerResult | undefined {
  const stats = addVectors(addVectors(combo.stats, adj.stats), mod);

  for (const stat of ARMOR_STAT_ORDER) {
    if (stats[stat] < thresholds[stat]) {
      return undefined;
    }
  }

  return { stats, loadout: buildLoadout(combo.choices, adj.tuningAssignment) };
}

/**
 * Crosses each `tunedCount` bucket of `itemSelectionFrontier` with its tuning-adjustment frontier
 * and the mod-delta set, filters by `query.thresholds`, tier-dedups (keeping the best-by-
 * `optimizeFor` per tier), and returns the top `RESULT_LIMIT` sorted by `optimizeFor` descending.
 */
function buildResults(itemSelectionFrontier: ItemCombination[][], query: OptimizerQuery): OptimizerResult[] {
  const modDeltas = getModDeltaSet();
  const best = new Map<string, OptimizerResult>();

  for (let tunedCount = 0; tunedCount <= MAX_TUNED_SLOTS; tunedCount++) {
    const combos = itemSelectionFrontier[tunedCount];
    if (combos.length === 0) continue;

    const adjustments = getTuningAdjustmentFrontier(tunedCount);

    for (const combo of combos) {
      for (const adj of adjustments) {
        for (const mod of modDeltas) {
          const result = combineIfMeetsThresholds(combo, adj, mod, query.thresholds);
          if (!result) continue;

          const key = tierKey(result.stats);
          const existing = best.get(key);
          if (!existing || result.stats[query.optimizeFor] > existing.stats[query.optimizeFor]) {
            best.set(key, result);
          }
        }
      }
    }
  }

  return [...best.values()]
    .sort((a, b) => b.stats[query.optimizeFor] - a.stats[query.optimizeFor])
    .slice(0, RESULT_LIMIT);
}

/**
 * Computes the top loadout results for `query`, with `exotic` locked into its slot and one item
 * chosen per remaining slot from `candidatesBySlot`. Returns an empty array if any non-exotic
 * slot has no candidates.
 */
export function computeOptimizerQuery(
  exotic: ArmorItem,
  candidatesBySlot: Partial<Record<ArmorSlot, ArmorItem[]>>,
  query: OptimizerQuery
): OptimizerResult[] {
  const rankedBySlot: Partial<Record<ArmorSlot, SlotCandidate[]>> = {};
  let maxAvailable = 0;

  for (const slot of ALL_SLOTS) {
    if (slot === exotic.slot) continue;

    const items = candidatesBySlot[slot];
    if (!items || items.length === 0) {
      return [];
    }

    rankedBySlot[slot] = rankCandidates(items);
    maxAvailable = Math.max(maxAvailable, items.length);
  }

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
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- query`
Expected: PASS (6 tests).

**Step 5: Commit**

```bash
git add src/lib/optimizer/query.ts src/lib/optimizer/query.test.ts
git commit -m "feat(optimizer): add computeOptimizerQuery (on-demand combine + tuning + mods)"
```

---

### Task 4: Update `index.ts` (thin re-export) and remove stale `index.test.ts`

**Files:**
- Modify (full rewrite): `src/lib/optimizer/index.ts`
- Delete: `src/lib/optimizer/index.test.ts` (superseded by `query.test.ts`, which covers the same
  scenarios against `computeOptimizerQuery`)

**Step 1: Rewrite `index.ts`**

```typescript
// src/lib/optimizer/index.ts
export type { StatVector } from "./vectors";
export type { SlotCandidate, ItemCombination } from "./combine";
export type { OptimizerQuery, OptimizerResult, SlotChoice } from "./query";
export { computeOptimizerQuery } from "./query";
```

**Step 2: Delete the stale test**

```bash
git rm src/lib/optimizer/index.test.ts
```

**Step 3: Run the full optimizer test suite**

Run: `npm test -- src/lib/optimizer`
Expected: PASS — all `src/lib/optimizer/*.test.ts` files pass (adjustment-frontier, combine,
mod-deltas, pareto, query, tuning-variants, vectors, candidates).

**Step 4: Commit**

```bash
git add src/lib/optimizer/index.ts
git commit -m "refactor(optimizer): re-export computeOptimizerQuery from index"
```

---

### Task 5: Update `route.ts` — accept `thresholds`/`optimizeFor`

**Files:**
- Modify (full rewrite): `src/app/api/optimizer/compute/route.ts`

**Background:** The request body gains optional `thresholds` (default: all-zero via
`zeroVector()`) and `optimizeFor` (default: `ARMOR_STAT_ORDER[0]`, i.e. `"mobility"`). An invalid
`optimizeFor` (not one of `ARMOR_STAT_ORDER`) returns 400. The handler now calls
`computeOptimizerQuery` instead of the removed `computeOptimizerResults`.

**Step 1: Rewrite the route**

```typescript
// src/app/api/optimizer/compute/route.ts
import { NextResponse } from "next/server";
import { getValidSession } from "@/lib/session/session";
import { ensureManifestUpToDate } from "@/lib/manifest/sync";
import { getProfileWithArmor } from "@/lib/bungie/profile";
import { transformProfileToArmorInventory } from "@/lib/armor/transform";
import type { ArmorStatName, ArmorStats } from "@/lib/armor/types";
import { buildCandidatesBySlot, findItemByInstanceId } from "@/lib/optimizer/candidates";
import { computeOptimizerQuery } from "@/lib/optimizer";
import { zeroVector } from "@/lib/optimizer/vectors";
import { ARMOR_STAT_ORDER } from "@/styles/theme";

interface ComputeRequestBody {
  exoticItemInstanceId?: string;
  thresholds?: ArmorStats;
  optimizeFor?: ArmorStatName;
}

export async function POST(request: Request) {
  const session = await getValidSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json()) as ComputeRequestBody;
  if (!body.exoticItemInstanceId) {
    return NextResponse.json({ error: "exoticItemInstanceId is required" }, { status: 400 });
  }

  const optimizeFor = body.optimizeFor ?? ARMOR_STAT_ORDER[0];
  if (!ARMOR_STAT_ORDER.includes(optimizeFor)) {
    return NextResponse.json({ error: "Invalid optimizeFor" }, { status: 400 });
  }

  const thresholds = body.thresholds ?? zeroVector();

  await ensureManifestUpToDate();
  const profile = await getProfileWithArmor(session);
  const inventory = transformProfileToArmorInventory(profile);

  const exotic = findItemByInstanceId(inventory, body.exoticItemInstanceId);
  if (!exotic) {
    return NextResponse.json({ error: "Exotic item not found in inventory" }, { status: 404 });
  }

  const candidatesBySlot = buildCandidatesBySlot(inventory, exotic);
  const results = computeOptimizerQuery(exotic, candidatesBySlot, { thresholds, optimizeFor });

  return NextResponse.json({ results });
}
```

**Step 2: Lint**

Run: `npm run lint`
Expected: no errors in `route.ts`.

**Step 3: Commit**

```bash
git add src/app/api/optimizer/compute/route.ts
git commit -m "feat(optimizer): accept thresholds/optimizeFor in compute route"
```

---

### Task 6: Update `OptimizerClient.tsx` — debounced re-query on threshold/optimizeFor change

**Files:**
- Modify (full rewrite): `src/components/optimizer/OptimizerClient.tsx`

**Background:** Replace the single fetch-on-select flow with a shared `runQuery` helper and a
debounced `useEffect` keyed on `[selectedExotic, thresholds, optimizeFor]` (300ms). Selecting a new
exotic resets `thresholds`/`optimizeFor` to defaults and lets the effect fire the query — avoiding
a duplicate fetch. The existing `requestIdRef` stale-response guard is reused. Controls stay
visible while a debounced re-query is loading (only the results region shows the loading/error
state), so the sliders don't disappear while the user is interacting with them.

**Step 1: Rewrite the component**

```tsx
// src/components/optimizer/OptimizerClient.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { ArmorInventory, ArmorItem, ArmorStatName, ArmorStats } from "@/lib/armor/types";
import type { OptimizerResult } from "@/lib/optimizer";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { ExoticPicker } from "./ExoticPicker";
import { OptimizerControls } from "./OptimizerControls";
import { OptimizerResults } from "./OptimizerResults";

const QUERY_DEBOUNCE_MS = 300;

function zeroThresholds(): ArmorStats {
  return {
    mobility: 0,
    resilience: 0,
    recovery: 0,
    discipline: 0,
    intellect: 0,
    strength: 0,
  };
}

interface OptimizerClientProps {
  inventory: ArmorInventory;
  statIcons: Record<ArmorStatName, string>;
  defaultClassType: number;
}

export function OptimizerClient({ inventory, statIcons, defaultClassType }: OptimizerClientProps) {
  const allItems = [...inventory.vault, ...Object.values(inventory.characters).flat()];

  const [classType, setClassType] = useState(defaultClassType);
  const [selectedExotic, setSelectedExotic] = useState<ArmorItem | null>(null);
  const [results, setResults] = useState<OptimizerResult[]>([]);
  const [thresholds, setThresholds] = useState<ArmorStats>(zeroThresholds());
  const [optimizeFor, setOptimizeFor] = useState<ArmorStatName>(ARMOR_STAT_ORDER[0]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const requestIdRef = useRef(0);

  async function runQuery(exotic: ArmorItem, currentThresholds: ArmorStats, currentOptimizeFor: ArmorStatName) {
    const requestId = ++requestIdRef.current;
    setStatus("loading");

    try {
      const response = await fetch("/api/optimizer/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exoticItemInstanceId: exotic.itemInstanceId,
          thresholds: currentThresholds,
          optimizeFor: currentOptimizeFor,
        }),
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      const data = (await response.json()) as { results: OptimizerResult[] };
      if (requestIdRef.current !== requestId) return;
      setResults(data.results);
      setStatus("idle");
    } catch {
      if (requestIdRef.current !== requestId) return;
      setStatus("error");
    }
  }

  useEffect(() => {
    if (!selectedExotic) return;

    const timeout = setTimeout(() => {
      runQuery(selectedExotic, thresholds, optimizeFor);
    }, QUERY_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExotic, thresholds, optimizeFor]);

  function handleSelectExotic(item: ArmorItem) {
    requestIdRef.current += 1;
    setSelectedExotic(item);
    setResults([]);
    setThresholds(zeroThresholds());
    setOptimizeFor(ARMOR_STAT_ORDER[0]);
  }

  return (
    <div className="flex flex-col gap-6">
      <ExoticPicker
        items={allItems}
        selectedClassType={classType}
        onSelectClassType={(next) => {
          requestIdRef.current += 1;
          setClassType(next);
          setSelectedExotic(null);
          setResults([]);
          setStatus("idle");
        }}
        selectedItemInstanceId={selectedExotic?.itemInstanceId ?? null}
        onSelect={handleSelectExotic}
      />

      {selectedExotic && (
        <>
          <OptimizerControls
            thresholds={thresholds}
            onThresholdChange={(stat, value) => setThresholds((prev) => ({ ...prev, [stat]: value }))}
            optimizeFor={optimizeFor}
            onOptimizeForChange={setOptimizeFor}
            statIcons={statIcons}
          />

          {status === "loading" && (
            <p role="status" aria-live="polite" className="text-sm text-foreground/50">
              Computing combinations...
            </p>
          )}
          {status === "error" && (
            <p role="alert" className="text-sm text-red-400">
              Something went wrong computing results.{" "}
              <button
                type="button"
                onClick={() => runQuery(selectedExotic, thresholds, optimizeFor)}
                className="underline"
              >
                Retry
              </button>
            </p>
          )}
          {status === "idle" && <OptimizerResults results={results} optimizeFor={optimizeFor} />}
        </>
      )}
    </div>
  );
}
```

**Step 2: Lint**

Run: `npm run lint`
Expected: no errors (the `eslint-disable-next-line react-hooks/exhaustive-deps` comment suppresses
the expected warning for omitting `runQuery` from the effect's dependency array — `runQuery` is
intentionally re-created each render and re-including it would re-fire the effect on every
render).

**Step 3: Commit**

```bash
git add src/components/optimizer/OptimizerClient.tsx
git commit -m "feat(optimizer): debounce re-query on threshold/optimizeFor change"
```

---

### Task 7: Update `OptimizerResults.tsx` — drop client-side filter/sort

**Files:**
- Modify (full rewrite): `src/components/optimizer/OptimizerResults.tsx`

**Background:** The server now returns pre-filtered, tier-deduped, sorted results, so the
`useMemo` filter/sort and the `thresholds` prop are removed. Render `results` directly; keep the
existing empty-state message and per-result markup unchanged otherwise.

**Step 1: Rewrite the component**

```tsx
// src/components/optimizer/OptimizerResults.tsx
"use client";

import { ARMOR_STAT_LABELS, ARMOR_STAT_ORDER, ARMOR_SLOT_LABELS } from "@/styles/theme";
import type { ArmorSlot, ArmorStatName } from "@/lib/armor/types";
import type { OptimizerResult } from "@/lib/optimizer";
import { cn } from "@/lib/utils/cn";

const SLOT_ORDER: ArmorSlot[] = ["helmet", "gauntlets", "chest", "legs", "classItem"];

interface OptimizerResultsProps {
  results: OptimizerResult[];
  optimizeFor: ArmorStatName;
}

export function OptimizerResults({ results, optimizeFor }: OptimizerResultsProps) {
  if (results.length === 0) {
    return (
      <p className="mt-4 text-sm text-foreground/50">
        No combination meets the current thresholds. Try lowering one or more sliders.
      </p>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-xs uppercase tracking-wider text-foreground/40">
        {results.length} combination{results.length === 1 ? "" : "s"}
      </p>
      {results.map((result, index) => {
        const resultKey = SLOT_ORDER.map((slot) => {
          const choice = result.loadout[slot];
          return choice
            ? `${choice.item.itemInstanceId}:${choice.tuning.kind}${
                choice.tuning.kind === "directional"
                  ? `:${choice.tuning.increasedStat}-${choice.tuning.decreasedStat}`
                  : ""
              }`
            : "-";
        }).join("|");

        return (
          <details key={resultKey} className="rounded-lg border border-border bg-panel/80 p-3">
            <summary
              className="flex cursor-pointer flex-wrap gap-3 text-sm"
              aria-label={`Loadout ${index + 1} of ${results.length}, expand for details`}
            >
              {ARMOR_STAT_ORDER.map((stat) => (
                <span
                  key={stat}
                  className={cn(
                    "tabular-nums",
                    stat === optimizeFor ? "font-semibold text-arc" : "text-foreground/70"
                  )}
                >
                  {ARMOR_STAT_LABELS[stat]} {result.stats[stat]}
                </span>
              ))}
            </summary>
            <div className="mt-3 flex flex-col gap-1 text-xs text-foreground/60">
              {SLOT_ORDER.map((slot) => {
                const choice = result.loadout[slot];
                if (!choice) return null;
                return (
                  <p key={slot}>
                    <span className="text-foreground/40">{ARMOR_SLOT_LABELS[slot]}:</span> {choice.item.name}
                    {choice.tuning.kind === "directional" && (
                      <span>
                        {" "}
                        (tuning: +{ARMOR_STAT_LABELS[choice.tuning.increasedStat]} / -
                        {ARMOR_STAT_LABELS[choice.tuning.decreasedStat]})
                      </span>
                    )}
                    {choice.tuning.kind === "balanced" && <span> (tuning: balanced)</span>}
                  </p>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}
```

**Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

**Step 3: Commit**

```bash
git add src/components/optimizer/OptimizerResults.tsx
git commit -m "refactor(optimizer): remove client-side filter/sort from results list"
```

---

### Task 8: Performance guard test

**Files:**
- Create: `src/lib/optimizer/query.performance.test.ts`

**Background:** Guard against a regression back to combinatorial blowup. Uses a realistic ~14
items/slot inventory. To stay fast and avoid the ~20s cold cost of `getTuningAdjustmentFrontier(5)`
(per Task 1), only 3 of the 4 non-exotic slots ever have `gearTier === 5` candidates, so
`tunedCount` never exceeds 3 and the test only exercises `getTuningAdjustmentFrontier(0..3)`
(≤1281 entries).

**Step 1: Write the test**

```typescript
// src/lib/optimizer/query.performance.test.ts
import { describe, it, expect } from "vitest";
import type { ArmorItem, ArmorSlot, ArmorStatName, ArmorStats } from "@/lib/armor/types";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { computeOptimizerQuery } from "./query";
import { zeroVector } from "./vectors";

const ITEMS_PER_SLOT = 14;
const PERFORMANCE_BUDGET_MS = 1000;

// Only these non-exotic slots ever have tuned (gearTier === 5) candidates, so tunedCount never
// exceeds 3 and getTuningAdjustmentFrontier(4|5) is never built.
const TUNED_SLOTS: ArmorSlot[] = ["gauntlets", "chest", "legs"];

const STAT_OFFSETS: Record<ArmorStatName, number> = {
  mobility: 1,
  resilience: 3,
  recovery: 5,
  discipline: 7,
  intellect: 11,
  strength: 13,
};

function generateStats(seed: number): ArmorStats {
  const stats = zeroVector();
  for (const stat of ARMOR_STAT_ORDER) {
    stats[stat] = ((seed * STAT_OFFSETS[stat]) % 7) * 5 + 5;
  }
  return stats;
}

function makeItem(slot: ArmorSlot, index: number, tuned: boolean): ArmorItem {
  return {
    itemInstanceId: `${slot}-${index}`,
    itemHash: 0,
    name: `${slot}-${index}`,
    icon: "",
    slot,
    tierType: 5,
    classType: 0,
    stats: generateStats(index + 1),
    tuning: { kind: "none" },
    power: 0,
    gearTier: tuned ? 5 : undefined,
    isMasterworked: true,
    location: "vault",
  };
}

function buildCandidates(): Partial<Record<ArmorSlot, ArmorItem[]>> {
  const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {};
  for (const slot of ["gauntlets", "chest", "legs", "classItem"] as ArmorSlot[]) {
    const tuned = TUNED_SLOTS.includes(slot);
    candidates[slot] = Array.from({ length: ITEMS_PER_SLOT }, (_, i) => makeItem(slot, i, tuned && i % 2 === 0));
  }
  return candidates;
}

const exotic: ArmorItem = { ...makeItem("helmet", 0, false), tierType: 6 };

describe("computeOptimizerQuery performance", () => {
  it("completes within budget with loose thresholds (all zero)", () => {
    const start = Date.now();
    const results = computeOptimizerQuery(exotic, buildCandidates(), {
      thresholds: zeroVector(),
      optimizeFor: "mobility",
    });
    expect(Date.now() - start).toBeLessThan(PERFORMANCE_BUDGET_MS);
    expect(results.length).toBeGreaterThan(0);
  });

  it("completes within budget with strict thresholds", () => {
    const thresholds = { ...zeroVector(), mobility: 30, resilience: 30 };
    const start = Date.now();
    const results = computeOptimizerQuery(exotic, buildCandidates(), {
      thresholds,
      optimizeFor: "mobility",
    });
    expect(Date.now() - start).toBeLessThan(PERFORMANCE_BUDGET_MS);
    expect(Array.isArray(results)).toBe(true);
  });
});
```

**Step 2: Run the test**

Run: `npm test -- query.performance`
Expected: PASS, both within `PERFORMANCE_BUDGET_MS`.

**Step 3: Commit**

```bash
git add src/lib/optimizer/query.performance.test.ts
git commit -m "test(optimizer): add performance guard for computeOptimizerQuery"
```

---

### Task 9: Full test suite, lint, build

**Files:** none (verification only)

**Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all test files, including the new `adjustment-frontier`, `combine`, `query`, and
`query.performance` tests, plus the unchanged `pareto`, `mod-deltas`, `vectors`, `tuning-variants`,
`candidates` tests.

**Step 2: Lint**

Run: `npm run lint`
Expected: no errors or warnings.

**Step 3: Build**

Run: `npm run build`
Expected: production build succeeds with no type errors.

**Step 4: Fix any failures**

If any step fails, fix the root cause (not by skipping tests or disabling lint rules) and re-run
all three steps until they pass. Do not commit broken intermediate states — fix-up changes belong
in a new commit per the usual workflow.

---

### Task 10: Manual end-to-end verification via browser

**Files:** none (manual verification only)

**Background:** Per `CLAUDE.md`, the app must be accessed via the ngrok tunnel (not localhost) for
Bungie OAuth to work. Start `npm run dev` and open the tunnel URL.

**Step 1: Start the dev server and open the optimizer page**

- Run `npm run dev`.
- Open the app via its ngrok URL, log in if needed, and navigate to `/optimizer`.

**Step 2: Verify the golden path**

- Select an exotic armor piece. Confirm results appear (loading indicator, then a result list)
  without the controls disappearing.
- Confirm every result's loadout includes the selected exotic in its slot.

**Step 3: Verify threshold/optimizeFor interactivity**

- Drag a stat threshold slider. Confirm (after ~300ms) the result list updates without the
  controls flickering away, and that all visible results meet the new threshold for every stat.
- Change "Optimize for" to a different stat. Confirm results re-sort/re-fetch and the chosen stat
  is highlighted in each result.
- Raise thresholds high enough that no combination can satisfy them. Confirm the empty-state
  message ("No combination meets the current thresholds...") appears.

**Step 4: Verify exotic switching**

- Select a different exotic (or switch class via the class picker). Confirm thresholds/optimizeFor
  reset to defaults and results refresh for the new exotic.

**Step 5: Report results**

Summarize what was verified and any issues found. If issues are found, fix them (with appropriate
test coverage if the fix touches `src/lib/optimizer`) before proceeding to Task 11.

---

### Task 11: Final code review and finish branch

**Files:** none

**Step 1: Dispatch a final code review**

Use `superpowers:requesting-code-review` to review the full diff on `optimizer-combine-redesign`
against `main`, covering all of Tasks 1-10.

**Step 2: Address any findings**

Fix any issues raised, re-running `npm test`, `npm run lint`, and `npm run build` as needed, each
fix in its own commit.

**Step 3: Finish the branch**

Use `superpowers:finishing-a-development-branch` to decide how to integrate the work (merge, PR,
or further cleanup).
