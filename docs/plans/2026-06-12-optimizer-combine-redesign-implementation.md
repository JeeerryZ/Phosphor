# Optimizer Combine Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the optimizer's `combineSlots` (which cartesian-products per-slot, 32x-expanded
tuning variants and explodes combinatorially) with a design that decouples item selection from
tuning/mod-delta selection, fixing the multi-minute hang while producing identical
`OptimizerResult[]` output.

**Architecture:** See `docs/plans/2026-06-12-optimizer-combine-redesign-design.md`. In short:
combine per-slot *base* item stats (small: ~14 items/slot) separately from a precomputed,
universal "adjustment frontier" (tuning deltas + mod deltas, small bounded vectors), then cross
the two at the end.

**Tech Stack:** TypeScript, Vitest.

---

## Task 1: Commit the already-implemented mod-delta and Pareto fixes

These two fixes were made and verified earlier this session and are correct, tested building
blocks for the redesign below. Commit them on their own before starting new work.

**Files:**
- `src/lib/optimizer/mod-deltas.ts` (modified)
- `src/lib/optimizer/mod-deltas.test.ts` (modified)
- `src/lib/optimizer/pareto.ts` (modified)

**Step 1: Run the full test suite to confirm these still pass**

Run: `npx vitest run`
Expected: `8 passed (8)` test files, `27 passed (27)` tests.

**Step 2: Commit**

```bash
git add src/lib/optimizer/mod-deltas.ts src/lib/optimizer/mod-deltas.test.ts src/lib/optimizer/pareto.ts
git commit -m "fix(optimizer): exact 252-vector mod-delta set and incremental Pareto frontier"
```

---

## Task 2: Add `subtractVectors` to `vectors.ts`

Needed by Task 4's tests to verify an adjustment vector decomposes into tuning deltas + a mod
delta.

**Files:**
- Modify: `src/lib/optimizer/vectors.ts`
- Test: `src/lib/optimizer/vectors.test.ts`

**Step 1: Write the failing test**

Add to `src/lib/optimizer/vectors.test.ts`:

```ts
describe("subtractVectors", () => {
  it("subtracts each stat independently", () => {
    const a = { mobility: 15, resilience: 20, recovery: 10, discipline: 0, intellect: 0, strength: 0 };
    const b = { mobility: 5, resilience: 0, recovery: 10, discipline: -5, intellect: 0, strength: 0 };
    expect(subtractVectors(a, b)).toEqual({
      mobility: 10,
      resilience: 20,
      recovery: 0,
      discipline: 5,
      intellect: 0,
      strength: 0,
    });
  });
});
```

Add `subtractVectors` to the import at the top of the file:

```ts
import { addVectors, zeroVector, vectorKey, dedupeByStats, subtractVectors } from "./vectors";
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/optimizer/vectors.test.ts`
Expected: FAIL with "subtractVectors is not a function" (or similar import error).

**Step 3: Implement `subtractVectors`**

Add to `src/lib/optimizer/vectors.ts`, after `addVectors`:

```ts
export function subtractVectors(a: StatVector, b: StatVector): StatVector {
  const result = zeroVector();
  for (const stat of ARMOR_STAT_ORDER) {
    result[stat] = a[stat] - b[stat];
  }
  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/optimizer/vectors.test.ts`
Expected: PASS (5 tests).

**Step 5: Commit**

```bash
git add src/lib/optimizer/vectors.ts src/lib/optimizer/vectors.test.ts
git commit -m "feat(optimizer): add subtractVectors helper"
```

---

## Task 3: Replace `computeTuningVariants` with `tuningDeltas` and `tuningDeltaVector`

`computeTuningVariants` (item base stats + each tuning variant) is only used by the old
`index.ts`/`combine.ts`, which Tasks 5-6 remove. The new design needs two smaller, item-independent
primitives instead:

- `tuningDeltas()`: the universal 32-vector `(ArmorTuning, delta)` menu shared by every item with a
  tuning socket.
- `tuningDeltaVector(tuning)`: the delta for a single `ArmorTuning` value (used to compute a
  `SlotChoice`'s final `stats` once a tuning choice has been assigned).

`directionalTuningPairs` stays (still used to build `tuningDeltas`).

**Files:**
- Modify: `src/lib/optimizer/tuning-variants.ts`
- Modify: `src/lib/optimizer/tuning-variants.test.ts`

**Step 1: Write the failing tests**

Replace the entire contents of `src/lib/optimizer/tuning-variants.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { directionalTuningPairs, tuningDeltaVector, tuningDeltas } from "./tuning-variants";
import { dedupeByStats, vectorKey, zeroVector } from "./vectors";

describe("directionalTuningPairs", () => {
  it("returns all 30 ordered pairs of distinct stats", () => {
    const pairs = directionalTuningPairs();
    expect(pairs).toHaveLength(30);
    expect(pairs.every((p) => p.increasedStat !== p.decreasedStat)).toBe(true);

    const keys = new Set(pairs.map((p) => `${p.increasedStat}->${p.decreasedStat}`));
    expect(keys.size).toBe(30);
  });
});

describe("tuningDeltas", () => {
  it("returns 32 entries: empty + balanced + 30 directional", () => {
    const deltas = tuningDeltas();
    expect(deltas).toHaveLength(32);
    expect(deltas.filter((d) => d.tuning.kind === "empty")).toHaveLength(1);
    expect(deltas.filter((d) => d.tuning.kind === "balanced")).toHaveLength(1);
    expect(deltas.filter((d) => d.tuning.kind === "directional")).toHaveLength(30);
  });

  it("the empty delta is zero", () => {
    const empty = tuningDeltas().find((d) => d.tuning.kind === "empty");
    expect(empty?.delta).toEqual(zeroVector());
  });

  it("the balanced delta adds +1 to every stat", () => {
    const balanced = tuningDeltas().find((d) => d.tuning.kind === "balanced");
    expect(balanced?.delta).toEqual({
      mobility: 1,
      resilience: 1,
      recovery: 1,
      discipline: 1,
      intellect: 1,
      strength: 1,
    });
  });

  it("each directional delta moves 5 points from the decreased stat to the increased stat", () => {
    const directional = tuningDeltas().find(
      (d) =>
        d.tuning.kind === "directional" &&
        d.tuning.increasedStat === "intellect" &&
        d.tuning.decreasedStat === "mobility"
    );

    expect(directional?.delta).toEqual({
      ...zeroVector(),
      mobility: -5,
      intellect: 5,
    });
  });

  it("has no duplicate delta vectors", () => {
    expect(dedupeByStats(tuningDeltas().map((d) => ({ stats: d.delta })))).toHaveLength(32);
  });
});

describe("tuningDeltaVector", () => {
  it("is zero for 'none' and 'empty'", () => {
    expect(tuningDeltaVector({ kind: "none" })).toEqual(zeroVector());
    expect(tuningDeltaVector({ kind: "empty" })).toEqual(zeroVector());
  });

  it("is +1 to every stat for 'balanced'", () => {
    expect(tuningDeltaVector({ kind: "balanced" })).toEqual({
      mobility: 1,
      resilience: 1,
      recovery: 1,
      discipline: 1,
      intellect: 1,
      strength: 1,
    });
  });

  it("matches tuningDeltas for 'directional'", () => {
    const directional = tuningDeltas().find((d) => d.tuning.kind === "directional")!;
    expect(vectorKey(tuningDeltaVector(directional.tuning))).toBe(vectorKey(directional.delta));
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/optimizer/tuning-variants.test.ts`
Expected: FAIL (`tuningDeltas`/`tuningDeltaVector` are not exported yet).

**Step 3: Replace `tuning-variants.ts`**

Replace the entire contents of `src/lib/optimizer/tuning-variants.ts` with:

```ts
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import type { ArmorStatName } from "@/lib/armor/types";
import type { ArmorTuning } from "@/lib/armor/tuning";
import { zeroVector, type StatVector } from "./vectors";

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
 * The universal set of 32 Tier 5 tuning deltas available to any item with a tuning socket: empty
 * (no change), balanced (+1 to every stat), and the 30 directional +5/-5 swaps. Every tuned item
 * shares this exact menu, independent of its base stats.
 */
export function tuningDeltas(): Array<{ tuning: ArmorTuning; delta: StatVector }> {
  const deltas: Array<{ tuning: ArmorTuning; delta: StatVector }> = [
    { tuning: { kind: "empty" }, delta: zeroVector() },
    { tuning: { kind: "balanced" }, delta: balancedDelta() },
  ];

  for (const { increasedStat, decreasedStat } of directionalTuningPairs()) {
    const delta = zeroVector();
    delta[increasedStat] += 5;
    delta[decreasedStat] -= 5;
    deltas.push({ tuning: { kind: "directional", increasedStat, decreasedStat }, delta });
  }

  return deltas;
}

/** The stat delta contributed by a given tuning choice (zero for "none" and "empty"). */
export function tuningDeltaVector(tuning: ArmorTuning): StatVector {
  if (tuning.kind === "balanced") {
    return balancedDelta();
  }
  if (tuning.kind === "directional") {
    const delta = zeroVector();
    delta[tuning.increasedStat] += 5;
    delta[tuning.decreasedStat] -= 5;
    return delta;
  }
  return zeroVector();
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/optimizer/tuning-variants.test.ts`
Expected: PASS (11 tests).

**Step 5: Commit**

```bash
git add src/lib/optimizer/tuning-variants.ts src/lib/optimizer/tuning-variants.test.ts
git commit -m "refactor(optimizer): replace computeTuningVariants with tuningDeltas/tuningDeltaVector"
```

---

## Task 4: Add `adjustment-frontier.ts`

Precomputes, for each possible count `k` (0-5) of tuned items in a loadout, the Pareto frontier of
achievable "adjustment" vectors: the sum of `k` independent picks from the universal 32-vector
tuning-delta menu, plus one pick from the 252-vector mod-delta set. Each entry retains the
`tuningAssignment` (the `k` `ArmorTuning` choices) needed to label the final loadout's items.

**Files:**
- Create: `src/lib/optimizer/adjustment-frontier.ts`
- Test: `src/lib/optimizer/adjustment-frontier.test.ts`

**Step 1: Write the failing tests**

Create `src/lib/optimizer/adjustment-frontier.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getAdjustmentFrontier } from "./adjustment-frontier";
import { getModDeltaSet } from "./mod-deltas";
import { dominates } from "./pareto";
import { tuningDeltaVector } from "./tuning-variants";
import { addVectors, subtractVectors, vectorKey, zeroVector } from "./vectors";

describe("getAdjustmentFrontier", () => {
  it("for 0 tuned slots, is exactly the mod-delta set with empty tuning assignments", () => {
    const adj = getAdjustmentFrontier(0);
    const modDeltaKeys = new Set(getModDeltaSet().map(vectorKey));

    expect(adj.every((a) => a.tuningAssignment.length === 0)).toBe(true);
    expect(new Set(adj.map((a) => vectorKey(a.stats)))).toEqual(modDeltaKeys);
  });

  it("each entry's tuningAssignment has length equal to the requested tuned-slot count", () => {
    for (let k = 0; k <= 5; k++) {
      const adj = getAdjustmentFrontier(k);
      expect(adj.length).toBeGreaterThan(0);
      for (const entry of adj) {
        expect(entry.tuningAssignment).toHaveLength(k);
      }
    }
  });

  it("every entry's stats equal its tuning assignment's deltas plus some mod delta", () => {
    const modDeltaKeys = new Set(getModDeltaSet().map(vectorKey));

    for (let k = 0; k <= 5; k++) {
      for (const entry of getAdjustmentFrontier(k)) {
        const tuningSum = entry.tuningAssignment.reduce(
          (sum, tuning) => addVectors(sum, tuningDeltaVector(tuning)),
          zeroVector()
        );
        const remainder = subtractVectors(entry.stats, tuningSum);
        expect(modDeltaKeys.has(vectorKey(remainder))).toBe(true);
      }
    }
  });

  it("is itself a Pareto frontier for each k", () => {
    for (let k = 0; k <= 5; k++) {
      const adj = getAdjustmentFrontier(k);
      for (const candidate of adj) {
        expect(adj.some((other) => dominates(other.stats, candidate.stats))).toBe(false);
      }
    }
  });

  it("is cached across calls", () => {
    expect(getAdjustmentFrontier(2)).toBe(getAdjustmentFrontier(2));
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/optimizer/adjustment-frontier.test.ts`
Expected: FAIL (module does not exist).

**Step 3: Implement `adjustment-frontier.ts`**

Create `src/lib/optimizer/adjustment-frontier.ts`:

```ts
import type { ArmorTuning } from "@/lib/armor/tuning";
import { getModDeltaSet } from "./mod-deltas";
import { paretoFrontier } from "./pareto";
import { tuningDeltas } from "./tuning-variants";
import { addVectors, dedupeByStats, zeroVector, type StatVector } from "./vectors";

const MAX_TUNED_SLOTS = 5;

export interface Adjustment {
  stats: StatVector;
  /** One tuning choice per tuned slot, in canonical assignment order. */
  tuningAssignment: ArmorTuning[];
}

let cachedFrontiers: Adjustment[][] | null = null;

/**
 * The Pareto frontier of achievable adjustment vectors - the sum of `tunedSlots` independent
 * Tier 5 tuning deltas (one per tuned item in the loadout) plus one stat-mod allocation - for a
 * loadout with exactly `tunedSlots` items (0-5) that have a tuning socket.
 *
 * Each entry's `tuningAssignment` has length `tunedSlots`: the tuning choice to assign to each
 * tuned item, in canonical order.
 */
export function getAdjustmentFrontier(tunedSlots: number): Adjustment[] {
  if (!cachedFrontiers) {
    cachedFrontiers = buildAdjustmentFrontiers();
  }
  return cachedFrontiers[tunedSlots];
}

function buildAdjustmentFrontiers(): Adjustment[][] {
  const deltas = tuningDeltas();
  const modDeltas = getModDeltaSet();

  let tuningFrontier: Adjustment[] = [{ stats: zeroVector(), tuningAssignment: [] }];
  const result: Adjustment[][] = [crossWithMods(tuningFrontier, modDeltas)];

  for (let k = 1; k <= MAX_TUNED_SLOTS; k++) {
    const next: Adjustment[] = [];
    for (const prev of tuningFrontier) {
      for (const { tuning, delta } of deltas) {
        next.push({
          stats: addVectors(prev.stats, delta),
          tuningAssignment: [...prev.tuningAssignment, tuning],
        });
      }
    }
    tuningFrontier = paretoFrontier(dedupeByStats(next));
    result.push(crossWithMods(tuningFrontier, modDeltas));
  }

  return result;
}

function crossWithMods(tuningFrontier: Adjustment[], modDeltas: StatVector[]): Adjustment[] {
  const crossed = tuningFrontier.flatMap((adj) =>
    modDeltas.map((modDelta) => ({
      stats: addVectors(adj.stats, modDelta),
      tuningAssignment: adj.tuningAssignment,
    }))
  );
  return paretoFrontier(dedupeByStats(crossed));
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/optimizer/adjustment-frontier.test.ts`
Expected: PASS (5 tests). If this takes more than a couple seconds, note the timing - it's a
signal for Task 7's performance guard.

**Step 5: Commit**

```bash
git add src/lib/optimizer/adjustment-frontier.ts src/lib/optimizer/adjustment-frontier.test.ts
git commit -m "feat(optimizer): add adjustment-frontier (tuning + mod deltas, by tuned-slot count)"
```

---

## Task 5: Rewrite `combine.ts`

Replaces `combineSlots(slotVariants: SlotChoice[][])` (cartesian product of 32x-expanded
tuning variants) with `combineSlots(itemsBySlot: ArmorItem[][])`:

1. Per-slot base-stat frontier (`slotFrontier`), with the tuned/untuned pruning rule from the
   design doc.
2. Cartesian-combine the 5 slot frontiers (incremental Pareto), tracking `tunedCount`.
3. Cross each combined loadout with `getAdjustmentFrontier(tunedCount)`, assigning tuning labels
   to tuned items (`assignTuning`).
4. Final Pareto frontier over the combined results.

`SlotChoice`/`LoadoutCandidate` types are unchanged (same shape consumed by `index.ts` and the UI).

**Files:**
- Modify: `src/lib/optimizer/combine.ts`
- Modify: `src/lib/optimizer/combine.test.ts`

**Step 1: Write the failing tests**

Replace the entire contents of `src/lib/optimizer/combine.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import type { ArmorItem, ArmorStats } from "@/lib/armor/types";
import type { ArmorTuning } from "@/lib/armor/tuning";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { combineSlots } from "./combine";
import { tuningDeltaVector } from "./tuning-variants";
import { addVectors, zeroVector } from "./vectors";

function makeItem(
  slot: ArmorItem["slot"],
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

function totalOf(stats: ArmorStats): number {
  return ARMOR_STAT_ORDER.reduce((sum, stat) => sum + stats[stat], 0);
}

describe("combineSlots", () => {
  it("sums base stats across one item per slot, plus a stat-mod allocation", () => {
    const helmet = makeItem("helmet", "Helmet", { ...zeroVector(), mobility: 10 });
    const gauntlets = makeItem("gauntlets", "Gauntlets", { ...zeroVector(), resilience: 20 });

    const result = combineSlots([[helmet], [gauntlets]]);

    expect(result.length).toBeGreaterThan(0);
    for (const candidate of result) {
      expect(candidate.choices.helmet?.item.name).toBe("Helmet");
      expect(candidate.choices.gauntlets?.item.name).toBe("Gauntlets");
      expect(candidate.stats.mobility).toBeGreaterThanOrEqual(10);
      expect(candidate.stats.resilience).toBeGreaterThanOrEqual(20);
      // Base total (30) + 50 from 5 mod slots at +10 each.
      expect(totalOf(candidate.stats)).toBe(80);
    }
  });

  it("prunes an item dominated by another item in the same slot", () => {
    const helmetA = makeItem("helmet", "Helmet A", { ...zeroVector(), mobility: 10, resilience: 10 });
    const helmetB = makeItem("helmet", "Helmet B", { ...zeroVector(), mobility: 10, resilience: 5 });
    const gauntlets = makeItem("gauntlets", "Gauntlets", { ...zeroVector(), recovery: 5 });

    const result = combineSlots([[helmetA, helmetB], [gauntlets]]);

    expect(result.length).toBeGreaterThan(0);
    for (const candidate of result) {
      expect(candidate.choices.helmet?.item.name).toBe("Helmet A");
    }
  });

  it("assigns a tuning choice to items with a tuning socket, reflected in choice.stats", () => {
    const helmet = makeItem("helmet", "Helmet", { ...zeroVector(), mobility: 10 }, { kind: "empty" });
    const gauntlets = makeItem("gauntlets", "Gauntlets", { ...zeroVector(), resilience: 10 });

    const result = combineSlots([[helmet], [gauntlets]]);

    expect(result.length).toBeGreaterThan(0);

    // Different directional tuning swaps trade off different stat pairs, so the frontier should
    // include more than one distinct tuning choice for the tuned helmet.
    const tuningKinds = new Set(result.map((c) => JSON.stringify(c.choices.helmet?.tuning)));
    expect(tuningKinds.size).toBeGreaterThan(1);

    for (const candidate of result) {
      const helmetChoice = candidate.choices.helmet!;
      expect(helmetChoice.stats).toEqual(
        addVectors(helmet.stats, tuningDeltaVector(helmetChoice.tuning))
      );

      const gauntletsChoice = candidate.choices.gauntlets!;
      expect(gauntletsChoice.tuning).toEqual({ kind: "none" });
      expect(gauntletsChoice.stats).toEqual(gauntlets.stats);
    }
  });

  it("returns an empty array for empty input", () => {
    expect(combineSlots([])).toEqual([]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/optimizer/combine.test.ts`
Expected: FAIL (old `combineSlots` expects `SlotChoice[][]`, not `ArmorItem[][]`; type/behavior
mismatches).

**Step 3: Replace `combine.ts`**

Replace the entire contents of `src/lib/optimizer/combine.ts` with:

```ts
import { ARMOR_BUCKET_HASHES } from "@/lib/armor/types";
import type { ArmorItem, ArmorSlot } from "@/lib/armor/types";
import type { ArmorTuning } from "@/lib/armor/tuning";
import { getAdjustmentFrontier } from "./adjustment-frontier";
import { dominates, paretoFrontier } from "./pareto";
import { tuningDeltaVector } from "./tuning-variants";
import { addVectors, dedupeByStats, type StatVector } from "./vectors";

export interface SlotChoice {
  item: ArmorItem;
  tuning: ArmorTuning;
  stats: StatVector;
}

export interface LoadoutCandidate {
  choices: Partial<Record<ArmorSlot, SlotChoice>>;
  stats: StatVector;
}

const ALL_SLOTS = Object.keys(ARMOR_BUCKET_HASHES) as ArmorSlot[];

interface ItemCandidate {
  item: ArmorItem;
  hasTuning: boolean;
  stats: StatVector;
}

interface PartialLoadout {
  items: Partial<Record<ArmorSlot, ItemCandidate>>;
  stats: StatVector;
  tunedCount: number;
}

/**
 * Computes the Pareto frontier of final loadouts: one item per slot (from `itemsBySlot`), a Tier
 * 5 tuning choice for every item with a tuning socket, and a stat-mod allocation across all
 * chosen items.
 *
 * See docs/plans/2026-06-12-optimizer-combine-redesign-design.md for the algorithm: item
 * selection (base stats only) and tuning/mod-delta selection are combined independently, then
 * crossed at the end - avoiding the cartesian explosion of expanding every item into its ~32
 * tuning variants before combining slots.
 */
export function combineSlots(itemsBySlot: ArmorItem[][]): LoadoutCandidate[] {
  if (itemsBySlot.length === 0) {
    return [];
  }

  const slotFrontiers = itemsBySlot.map(slotFrontier);

  let combined: PartialLoadout[] = slotFrontiers[0].map((candidate) => ({
    items: { [candidate.item.slot]: candidate },
    stats: candidate.stats,
    tunedCount: candidate.hasTuning ? 1 : 0,
  }));
  combined = paretoFrontier(dedupeByStats(combined));

  for (let i = 1; i < slotFrontiers.length; i++) {
    const next: PartialLoadout[] = [];
    for (const acc of combined) {
      for (const candidate of slotFrontiers[i]) {
        next.push({
          items: { ...acc.items, [candidate.item.slot]: candidate },
          stats: addVectors(acc.stats, candidate.stats),
          tunedCount: acc.tunedCount + (candidate.hasTuning ? 1 : 0),
        });
      }
    }
    combined = paretoFrontier(dedupeByStats(next));
  }

  const results: LoadoutCandidate[] = combined.flatMap((loadout) =>
    getAdjustmentFrontier(loadout.tunedCount).map((adjustment) => ({
      choices: assignTuning(loadout.items, adjustment.tuningAssignment),
      stats: addVectors(loadout.stats, adjustment.stats),
    }))
  );

  return paretoFrontier(dedupeByStats(results));
}

/**
 * The Pareto frontier of an armor slot's candidates, by base stats only.
 *
 * Tuned items are pruned against each other only: they share an identical tuning-delta menu, so
 * if one tuned item's base stats dominate another's, the dominator can reproduce any of the
 * dominated item's (base + delta) vectors using the same delta.
 *
 * Untuned items are pruned against each other and against tuned items (a tuned item can always
 * pick the zero "empty" delta to match an untuned item's base stats exactly). A tuned item is
 * never pruned by an untuned one - the tuned item's non-zero deltas may reach vectors the untuned
 * item can never match.
 */
function slotFrontier(items: ArmorItem[]): ItemCandidate[] {
  const candidates: ItemCandidate[] = items.map((item) => ({
    item,
    hasTuning: item.tuning.kind !== "none",
    stats: item.stats,
  }));

  const tuned = paretoFrontier(dedupeByStats(candidates.filter((c) => c.hasTuning)));
  const untuned = paretoFrontier(dedupeByStats(candidates.filter((c) => !c.hasTuning)));
  const untunedSurvivors = untuned.filter((u) => !tuned.some((t) => dominates(t.stats, u.stats)));

  return [...tuned, ...untunedSurvivors];
}

/**
 * Assigns each tuned item (visiting slots in `ALL_SLOTS` order) the next tuning choice from
 * `tuningAssignment`, and `{ kind: "none" }` to untuned items. `tuningAssignment.length` must
 * equal the number of tuned items among `items`.
 */
function assignTuning(
  items: Partial<Record<ArmorSlot, ItemCandidate>>,
  tuningAssignment: ArmorTuning[]
): Partial<Record<ArmorSlot, SlotChoice>> {
  const choices: Partial<Record<ArmorSlot, SlotChoice>> = {};
  let next = 0;

  for (const slot of ALL_SLOTS) {
    const candidate = items[slot];
    if (!candidate) continue;

    const tuning: ArmorTuning = candidate.hasTuning ? tuningAssignment[next++] : { kind: "none" };
    choices[slot] = {
      item: candidate.item,
      tuning,
      stats: addVectors(candidate.item.stats, tuningDeltaVector(tuning)),
    };
  }

  return choices;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/optimizer/combine.test.ts`
Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add src/lib/optimizer/combine.ts src/lib/optimizer/combine.test.ts
git commit -m "refactor(optimizer): redesign combineSlots to decouple item selection from tuning/mod deltas"
```

---

## Task 6: Update `index.ts` orchestration

`combineSlots` now takes raw `ArmorItem[][]` and already returns the final Pareto frontier
(including mods), so `computeOptimizerResults` no longer needs to expand tuning variants, apply
mod deltas, or re-run Pareto pruning itself.

**Files:**
- Modify: `src/lib/optimizer/index.ts`
- Test: `src/lib/optimizer/index.test.ts` (no changes expected, but re-run to confirm)

**Step 1: Confirm the existing test still describes the desired behavior**

Read `src/lib/optimizer/index.test.ts` - both tests (`locks the exotic into its slot...` and
`returns an empty array when a non-exotic slot has no candidates`) describe behavior that holds
under the new design (verified during planning). No edits needed yet; Step 4 re-runs them.

**Step 2: Run the test to see it fail against the old implementation's imports**

Not applicable yet - the old `index.ts` still compiles against the old `combine.ts`. Skip to
Step 3 (the failure will show up as a type error once `combine.ts` has changed, which it already
has from Task 5).

Run: `npx vitest run src/lib/optimizer/index.test.ts`
Expected: FAIL (type error - `combineSlots` now expects `ArmorItem[][]`, and `index.ts` still
calls `computeTuningVariants`, which no longer exists).

**Step 3: Replace `index.ts`**

Replace the entire contents of `src/lib/optimizer/index.ts` with:

```ts
import { ARMOR_BUCKET_HASHES } from "@/lib/armor/types";
import type { ArmorItem, ArmorSlot } from "@/lib/armor/types";
import { combineSlots, type LoadoutCandidate, type SlotChoice } from "./combine";
import type { StatVector } from "./vectors";

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
  const itemsBySlot: ArmorItem[][] = [];

  for (const slot of ALL_SLOTS) {
    const items = slot === exotic.slot ? [exotic] : candidatesBySlot[slot] ?? [];
    if (items.length === 0) {
      return [];
    }
    itemsBySlot.push(items);
  }

  return combineSlots(itemsBySlot).map((loadout) => ({
    stats: loadout.stats,
    loadout: loadout.choices,
  }));
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/optimizer/index.test.ts`
Expected: PASS (2 tests).

**Step 5: Commit**

```bash
git add src/lib/optimizer/index.ts
git commit -m "refactor(optimizer): simplify computeOptimizerResults for the new combineSlots"
```

---

## Task 7: Performance guard test

Add a test using realistic inventory sizes (~14 items/slot, 5 slots, all with tuning sockets) and
assert the whole computation finishes within a fixed wall-clock budget. This is the regression
guard for the original hang.

**Files:**
- Create: `src/lib/optimizer/performance.test.ts`

**Step 1: Write the test**

Create `src/lib/optimizer/performance.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { ArmorItem, ArmorSlot, ArmorStats } from "@/lib/armor/types";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { combineSlots } from "./combine";
import { zeroVector } from "./vectors";

const SLOTS: ArmorSlot[] = ["helmet", "gauntlets", "chest", "legs", "classItem"];
const ITEMS_PER_SLOT = 14;

function makeItem(slot: ArmorSlot, index: number): ArmorItem {
  const stats: ArmorStats = zeroVector();
  ARMOR_STAT_ORDER.forEach((stat, statIndex) => {
    // Spread a varied stat distribution per item so slots don't collapse to one dominant choice.
    stats[stat] = ((index + statIndex * 3) % 7) * 4 + 10;
  });

  return {
    itemInstanceId: `${slot}-${index}`,
    itemHash: 0,
    name: `${slot} ${index}`,
    icon: "",
    slot,
    tierType: 5,
    classType: 0,
    stats,
    tuning: { kind: "empty" },
    power: 0,
    gearTier: 5,
    isMasterworked: true,
    location: "vault",
  };
}

describe("combineSlots performance", () => {
  it("completes within a reasonable time for realistic inventory sizes", () => {
    const itemsBySlot = SLOTS.map((slot) =>
      Array.from({ length: ITEMS_PER_SLOT }, (_, i) => makeItem(slot, i))
    );

    const start = Date.now();
    const result = combineSlots(itemsBySlot);
    const elapsed = Date.now() - start;

    expect(result.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2000);
  }, 10000);
});
```

**Step 2: Run the test**

Run: `npx vitest run src/lib/optimizer/performance.test.ts`
Expected: PASS, completing well under 2000ms (this is the key regression check - the old
implementation would hang/take minutes on this input).

If it's slow or fails, profile with a standalone `npx tsx` script (vitest buffers
`console.log` per-test, so it won't show progress on a hanging test) to find which step
(`slotFrontier`, the slot-combination loop, or `getAdjustmentFrontier`) is slow, and revisit the
design doc's complexity assumptions for that step.

**Step 3: Commit**

```bash
git add src/lib/optimizer/performance.test.ts
git commit -m "test(optimizer): add performance guard for combineSlots at realistic inventory sizes"
```

---

## Task 8: Full test suite, lint, and typecheck

**Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all test files pass (existing 8 files plus `adjustment-frontier.test.ts` and
`performance.test.ts` = 10 files; `tuning-variants.test.ts` and `combine.test.ts` have different
test counts than before but should all pass).

**Step 2: Run lint**

Run: `npm run lint`
Expected: no errors. Fix any unused-import or type errors surfaced by the refactor (e.g. if
`SlotChoice`/`LoadoutCandidate` re-exports in `index.ts` are now unused - check
`OptimizerResults.tsx` and other UI imports before removing).

**Step 3: Run a production build**

Run: `npm run build`
Expected: build succeeds (catches any type errors not caught by lint/vitest).

---

## Task 9: Manual end-to-end verification (resume Task 16 from the original implementation plan)

This is the original Task 16 from `docs/plans/2026-06-10-armor-optimizer-implementation.md`,
picking up where it left off - now that the combinatorial hang is fixed.

**Step 1: Start the dev server**

Run (in background): `npm run dev`

Access via the ngrok tunnel (`https://evenly-deep-terrapin.ngrok-free.app`), per
`CLAUDE.md` - not `localhost`.

**Step 2: Verify the optimizer page end-to-end**

Using Playwright (browser tools):

1. Navigate to `/optimizer`. Confirm class tabs (Titan/Hunter/Warlock) show the correct owned
   exotics per class.
2. Select an exotic. Confirm results load **without hanging** (this is the main regression check)
   and the "Computing combinations..." status clears within a few seconds.
3. Adjust a couple of stat threshold sliders (e.g. Super/intellect and Weapons/mobility to ~180
   each) and confirm the results list re-filters/re-sorts client-side without a new request.
4. Change the "optimize for" dropdown and confirm results re-sort.
5. Expand a result row and confirm it shows 5 items (one per slot) with tuning notes (e.g.
   "(tuning: +Super / -Weapons)" or "(tuning: balanced)") where applicable.
6. Set thresholds high enough that no result qualifies (e.g. all sliders to 200); confirm the
   empty-state message appears.
7. Switch to a class with no owned exotics (if any); confirm the appropriate empty-state message.
8. Repeat steps 2-5 for a second exotic with different threshold choices, to confirm results
   differ sensibly per exotic.

**Step 3: Update the original plan's task list**

Mark Task 16 (`docs/plans/2026-06-10-armor-optimizer-implementation.md`) as complete once the
above passes.

---

## Task 10: Final code review and finishing the branch

**REQUIRED SUB-SKILL:** Use superpowers:requesting-code-review to dispatch a final code reviewer
for the combined diff (Tasks 1-9), then superpowers:finishing-a-development-branch to decide how
to integrate the work (merge, PR, etc.).
