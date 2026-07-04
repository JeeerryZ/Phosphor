# Ghost Advisor Subclass Fragment Bonuses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Ghost Advisor account for subclass fragment stat bonuses/penalties so the mod solver only needs to cover the gap fragments don't already fill.

**Architecture:** Fragments are handled entirely as a pre/post adjustment around the existing solver — the solver itself never changes. A new pure-function module (`src/lib/ghost/fragmentTargets.ts`) computes the adjusted (post-fragment) targets sent to the worker and the raised per-stat input cap. `GhostModAdvisor.tsx` gets a `fragmentBonuses` state, a manual per-stat stepper UI, and an "Import from equipped" button that reuses the Optimizer's existing `/api/loadout/fragments` endpoint (backed by `getEquippedFragmentStats`, which reads live off the manifest — no hardcoded fragment data needed).

**Tech Stack:** Next.js App Router (Server + Client Components), React 19, TypeScript, Vitest.

## Global Constraints

- Fragment bonus range: -30 to +30 per stat, step 5 (matches `OptimizerControls.tsx`'s `FRAG_BONUS_MIN`/`FRAG_BONUS_MAX`/`FRAG_BONUS_STEP`).
- `src/lib/ghost/solver.ts` and `solver.worker.ts` are NOT modified — they only ever receive post-fragment targets, same shape as today.
- No new API routes — reuse `/api/loadout/fragments` and `getEquippedFragmentStats` as-is.
- No persistence of fragment bonuses across sessions/reloads (matches existing Ghost Advisor behavior).
- Reference spec: `docs/superpowers/specs/2026-07-04-ghost-advisor-fragments-design.md`.

---

### Task 1: Fragment target-adjustment helpers

**Files:**
- Create: `src/lib/ghost/fragmentTargets.ts`
- Test: `src/lib/ghost/fragmentTargets.test.ts`

**Interfaces:**
- Produces: `adjustTargetsForFragments(targets: ArmorStats, fragmentBonuses: ArmorStats): ArmorStats` — per stat, `max(0, targets[stat] - fragmentBonuses[stat])`.
- Produces: `effectiveStatCap(maxStat: number, fragmentBonus: number): number` — `maxStat + max(0, fragmentBonus)`.
- Consumes: `ArmorStats`, `EMPTY_ARMOR_STATS` from `@/lib/armor/types`; `ALL_STAT_NAMES` from `./mods`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ghost/fragmentTargets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { adjustTargetsForFragments, effectiveStatCap } from "./fragmentTargets";
import { EMPTY_ARMOR_STATS } from "@/lib/armor/types";

describe("adjustTargetsForFragments", () => {
  it("subtracts positive fragment bonuses from targets", () => {
    const targets = { ...EMPTY_ARMOR_STATS, resilience: 100 };
    const fragmentBonuses = { ...EMPTY_ARMOR_STATS, resilience: 20 };
    expect(adjustTargetsForFragments(targets, fragmentBonuses).resilience).toBe(80);
  });

  it("adds the deficit back when fragment bonus is negative", () => {
    const targets = { ...EMPTY_ARMOR_STATS, mobility: 100 };
    const fragmentBonuses = { ...EMPTY_ARMOR_STATS, mobility: -10 };
    expect(adjustTargetsForFragments(targets, fragmentBonuses).mobility).toBe(110);
  });

  it("floors at zero when the fragment bonus exceeds the target", () => {
    const targets = { ...EMPTY_ARMOR_STATS, strength: 10 };
    const fragmentBonuses = { ...EMPTY_ARMOR_STATS, strength: 25 };
    expect(adjustTargetsForFragments(targets, fragmentBonuses).strength).toBe(0);
  });

  it("leaves untouched stats at zero", () => {
    const targets = { ...EMPTY_ARMOR_STATS, resilience: 50 };
    const fragmentBonuses = { ...EMPTY_ARMOR_STATS };
    const result = adjustTargetsForFragments(targets, fragmentBonuses);
    expect(result.mobility).toBe(0);
    expect(result.resilience).toBe(50);
  });
});

describe("effectiveStatCap", () => {
  it("raises the cap by a positive fragment bonus", () => {
    expect(effectiveStatCap(175, 20)).toBe(195);
  });

  it("does not lower the cap for a negative fragment bonus", () => {
    expect(effectiveStatCap(175, -20)).toBe(175);
  });

  it("leaves the cap unchanged when there is no bonus", () => {
    expect(effectiveStatCap(175, 0)).toBe(175);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- fragmentTargets`
Expected: FAIL — `Cannot find module './fragmentTargets'` (or similar resolution error).

- [ ] **Step 3: Write the implementation**

Create `src/lib/ghost/fragmentTargets.ts`:

```ts
import { EMPTY_ARMOR_STATS } from "@/lib/armor/types";
import type { ArmorStats } from "@/lib/armor/types";
import { ALL_STAT_NAMES } from "./mods";

// Subclass fragments are a free stat source outside of mods, so they reduce what
// mods need to cover. Returns, per stat, how much the mod solver still needs to
// make up after subtracting the fragment bonus (never negative).
export function adjustTargetsForFragments(targets: ArmorStats, fragmentBonuses: ArmorStats): ArmorStats {
  const result: ArmorStats = { ...EMPTY_ARMOR_STATS };
  for (const stat of ALL_STAT_NAMES) {
    result[stat] = Math.max(0, targets[stat] - fragmentBonuses[stat]);
  }
  return result;
}

// A stat's input ceiling is normally capped by what mods alone can produce
// (maxStat). A positive fragment bonus raises that ceiling by the same amount,
// since mods still only need to cover up to maxStat of it. Negative bonuses
// don't lower the ceiling -- an unreachable target just shows as a deficit.
export function effectiveStatCap(maxStat: number, fragmentBonus: number): number {
  return maxStat + Math.max(0, fragmentBonus);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- fragmentTargets`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ghost/fragmentTargets.ts src/lib/ghost/fragmentTargets.test.ts
git commit -m "feat(ghost): add fragment target-adjustment helpers"
```

---

### Task 2: Manual fragment bonus UI + solver wiring

**Files:**
- Modify: `src/components/ghost/GhostModAdvisor.tsx`

**Interfaces:**
- Consumes: `adjustTargetsForFragments`, `effectiveStatCap` from `@/lib/ghost/fragmentTargets` (Task 1).
- Produces: (within the same file) `fragmentBonuses` state, `applyFragmentBonuses(next: ArmorStats)`, `handleFragmentBonusChange(stat: ArmorStatName, value: number)` — later consumed by Task 3's import button.

This task has no isolated unit test (the component has no existing test harness — `clampToCapAndBudget` itself is untested today; this follows the same convention). Verify manually via the dev server per Step 6.

- [ ] **Step 1: Add the fragment bonus import and state**

In `src/components/ghost/GhostModAdvisor.tsx`, add the import after the existing imports (after line 8, `import type { ArmorStatName, ArmorStats } from "@/lib/armor/types";`):

```ts
import { adjustTargetsForFragments, effectiveStatCap } from "@/lib/ghost/fragmentTargets";
```

Add state right after `const [statMods, setStatMods] = useState(false);` (currently line 51):

```ts
  const [fragmentBonuses, setFragmentBonuses] = useState<ArmorStats>({ ...EMPTY_ARMOR_STATS });
  const [fragmentsOpen, setFragmentsOpen] = useState(false);
```

- [ ] **Step 2: Rewrite `clampToCapAndBudget` to account for fragment bonuses**

Replace the existing function (lines 26-46):

```ts
function clampToCapAndBudget(
  targets: ArmorStats,
  maxStat: number,
  totalBudget: number
): ArmorStats {
  const next = { ...targets };
  for (const stat of ALL_STAT_NAMES) {
    next[stat] = Math.min(maxStat, Math.max(0, next[stat]));
  }
  let sum = ALL_STAT_NAMES.reduce((s, k) => s + next[k], 0);
  while (sum > totalBudget) {
    let biggest = ALL_STAT_NAMES[0];
    for (const stat of ALL_STAT_NAMES) {
      if (next[stat] > next[biggest]) biggest = stat;
    }
    if (next[biggest] <= 0) break;
    next[biggest] -= 5;
    sum -= 5;
  }
  return next;
}
```

with:

```ts
function clampToCapAndBudget(
  targets: ArmorStats,
  maxStat: number,
  totalBudget: number,
  fragmentBonuses: ArmorStats
): ArmorStats {
  const next = { ...targets };
  for (const stat of ALL_STAT_NAMES) {
    const cap = effectiveStatCap(maxStat, fragmentBonuses[stat]);
    next[stat] = Math.min(cap, Math.max(0, next[stat]));
  }
  let adjusted = adjustTargetsForFragments(next, fragmentBonuses);
  let sum = ALL_STAT_NAMES.reduce((s, k) => s + adjusted[k], 0);
  while (sum > totalBudget) {
    let biggest = ALL_STAT_NAMES[0];
    for (const stat of ALL_STAT_NAMES) {
      if (adjusted[stat] > adjusted[biggest]) biggest = stat;
    }
    if (adjusted[biggest] <= 0) break;
    next[biggest] -= 5;
    adjusted = adjustTargetsForFragments(next, fragmentBonuses);
    sum = ALL_STAT_NAMES.reduce((s, k) => s + adjusted[k], 0);
  }
  return next;
}
```

- [ ] **Step 3: Wire adjusted targets into budget, solve, and handlers**

Replace the `usedBudget` line (currently line 57):

```ts
  const usedBudget = ALL_STAT_NAMES.reduce((s, k) => s + targets[k], 0);
```

with:

```ts
  const adjustedTargets = adjustTargetsForFragments(targets, fragmentBonuses);
  const usedBudget = ALL_STAT_NAMES.reduce((s, k) => s + adjustedTargets[k], 0);
```

In the debounced solve `useEffect` (currently lines 67-87), change the worker post and dependency array:

```ts
      worker.postMessage({ targets, options: { masterwork, statMods } });
```
becomes:
```ts
      worker.postMessage({ targets: adjustedTargets, options: { masterwork, statMods } });
```

and the dependency array:
```ts
  }, [targets, masterwork, statMods]);
```
becomes:
```ts
  }, [targets, masterwork, statMods, fragmentBonuses]);
```

Update `handleMasterworkChange` and `handleStatModsChange` (currently lines 89-102) to pass `fragmentBonuses` as the 4th argument to `clampToCapAndBudget`:

```ts
  function handleMasterworkChange(checked: boolean) {
    setMasterwork(checked);
    const newBudget =
      BASE_BUDGET + (checked ? MASTERWORK_BUDGET_BONUS : 0) + (statMods ? STAT_MODS_BUDGET_BONUS : 0);
    setTargets((prev) => clampToCapAndBudget(prev, maxStat, newBudget, fragmentBonuses));
  }

  function handleStatModsChange(checked: boolean) {
    setStatMods(checked);
    const newMax = checked ? MAX_STAT_WITH_STAT_MODS : MAX_STAT_FROM_MODS;
    const newBudget =
      BASE_BUDGET + (masterwork ? MASTERWORK_BUDGET_BONUS : 0) + (checked ? STAT_MODS_BUDGET_BONUS : 0);
    setTargets((prev) => clampToCapAndBudget(prev, newMax, newBudget, fragmentBonuses));
  }
```

Add fragment bonus handlers right after `handleStatModsChange`:

```ts
  function applyFragmentBonuses(next: ArmorStats) {
    setFragmentBonuses(next);
    setTargets((prev) => clampToCapAndBudget(prev, maxStat, totalBudget, next));
  }

  function handleFragmentBonusChange(stat: ArmorStatName, value: number) {
    applyFragmentBonuses({ ...fragmentBonuses, [stat]: value });
  }
```

Rewrite `setTarget` (currently lines 104-111) to respect the per-stat cap and adjusted-budget:

```ts
  function setTarget(stat: ArmorStatName, val: number) {
    setTargets((prev) => {
      const cap = effectiveStatCap(maxStat, fragmentBonuses[stat]);
      const raw = Math.min(cap, Math.max(0, val));
      const candidate = { ...prev, [stat]: raw };
      const adjusted = adjustTargetsForFragments(candidate, fragmentBonuses);
      const adjustedSum = ALL_STAT_NAMES.reduce((s, k) => s + adjusted[k], 0);
      if (adjustedSum <= totalBudget) return candidate;
      const excess = adjustedSum - totalBudget;
      return { ...prev, [stat]: Math.max(0, raw - excess) };
    });
  }
```

- [ ] **Step 4: Update the Target Stats section to use the per-stat cap**

In the "Target Stats" section's badge (currently line 150):
```tsx
            Budget {usedBudget} / {totalBudget}
```
This line is unchanged (already reads `usedBudget`, now fragment-adjusted).

Inside the `ALL_STAT_NAMES.map` for target inputs (currently lines 154-155):
```tsx
          {ALL_STAT_NAMES.map((stat) => {
            const atMax = targets[stat] >= maxStat || usedBudget >= totalBudget;
```
replace with:
```tsx
          {ALL_STAT_NAMES.map((stat) => {
            const cap = effectiveStatCap(maxStat, fragmentBonuses[stat]);
            const atMax = targets[stat] >= cap || usedBudget >= totalBudget;
```

And the per-stat cap label (currently lines 158-160):
```tsx
                <span className="text-xs uppercase tracking-widest text-fg-dim">
                  {STAT_LABELS[stat]} <span className="text-fg-muted">/ {maxStat}</span>
                </span>
```
replace with:
```tsx
                <span className="text-xs uppercase tracking-widest text-fg-dim">
                  {STAT_LABELS[stat]} <span className="text-fg-muted">/ {cap}</span>
                </span>
```

- [ ] **Step 5: Add the Subclass Fragments UI section, and wire fragment bonuses into the results display**

Insert a new `<section>` between the existing "Options" `</section>` and the "Results" comment (currently right before line 213, `{/* Results — auto-updates live as targets/options change */}`):

```tsx
      {/* Subclass Fragments — free stat source outside of mods; reduces what mods need to cover */}
      <section>
        <details open={fragmentsOpen} onToggle={(e) => setFragmentsOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="text-sm uppercase tracking-widest text-fg-dim text-glow cursor-pointer mb-4 list-none flex items-center gap-2">
            <span>{fragmentsOpen ? "▾" : "▸"}</span>
            Subclass Fragments
          </summary>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {ALL_STAT_NAMES.map((stat) => {
              const bonus = fragmentBonuses[stat];
              return (
                <div key={stat} className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-widest text-fg-dim">{STAT_LABELS[stat]}</span>
                  <div className="flex border border-border focus-within:border-border-active">
                    <button
                      type="button"
                      onClick={() => handleFragmentBonusChange(stat, Math.max(-30, bonus - 5))}
                      disabled={bonus <= -30}
                      className="px-3 py-2 text-fg-muted hover:text-fg hover:bg-white/5 border-r border-border transition-colors select-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      −
                    </button>
                    <span className="flex-1 text-center text-sm py-2 text-fg">
                      {bonus > 0 ? `+${bonus}` : bonus}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleFragmentBonusChange(stat, Math.min(30, bonus + 5))}
                      disabled={bonus >= 30}
                      className="px-3 py-2 text-fg-muted hover:text-fg hover:bg-white/5 border-l border-border transition-colors select-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      </section>

```

In the "Projected vs Target" grid (currently lines 238-251), change the `projected` line:
```tsx
                  {ALL_STAT_NAMES.map((stat) => {
                    const projected = result.projected[stat];
                    const target = targets[stat];
```
to:
```tsx
                  {ALL_STAT_NAMES.map((stat) => {
                    const projected = result.projected[stat] + fragmentBonuses[stat];
                    const target = targets[stat];
```

In the debug breakdown table, insert a new row for fragments right before the "Total row" comment (currently right before line 322-323):

```tsx
                        {/* Subclass fragment bonus row (can be negative) */}
                        {ALL_STAT_NAMES.some((s) => fragmentBonuses[s] !== 0) && (
                          <tr className="border-t border-border/40 text-fg-dim italic">
                            <td className="py-1 pr-4">Subclass Fragments</td>
                            {ALL_STAT_NAMES.map((s) => (
                              <td key={s} className="text-right px-2 py-1">
                                {fragmentBonuses[s] !== 0
                                  ? fragmentBonuses[s] > 0
                                    ? `+${fragmentBonuses[s]}`
                                    : fragmentBonuses[s]
                                  : "—"}
                              </td>
                            ))}
                          </tr>
                        )}

```

And update the Total row (currently lines 323-330) to include the fragment bonus:
```tsx
                        <tr className="border-t-2 border-border font-bold">
                          <td className="text-fg py-1 pr-4">Total</td>
                          {ALL_STAT_NAMES.map((s) => (
                            <td key={s} className="text-right px-2 py-1 text-fg">
                              {result.projected[s].toFixed(1)}
                            </td>
                          ))}
                        </tr>
```
becomes:
```tsx
                        <tr className="border-t-2 border-border font-bold">
                          <td className="text-fg py-1 pr-4">Total</td>
                          {ALL_STAT_NAMES.map((s) => (
                            <td key={s} className="text-right px-2 py-1 text-fg">
                              {(result.projected[s] + fragmentBonuses[s]).toFixed(1)}
                            </td>
                          ))}
                        </tr>
```

- [ ] **Step 6: Manually verify in the browser**

Run: `npm run dev` (access via the ngrok tunnel per `CLAUDE.md`), navigate to `/ghost-mods`.

- Expand "Subclass Fragments", set Health to +20. Confirm the Health target's "/ cap" label rises by 20, and the Budget bar's used amount reflects the reduced (adjusted) requirement.
- Set a target for a stat with a +20 fragment bonus; confirm results still compute, the "Subclass Fragments" debug row shows `+20`, and the Total row / Projected column both include that +20.
- Set a fragment bonus to a negative value (e.g. -10 Mobility); confirm the per-stat cap does NOT rise, and a target above the pre-existing cap still shows a deficit as expected.
- Toggle Masterwork/Stat Mods on and off with nonzero fragment bonuses set; confirm targets get re-clamped without crashing.

- [ ] **Step 7: Commit**

```bash
git add src/components/ghost/GhostModAdvisor.tsx
git commit -m "feat(ghost): add manual subclass fragment bonus adjustment"
```

---

### Task 3: Import fragment bonuses from equipped subclass

**Files:**
- Modify: `src/app/ghost-mods/page.tsx`
- Modify: `src/components/ghost/GhostModAdvisor.tsx`

**Interfaces:**
- Consumes: `getValidSession` (`@/lib/session/session`), `ensureManifestUpToDate` (`@/lib/manifest/sync`), `getProfileWithArmor` (`@/lib/bungie/profile`) — same trio used in `src/app/page.tsx:14-49`.
- Consumes: `CLASS_TYPE_LABELS` from `@/styles/theme`.
- Consumes: existing `/api/loadout/fragments?characterId=` route (`src/app/api/loadout/fragments/route.ts`), which returns `{ stats: ArmorStats }` — same contract `OptimizerClient.handleImportFragments` already relies on.
- Consumes: `applyFragmentBonuses` from Task 2.

- [ ] **Step 1: Fetch characters server-side in the Ghost Advisor page**

Replace `src/app/ghost-mods/page.tsx` in full:

```tsx
import Link from "next/link";
import { PageTransition } from "@/components/ui/PageTransition";
import { GhostModAdvisor } from "@/components/ghost/GhostModAdvisor";
import { getValidSession } from "@/lib/session/session";
import { ensureManifestUpToDate } from "@/lib/manifest/sync";
import { getProfileWithArmor } from "@/lib/bungie/profile";

export const metadata = { title: "Ghost Mod Advisor · Phosphor" };

export default async function GhostModsPage() {
  const session = await getValidSession();

  let characters: Record<string, { classType: number }> = {};
  if (session) {
    await ensureManifestUpToDate();
    const profile = await getProfileWithArmor(session);
    const charactersData = profile.characters.data ?? {};
    characters = Object.fromEntries(
      Object.entries(charactersData).map(([id, c]) => [id, { classType: c.classType }])
    );
  }

  return (
    <main className="min-h-screen px-4 sm:px-6 py-8">
      <PageTransition>
        <div className="mx-auto max-w-3xl">
          <div className="mb-8 flex items-baseline gap-4">
            <Link
              href="/"
              className="text-xs uppercase tracking-widest text-fg-dim hover:text-fg transition-colors"
            >
              ← Phosphor
            </Link>
            <h1 className="text-xl font-bold text-glow" style={{ fontFamily: "var(--font-sans)" }}>
              <span className="text-fg">Ghost</span>
              <span className="text-accent">Advisor</span>
            </h1>
            <span className="text-sm text-fg-dim tracking-widest uppercase">Mod Planner</span>
          </div>
          <GhostModAdvisor characters={characters} />
        </div>
      </PageTransition>
    </main>
  );
}
```

- [ ] **Step 2: Accept the `characters` prop and add import state**

In `src/components/ghost/GhostModAdvisor.tsx`, add the import (near the top, alongside the other `@/styles` / `@/lib` imports):

```ts
import { CLASS_TYPE_LABELS } from "@/styles/theme";
```

Change the component signature from:
```ts
export function GhostModAdvisor() {
```
to:
```ts
interface GhostModAdvisorProps {
  characters?: Record<string, { classType: number }>;
}

export function GhostModAdvisor({ characters = {} }: GhostModAdvisorProps) {
```

Add state right after the `fragmentsOpen` state from Task 2:

```ts
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [importState, setImportState] = useState<"idle" | "loading" | "error">("idle");
  const importRequestIdRef = useRef(0);
  const characterEntries = Object.entries(characters);
  const activeCharacterId = selectedCharacterId ?? characterEntries[0]?.[0] ?? null;
```

- [ ] **Step 3: Add the import handler**

Add this function right after `applyFragmentBonuses`/`handleFragmentBonusChange` from Task 2:

```ts
  async function handleImportFragments() {
    if (!activeCharacterId) return;
    const requestId = ++importRequestIdRef.current;
    setImportState("loading");
    try {
      const response = await fetch(`/api/loadout/fragments?characterId=${activeCharacterId}`);
      if (!response.ok) throw new Error("Import failed");
      const data = (await response.json()) as { stats: ArmorStats };
      if (importRequestIdRef.current !== requestId) return;
      applyFragmentBonuses(data.stats);
      setImportState("idle");
    } catch (err) {
      if (importRequestIdRef.current !== requestId) return;
      console.error("Failed to import fragment stats:", err);
      setImportState("error");
      setTimeout(() => setImportState("idle"), 3000);
    }
  }
```

- [ ] **Step 4: Add the character selector + import button to the Subclass Fragments panel**

Inside the `<details>` block added in Task 2, right after the `<summary>...</summary>` and before the stepper grid `<div className="grid grid-cols-2 sm:grid-cols-3 gap-4">`, insert:

```tsx
          <div className="flex items-center gap-3 mb-4">
            {characterEntries.length > 1 && (
              <select
                value={activeCharacterId ?? ""}
                onChange={(e) => setSelectedCharacterId(e.target.value)}
                className="bg-transparent border border-border text-xs text-fg-dim px-2 py-1 focus:outline-none focus:border-border-active"
              >
                {characterEntries.map(([id, c]) => (
                  <option key={id} value={id} className="bg-surface">
                    {CLASS_TYPE_LABELS[c.classType] ?? "Unknown"}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={handleImportFragments}
              disabled={!activeCharacterId || importState === "loading"}
              title={!activeCharacterId ? "Log in to import fragments" : undefined}
              className={
                "text-xs uppercase tracking-widest border px-2 py-1 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed " +
                (importState === "error"
                  ? "border-red-400/40 text-red-400 hover:bg-red-400/10"
                  : "border-border text-fg-muted hover:border-border-active hover:text-fg-dim")
              }
            >
              {importState === "loading"
                ? "Importing…"
                : importState === "error"
                  ? "Failed — Retry"
                  : "Import from equipped"}
            </button>
          </div>
```

- [ ] **Step 5: Manually verify in the browser**

Run: `npm run dev` (via the ngrok tunnel), navigate to `/ghost-mods`.

- Logged out: expand Subclass Fragments, confirm the "Import from equipped" button is disabled with a "Log in to import fragments" tooltip, and the manual steppers still work.
- Logged in with one character: confirm no `<select>` renders, clicking Import fetches and populates the steppers with the equipped subclass's actual fragment stats (compare against in-game values for a sanity check).
- Logged in with multiple characters (alts of different classes): confirm the `<select>` appears, switching it changes which character Import reads from.
- Force an import failure (e.g. stop the dev server mid-request, or temporarily rename the API route) and confirm the button shows "Failed — Retry" for ~3 seconds then resets to idle.

- [ ] **Step 6: Run the full check suite**

Run: `npm run lint`
Expected: no errors.

Run: `npm run test`
Expected: all tests pass, including the Task 1 `fragmentTargets.test.ts` and pre-existing `fragments.test.ts`.

Run: `npm run build`
Expected: production build succeeds (verifies the new async Server Component and prop types compile cleanly).

- [ ] **Step 7: Commit**

```bash
git add src/app/ghost-mods/page.tsx src/components/ghost/GhostModAdvisor.tsx
git commit -m "feat(ghost): import subclass fragment bonuses from equipped character"
```
