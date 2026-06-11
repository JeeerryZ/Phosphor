# Armor Set Optimizer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a `/optimizer` page where the player locks in an owned exotic and sees the
Pareto-frontier of achievable 6-stat totals across their remaining legendary armor (with Tier 5
tuning and stat mods), filterable by minimum-stat sliders and sortable by an "optimize for" stat.

**Architecture:** A pure-function algorithm package in `src/lib/optimizer/` (tuning variants,
Pareto pruning, mod-delta set, slot combination) is exercised via TDD with Vitest. An API route
(`/api/optimizer/compute`) wires the algorithm to the existing session/profile/manifest pipeline.
A new `/optimizer` page + client component handle the exotic picker, sliders, and results list.

**Tech Stack:** Next.js (App Router, RSC + client components), TypeScript, Vitest (new dev dep),
existing `bungie-api-ts` / manifest / session libs.

**Design reference:** `docs/plans/2026-06-10-armor-optimizer-design.md`

---

## Task 1: Add Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

**Step 1: Install Vitest**

Run: `npm install -D vitest`

**Step 2: Add test scripts to `package.json`**

Add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
  },
});
```

**Step 4: Verify it runs with no test files**

Run: `npm test`
Expected: Vitest runs and reports "No test files found" (exit code may be non-zero - that's fine,
this just confirms the config loads). If it errors on config/resolution, fix before continuing.

**Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest"
```

---

## Task 2: Stat vector helpers

**Files:**
- Create: `src/lib/optimizer/vectors.ts`
- Test: `src/lib/optimizer/vectors.test.ts`

**Step 1: Write the failing test**

```typescript
// src/lib/optimizer/vectors.test.ts
import { describe, it, expect } from "vitest";
import { addVectors, zeroVector, vectorKey, dedupeByStats } from "./vectors";

describe("zeroVector", () => {
  it("has all six stats at zero", () => {
    expect(zeroVector()).toEqual({
      mobility: 0,
      resilience: 0,
      recovery: 0,
      discipline: 0,
      intellect: 0,
      strength: 0,
    });
  });
});

describe("addVectors", () => {
  it("sums each stat independently, including negative deltas", () => {
    const a = { mobility: 10, resilience: 20, recovery: 0, discipline: 5, intellect: 0, strength: 0 };
    const b = { mobility: 5, resilience: 0, recovery: 10, discipline: -5, intellect: 0, strength: 0 };
    expect(addVectors(a, b)).toEqual({
      mobility: 15,
      resilience: 20,
      recovery: 10,
      discipline: 0,
      intellect: 0,
      strength: 0,
    });
  });
});

describe("vectorKey", () => {
  it("is equal for equal vectors and different for different vectors", () => {
    const a = zeroVector();
    const b = zeroVector();
    expect(vectorKey(a)).toBe(vectorKey(b));

    const c = { ...zeroVector(), mobility: 1 };
    expect(vectorKey(a)).not.toBe(vectorKey(c));
  });
});

describe("dedupeByStats", () => {
  it("keeps only the first item for each distinct stat vector", () => {
    const items = [
      { id: "a", stats: zeroVector() },
      { id: "b", stats: zeroVector() },
      { id: "c", stats: { ...zeroVector(), mobility: 1 } },
    ];
    expect(dedupeByStats(items).map((i) => i.id)).toEqual(["a", "c"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- vectors`
Expected: FAIL - `Cannot find module './vectors'`

**Step 3: Write the implementation**

```typescript
// src/lib/optimizer/vectors.ts
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import type { ArmorStats } from "@/lib/armor/types";

export type StatVector = ArmorStats;

export function zeroVector(): StatVector {
  return {
    mobility: 0,
    resilience: 0,
    recovery: 0,
    discipline: 0,
    intellect: 0,
    strength: 0,
  };
}

export function addVectors(a: StatVector, b: StatVector): StatVector {
  const result = zeroVector();
  for (const stat of ARMOR_STAT_ORDER) {
    result[stat] = a[stat] + b[stat];
  }
  return result;
}

/** Stable string key for a stat vector, suitable for Map/Set dedup. */
export function vectorKey(vector: StatVector): string {
  return ARMOR_STAT_ORDER.map((stat) => vector[stat]).join(",");
}

/** Keeps only the first item for each distinct stat vector (by `vectorKey`). */
export function dedupeByStats<T extends { stats: StatVector }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = vectorKey(item.stats);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- vectors`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/lib/optimizer/vectors.ts src/lib/optimizer/vectors.test.ts
git commit -m "feat(optimizer): add stat vector helpers"
```

---

## Task 3: Tuning variant generation

**Files:**
- Create: `src/lib/optimizer/tuning-variants.ts`
- Test: `src/lib/optimizer/tuning-variants.test.ts`

**Step 1: Write the failing test**

```typescript
// src/lib/optimizer/tuning-variants.test.ts
import { describe, it, expect } from "vitest";
import type { ArmorItem, ArmorStats } from "@/lib/armor/types";
import type { ArmorTuning } from "@/lib/armor/tuning";
import { computeTuningVariants, directionalTuningPairs } from "./tuning-variants";
import { zeroVector } from "./vectors";

function makeItem(stats: ArmorStats, tuning: ArmorTuning): ArmorItem {
  return {
    itemInstanceId: "test-item",
    itemHash: 0,
    name: "Test Item",
    icon: "",
    slot: "helmet",
    tierType: 5,
    classType: 0,
    stats,
    tuning,
    power: 0,
    gearTier: tuning.kind === "none" ? undefined : 5,
    isMasterworked: true,
    location: "vault",
  };
}

const BASE_STATS: ArmorStats = {
  mobility: 10,
  resilience: 20,
  recovery: 30,
  discipline: 5,
  intellect: 15,
  strength: 0,
};

describe("directionalTuningPairs", () => {
  it("returns all 30 ordered pairs of distinct stats", () => {
    const pairs = directionalTuningPairs();
    expect(pairs).toHaveLength(30);
    expect(pairs.every((p) => p.increasedStat !== p.decreasedStat)).toBe(true);

    const keys = new Set(pairs.map((p) => `${p.increasedStat}->${p.decreasedStat}`));
    expect(keys.size).toBe(30);
  });
});

describe("computeTuningVariants", () => {
  it("returns a single unmodified variant for items without a tuning socket", () => {
    const item = makeItem(BASE_STATS, { kind: "none" });
    const variants = computeTuningVariants(item);

    expect(variants).toHaveLength(1);
    expect(variants[0]).toEqual({ tuning: { kind: "none" }, stats: BASE_STATS });
  });

  it("returns 32 variants for Tier 5 armor (empty + balanced + 30 directional)", () => {
    const item = makeItem(BASE_STATS, { kind: "empty" });
    const variants = computeTuningVariants(item);
    expect(variants).toHaveLength(32);
  });

  it("the balanced variant adds +1 to every stat", () => {
    const item = makeItem(BASE_STATS, { kind: "empty" });
    const variants = computeTuningVariants(item);
    const balanced = variants.find((v) => v.tuning.kind === "balanced");

    expect(balanced?.stats).toEqual({
      mobility: 11,
      resilience: 21,
      recovery: 31,
      discipline: 6,
      intellect: 16,
      strength: 1,
    });
  });

  it("a directional variant moves 5 points from the decreased stat to the increased stat", () => {
    const item = makeItem(BASE_STATS, { kind: "empty" });
    const variants = computeTuningVariants(item);
    const variant = variants.find(
      (v) =>
        v.tuning.kind === "directional" &&
        v.tuning.increasedStat === "intellect" &&
        v.tuning.decreasedStat === "mobility"
    );

    expect(variant?.stats).toEqual({
      ...BASE_STATS,
      mobility: BASE_STATS.mobility - 5,
      intellect: BASE_STATS.intellect + 5,
    });
  });

  it("the empty variant is unmodified", () => {
    const item = makeItem(BASE_STATS, { kind: "empty" });
    const variants = computeTuningVariants(item);
    const empty = variants.find((v) => v.tuning.kind === "empty");
    expect(empty?.stats).toEqual(BASE_STATS);
  });
});
```

Note: `zeroVector` is imported but unused above only if you don't need it - remove the import if
your editor/lint complains; it's not required by these tests.

**Step 2: Run test to verify it fails**

Run: `npm test -- tuning-variants`
Expected: FAIL - `Cannot find module './tuning-variants'`

**Step 3: Write the implementation**

```typescript
// src/lib/optimizer/tuning-variants.ts
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import type { ArmorItem, ArmorStatName } from "@/lib/armor/types";
import type { ArmorTuning } from "@/lib/armor/tuning";
import { addVectors, zeroVector, type StatVector } from "./vectors";

export interface TuningVariant {
  tuning: ArmorTuning;
  stats: StatVector;
}

/** All 30 ordered pairs of distinct stats - the directional Tier 5 tuning options. */
export function directionalTuningPairs(): Array<{
  increasedStat: ArmorStatName;
  decreasedStat: ArmorStatName;
}> {
  const pairs: Array<{ increasedStat: ArmorStatName; decreasedStat: ArmorStatName }> = [];
  for (const increasedStat of ARMOR_STAT_ORDER) {
    for (const decreasedStat of ARMOR_STAT_ORDER) {
      if (increasedStat !== decreasedStat) {
        pairs.push({ increasedStat, decreasedStat });
      }
    }
  }
  return pairs;
}

function balancedDelta(): StatVector {
  const delta = zeroVector();
  for (const stat of ARMOR_STAT_ORDER) {
    delta[stat] = 1;
  }
  return delta;
}

/**
 * All achievable stat vectors for an item across its Tier 5 tuning options. Items without a
 * tuning socket (`tuning.kind === "none"`) have exactly one variant: their unmodified stats.
 */
export function computeTuningVariants(item: ArmorItem): TuningVariant[] {
  if (item.tuning.kind === "none") {
    return [{ tuning: { kind: "none" }, stats: item.stats }];
  }

  const variants: TuningVariant[] = [
    { tuning: { kind: "empty" }, stats: item.stats },
    { tuning: { kind: "balanced" }, stats: addVectors(item.stats, balancedDelta()) },
  ];

  for (const { increasedStat, decreasedStat } of directionalTuningPairs()) {
    const delta = zeroVector();
    delta[increasedStat] += 5;
    delta[decreasedStat] -= 5;
    variants.push({
      tuning: { kind: "directional", increasedStat, decreasedStat },
      stats: addVectors(item.stats, delta),
    });
  }

  return variants;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tuning-variants`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add src/lib/optimizer/tuning-variants.ts src/lib/optimizer/tuning-variants.test.ts
git commit -m "feat(optimizer): generate Tier 5 tuning variants per item"
```

---

## Task 4: Pareto dominance and frontier

**Files:**
- Create: `src/lib/optimizer/pareto.ts`
- Test: `src/lib/optimizer/pareto.test.ts`

**Step 1: Write the failing test**

```typescript
// src/lib/optimizer/pareto.test.ts
import { describe, it, expect } from "vitest";
import { dominates, paretoFrontier } from "./pareto";
import { zeroVector } from "./vectors";

describe("dominates", () => {
  it("is true when a is >= b in every stat and > in at least one", () => {
    const a = { ...zeroVector(), mobility: 10, resilience: 5 };
    const b = { ...zeroVector(), mobility: 10, resilience: 4 };
    expect(dominates(a, b)).toBe(true);
  });

  it("is false for equal vectors", () => {
    const a = { ...zeroVector(), mobility: 10 };
    const b = { ...zeroVector(), mobility: 10 };
    expect(dominates(a, b)).toBe(false);
  });

  it("is false when a is better in one stat but worse in another", () => {
    const a = { ...zeroVector(), mobility: 10, resilience: 0 };
    const b = { ...zeroVector(), mobility: 5, resilience: 5 };
    expect(dominates(a, b)).toBe(false);
  });
});

describe("paretoFrontier", () => {
  it("removes items dominated by another item", () => {
    const items = [
      { id: "best", stats: { ...zeroVector(), mobility: 10, resilience: 10 } },
      { id: "dominated", stats: { ...zeroVector(), mobility: 10, resilience: 5 } },
      { id: "tradeoff", stats: { ...zeroVector(), mobility: 20, resilience: 0 } },
    ];

    const frontier = paretoFrontier(items);
    expect(frontier.map((i) => i.id).sort()).toEqual(["best", "tradeoff"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- pareto`
Expected: FAIL - `Cannot find module './pareto'`

**Step 3: Write the implementation**

```typescript
// src/lib/optimizer/pareto.ts
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import type { StatVector } from "./vectors";

/** True if `a` is at least as good as `b` in every stat and strictly better in at least one. */
export function dominates(a: StatVector, b: StatVector): boolean {
  let strictlyBetter = false;
  for (const stat of ARMOR_STAT_ORDER) {
    if (a[stat] < b[stat]) return false;
    if (a[stat] > b[stat]) strictlyBetter = true;
  }
  return strictlyBetter;
}

/**
 * Returns the subset of `items` whose stat vectors are not dominated by any other item's
 * vector. Assumes duplicate stat vectors have already been removed (see `dedupeByStats`).
 */
export function paretoFrontier<T extends { stats: StatVector }>(items: T[]): T[] {
  return items.filter((candidate) => !items.some((other) => dominates(other.stats, candidate.stats)));
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- pareto`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/lib/optimizer/pareto.ts src/lib/optimizer/pareto.test.ts
git commit -m "feat(optimizer): add pareto dominance and frontier helpers"
```

---

## Task 5: Mod delta set

**Files:**
- Create: `src/lib/optimizer/mod-deltas.ts`
- Test: `src/lib/optimizer/mod-deltas.test.ts`

**Step 1: Write the failing test**

```typescript
// src/lib/optimizer/mod-deltas.test.ts
import { describe, it, expect } from "vitest";
import { getModDeltaSet } from "./mod-deltas";
import { vectorKey, zeroVector } from "./vectors";

describe("getModDeltaSet", () => {
  it("includes the all-zero vector (every mod slot empty)", () => {
    const deltas = getModDeltaSet();
    expect(deltas.some((d) => vectorKey(d) === vectorKey(zeroVector()))).toBe(true);
  });

  it("includes +50 to a single stat (five +10 mods on the same stat)", () => {
    const deltas = getModDeltaSet();
    const maxMobility = { ...zeroVector(), mobility: 50 };
    expect(deltas.some((d) => vectorKey(d) === vectorKey(maxMobility))).toBe(true);
  });

  it("is bounded by the number of 5-multisets of the 13 mod options", () => {
    const deltas = getModDeltaSet();
    // C(13 + 5 - 1, 5) = C(17, 5) = 6188 raw multisets; distinct sums must be <= that.
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.length).toBeLessThanOrEqual(6188);
  });

  it("is cached across calls", () => {
    expect(getModDeltaSet()).toBe(getModDeltaSet());
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- mod-deltas`
Expected: FAIL - `Cannot find module './mod-deltas'`

**Step 3: Write the implementation**

```typescript
// src/lib/optimizer/mod-deltas.ts
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { addVectors, vectorKey, zeroVector, type StatVector } from "./vectors";

const MOD_SLOTS_PER_LOADOUT = 5;

/** A single mod slot is empty, +10 to one stat, or +5 to one stat - 13 options. */
function modOptions(): StatVector[] {
  const options: StatVector[] = [zeroVector()];
  for (const stat of ARMOR_STAT_ORDER) {
    options.push({ ...zeroVector(), [stat]: 10 });
    options.push({ ...zeroVector(), [stat]: 5 });
  }
  return options;
}

let cachedModDeltaSet: StatVector[] | null = null;

/**
 * All distinct stat-vector sums achievable by independently choosing a mod option for each of
 * the loadout's `MOD_SLOTS_PER_LOADOUT` mod slots. Item-independent, so computed once and cached.
 */
export function getModDeltaSet(): StatVector[] {
  if (cachedModDeltaSet) {
    return cachedModDeltaSet;
  }

  const options = modOptions();
  let current = new Map<string, StatVector>([[vectorKey(zeroVector()), zeroVector()]]);

  for (let i = 0; i < MOD_SLOTS_PER_LOADOUT; i++) {
    const next = new Map<string, StatVector>();
    for (const acc of current.values()) {
      for (const option of options) {
        const sum = addVectors(acc, option);
        next.set(vectorKey(sum), sum);
      }
    }
    current = next;
  }

  cachedModDeltaSet = Array.from(current.values());
  return cachedModDeltaSet;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- mod-deltas`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/lib/optimizer/mod-deltas.ts src/lib/optimizer/mod-deltas.test.ts
git commit -m "feat(optimizer): compute the universal mod-delta set"
```

---

## Task 6: Slot combination

**Files:**
- Create: `src/lib/optimizer/combine.ts`
- Test: `src/lib/optimizer/combine.test.ts`

**Step 1: Write the failing test**

```typescript
// src/lib/optimizer/combine.test.ts
import { describe, it, expect } from "vitest";
import type { ArmorItem, ArmorStats } from "@/lib/armor/types";
import { combineSlots, type SlotChoice } from "./combine";
import { zeroVector } from "./vectors";

function makeItem(slot: ArmorItem["slot"], name: string, stats: ArmorStats): ArmorItem {
  return {
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
    gearTier: undefined,
    isMasterworked: true,
    location: "vault",
  };
}

function choice(item: ArmorItem, stats: ArmorStats): SlotChoice {
  return { item, tuning: { kind: "none" }, stats };
}

describe("combineSlots", () => {
  it("sums stats across one choice per slot", () => {
    const helmet = makeItem("helmet", "Helmet", { ...zeroVector(), mobility: 10 });
    const gauntlets = makeItem("gauntlets", "Gauntlets", { ...zeroVector(), resilience: 20 });

    const result = combineSlots([
      [choice(helmet, helmet.stats)],
      [choice(gauntlets, gauntlets.stats)],
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].stats).toEqual({ ...zeroVector(), mobility: 10, resilience: 20 });
    expect(result[0].choices.helmet?.item.name).toBe("Helmet");
    expect(result[0].choices.gauntlets?.item.name).toBe("Gauntlets");
  });

  it("prunes dominated combinations after each slot", () => {
    const helmetA = makeItem("helmet", "Helmet A", { ...zeroVector(), mobility: 10, resilience: 10 });
    const helmetB = makeItem("helmet", "Helmet B", { ...zeroVector(), mobility: 10, resilience: 5 });
    const gauntlets = makeItem("gauntlets", "Gauntlets", { ...zeroVector(), recovery: 5 });

    const result = combineSlots([
      [choice(helmetA, helmetA.stats), choice(helmetB, helmetB.stats)],
      [choice(gauntlets, gauntlets.stats)],
    ]);

    // Helmet B is dominated by Helmet A in every combination, so only one result remains.
    expect(result).toHaveLength(1);
    expect(result[0].choices.helmet?.item.name).toBe("Helmet A");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- combine`
Expected: FAIL - `Cannot find module './combine'`

**Step 3: Write the implementation**

```typescript
// src/lib/optimizer/combine.ts
import type { ArmorItem, ArmorSlot } from "@/lib/armor/types";
import type { ArmorTuning } from "@/lib/armor/tuning";
import { addVectors, dedupeByStats, type StatVector } from "./vectors";
import { paretoFrontier } from "./pareto";

export interface SlotChoice {
  item: ArmorItem;
  tuning: ArmorTuning;
  stats: StatVector;
}

export interface LoadoutCandidate {
  choices: Partial<Record<ArmorSlot, SlotChoice>>;
  stats: StatVector;
}

/**
 * Combines per-slot candidate variants into loadout candidates (one choice per slot, stats
 * summed), Pareto-pruning the running set after each slot to keep the search tractable.
 */
export function combineSlots(slotVariants: SlotChoice[][]): LoadoutCandidate[] {
  if (slotVariants.length === 0) {
    return [];
  }

  let combined: LoadoutCandidate[] = slotVariants[0].map((choice) => ({
    choices: { [choice.item.slot]: choice },
    stats: choice.stats,
  }));
  combined = paretoFrontier(dedupeByStats(combined));

  for (let i = 1; i < slotVariants.length; i++) {
    const next: LoadoutCandidate[] = [];
    for (const acc of combined) {
      for (const choice of slotVariants[i]) {
        next.push({
          choices: { ...acc.choices, [choice.item.slot]: choice },
          stats: addVectors(acc.stats, choice.stats),
        });
      }
    }
    combined = paretoFrontier(dedupeByStats(next));
  }

  return combined;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- combine`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add src/lib/optimizer/combine.ts src/lib/optimizer/combine.test.ts
git commit -m "feat(optimizer): combine per-slot variants into loadout candidates"
```

---

## Task 7a: Reference - upcoming tasks

Tasks 8-10 build the data-layer glue (candidate selection, API route, manifest stat icons).
Tasks 11-16 build the UI. UI tasks are not TDD'd (no component-testing framework is being added -
see design doc); verify them by running `npm run dev` and using the page in the browser.

---

## Task 7: Top-level orchestration

**Files:**
- Create: `src/lib/optimizer/index.ts`
- Test: `src/lib/optimizer/index.test.ts`

**Step 1: Write the failing test**

```typescript
// src/lib/optimizer/index.test.ts
import { describe, it, expect } from "vitest";
import type { ArmorItem, ArmorSlot, ArmorStats } from "@/lib/armor/types";
import type { ArmorTuning } from "@/lib/armor/tuning";
import { computeOptimizerResults } from "./index";
import { zeroVector } from "./vectors";

function makeItem(
  slot: ArmorSlot,
  name: string,
  stats: ArmorStats,
  tuning: ArmorTuning = { kind: "none" }
): ArmorItem {
  return {
    itemInstanceId: name,
    itemHash: 0,
    name,
    icon: "",
    slot,
    tierType: slot === "helmet" ? 6 : 5, // exotic helmet, legendary everything else
    classType: 0,
    stats,
    tuning,
    power: 0,
    gearTier: tuning.kind === "none" ? undefined : 5,
    isMasterworked: true,
    location: "vault",
  };
}

describe("computeOptimizerResults", () => {
  it("locks the exotic into its slot and combines it with the best candidate per slot", () => {
    const exotic = makeItem("helmet", "Exotic Helmet", { ...zeroVector(), mobility: 10 });
    const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {
      gauntlets: [makeItem("gauntlets", "Gauntlets", { ...zeroVector(), resilience: 10 })],
      chest: [makeItem("chest", "Chest", { ...zeroVector(), recovery: 10 })],
      legs: [makeItem("legs", "Legs", { ...zeroVector(), discipline: 10 })],
      classItem: [makeItem("classItem", "Class Item", { ...zeroVector(), intellect: 10 })],
    };

    const results = computeOptimizerResults(exotic, candidates);

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.loadout.helmet?.item.name).toBe("Exotic Helmet");
      // Base stats from all 5 slots are always present, plus whatever the mod-delta set adds.
      expect(result.stats.mobility).toBeGreaterThanOrEqual(10);
      expect(result.stats.resilience).toBeGreaterThanOrEqual(10);
      expect(result.stats.recovery).toBeGreaterThanOrEqual(10);
      expect(result.stats.discipline).toBeGreaterThanOrEqual(10);
      expect(result.stats.intellect).toBeGreaterThanOrEqual(10);
    }
  });

  it("returns an empty array when a non-exotic slot has no candidates", () => {
    const exotic = makeItem("helmet", "Exotic Helmet", zeroVector());
    const results = computeOptimizerResults(exotic, {});
    expect(results).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- index`
Expected: FAIL - `Cannot find module './index'`

**Step 3: Write the implementation**

```typescript
// src/lib/optimizer/index.ts
import { ARMOR_BUCKET_HASHES } from "@/lib/armor/types";
import type { ArmorItem, ArmorSlot } from "@/lib/armor/types";
import { computeTuningVariants } from "./tuning-variants";
import { paretoFrontier } from "./pareto";
import { combineSlots, type LoadoutCandidate, type SlotChoice } from "./combine";
import { getModDeltaSet } from "./mod-deltas";
import { addVectors, dedupeByStats, type StatVector } from "./vectors";

export type { LoadoutCandidate, SlotChoice } from "./combine";
export type { StatVector } from "./vectors";

export interface OptimizerResult {
  stats: StatVector;
  loadout: LoadoutCandidate["choices"];
}

const ALL_SLOTS = Object.keys(ARMOR_BUCKET_HASHES) as ArmorSlot[];

/**
 * Computes the Pareto frontier of achievable final stat totals for a loadout with `exotic`
 * locked into its slot, choosing one item per remaining slot from `candidatesBySlot`.
 *
 * Returns an empty array if any non-exotic slot has no candidates.
 */
export function computeOptimizerResults(
  exotic: ArmorItem,
  candidatesBySlot: Partial<Record<ArmorSlot, ArmorItem[]>>
): OptimizerResult[] {
  const slotVariants: SlotChoice[][] = [];

  for (const slot of ALL_SLOTS) {
    const items = slot === exotic.slot ? [exotic] : candidatesBySlot[slot] ?? [];
    if (items.length === 0) {
      return [];
    }

    const variants = items.flatMap((item) =>
      computeTuningVariants(item).map((variant) => ({
        item,
        tuning: variant.tuning,
        stats: variant.stats,
      }))
    );
    slotVariants.push(paretoFrontier(dedupeByStats(variants)));
  }

  const baseLoadouts = combineSlots(slotVariants);
  const modDeltas = getModDeltaSet();

  const withMods = baseLoadouts.flatMap((loadout) =>
    modDeltas.map((delta) => ({
      stats: addVectors(loadout.stats, delta),
      loadout: loadout.choices,
    }))
  );

  return paretoFrontier(dedupeByStats(withMods));
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- index`
Expected: PASS (2 tests)

**Step 5: Run the full optimizer test suite**

Run: `npm test`
Expected: All tests across `src/lib/optimizer/*.test.ts` pass.

**Step 6: Commit**

```bash
git add src/lib/optimizer/index.ts src/lib/optimizer/index.test.ts
git commit -m "feat(optimizer): add top-level computeOptimizerResults"
```

---

## Task 8: Candidate selection from inventory

**Files:**
- Create: `src/lib/optimizer/candidates.ts`
- Test: `src/lib/optimizer/candidates.test.ts`

**Step 1: Write the failing test**

```typescript
// src/lib/optimizer/candidates.test.ts
import { describe, it, expect } from "vitest";
import type { ArmorInventory, ArmorItem, ArmorSlot } from "@/lib/armor/types";
import { buildCandidatesBySlot, findItemByInstanceId } from "./candidates";

function makeItem(overrides: Partial<ArmorItem> & { itemInstanceId: string; slot: ArmorSlot }): ArmorItem {
  return {
    itemHash: 0,
    name: overrides.itemInstanceId,
    icon: "",
    tierType: 5,
    classType: 0,
    stats: { mobility: 0, resilience: 0, recovery: 0, discipline: 0, intellect: 0, strength: 0 },
    tuning: { kind: "none" },
    power: 0,
    gearTier: undefined,
    isMasterworked: true,
    location: "vault",
    ...overrides,
  };
}

describe("findItemByInstanceId", () => {
  it("finds an item across vault and characters", () => {
    const inventory: ArmorInventory = {
      vault: [makeItem({ itemInstanceId: "vault-1", slot: "helmet" })],
      characters: { char1: [makeItem({ itemInstanceId: "char-1", slot: "chest" })] },
    };

    expect(findItemByInstanceId(inventory, "char-1")?.itemInstanceId).toBe("char-1");
    expect(findItemByInstanceId(inventory, "missing")).toBeUndefined();
  });
});

describe("buildCandidatesBySlot", () => {
  it("excludes the exotic's slot, exotics, and other classes; includes class-agnostic items", () => {
    const exotic = makeItem({ itemInstanceId: "exotic", slot: "helmet", tierType: 6, classType: 0 });
    const inventory: ArmorInventory = {
      vault: [
        makeItem({ itemInstanceId: "same-slot-legendary", slot: "helmet", tierType: 5, classType: 0 }),
        makeItem({ itemInstanceId: "other-class", slot: "gauntlets", tierType: 5, classType: 1 }),
        makeItem({ itemInstanceId: "other-exotic", slot: "chest", tierType: 6, classType: 0 }),
        makeItem({ itemInstanceId: "good-legendary", slot: "legs", tierType: 5, classType: 0 }),
        makeItem({ itemInstanceId: "class-agnostic", slot: "classItem", tierType: 5, classType: 3 }),
      ],
      characters: {},
    };

    const candidates = buildCandidatesBySlot(inventory, exotic);

    expect(candidates.helmet).toBeUndefined();
    expect(candidates.gauntlets).toBeUndefined();
    expect(candidates.chest).toBeUndefined();
    expect(candidates.legs?.map((i) => i.itemInstanceId)).toEqual(["good-legendary"]);
    expect(candidates.classItem?.map((i) => i.itemInstanceId)).toEqual(["class-agnostic"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- candidates`
Expected: FAIL - `Cannot find module './candidates'`

**Step 3: Write the implementation**

```typescript
// src/lib/optimizer/candidates.ts
import type { ArmorInventory, ArmorItem, ArmorSlot } from "@/lib/armor/types";

const TIER_LEGENDARY = 5;

/** DestinyClass value meaning "any class" (used by some class-agnostic items). */
const CLASS_TYPE_ANY = 3;

export function findItemByInstanceId(inventory: ArmorInventory, itemInstanceId: string): ArmorItem | undefined {
  return allItems(inventory).find((item) => item.itemInstanceId === itemInstanceId);
}

/**
 * Legendary armor matching the exotic's class (or class-agnostic), grouped by slot, excluding
 * the exotic's own slot - candidates for the optimizer's 4 open slots.
 */
export function buildCandidatesBySlot(
  inventory: ArmorInventory,
  exotic: ArmorItem
): Partial<Record<ArmorSlot, ArmorItem[]>> {
  const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {};

  for (const item of allItems(inventory)) {
    if (item.slot === exotic.slot) continue;
    if (item.tierType !== TIER_LEGENDARY) continue;
    if (item.classType !== exotic.classType && item.classType !== CLASS_TYPE_ANY) continue;

    (candidates[item.slot] ??= []).push(item);
  }

  return candidates;
}

function allItems(inventory: ArmorInventory): ArmorItem[] {
  return [...inventory.vault, ...Object.values(inventory.characters).flat()];
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- candidates`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add src/lib/optimizer/candidates.ts src/lib/optimizer/candidates.test.ts
git commit -m "feat(optimizer): select candidate armor by slot/class/tier"
```

---

## Task 9: API route `/api/optimizer/compute`

**Files:**
- Create: `src/app/api/optimizer/compute/route.ts`

This route is server-only (auth, manifest, Bungie API) and is verified manually in Task 16, not
with Vitest.

**Step 1: Write the route**

```typescript
// src/app/api/optimizer/compute/route.ts
import { NextResponse } from "next/server";
import { getValidSession } from "@/lib/session/session";
import { ensureManifestUpToDate } from "@/lib/manifest/sync";
import { getProfileWithArmor } from "@/lib/bungie/profile";
import { transformProfileToArmorInventory } from "@/lib/armor/transform";
import { buildCandidatesBySlot, findItemByInstanceId } from "@/lib/optimizer/candidates";
import { computeOptimizerResults } from "@/lib/optimizer";

interface ComputeRequestBody {
  exoticItemInstanceId?: string;
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

  await ensureManifestUpToDate();
  const profile = await getProfileWithArmor(session);
  const inventory = transformProfileToArmorInventory(profile);

  const exotic = findItemByInstanceId(inventory, body.exoticItemInstanceId);
  if (!exotic) {
    return NextResponse.json({ error: "Exotic item not found in inventory" }, { status: 404 });
  }

  const candidatesBySlot = buildCandidatesBySlot(inventory, exotic);
  const results = computeOptimizerResults(exotic, candidatesBySlot);

  return NextResponse.json({ results });
}
```

**Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/app/api/optimizer/compute/route.ts
git commit -m "feat(optimizer): add /api/optimizer/compute route"
```

---

## Task 10: Manifest stat icons

**Files:**
- Create: `src/lib/manifest/stats.ts`
- Test: `src/lib/manifest/stats.test.ts`

**Step 1: Write the failing test**

```typescript
// src/lib/manifest/stats.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("./definitions", () => ({
  getStatDefinition: (hash: number) => ({
    displayProperties: { icon: `/common/destiny2_content/icons/${hash}.png` },
  }),
}));

describe("getArmorStatIcons", () => {
  it("returns an icon path for each of the 6 armor stats", async () => {
    const { getArmorStatIcons } = await import("./stats");
    const icons = getArmorStatIcons();

    expect(Object.keys(icons).sort()).toEqual(
      ["discipline", "intellect", "mobility", "recovery", "resilience", "strength"].sort()
    );
    expect(icons.mobility).toMatch(/^\/common\/destiny2_content\/icons\//);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- stats`
Expected: FAIL - `Cannot find module './stats'`

**Step 3: Write the implementation**

```typescript
// src/lib/manifest/stats.ts
import { ARMOR_STAT_HASHES, type ArmorStatName } from "@/lib/armor/types";
import { getStatDefinition } from "./definitions";

/** Bungie.net icon path for each armor stat, from the manifest's stat definitions. */
export function getArmorStatIcons(): Record<ArmorStatName, string> {
  const icons = {} as Record<ArmorStatName, string>;
  for (const [stat, hash] of Object.entries(ARMOR_STAT_HASHES) as [ArmorStatName, number][]) {
    icons[stat] = getStatDefinition(hash)?.displayProperties.icon ?? "";
  }
  return icons;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- stats`
Expected: PASS (1 test)

**Step 5: Run the full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/lib/manifest/stats.ts src/lib/manifest/stats.test.ts
git commit -m "feat(optimizer): expose armor stat icons from the manifest"
```

---

## Task 11: Theme constants for the optimizer sliders

**Files:**
- Modify: `src/styles/theme.ts`

**Step 1: Add slider range constants**

Add near `ARMOR_STAT_MAX`:

```typescript
/** Slider range for the optimizer's per-stat thresholds (totals across a 5-piece loadout). */
export const OPTIMIZER_STAT_MAX = 200;
export const OPTIMIZER_STAT_STEP = 5;
```

**Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/styles/theme.ts
git commit -m "feat(optimizer): add slider range constants"
```

---

## Task 12: Exotic picker component

**Files:**
- Create: `src/components/optimizer/ExoticPicker.tsx`

**Step 1: Write the component**

Keep this visually restrained (plain borders, no glow/motion effects), per the project's
in-progress style simplification.

```tsx
"use client";

import Image from "next/image";
import { cn } from "@/lib/utils/cn";
import type { ArmorItem } from "@/lib/armor/types";
import { CLASS_TYPE_LABELS } from "@/styles/theme";

const TIER_EXOTIC = 6;
const CLASS_TABS = [0, 1, 2] as const;

interface ExoticPickerProps {
  items: ArmorItem[];
  selectedClassType: number;
  onSelectClassType: (classType: number) => void;
  selectedItemInstanceId: string | null;
  onSelect: (item: ArmorItem) => void;
}

export function ExoticPicker({
  items,
  selectedClassType,
  onSelectClassType,
  selectedItemInstanceId,
  onSelect,
}: ExoticPickerProps) {
  const exotics = items.filter(
    (item) => item.tierType === TIER_EXOTIC && item.classType === selectedClassType
  );

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {CLASS_TABS.map((classType) => (
          <button
            key={classType}
            type="button"
            onClick={() => onSelectClassType(classType)}
            className={cn(
              "font-display rounded border px-3 py-1 text-xs uppercase tracking-wider transition-colors",
              classType === selectedClassType
                ? "border-arc text-arc"
                : "border-border text-foreground/50 hover:text-foreground"
            )}
          >
            {CLASS_TYPE_LABELS[classType]}
          </button>
        ))}
      </div>

      {exotics.length === 0 ? (
        <p className="text-sm text-foreground/50">No exotic armor owned for this class.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {exotics.map((item) => (
            <button
              key={item.itemInstanceId}
              type="button"
              onClick={() => onSelect(item)}
              className={cn(
                "rounded-lg border bg-panel/80 p-2 text-left transition-colors",
                item.itemInstanceId === selectedItemInstanceId
                  ? "border-arc"
                  : "border-border hover:border-foreground/30"
              )}
            >
              <div className="relative mb-2 h-12 w-12 overflow-hidden rounded border border-border">
                <Image
                  src={`https://www.bungie.net${item.icon}`}
                  alt={item.name}
                  fill
                  sizes="48px"
                  className="object-cover"
                />
              </div>
              <p className="truncate text-xs font-semibold">{item.name}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/components/optimizer/ExoticPicker.tsx
git commit -m "feat(optimizer): add exotic picker component"
```

---

## Task 13: Optimizer controls (sliders + optimize-for)

**Files:**
- Create: `src/components/optimizer/OptimizerControls.tsx`

**Step 1: Write the component**

```tsx
"use client";

import Image from "next/image";
import { ARMOR_STAT_LABELS, ARMOR_STAT_ORDER, OPTIMIZER_STAT_MAX, OPTIMIZER_STAT_STEP } from "@/styles/theme";
import type { ArmorStatName, ArmorStats } from "@/lib/armor/types";
import { cn } from "@/lib/utils/cn";

interface OptimizerControlsProps {
  thresholds: ArmorStats;
  onThresholdChange: (stat: ArmorStatName, value: number) => void;
  optimizeFor: ArmorStatName;
  onOptimizeForChange: (stat: ArmorStatName) => void;
  statIcons: Record<ArmorStatName, string>;
}

export function OptimizerControls({
  thresholds,
  onThresholdChange,
  optimizeFor,
  onOptimizeForChange,
  statIcons,
}: OptimizerControlsProps) {
  return (
    <div className="rounded-lg border border-border bg-panel/80 p-4">
      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="optimize-for" className="font-display text-xs uppercase tracking-wider text-foreground/60">
          Optimize for
        </label>
        <select
          id="optimize-for"
          value={optimizeFor}
          onChange={(e) => onOptimizeForChange(e.target.value as ArmorStatName)}
          className="rounded border border-border bg-panel px-2 py-1 text-sm"
        >
          {ARMOR_STAT_ORDER.map((stat) => (
            <option key={stat} value={stat}>
              {ARMOR_STAT_LABELS[stat]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              className="flex-1"
            />
            <span className="w-10 shrink-0 text-right text-xs tabular-nums">{thresholds[stat]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/components/optimizer/OptimizerControls.tsx
git commit -m "feat(optimizer): add stat threshold sliders and optimize-for control"
```

---

## Task 14: Results list

**Files:**
- Create: `src/components/optimizer/OptimizerResults.tsx`

**Step 1: Write the component**

```tsx
"use client";

import { useMemo } from "react";
import { ARMOR_STAT_LABELS, ARMOR_STAT_ORDER, ARMOR_SLOT_LABELS } from "@/styles/theme";
import type { ArmorSlot, ArmorStatName, ArmorStats } from "@/lib/armor/types";
import type { OptimizerResult } from "@/lib/optimizer";
import { cn } from "@/lib/utils/cn";

const SLOT_ORDER: ArmorSlot[] = ["helmet", "gauntlets", "chest", "legs", "classItem"];

interface OptimizerResultsProps {
  results: OptimizerResult[];
  thresholds: ArmorStats;
  optimizeFor: ArmorStatName;
}

export function OptimizerResults({ results, thresholds, optimizeFor }: OptimizerResultsProps) {
  const filtered = useMemo(() => {
    return results
      .filter((result) => ARMOR_STAT_ORDER.every((stat) => result.stats[stat] >= thresholds[stat]))
      .sort((a, b) => b.stats[optimizeFor] - a.stats[optimizeFor]);
  }, [results, thresholds, optimizeFor]);

  if (filtered.length === 0) {
    return (
      <p className="mt-4 text-sm text-foreground/50">
        No combination meets the current thresholds. Try lowering one or more sliders.
      </p>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-xs uppercase tracking-wider text-foreground/40">
        {filtered.length} combination{filtered.length === 1 ? "" : "s"}
      </p>
      {filtered.map((result, index) => (
        <details key={index} className="rounded-lg border border-border bg-panel/80 p-3">
          <summary className="flex cursor-pointer flex-wrap gap-3 text-sm">
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
      ))}
    </div>
  );
}
```

**Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/components/optimizer/OptimizerResults.tsx
git commit -m "feat(optimizer): add results list with expandable loadout detail"
```

---

## Task 15: Client wrapper and `/optimizer` page

**Files:**
- Create: `src/components/optimizer/OptimizerClient.tsx`
- Create: `src/app/optimizer/page.tsx`
- Modify: `src/app/inventory/page.tsx:35-43` (header nav)

**Step 1: Write the client wrapper**

```tsx
// src/components/optimizer/OptimizerClient.tsx
"use client";

import { useState } from "react";
import type { ArmorInventory, ArmorItem, ArmorStatName, ArmorStats } from "@/lib/armor/types";
import type { OptimizerResult } from "@/lib/optimizer";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { ExoticPicker } from "./ExoticPicker";
import { OptimizerControls } from "./OptimizerControls";
import { OptimizerResults } from "./OptimizerResults";

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

  async function handleSelectExotic(item: ArmorItem) {
    setSelectedExotic(item);
    setResults([]);
    setThresholds(zeroThresholds());
    setStatus("loading");

    try {
      const response = await fetch("/api/optimizer/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exoticItemInstanceId: item.itemInstanceId }),
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      const data = (await response.json()) as { results: OptimizerResult[] };
      setResults(data.results);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <ExoticPicker
        items={allItems}
        selectedClassType={classType}
        onSelectClassType={(next) => {
          setClassType(next);
          setSelectedExotic(null);
          setResults([]);
        }}
        selectedItemInstanceId={selectedExotic?.itemInstanceId ?? null}
        onSelect={handleSelectExotic}
      />

      {status === "loading" && <p className="text-sm text-foreground/50">Computing combinations...</p>}
      {status === "error" && (
        <p className="text-sm text-red-400">
          Something went wrong computing results.{" "}
          {selectedExotic && (
            <button type="button" onClick={() => handleSelectExotic(selectedExotic)} className="underline">
              Retry
            </button>
          )}
        </p>
      )}

      {selectedExotic && status === "idle" && (
        <>
          <OptimizerControls
            thresholds={thresholds}
            onThresholdChange={(stat, value) => setThresholds((prev) => ({ ...prev, [stat]: value }))}
            optimizeFor={optimizeFor}
            onOptimizeForChange={setOptimizeFor}
            statIcons={statIcons}
          />
          <OptimizerResults results={results} thresholds={thresholds} optimizeFor={optimizeFor} />
        </>
      )}
    </div>
  );
}
```

**Step 2: Write the page**

```tsx
// src/app/optimizer/page.tsx
import { redirect } from "next/navigation";
import { getValidSession } from "@/lib/session/session";
import { ensureManifestUpToDate } from "@/lib/manifest/sync";
import { getProfileWithArmor } from "@/lib/bungie/profile";
import { transformProfileToArmorInventory } from "@/lib/armor/transform";
import { getArmorStatIcons } from "@/lib/manifest/stats";
import { OptimizerClient } from "@/components/optimizer/OptimizerClient";
import { PageTransition } from "@/components/ui/PageTransition";

export default async function OptimizerPage() {
  const session = await getValidSession();
  if (!session) {
    redirect("/");
  }

  await ensureManifestUpToDate();

  const profile = await getProfileWithArmor(session);
  const inventory = transformProfileToArmorInventory(profile);
  const statIcons = getArmorStatIcons();

  const firstCharacter = Object.values(profile.characters.data ?? {})[0];

  return (
    <main className="bg-grid min-h-screen px-6 py-10">
      <PageTransition>
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 flex items-center justify-between">
            <h1 className="font-display text-3xl font-bold tracking-wide sm:text-4xl">
              ARMOR <span className="text-arc text-glow-arc">OPTIMIZER</span>
            </h1>
            <a
              href="/inventory"
              className="font-display text-foreground/60 hover:text-foreground text-xs uppercase tracking-wider transition-colors"
            >
              Inventory
            </a>
          </div>

          <OptimizerClient
            inventory={inventory}
            statIcons={statIcons}
            defaultClassType={firstCharacter?.classType ?? 0}
          />
        </div>
      </PageTransition>
    </main>
  );
}
```

**Step 3: Add a link from the inventory page**

In `src/app/inventory/page.tsx`, the header currently has the title and a "Log out" link
(around lines 35-43):

```tsx
          <div className="mb-8 flex items-center justify-between">
            <h1 className="font-display text-3xl font-bold tracking-wide sm:text-4xl">
              ARMOR <span className="text-arc text-glow-arc">INVENTORY</span>
            </h1>
            <a
              href="/api/auth/logout"
              className="font-display text-foreground/60 hover:text-foreground text-xs uppercase tracking-wider transition-colors"
            >
              Log out
            </a>
          </div>
```

Add an "Optimizer" link between the title and "Log out", grouped in a flex container:

```tsx
          <div className="mb-8 flex items-center justify-between">
            <h1 className="font-display text-3xl font-bold tracking-wide sm:text-4xl">
              ARMOR <span className="text-arc text-glow-arc">INVENTORY</span>
            </h1>
            <div className="flex items-center gap-4">
              <a
                href="/optimizer"
                className="font-display text-foreground/60 hover:text-foreground text-xs uppercase tracking-wider transition-colors"
              >
                Optimizer
              </a>
              <a
                href="/api/auth/logout"
                className="font-display text-foreground/60 hover:text-foreground text-xs uppercase tracking-wider transition-colors"
              >
                Log out
              </a>
            </div>
          </div>
```

**Step 4: Type-check and lint**

Run: `npx tsc --noEmit`
Run: `npm run lint`
Expected: No errors.

**Step 5: Commit**

```bash
git add src/components/optimizer/OptimizerClient.tsx src/app/optimizer/page.tsx src/app/inventory/page.tsx
git commit -m "feat(optimizer): add /optimizer page and link from inventory"
```

---

## Task 16: Manual end-to-end verification

**Files:** none (manual testing only)

**Step 1: Run the full automated suite**

Run: `npm test`
Run: `npx tsc --noEmit`
Run: `npm run lint`
Expected: All pass.

**Step 2: Start the dev server through ngrok**

Per `README.md`: `npm run dev`, then in another terminal `ngrok http --domain=<your-domain> 3000`,
and open `https://<your-domain>` (not `localhost`).

**Step 3: Walk through the optimizer**

1. Log in, navigate to `/inventory`, click "Optimizer".
2. Confirm the class tabs show the right exotics for each class you have characters for.
3. Select an exotic. Confirm a "Computing combinations..." message appears, then sliders and
   results show up.
4. Move a slider (e.g. Super) up and confirm the results list shrinks/changes immediately
   (client-side filter, no network request - check the Network tab).
5. Set the "optimize for" dropdown to a different stat and confirm the results re-sort.
6. Expand a result and confirm it lists 5 items (one per slot) with sensible names and any
   tuning notes.
7. Set thresholds high enough that no result qualifies and confirm the empty-state message
   appears.
8. Pick a class with no owned exotics (if any) and confirm the "No exotic armor owned for this
   class" message appears.

**Step 4: Note any follow-ups**

If the precompute step is noticeably slow for your inventory size, or the results list is
unwieldy, note this for a follow-up plan (e.g. result pagination/virtualization) - out of scope
for this plan per the design doc's "Open implementation details."

