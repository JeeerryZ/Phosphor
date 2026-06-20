# Perk Selector + Fragment Import Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let players pick which owned perk pair to use on an exotic class item, and
auto-fill the Fragment Bonuses sliders from whatever's socketed on their equipped subclass.

**Architecture:** Both features are pure-function-plus-thin-wiring, matching this
codebase's existing pattern (`lib/armor/transform.ts`, `lib/optimizer/candidates.ts`).
The perk selector changes the grouping key used by `ExoticPicker.tsx`'s exotic-collapsing
logic. The fragment importer adds a new `lib/bungie/fragments.ts` helper, a thin
`GET /api/loadout/fragments` route, and a button + extended-range slider state in the
optimizer controls.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, `bungie-api-ts`.

---

### Task 1: `getEquippedFragmentStats` helper (TDD)

**Files:**
- Create: `src/lib/bungie/fragments.ts`
- Create: `src/lib/bungie/fragments.test.ts`

This function takes a raw `DestinyProfileResponse` (the same shape already returned by
`getProfileWithArmor`) plus a `characterId`, finds that character's equipped subclass item,
reads its sockets, and sums each socketed plug's `investmentStats` entries that match one
of the 6 armor stat hashes. Aspects/supers naturally contribute nothing since they carry no
raw stat investment — no socket-category filtering needed.

**Step 1: Write the failing test**

```typescript
// src/lib/bungie/fragments.test.ts
import { describe, it, expect, vi } from "vitest";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";

vi.mock("@/lib/manifest/definitions", () => ({
  getItemDefinition: (hash: number) => {
    const defs: Record<number, { investmentStats: { statTypeHash: number; value: number }[] }> = {
      // Fragment: +10 Resilience
      1001: { investmentStats: [{ statTypeHash: 392767087, value: 10 }] },
      // Fragment: -10 Mobility / +5 Recovery
      1002: { investmentStats: [{ statTypeHash: 2996146975, value: -10 }, { statTypeHash: 1943323491, value: 5 }] },
      // Aspect: no stat investment
      1003: { investmentStats: [] },
      // Irrelevant stat (not one of the 6 armor stats) — must be ignored
      1004: { investmentStats: [{ statTypeHash: 999999999, value: 50 }] },
    };
    return defs[hash];
  },
}));

const SUBCLASS_BUCKET_HASH = 3284755031;

function makeProfile(socketPlugHashes: (number | undefined)[]): DestinyProfileResponse {
  return {
    characterEquipment: {
      data: {
        char1: { items: [{ itemHash: 0, itemInstanceId: "subclass-1", bucketHash: SUBCLASS_BUCKET_HASH }] },
      },
    },
    itemComponents: {
      sockets: {
        data: {
          "subclass-1": { sockets: socketPlugHashes.map((plugHash) => ({ plugHash, isEnabled: true })) },
        },
      },
    },
  } as unknown as DestinyProfileResponse;
}

describe("getEquippedFragmentStats", () => {
  it("sums investmentStats across fragment sockets, ignoring aspects and non-armor stats", async () => {
    const { getEquippedFragmentStats } = await import("./fragments");
    const profile = makeProfile([1001, 1002, 1003, 1004, undefined]);

    const result = getEquippedFragmentStats(profile, "char1");

    expect(result).toEqual({
      mobility: -10,
      resilience: 10,
      recovery: 5,
      discipline: 0,
      intellect: 0,
      strength: 0,
    });
  });

  it("returns undefined when the character has no equipped subclass", async () => {
    const { getEquippedFragmentStats } = await import("./fragments");
    const profile = {
      characterEquipment: { data: { char1: { items: [] } } },
      itemComponents: { sockets: { data: {} } },
    } as unknown as DestinyProfileResponse;

    expect(getEquippedFragmentStats(profile, "char1")).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bungie/fragments.test.ts`
Expected: FAIL — `Cannot find module './fragments'`

**Step 3: Write minimal implementation**

```typescript
// src/lib/bungie/fragments.ts
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { ARMOR_STAT_HASHES, type ArmorStats, type ArmorStatName } from "@/lib/armor/types";
import { getItemDefinition } from "@/lib/manifest/definitions";

/** Bucket hash for the Subclass slot — stable across Destiny 2's lifetime. */
const SUBCLASS_BUCKET_HASH = 3284755031;

const STAT_HASH_TO_NAME = new Map<number, ArmorStatName>(
  Object.entries(ARMOR_STAT_HASHES).map(([name, hash]) => [hash, name as ArmorStatName])
);

const EMPTY_STATS: ArmorStats = {
  mobility: 0,
  resilience: 0,
  recovery: 0,
  discipline: 0,
  intellect: 0,
  strength: 0,
};

/**
 * Sums the stat deltas granted by whatever's socketed on `characterId`'s currently
 * equipped subclass — in practice, this is driven entirely by Fragments, since Aspects
 * and Supers carry no raw stat investment. Values may be negative (some fragments trade
 * one stat for another). Returns undefined if the character has no equipped subclass.
 */
export function getEquippedFragmentStats(
  profile: DestinyProfileResponse,
  characterId: string
): ArmorStats | undefined {
  const equipment = profile.characterEquipment.data?.[characterId]?.items ?? [];
  const subclass = equipment.find((item) => item.bucketHash === SUBCLASS_BUCKET_HASH);
  if (!subclass?.itemInstanceId) return undefined;

  const sockets = profile.itemComponents.sockets.data?.[subclass.itemInstanceId]?.sockets ?? [];
  const result: ArmorStats = { ...EMPTY_STATS };

  for (const socket of sockets) {
    const plugHash = socket.plugHash;
    if (!plugHash) continue;

    const plugDef = getItemDefinition(plugHash);
    if (!plugDef) continue;

    for (const stat of plugDef.investmentStats ?? []) {
      const statName = STAT_HASH_TO_NAME.get(stat.statTypeHash);
      if (statName) result[statName] += stat.value;
    }
  }

  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bungie/fragments.test.ts`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add src/lib/bungie/fragments.ts src/lib/bungie/fragments.test.ts
git commit -m "feat(bungie): add getEquippedFragmentStats helper"
```

---

### Task 2: `GET /api/loadout/fragments` route

**Files:**
- Create: `src/app/api/loadout/fragments/route.ts`

No test file — this repo doesn't unit-test route handlers (see `src/app/api/optimizer/compute/route.ts`, `src/app/api/loadout/equip/route.ts`); they're thin wrappers around already-tested lib functions, verified by the build + manual smoke test in Task 6.

**Step 1: Write the route**

```typescript
// src/app/api/loadout/fragments/route.ts
import { NextResponse } from "next/server";
import { getValidSession } from "@/lib/session/session";
import { ensureManifestUpToDate } from "@/lib/manifest/sync";
import { getProfileWithArmor } from "@/lib/bungie/profile";
import { getEquippedFragmentStats } from "@/lib/bungie/fragments";

export async function GET(request: Request): Promise<NextResponse> {
  const session = await getValidSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const characterId = new URL(request.url).searchParams.get("characterId");
  if (!characterId) {
    return NextResponse.json({ error: "characterId is required" }, { status: 400 });
  }

  await ensureManifestUpToDate();
  const profile = await getProfileWithArmor(session);
  const stats = getEquippedFragmentStats(profile, characterId);

  if (!stats) {
    return NextResponse.json({ error: "No equipped subclass found for this character" }, { status: 404 });
  }

  return NextResponse.json({ stats });
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/app/api/loadout/fragments/route.ts
git commit -m "feat(api): add GET /api/loadout/fragments route"
```

---

### Task 3: `groupExoticVariants` pure function (TDD)

**Files:**
- Create: `src/lib/armor/exotic-grouping.ts`
- Create: `src/lib/armor/exotic-grouping.test.ts`
- Modify: `src/components/optimizer/ExoticPicker.tsx:43-52`

Extracts the picker's exotic-collapsing logic into a testable pure function, and changes
the grouping key for class items so each distinct **owned perk pair** survives as its own
entry, instead of collapsing every copy of an exotic class item down to the single
highest-stat one regardless of its perks.

**Step 1: Write the failing test**

```typescript
// src/lib/armor/exotic-grouping.test.ts
import { describe, it, expect } from "vitest";
import type { ArmorItem, ArmorSlot } from "@/lib/armor/types";
import { groupExoticVariants } from "./exotic-grouping";

function makeExotic(overrides: Partial<ArmorItem> & { itemInstanceId: string; slot: ArmorSlot }): ArmorItem {
  return {
    itemHash: 100,
    name: "Test Exotic",
    icon: "",
    tierType: 6,
    classType: 1,
    stats: { mobility: 0, resilience: 0, recovery: 0, discipline: 0, intellect: 0, strength: 0 },
    tuning: { kind: "none" },
    power: 0,
    gearTier: undefined,
    isMasterworked: true,
    location: "vault",
    ...overrides,
  };
}

describe("groupExoticVariants", () => {
  it("keeps both copies of a class item exotic when their perk pairs differ", () => {
    const items = [
      makeExotic({
        itemInstanceId: "a",
        slot: "classItem",
        exoticPerks: [{ name: "Perk A", description: "", icon: "" }, { name: "Perk B", description: "", icon: "" }],
      }),
      makeExotic({
        itemInstanceId: "b",
        slot: "classItem",
        exoticPerks: [{ name: "Perk C", description: "", icon: "" }, { name: "Perk D", description: "", icon: "" }],
      }),
    ];

    const result = groupExoticVariants(items);

    expect(result.map((i) => i.itemInstanceId).sort()).toEqual(["a", "b"]);
  });

  it("collapses copies with an identical perk pair, keeping the highest-stat one", () => {
    const items = [
      makeExotic({
        itemInstanceId: "low-stats",
        slot: "classItem",
        stats: { mobility: 2, resilience: 0, recovery: 0, discipline: 0, intellect: 0, strength: 0 },
        exoticPerks: [{ name: "Perk A", description: "", icon: "" }, { name: "Perk B", description: "", icon: "" }],
      }),
      makeExotic({
        itemInstanceId: "high-stats",
        slot: "classItem",
        stats: { mobility: 20, resilience: 0, recovery: 0, discipline: 0, intellect: 0, strength: 0 },
        // Same perk pair, different order — must still be treated as identical.
        exoticPerks: [{ name: "Perk B", description: "", icon: "" }, { name: "Perk A", description: "", icon: "" }],
      }),
    ];

    const result = groupExoticVariants(items);

    expect(result.map((i) => i.itemInstanceId)).toEqual(["high-stats"]);
  });

  it("collapses non-class-item exotics by itemHash alone, ignoring perks entirely", () => {
    const items = [
      makeExotic({ itemInstanceId: "helmet-low", slot: "helmet", itemHash: 200,
        stats: { mobility: 2, resilience: 0, recovery: 0, discipline: 0, intellect: 0, strength: 0 } }),
      makeExotic({ itemInstanceId: "helmet-high", slot: "helmet", itemHash: 200,
        stats: { mobility: 20, resilience: 0, recovery: 0, discipline: 0, intellect: 0, strength: 0 } }),
    ];

    const result = groupExoticVariants(items);

    expect(result.map((i) => i.itemInstanceId)).toEqual(["helmet-high"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/armor/exotic-grouping.test.ts`
Expected: FAIL — `Cannot find module './exotic-grouping'`

**Step 3: Write minimal implementation**

```typescript
// src/lib/armor/exotic-grouping.ts
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import type { ArmorItem } from "@/lib/armor/types";

function statTotal(item: ArmorItem): number {
  return ARMOR_STAT_ORDER.reduce((sum, stat) => sum + item.stats[stat], 0);
}

/** Grouping key: class items with perks are keyed by hash + sorted perk names, so each
 *  distinct owned perk pair survives separately. Everything else is keyed by hash alone. */
function variantKey(item: ArmorItem): string {
  if (!item.exoticPerks?.length) return String(item.itemHash);
  const perkSignature = [...item.exoticPerks].map((p) => p.name).sort().join("|");
  return `${item.itemHash}:${perkSignature}`;
}

/**
 * Collapses a list of exotics down to one entry per distinct "variant" — for class items,
 * a variant is a unique perk pair; for everything else, a variant is just the item hash.
 * Within a variant, keeps the highest total-stat copy.
 */
export function groupExoticVariants(items: ArmorItem[]): ArmorItem[] {
  const byVariant = new Map<string, ArmorItem>();

  for (const item of items) {
    const key = variantKey(item);
    const existing = byVariant.get(key);
    if (!existing || statTotal(item) > statTotal(existing)) {
      byVariant.set(key, item);
    }
  }

  return [...byVariant.values()];
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/armor/exotic-grouping.test.ts`
Expected: PASS (3 tests)

**Step 5: Wire into `ExoticPicker.tsx`**

Replace the inline `Map<number, ArmorItem>` grouping (currently `src/components/optimizer/ExoticPicker.tsx:43-52`):

```typescript
// Before:
const exoticsByHash = new Map<number, ArmorItem>();
for (const item of items) {
  if (item.tierType !== TIER_EXOTIC || item.classType !== selectedClassType) continue;
  const existing = exoticsByHash.get(item.itemHash);
  if (!existing || statTotal(item) > statTotal(existing)) exoticsByHash.set(item.itemHash, item);
}

const exotics = [...exoticsByHash.values()]
  .sort((a, b) => a.name.localeCompare(b.name))
  .filter((item) => !search || item.name.toLowerCase().includes(search.toLowerCase()));
```

```typescript
// After:
const classExotics = items.filter(
  (item) => item.tierType === TIER_EXOTIC && item.classType === selectedClassType
);

const exotics = groupExoticVariants(classExotics)
  .sort((a, b) => a.name.localeCompare(b.name))
  .filter((item) => !search || item.name.toLowerCase().includes(search.toLowerCase()));
```

Add the import at the top of `ExoticPicker.tsx`:

```typescript
import { groupExoticVariants } from "@/lib/armor/exotic-grouping";
```

Remove the now-unused local `statTotal` helper (lines 40-41) from `ExoticPicker.tsx`, since it's only used by `exotic-grouping.ts` now.

**Step 6: Build to verify no regressions**

Run: `npm run build`
Expected: compiles cleanly

**Step 7: Commit**

```bash
git add src/lib/armor/exotic-grouping.ts src/lib/armor/exotic-grouping.test.ts src/components/optimizer/ExoticPicker.tsx
git commit -m "feat(picker): show each owned exotic class item perk pair as its own card"
```

---

### Task 4: Extend Fragment Bonuses UI for negative values + import button

**Files:**
- Modify: `src/components/optimizer/OptimizerControls.tsx`

**Step 1: Extend the bonus range and color logic**

In `OptimizerControls.tsx`, change:

```typescript
const FRAG_BONUS_MAX = 30;
const FRAG_BONUS_STEP = 5;
```

to:

```typescript
const FRAG_BONUS_MIN = -30;
const FRAG_BONUS_MAX = 30;
const FRAG_BONUS_STEP = 5;
```

Update the props interface to accept the import handler and its state:

```typescript
interface OptimizerControlsProps {
  thresholds: ArmorStats;
  onThresholdChange: (stat: ArmorStatName, value: number) => void;
  statIcons: Record<ArmorStatName, string>;
  maxStats?: Record<ArmorStatName, number> | null;
  masterworkOnly?: boolean;
  onMasterworkOnlyChange?: (value: boolean) => void;
  fragmentBonuses: ArmorStats;
  onFragmentBonusChange: (stat: ArmorStatName, value: number) => void;
  onImportFragments: () => void;
  importFragmentsState: "idle" | "loading" | "error";
  lockedItems: Partial<Record<ArmorSlot, ArmorItem>>;
  onUnlockSlot: (slot: ArmorSlot) => void;
}
```

Destructure the two new props in the function signature alongside the existing ones.

Replace the fragment bonus row's decrement button (currently clamped at 0):

```typescript
// Before:
<button
  type="button"
  disabled={bonus <= 0}
  onClick={() => onFragmentBonusChange(stat, Math.max(0, bonus - FRAG_BONUS_STEP))}
  className="h-5 w-5 border border-border text-[10px] text-fg-muted hover:border-border-active hover:text-fg-dim disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
>
  −
</button>
```

```typescript
// After:
<button
  type="button"
  disabled={bonus <= FRAG_BONUS_MIN}
  onClick={() => onFragmentBonusChange(stat, Math.max(FRAG_BONUS_MIN, bonus - FRAG_BONUS_STEP))}
  className="h-5 w-5 border border-border text-[10px] text-fg-muted hover:border-border-active hover:text-fg-dim disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
>
  −
</button>
```

Update the value display and its color (currently only handles `bonus > 0`):

```typescript
// Before:
<span className="w-6 text-center text-xs tabular-nums" style={{ color: bonus > 0 ? color : "var(--color-fg-muted)" }}>
  {bonus > 0 ? `+${bonus}` : "0"}
</span>
```

```typescript
// After:
<span
  className="w-6 text-center text-xs tabular-nums"
  style={{ color: bonus > 0 ? color : bonus < 0 ? "var(--color-error)" : "var(--color-fg-muted)" }}
>
  {bonus > 0 ? `+${bonus}` : bonus}
</span>
```

Update the stat label color to also flag negative (currently only checks `bonus > 0`):

```typescript
// Before:
<span className="w-20 shrink-0 text-[10px] uppercase tracking-widest" style={{ color: bonus > 0 ? color : "var(--color-fg-muted)" }}>
  {ARMOR_STAT_SHORT[stat]}
</span>
```

```typescript
// After:
<span
  className="w-20 shrink-0 text-[10px] uppercase tracking-widest"
  style={{ color: bonus > 0 ? color : bonus < 0 ? "var(--color-error)" : "var(--color-fg-muted)" }}
>
  {ARMOR_STAT_SHORT[stat]}
</span>
```

The total-bonus badge next to the "Fragment bonuses" toggle currently sums raw values
(`totalFragBonus`), which will now go negative when net-negative fragments are imported —
that's correct and needs no change, since `+${totalFragBonus}` only renders when
`totalFragBonus > 0`; verify the existing condition still reads sensibly when the sum is
negative (it will simply not show the badge, which is acceptable — the per-stat colors
carry the detail).

**Step 2: Add the import button**

Add a button next to the existing "Fragment bonuses" toggle (the `<button onClick={() => setFragOpen(...)}>` block):

```typescript
<button
  type="button"
  onClick={onImportFragments}
  disabled={importFragmentsState === "loading"}
  className="text-[10px] uppercase tracking-widest border border-border px-2 py-0.5 transition-colors cursor-pointer hover:border-border-active hover:text-fg-dim text-fg-muted disabled:opacity-50 disabled:cursor-wait"
>
  {importFragmentsState === "loading" ? "Importing…" : importFragmentsState === "error" ? "Failed — Retry" : "Import from equipped"}
</button>
```

Place it directly after the "Fragment bonuses" toggle button, inside the same flex row (the row currently containing the masterwork toggle and the fragment-bonuses disclosure button).

**Step 3: Build to verify no regressions**

Run: `npm run build`
Expected: compiles cleanly (will currently fail only because `OptimizerClient.tsx` doesn't yet pass the two new required props — fixed in Task 5)

**Step 4: Commit**

```bash
git add src/components/optimizer/OptimizerControls.tsx
git commit -m "feat(controls): support negative fragment bonuses and add import button"
```

---

### Task 5: Wire the import handler in `OptimizerClient.tsx`

**Files:**
- Modify: `src/components/optimizer/OptimizerClient.tsx`

**Step 1: Add import state and handler**

Add a new state near the other UI-feedback states (alongside `saveDone`, `shareCopied`):

```typescript
const [importFragmentsState, setImportFragmentsState] = useState<"idle" | "loading" | "error">("idle");
```

Add the handler (near `handleSaveBuild`):

```typescript
const handleImportFragments = useCallback(async () => {
  if (!activeCharacterId) return;
  setImportFragmentsState("loading");
  try {
    const response = await fetch(`/api/loadout/fragments?characterId=${activeCharacterId}`);
    if (!response.ok) throw new Error("Import failed");
    const data = (await response.json()) as { stats: ArmorStats };
    setFragmentBonuses(data.stats);
    setImportFragmentsState("idle");
  } catch {
    setImportFragmentsState("error");
    setTimeout(() => setImportFragmentsState("idle"), 3000);
  }
}, [activeCharacterId]);
```

**Step 2: Pass the new props to `OptimizerControls`**

Find the `<OptimizerControls ... />` usage and add:

```typescript
onImportFragments={handleImportFragments}
importFragmentsState={importFragmentsState}
```

**Step 3: Build to verify everything compiles**

Run: `npm run build`
Expected: compiles cleanly, no missing-prop errors

**Step 4: Commit**

```bash
git add src/components/optimizer/OptimizerClient.tsx
git commit -m "feat(optimizer): wire fragment import button to equipped-subclass API"
```

---

### Task 6: Full verification

**Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including the 5 new tests from Tasks 1 and 3

**Step 2: Run the build**

Run: `npm run build`
Expected: compiles cleanly, no TypeScript errors

**Step 3: Run lint**

Run: `npm run lint`
Expected: no errors

**Step 4: Manual smoke test (requires the ngrok dev tunnel — see CLAUDE.md "Local development")**

1. Log in, go to the picker. If you own an exotic class item with more than one perk pair
   socketed across different copies, confirm both perk pairs now appear as separate cards.
2. Select any exotic, open "Fragment bonuses", click "Import from equipped".
   - Confirm the 6 sliders' bonus values populate to match your actual equipped Fragments.
   - If your subclass has a fragment with a stat trade-off, confirm the traded-down stat
     shows in red/error color with a negative value, and that the corresponding threshold
     slider's effective requirement increases (visible via the "max" hint or results
     needing more armor for that stat).
3. Manually tweak a fragment bonus after importing — confirm it's editable and doesn't
   get silently overwritten until you click "Import from equipped" again.
4. Trigger the error path: pick a character with no characters available (or temporarily
   break the route) and confirm "Failed — Retry" appears and clears after ~3s.
