# Legendary T5 Tuning Fixed-Increase-Stat Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop the optimizer from treating a legendary armor piece's Tier 5 tuning socket
as a free choice among all 6 stats — each legendary piece can only ever increase one
specific (fixed-per-instance) stat; only the decrease stat is freely chosen. Exotics stay
free-choice on both ends.

**Architecture:** Fetch Bungie's `ItemReusablePlugs` profile component (the documented
mechanism for per-instance plug eligibility, since the static manifest only exposes a
30-combo superset identical across every legendary item). Derive each legendary item's
fixed increase stat from it, carry that constraint through `SlotCandidate`, and replace the
optimizer's multiset boost-enumeration with a per-slot Cartesian product that respects each
slot's own allowed-stat domain.

**Tech Stack:** TypeScript, `bungie-api-ts`, Vitest.

---

### Task 1: Fetch the `ItemReusablePlugs` profile component

**Files:**
- Modify: `src/lib/bungie/profile.ts`

No test needed — this file has no existing tests (it's a thin wrapper around
`bungie-api-ts`'s `getProfile`), verified instead by the build and by Task 2's test relying
on the new field shape.

**Step 1: Add the component constant and include it in the request**

In `src/lib/bungie/profile.ts`, find the block of `COMPONENT_*` constants (currently
`COMPONENT_PROFILE_INVENTORIES` through `COMPONENT_ITEM_SOCKETS`) and add:

```typescript
const COMPONENT_ITEM_REUSABLE_PLUGS = 310;
```

Then add `COMPONENT_ITEM_REUSABLE_PLUGS` to the `components` array passed to `getProfile`,
alongside the existing `COMPONENT_ITEM_SOCKETS`.

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/lib/bungie/profile.ts
git commit -m "feat(bungie): fetch ItemReusablePlugs profile component"
```

---

### Task 2: Derive each legendary item's fixed tuning-increase stat (TDD)

**Files:**
- Modify: `src/lib/armor/types.ts`
- Modify: `src/lib/armor/transform.ts`
- Modify: `src/lib/armor/transform.test.ts`

`ItemReusablePlugs` gives the *live*, per-instance list of plugs actually insertable into a
socket (`canInsert: boolean`), unlike the static manifest definition which lists the same
30-plug superset for every legendary item. We intersect that live list with the known
directional tuning plugs (`STAT_TUNING_PLUGS`, already in `src/lib/armor/tuning.ts`) and
take the single `increasedStat` they all share.

**Step 1: Add the new field to `ArmorItem`**

In `src/lib/armor/types.ts`, add to the `ArmorItem` interface (near `tuningSocketIndex`):

```typescript
  /**
   * For legendary (non-exotic) armor with a Tier 5 tuning socket: the one stat this
   * specific item instance is allowed to increase via tuning (the decrease stat is freely
   * chosen among the other 5). Undefined for exotics (free-choice) and for legendary items
   * where this couldn't be determined from live plug data.
   */
  legendaryTuningIncreaseStat?: ArmorStatName;
```

Add `ArmorStatName` to the type-only imports at the top of the file if not already
present as a local type (it's already defined in this same file, so no import needed —
just reference it directly).

**Step 2: Write the failing test**

Add to `src/lib/armor/transform.test.ts` (this file already exists from the exotic-perks
fix and already mocks `@/lib/manifest/definitions` — add a new `describe` block, don't
duplicate the existing mock setup):

```typescript
import { STAT_TUNING_PLUGS } from "./tuning";

describe("readLegendaryTuningIncreaseStat", () => {
  function makeProfileWithReusablePlugs(
    plugs: { plugItemHash: number; canInsert: boolean }[]
  ): DestinyProfileResponse {
    return {
      itemComponents: {
        reusablePlugs: { data: { "item-1": { plugs: { 5: plugs } } } },
      },
    } as unknown as DestinyProfileResponse;
  }

  it("returns the single increase stat shared by all insertable directional plugs", async () => {
    const { readLegendaryTuningIncreaseStat } = await import("./transform");
    // Every STAT_TUNING_PLUGS entry whose increasedStat is "discipline":
    const disciplinePlugs = Object.entries(STAT_TUNING_PLUGS)
      .filter(([, v]) => v.increasedStat === "discipline")
      .map(([hash]) => ({ plugItemHash: Number(hash), canInsert: true }));
    const profile = makeProfileWithReusablePlugs(disciplinePlugs);

    expect(readLegendaryTuningIncreaseStat("item-1", 5, profile)).toBe("discipline");
  });

  it("ignores plugs that can't actually be inserted", async () => {
    const { readLegendaryTuningIncreaseStat } = await import("./transform");
    const [hash, { increasedStat }] = Object.entries(STAT_TUNING_PLUGS)[0];
    const profile = makeProfileWithReusablePlugs([
      { plugItemHash: Number(hash), canInsert: false },
    ]);

    expect(readLegendaryTuningIncreaseStat("item-1", 5, profile)).toBeUndefined();
    void increasedStat; // unused, just destructured for clarity
  });

  it("returns undefined when no live reusable-plugs data exists for this socket", async () => {
    const { readLegendaryTuningIncreaseStat } = await import("./transform");
    const profile = { itemComponents: { reusablePlugs: { data: {} } } } as unknown as DestinyProfileResponse;

    expect(readLegendaryTuningIncreaseStat("item-1", 5, profile)).toBeUndefined();
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/armor/transform.test.ts`
Expected: FAIL — `readLegendaryTuningIncreaseStat is not a function` (not exported yet)

**Step 4: Write the implementation**

In `src/lib/armor/transform.ts`:

1. Add `STAT_TUNING_PLUGS` to the existing import from `./tuning` (currently
   `import { readArmorTuning, type ArmorTuning } from "./tuning";`):

```typescript
import { readArmorTuning, STAT_TUNING_PLUGS, type ArmorTuning } from "./tuning";
```

2. Add a `TIER_LEGENDARY` constant next to the existing `TIER_EXOTIC = 6;`:

```typescript
const TIER_LEGENDARY = 5;
```

3. Add the new function, near `readExoticPerks`:

```typescript
/**
 * Legendary armor's tuning socket lists the same 30-plug superset in its static manifest
 * definition for every item — Bungie narrows it per-instance via the live
 * `ItemReusablePlugs` profile component instead. Returns the single stat every insertable
 * directional plug agrees on increasing, or undefined if that can't be determined (no live
 * data, or — unexpectedly — more than one distinct increase stat).
 */
export function readLegendaryTuningIncreaseStat(
  itemInstanceId: string,
  tuningSocketIndex: number,
  profile: DestinyProfileResponse
): ArmorStatName | undefined {
  const livePlugs = profile.itemComponents.reusablePlugs.data?.[itemInstanceId]?.plugs[tuningSocketIndex] ?? [];
  const increaseStats = new Set<ArmorStatName>();

  for (const plug of livePlugs) {
    if (!plug.canInsert) continue;
    const directional = STAT_TUNING_PLUGS[plug.plugItemHash];
    if (directional) increaseStats.add(directional.increasedStat);
  }

  return increaseStats.size === 1 ? [...increaseStats][0] : undefined;
}
```

Add `ArmorStatName` to the type-only import from `./types` at the top of the file (it
already imports `type ArmorStats` from there — add `type ArmorStatName` alongside it).

4. Wire it into `transformItem`. Find this block:

```typescript
  const exoticPerks =
    tierType === TIER_EXOTIC && slot === "classItem"
      ? readExoticPerks(item.itemInstanceId, definition, profile)
      : undefined;
```

Add directly after it:

```typescript
  const legendaryTuningIncreaseStat =
    tierType === TIER_LEGENDARY && tuningSocketIndex !== undefined
      ? readLegendaryTuningIncreaseStat(item.itemInstanceId, tuningSocketIndex, profile)
      : undefined;
```

5. Add `legendaryTuningIncreaseStat` to the returned `ArmorItem` object (in the `return {`
   block at the end of `transformItem`), right after the existing `exoticPerks` line:

```typescript
    exoticPerks: exoticPerks?.length ? exoticPerks : undefined,
    legendaryTuningIncreaseStat,
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/armor/transform.test.ts`
Expected: PASS (4 tests now — 1 existing `readExoticPerks` test + 3 new)

**Step 6: Run full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green

**Step 7: Commit**

```bash
git add src/lib/armor/types.ts src/lib/armor/transform.ts src/lib/armor/transform.test.ts
git commit -m "feat(armor): derive each legendary item's fixed tuning-increase stat from live plug data"
```

---

### Task 3: Carry the constraint through `SlotCandidate`

**Files:**
- Modify: `src/lib/optimizer/combine.ts`
- Modify: `src/lib/optimizer/combine.test.ts`
- Modify: `src/lib/optimizer/query.ts`

`SlotCandidate` currently has a boolean `hasTuning`. We add `allowedIncreaseStats:
ArmorStatName[]` — the list of stats this specific candidate is allowed to boost via
tuning. For exotics (free-choice) this is all 6 stats; for legendary items it's
`[item.legendaryTuningIncreaseStat]` if known, or `[]` if not (in which case `hasTuning`
must also become `false`, so combo bucketing by `tunedCount` stays accurate — a slot that
can't actually be tuned shouldn't count toward `tunedCount`).

**Step 1: Write the failing test**

This test lives in `combine.test.ts` since that's where `SlotCandidate`/`ItemCombination`
plumbing is exercised. First check the existing file's `makeItem`/candidate helpers (read
`src/lib/optimizer/combine.test.ts` to match its existing style before adding) — then add:

```typescript
describe("selectItemCombinations with allowedIncreaseStats", () => {
  it("carries each candidate's allowedIncreaseStats through to the resulting combination", () => {
    const tunedCandidate: SlotCandidate = {
      item: makeItem({ itemInstanceId: "a", slot: "helmet", gearTier: 5 }),
      stats: zeroVector(),
      hasTuning: true,
      allowedIncreaseStats: ["discipline"],
    };
    const itemsBySlot = { helmet: [tunedCandidate] };

    // selectItemCombinations only needs this one slot filled to produce a tunedCount=1 bucket;
    // the other 4 slots are intentionally left empty to short-circuit to all-empty buckets in
    // this minimal test -- see existing tests in this file for the full-5-slot pattern instead
    // if that's how other tests here are structured.
  });
});
```

**Note to implementer:** adapt the exact test shape to match whatever pattern
`combine.test.ts` already uses (read it first) — the key behavioral assertion is: after
calling `selectItemCombinations`, the resulting `ItemCombination.choices[slot]
.allowedIncreaseStats` for a tuned slot equals exactly what was passed in on the input
`SlotCandidate`. This is mostly a type/plumbing test since `selectItemCombinations` already
copies `SlotCandidate` objects through unchanged — the real risk is the `hasTuning`
property name typo'd or the field dropped during a refactor, not complex logic.

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/optimizer/combine.test.ts`
Expected: FAIL — `Property 'allowedIncreaseStats' is missing` (TypeScript error, since
`SlotCandidate` doesn't have the field yet)

**Step 3: Add the field**

In `src/lib/optimizer/combine.ts`, update the `SlotCandidate` interface:

```typescript
export interface SlotCandidate {
  item: ArmorItem;
  stats: StatVector;
  /** True if this item has a Tier 5 tuning socket (`item.gearTier === 5`) AND tuning is actually usable (see allowedIncreaseStats). */
  hasTuning: boolean;
  /** Stats this candidate may increase via tuning. All 6 for exotics (free choice); a single
   *  fixed stat for legendary items where it's known; empty if unknown/unusable. */
  allowedIncreaseStats: ArmorStatName[];
}
```

Add `ArmorStatName` to the type-only import at the top of the file (currently
`import type { ArmorItem, ArmorSlot } from "@/lib/armor/types";` — add `ArmorStatName`).

**Step 4: Update the two places that construct `SlotCandidate`**

Both live in `src/lib/optimizer/query.ts`. First, `rankCandidates` (used for the 4
non-exotic slots, or all 5 in no-exotic mode):

```typescript
// Before:
return topN.map((item) => ({ item, stats: item.stats, hasTuning: item.gearTier === 5 }));

// After:
return topN.map((item) => {
  const isLegendaryWithFixedStat = item.tierType !== 6 && item.legendaryTuningIncreaseStat !== undefined;
  const isExotic = item.tierType === 6;
  const canTune = item.gearTier === 5 && (isExotic || isLegendaryWithFixedStat);
  return {
    item,
    stats: item.stats,
    hasTuning: canTune,
    allowedIncreaseStats: !canTune ? [] : isExotic ? ARMOR_STAT_ORDER : [item.legendaryTuningIncreaseStat!],
  };
});
```

Second, the exotic-slot branch in `computeOptimizerQuery`:

```typescript
// Before:
itemsBySlot[slot] = [{ item: exotic, stats: exotic.stats, hasTuning: exotic.gearTier === 5 }];

// After:
itemsBySlot[slot] = [{
  item: exotic,
  stats: exotic.stats,
  hasTuning: exotic.gearTier === 5,
  allowedIncreaseStats: exotic.gearTier === 5 ? ARMOR_STAT_ORDER : [],
}];
```

(The exotic branch is always free-choice when tuned — exotics don't carry
`legendaryTuningIncreaseStat`, since `transformItem` only sets that field for
`tierType === TIER_LEGENDARY`.)

**Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/optimizer/combine.test.ts`
Expected: PASS

**Step 6: Run full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green (some other tests in `query.test.ts`/`combine.test.ts` construct
`SlotCandidate` or `ArmorItem` objects directly — if any fail to compile because they're
missing the new field, add `allowedIncreaseStats: []` or `allowedIncreaseStats:
ARMOR_STAT_ORDER` to their test fixtures as appropriate, matching whether that fixture
represents an exotic or legendary candidate)

**Step 7: Commit**

```bash
git add src/lib/optimizer/combine.ts src/lib/optimizer/combine.test.ts src/lib/optimizer/query.ts
git commit -m "feat(optimizer): carry per-candidate allowed tuning-increase stats through SlotCandidate"
```

---

### Task 4: Per-slot Cartesian product boost enumeration (TDD)

**Files:**
- Modify: `src/lib/optimizer/query.ts`
- Modify: `src/lib/optimizer/query.test.ts`

Replaces `enumerateBoostDistributions(k)` — which generates every *multiset* of size `k`
from the 6 stats, valid only when every tuned slot has an identical, interchangeable
domain — with a per-slot Cartesian product over each slot's own `allowedIncreaseStats`.

**Step 1: Write the failing test**

Add to `src/lib/optimizer/query.test.ts` (this file doesn't currently export
`enumerateBoostDistributions`/the new function from `query.ts` — for testability, the new
function needs to be exported; add `export` to its declaration):

```typescript
import { enumerateBoostCombinations } from "./query";

describe("enumerateBoostCombinations", () => {
  it("yields the Cartesian product across asymmetric per-slot domains", () => {
    const results = [...enumerateBoostCombinations([["discipline"], ["mobility", "resilience"]])];
    expect(results).toEqual([
      ["discipline", "mobility"],
      ["discipline", "resilience"],
    ]);
  });

  it("yields a single empty tuple when there are no tuned slots", () => {
    expect([...enumerateBoostCombinations([])]).toEqual([[]]);
  });

  it("yields nothing if any slot's domain is empty", () => {
    expect([...enumerateBoostCombinations([["discipline"], []])]).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/optimizer/query.test.ts`
Expected: FAIL — `enumerateBoostCombinations is not exported` / not a function

**Step 3: Write the implementation**

In `src/lib/optimizer/query.ts`, replace the existing `enumerateBoostDistributions`
function (and its doc comment) entirely with:

```typescript
/**
 * Per-slot Cartesian product: yields every combination of one stat per domain in `domains`,
 * in order. Replaces the old "multiset of any 6 stats" enumeration now that each tuned
 * slot has its own allowed-stat domain (a single fixed stat for legendary items, all 6 for
 * exotics) -- domains are no longer interchangeable, so multiset enumeration would silently
 * drop or misassign stats relative to which physical item occupies which slot.
 */
export function* enumerateBoostCombinations(domains: ArmorStatName[][]): Generator<ArmorStatName[]> {
  if (domains.length === 0) {
    yield [];
    return;
  }
  const [first, ...rest] = domains;
  for (const stat of first) {
    for (const tail of enumerateBoostCombinations(rest)) {
      yield [stat, ...tail];
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/optimizer/query.test.ts`
Expected: the 3 new tests PASS (other tests in this file will still fail until Step 5 — the
`buildResults` loop still calls the now-deleted `enumerateBoostDistributions`)

**Step 5: Wire it into `buildResults`**

Still in `query.ts`, inside `buildResults`, find:

```typescript
    for (const combo of combos) {
      for (const boosts of enumerateBoostDistributions(tunedCount)) {
        boostDistributionsChecked++;
```

Replace with:

```typescript
    for (const combo of combos) {
      const tunedSlots = ALL_SLOTS.filter((slot) => combo.choices[slot]?.hasTuning);
      const domains = tunedSlots.map((slot) => combo.choices[slot]!.allowedIncreaseStats);

      for (const boosts of enumerateBoostCombinations(domains)) {
        boostDistributionsChecked++;
```

Everything below this line in the loop body is unchanged — it only ever consumed
`boosts: ArmorStatName[]` of length `tunedCount`, indexed positionally
(`boosts[i]`/`dumps[i]` for `i` in `0..tunedCount`), and `tunedSlots.length === tunedCount`
by construction (the combo was already bucketed by `tunedCount` in `selectItemCombinations`,
counting exactly the slots where `hasTuning` is true).

**Step 6: Run full suite**

Run: `npx vitest run`
Expected: all green, including the pre-existing `computeOptimizerQuery` tests in
`query.test.ts` (those use exotics/items without `gearTier: 5`, so they have no tuned
slots and never exercise the boost loop at all — should be unaffected)

**Step 7: Run typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean

**Step 8: Commit**

```bash
git add src/lib/optimizer/query.ts src/lib/optimizer/query.test.ts
git commit -m "feat(optimizer): replace multiset boost enumeration with per-slot Cartesian product"
```

---

### Task 5: Regression test — the actual bug fix, end to end

**Files:**
- Modify: `src/lib/optimizer/query.test.ts`

This is the test that would have caught the original bug: a legendary item with a fixed
increase stat must never appear in a result with a *different* stat increased.

**Step 1: Write the test**

Add to `src/lib/optimizer/query.test.ts`. This needs an `ArmorItem` with `gearTier: 5,
tierType: 5` and a `legendaryTuningIncreaseStat` set — `computeOptimizerQuery` builds
`SlotCandidate`s via `rankCandidates`, which now reads `item.legendaryTuningIncreaseStat`
(from Task 3), so this test exercises the full pipeline from `ArmorItem` through to
`OptimizerResult`:

```typescript
describe("legendary tuning respects the item's fixed increase stat", () => {
  it("never produces a tuning assignment that increases a stat other than the item's fixed one", async () => {
    const exotic = makeItem("helmet", "Exotic Helmet", zeroVector(), { tierType: 6 });
    const fixedDisciplineGauntlets: ArmorItem = {
      ...makeItem("gauntlets", "Tuned Gauntlets", { ...zeroVector(), mobility: 10 }, { tierType: 5, gearTier: 5 }),
      legendaryTuningIncreaseStat: "discipline",
    };
    const candidates: Partial<Record<ArmorSlot, ArmorItem[]>> = {
      gauntlets: [fixedDisciplineGauntlets],
      chest: [makeItem("chest", "Chest", { ...zeroVector(), recovery: 10 })],
      legs: [makeItem("legs", "Legs", { ...zeroVector(), intellect: 10 })],
      classItem: [makeItem("classItem", "Class Item", { ...zeroVector(), strength: 10 })],
    };

    const { results } = await computeOptimizerQuery(exotic, candidates, { thresholds: zeroVector() });

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      const gauntletsChoice = result.loadout.gauntlets;
      if (gauntletsChoice?.tuning.kind === "directional") {
        expect(gauntletsChoice.tuning.increasedStat).toBe("discipline");
      }
    }
  });
});
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/lib/optimizer/query.test.ts`
Expected: PASS

If this test FAILS, do not move on — it means Tasks 2-4 didn't actually wire the
constraint through correctly. Re-check `rankCandidates` in `query.ts` is reading
`item.legendaryTuningIncreaseStat` (not silently falling back to free-choice).

**Step 3: Commit**

```bash
git add src/lib/optimizer/query.test.ts
git commit -m "test(optimizer): add regression test for legendary fixed-increase-stat tuning"
```

---

### Task 6: Full verification

**Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (existing suite + new tests from Tasks 2, 3, 4, 5)

**Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean

**Step 3: Run the build**

Run: `npm run build`
Expected: clean, `/api/optimizer/compute` listed in the route table as before

**Step 4: Run lint**

Run: `npm run lint`
Expected: no new errors (the 4 pre-existing baseline errors/7 warnings unrelated to this
change are expected and not a regression — see `git log` for prior verification of this
exact baseline)

**Step 5: Check the performance test budget**

Run: `npx vitest run src/lib/optimizer/query.performance.test.ts`

The search space should *shrink*, not grow, now that legendary tuned slots contribute a
domain of size 1 instead of joining a 252-way multiset enumeration — so this should pass
comfortably under its existing budget. If it's now much faster, that's expected and fine;
if it somehow regresses, investigate before considering this task done (it would indicate
something about the per-combo domain computation is more expensive than anticipated, e.g.
recomputing `tunedSlots`/`domains` arrays redundantly inside a hot loop where they could be
hoisted — but don't preemptively optimize this without first confirming there's an actual
regression).

**Step 6: Manual smoke test (requires the ngrok dev tunnel — see CLAUDE.md "Local development")**

1. Pick a legendary piece you know has a high stat in one category, select it (lock it via
   the pin feature, or just check it's chosen) in a result, expand the result card.
2. Confirm the "+X / -Y" tuning indicator only ever shows the same increase stat for that
   specific piece across different results/threshold combinations — it should never show a
   different increase stat for the same physical item instance.
3. Confirm exotic pieces still show varied increase stats across different results (their
   free-choice behavior is unchanged).
