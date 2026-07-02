# Ghost Mod Advisor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a standalone unauthenticated page at `/ghost-mods` that takes target stat totals and outputs which ghost armor mods to farm with across 5 armor pieces, with a debug breakdown of the math.

**Architecture:** Pure client-side solver in `src/lib/ghost/` (data + algorithm), rendered by a single `"use client"` component at `src/components/ghost/GhostModAdvisor.tsx`, mounted by a minimal server page at `src/app/ghost-mods/page.tsx`. No auth, no API calls.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind, existing `Button` component (`src/components/ui/Button.tsx`), CSS variables from existing theme.

---

## Ghost Mod Domain Knowledge

All 12 mods share the same structure: focused stat A gets 27.5 avg (30 or 25, randomized per drop), focused stat B gets 27.5 avg (the other), and a player-chosen third stat gets +20 fixed.

Stat label → codebase name mapping (used throughout):
- Weapon → `mobility`
- Health → `resilience`
- Class → `recovery`
- Grenade → `discipline`
- Super → `intellect`
- Melee → `strength`

The solver enumerates all multisets of 5 mods from 12 (~4,368 combos) × all third-stat choices (4^5 = 1,024 per combo) ≈ 4.5M total evaluations. Score = sum of squared **deficits** only (overshoot = 0 penalty).

---

## Task 1: Ghost mod data

**Files:**
- Create: `src/lib/ghost/mods.ts`

**Step 1: Create the file with all 12 mods and stat label map**

```typescript
import type { ArmorStatName } from "@/lib/armor/types";

export const STAT_LABELS: Record<ArmorStatName, string> = {
  mobility: "Weapon",
  resilience: "Health",
  recovery: "Class",
  discipline: "Grenade",
  intellect: "Super",
  strength: "Melee",
};

export const ALL_STAT_NAMES: ArmorStatName[] = [
  "mobility",
  "resilience",
  "recovery",
  "discipline",
  "intellect",
  "strength",
];

export interface GhostMod {
  name: string;
  statA: ArmorStatName;
  statB: ArmorStatName;
}

export const GHOST_MODS: GhostMod[] = [
  { name: "Siegebreaker", statA: "resilience", statB: "discipline" },
  { name: "Bulwark",      statA: "resilience", statB: "recovery"   },
  { name: "Brawler",      statA: "strength",   statB: "resilience" },
  { name: "Skirmisher",   statA: "strength",   statB: "mobility"   },
  { name: "Grenadier",    statA: "discipline", statB: "intellect"  },
  { name: "Demolitionist",statA: "discipline", statB: "recovery"   },
  { name: "Colossus",     statA: "intellect",  statB: "resilience" },
  { name: "Paragon",      statA: "intellect",  statB: "strength"   },
  { name: "Reaver",       statA: "recovery",   statB: "strength"   },
  { name: "Specialist",   statA: "recovery",   statB: "mobility"   },
  { name: "Gunner",       statA: "mobility",   statB: "discipline" },
  { name: "Powerhouse",   statA: "mobility",   statB: "intellect"  },
];
```

**Step 2: Commit**

```bash
git add src/lib/ghost/mods.ts
git commit -m "feat(ghost): add ghost mod data constants"
```

---

## Task 2: Solver algorithm

**Files:**
- Create: `src/lib/ghost/solver.ts`

**Step 1: Create the solver**

```typescript
import { EMPTY_ARMOR_STATS } from "@/lib/armor/types";
import type { ArmorStatName, ArmorStats } from "@/lib/armor/types";
import { ALL_STAT_NAMES, GHOST_MODS } from "./mods";
import type { GhostMod } from "./mods";

export interface GhostModAssignment {
  mod: GhostMod;
  thirdStat: ArmorStatName;
}

export interface DebugContribution {
  modName: string;
  contributions: Partial<Record<ArmorStatName, number>>;
}

export interface SolverResult {
  assignments: GhostModAssignment[];
  projected: ArmorStats;
  score: number;
  debug: DebugContribution[];
}

export interface SolverOptions {
  masterwork: boolean;
  statMods: Partial<Record<ArmorStatName, number>>; // number of +10 mods per stat
}

// Yields all multisets of size k from arr (with repetition, order irrelevant).
function* multisetCombinations<T>(arr: T[], k: number, start = 0): Generator<T[]> {
  if (k === 0) { yield []; return; }
  for (let i = start; i < arr.length; i++) {
    for (const rest of multisetCombinations(arr, k - 1, i)) {
      yield [arr[i], ...rest];
    }
  }
}

// Yields cartesian product of arrays.
function* cartesianProduct<T>(arrays: T[][]): Generator<T[]> {
  if (arrays.length === 0) { yield []; return; }
  const [first, ...rest] = arrays;
  for (const item of first) {
    for (const others of cartesianProduct(rest)) {
      yield [item, ...others];
    }
  }
}

function computeProjected(
  assignments: GhostModAssignment[],
  options: SolverOptions
): ArmorStats {
  const stats: ArmorStats = { ...EMPTY_ARMOR_STATS };
  for (const { mod, thirdStat } of assignments) {
    stats[mod.statA] += 27.5;
    stats[mod.statB] += 27.5;
    stats[thirdStat] += 20;
  }
  // Masterwork: +2 per piece × 5 pieces = +10 to all stats
  if (options.masterwork) {
    for (const s of ALL_STAT_NAMES) stats[s] += 10;
  }
  // Stat mods: each counts as +10 to that stat
  for (const s of ALL_STAT_NAMES) {
    const count = options.statMods[s] ?? 0;
    stats[s] += count * 10;
  }
  return stats;
}

function computeScore(projected: ArmorStats, targets: ArmorStats): number {
  let score = 0;
  for (const s of ALL_STAT_NAMES) {
    const deficit = Math.max(0, targets[s] - projected[s]);
    score += deficit * deficit;
  }
  return score;
}

export function solve(targets: ArmorStats, options: SolverOptions): SolverResult[] {
  const heap: { score: number; assignments: GhostModAssignment[]; projected: ArmorStats }[] = [];

  for (const modCombo of multisetCombinations(GHOST_MODS, 5)) {
    const thirdStatChoices = modCombo.map((mod) =>
      ALL_STAT_NAMES.filter((s) => s !== mod.statA && s !== mod.statB)
    );

    for (const thirdStats of cartesianProduct(thirdStatChoices)) {
      const assignments: GhostModAssignment[] = modCombo.map((mod, i) => ({
        mod,
        thirdStat: thirdStats[i],
      }));
      const projected = computeProjected(assignments, options);
      const score = computeScore(projected, targets);

      // Keep only top 5 in heap to avoid building a huge array
      if (heap.length < 5 || score < heap[heap.length - 1].score) {
        heap.push({ score, assignments, projected });
        heap.sort((a, b) => a.score - b.score);
        if (heap.length > 5) heap.pop();
      }
    }
  }

  return heap.map(({ assignments, projected, score }) => ({
    assignments,
    projected,
    score,
    debug: assignments.map(({ mod, thirdStat }) => ({
      modName: mod.name,
      contributions: {
        [mod.statA]: 27.5,
        [mod.statB]: 27.5,
        [thirdStat]: 20,
      } as Partial<Record<ArmorStatName, number>>,
    })),
  }));
}
```

**Step 2: Commit**

```bash
git add src/lib/ghost/solver.ts
git commit -m "feat(ghost): add combinatorial ghost mod solver"
```

---

## Task 3: Ghost Mod Advisor client component

**Files:**
- Create: `src/components/ghost/GhostModAdvisor.tsx`

This is a single large `"use client"` component. It holds all UI state and calls `solve()` on demand.

**Step 1: Create the component**

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { solve } from "@/lib/ghost/solver";
import type { SolverResult, SolverOptions } from "@/lib/ghost/solver";
import { ALL_STAT_NAMES, STAT_LABELS } from "@/lib/ghost/mods";
import { EMPTY_ARMOR_STATS } from "@/lib/armor/types";
import type { ArmorStatName, ArmorStats } from "@/lib/armor/types";

export function GhostModAdvisor() {
  const [targets, setTargets] = useState<ArmorStats>({ ...EMPTY_ARMOR_STATS });
  const [masterwork, setMasterwork] = useState(false);
  const [showMods, setShowMods] = useState(false);
  const [statMods, setStatMods] = useState<Partial<Record<ArmorStatName, number>>>({});
  const [results, setResults] = useState<SolverResult[] | null>(null);
  const [debugOpen, setDebugOpen] = useState(true);

  function handleSolve() {
    const options: SolverOptions = { masterwork, statMods: showMods ? statMods : {} };
    setResults(solve(targets, options));
  }

  function setTarget(stat: ArmorStatName, raw: string) {
    const val = parseInt(raw, 10);
    setTargets((prev) => ({ ...prev, [stat]: isNaN(val) ? 0 : val }));
  }

  function setStatMod(stat: ArmorStatName, raw: string) {
    const val = parseInt(raw, 10);
    setStatMods((prev) => ({ ...prev, [stat]: isNaN(val) ? 0 : val }));
  }

  // Group assignments by mod name for display: "2× Powerhouse (third: Class), ..."
  function summarizeAssignments(result: SolverResult): string {
    const counts = new Map<string, { count: number; thirds: string[] }>();
    for (const { mod, thirdStat } of result.assignments) {
      const key = mod.name;
      const existing = counts.get(key) ?? { count: 0, thirds: [] };
      existing.count++;
      existing.thirds.push(STAT_LABELS[thirdStat]);
      counts.set(key, existing);
    }
    return Array.from(counts.entries())
      .map(([name, { count, thirds }]) => `${count}× ${name} (third: ${thirds.join(", ")})`)
      .join(" · ");
  }

  return (
    <div className="space-y-8">
      {/* Target Stats */}
      <section>
        <h2 className="text-sm uppercase tracking-widest text-fg-muted mb-4">Target Stats</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {ALL_STAT_NAMES.map((stat) => (
            <label key={stat} className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-widest text-fg-dim">
                {STAT_LABELS[stat]}
              </span>
              <input
                type="number"
                min={0}
                value={targets[stat] || ""}
                onChange={(e) => setTarget(stat, e.target.value)}
                placeholder="0"
                className="w-full bg-transparent border border-border px-3 py-2 text-sm text-fg focus:border-border-active focus:outline-none"
              />
            </label>
          ))}
        </div>
      </section>

      {/* Options */}
      <section>
        <h2 className="text-sm uppercase tracking-widest text-fg-muted mb-4">Options</h2>
        <div className="flex flex-col gap-4">
          {/* Masterwork toggle */}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={masterwork}
              onChange={(e) => setMasterwork(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            <span className="text-sm text-fg-dim">
              Masterwork <span className="text-fg-muted">(+2 per piece = +10 total to all stats)</span>
            </span>
          </label>

          {/* Stat mods toggle */}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showMods}
              onChange={(e) => setShowMods(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            <span className="text-sm text-fg-dim">
              Stat Mods <span className="text-fg-muted">(how many +10 mods per stat)</span>
            </span>
          </label>

          {showMods && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 ml-7">
              {ALL_STAT_NAMES.map((stat) => (
                <label key={stat} className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-widest text-fg-dim">
                    {STAT_LABELS[stat]}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    value={statMods[stat] ?? ""}
                    onChange={(e) => setStatMod(stat, e.target.value)}
                    placeholder="0"
                    className="w-full bg-transparent border border-border px-3 py-2 text-sm text-fg focus:border-border-active focus:outline-none"
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Solve */}
      <Button onClick={handleSolve}>Find Best Combination</Button>

      {/* Results */}
      {results && (
        <section className="space-y-6">
          <h2 className="text-sm uppercase tracking-widest text-fg-muted">Results</h2>

          {results.length === 0 ? (
            <p className="text-fg-dim text-sm">No combinations found.</p>
          ) : (
            results.map((result, ri) => (
              <div key={ri} className="border border-border p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-fg-muted">#{ri + 1}</span>
                  <span className="text-sm text-fg">{summarizeAssignments(result)}</span>
                </div>

                {/* Projected vs Target table */}
                <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs">
                  <span className="text-fg-muted uppercase tracking-widest">Stat</span>
                  <span className="text-fg-muted uppercase tracking-widest">Projected</span>
                  <span className="text-fg-muted uppercase tracking-widest">Target</span>
                  {ALL_STAT_NAMES.map((stat) => {
                    const projected = result.projected[stat];
                    const target = targets[stat];
                    const deficit = Math.max(0, target - projected);
                    return (
                      <>
                        <span key={`${stat}-label`} className="text-fg-dim">{STAT_LABELS[stat]}</span>
                        <span
                          key={`${stat}-proj`}
                          className={deficit > 0 ? "text-red-400" : "text-green-400"}
                        >
                          {projected.toFixed(1)}
                        </span>
                        <span key={`${stat}-tgt`} className="text-fg-dim">{target}</span>
                      </>
                    );
                  })}
                </div>

                {/* Debug section */}
                <details open={debugOpen} onToggle={(e) => setDebugOpen((e.target as HTMLDetailsElement).open)}>
                  <summary className="text-xs uppercase tracking-widest text-fg-muted cursor-pointer mb-2">
                    Debug breakdown
                  </summary>
                  <div className="overflow-x-auto">
                    <table className="text-xs w-full border-collapse">
                      <thead>
                        <tr>
                          <th className="text-left text-fg-muted py-1 pr-4">Mod</th>
                          {ALL_STAT_NAMES.map((s) => (
                            <th key={s} className="text-fg-muted py-1 px-2 text-right">
                              {STAT_LABELS[s]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {/* Per-mod rows */}
                        {result.debug.map((row, i) => (
                          <tr key={i} className="border-t border-border/40">
                            <td className="text-fg-dim py-1 pr-4">{row.modName}</td>
                            {ALL_STAT_NAMES.map((s) => (
                              <td key={s} className="text-right px-2 py-1 text-fg-dim">
                                {row.contributions[s] !== undefined
                                  ? `+${row.contributions[s]}`
                                  : "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {/* Masterwork row */}
                        {masterwork && (
                          <tr className="border-t border-border/40 text-fg-muted italic">
                            <td className="py-1 pr-4">Masterwork</td>
                            {ALL_STAT_NAMES.map((s) => (
                              <td key={s} className="text-right px-2 py-1">+10</td>
                            ))}
                          </tr>
                        )}
                        {/* Stat mod rows */}
                        {showMods &&
                          ALL_STAT_NAMES.filter((s) => (statMods[s] ?? 0) > 0).map((s) => (
                            <tr key={s} className="border-t border-border/40 text-fg-muted italic">
                              <td className="py-1 pr-4">{STAT_LABELS[s]} mod ×{statMods[s]}</td>
                              {ALL_STAT_NAMES.map((ss) => (
                                <td key={ss} className="text-right px-2 py-1">
                                  {ss === s ? `+${(statMods[s] ?? 0) * 10}` : "—"}
                                </td>
                              ))}
                            </tr>
                          ))}
                        {/* Total row */}
                        <tr className="border-t-2 border-border font-bold">
                          <td className="text-fg py-1 pr-4">Total</td>
                          {ALL_STAT_NAMES.map((s) => (
                            <td key={s} className="text-right px-2 py-1 text-fg">
                              {result.projected[s].toFixed(1)}
                            </td>
                          ))}
                        </tr>
                        {/* Target row */}
                        <tr className="border-t border-border/40">
                          <td className="text-fg-muted py-1 pr-4">Target</td>
                          {ALL_STAT_NAMES.map((s) => (
                            <td
                              key={s}
                              className={`text-right px-2 py-1 ${
                                result.projected[s] >= targets[s]
                                  ? "text-green-400"
                                  : "text-red-400"
                              }`}
                            >
                              {targets[s]}
                            </td>
                          ))}
                        </tr>
                        {/* Gap row */}
                        <tr className="border-t border-border/40">
                          <td className="text-fg-muted py-1 pr-4">Gap</td>
                          {ALL_STAT_NAMES.map((s) => {
                            const gap = targets[s] - result.projected[s];
                            return (
                              <td
                                key={s}
                                className={`text-right px-2 py-1 ${
                                  gap <= 0 ? "text-green-400" : "text-red-400"
                                }`}
                              >
                                {gap > 0 ? `−${gap.toFixed(1)}` : `+${Math.abs(gap).toFixed(1)}`}
                              </td>
                            );
                          })}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            ))
          )}
        </section>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/ghost/GhostModAdvisor.tsx
git commit -m "feat(ghost): add GhostModAdvisor client component"
```

---

## Task 4: Page route

**Files:**
- Create: `src/app/ghost-mods/page.tsx`

**Step 1: Create the server page**

```tsx
import Link from "next/link";
import { PageTransition } from "@/components/ui/PageTransition";
import { GhostModAdvisor } from "@/components/ghost/GhostModAdvisor";

export const metadata = { title: "Ghost Mod Advisor · SetBuilder" };

export default function GhostModsPage() {
  return (
    <main className="min-h-screen px-4 sm:px-6 py-8">
      <PageTransition>
        <div className="mx-auto max-w-3xl">
          <div className="mb-8 flex items-baseline gap-4">
            <Link
              href="/"
              className="text-xs uppercase tracking-widest text-fg-muted hover:text-fg transition-colors"
            >
              ← SetBuilder
            </Link>
            <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-sans)" }}>
              <span className="text-fg">Ghost</span>
              <span className="text-accent">Advisor</span>
            </h1>
            <span className="text-sm text-fg-muted tracking-widest uppercase">Mod Planner</span>
          </div>
          <GhostModAdvisor />
        </div>
      </PageTransition>
    </main>
  );
}
```

**Step 2: Commit**

```bash
git add src/app/ghost-mods/page.tsx
git commit -m "feat(ghost): add /ghost-mods page route"
```

---

## Task 5: Navigation link from main page

**Files:**
- Modify: `src/app/page.tsx`

**Step 1: Add Ghost Advisor link to the authenticated header**

In `src/app/page.tsx`, find the header `<div className="mb-8 flex items-baseline gap-3">` (around line 62) and add a navigation link after the "Armor Optimizer" span:

```tsx
// existing:
<span className="text-sm text-fg-muted tracking-widest uppercase">Armor Optimizer</span>

// add after:
<Link
  href="/ghost-mods"
  className="ml-auto text-xs uppercase tracking-widest text-fg-muted hover:text-fg transition-colors"
>
  Ghost Advisor →
</Link>
```

Also add the Next.js `Link` import at the top of the file if not already present:
```tsx
import Link from "next/link";
```

**Step 2: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(ghost): add Ghost Advisor navigation link from main page"
```

---

## Verification

1. Run `npm run dev`, open the app (via ngrok tunnel per CLAUDE.md)
2. Navigate to `/ghost-mods` directly
3. Enter example targets: Weapon=160, Super=200, Class=100, others=0
4. Click "Find Best Combination"
5. Verify top result shows mods that focus mobility+intellect (Powerhouse) and recovery (Bulwark/Specialist/Demolitionist)
6. Expand the debug table and confirm: each row's stat columns sum correctly, Total row matches Projected column, Gap row = Target − Total
7. Toggle Masterwork on, re-solve — all stats in Total should increase by 10
8. Run `npm run lint` and confirm no errors
9. Run `npm run build` and confirm clean build
