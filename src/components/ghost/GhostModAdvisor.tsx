"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/Checkbox";
import type { SolverResult } from "@/lib/ghost/solver";
import { ALL_STAT_NAMES, STAT_LABELS } from "@/lib/ghost/mods";
import { EMPTY_ARMOR_STATS } from "@/lib/armor/types";
import type { ArmorStatName, ArmorStats } from "@/lib/armor/types";
import { adjustTargetsForFragments, effectiveStatCap } from "@/lib/ghost/fragmentTargets";

// A single stat can get at most +30 per piece (its ghost mod's primary slot) across
// 5 pieces = 150, plus T5 tuning's +5/piece (always available, 5 pieces = +25) = 175.
// Masterwork never raises this — it only buffs stats a piece doesn't already cover.
// Stat Mods adds one more +50 on top, for a hard ceiling of 225.
const MAX_STAT_FROM_MODS = 175;
const MAX_STAT_WITH_STAT_MODS = 225;

// Cross-stat budget: every piece hands out 30+25+20=75 no matter what (guaranteed),
// T5 tuning always adds a further 5×5=25 (freely assignable, always on), masterwork
// adds another 5×3=15/piece, and Stat Mods adds a flat +50 pool on top.
// This is a NECESSARY condition, not sufficient — some mod pairings (e.g. Weapon+Health)
// don't exist, so certain target combinations can still be unreachable within budget.
const BASE_BUDGET = 5 * (30 + 25 + 20) + 5 * 5;
const MASTERWORK_BUDGET_BONUS = 5 * (5 * 3);
const STAT_MODS_BUDGET_BONUS = 50;

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

export function GhostModAdvisor() {
  const [targets, setTargets] = useState<ArmorStats>({ ...EMPTY_ARMOR_STATS });
  const [masterwork, setMasterwork] = useState(false);
  const [statMods, setStatMods] = useState(false);
  const [fragmentBonuses, setFragmentBonuses] = useState<ArmorStats>({ ...EMPTY_ARMOR_STATS });
  const [fragmentsOpen, setFragmentsOpen] = useState(false);
  const maxStat = statMods ? MAX_STAT_WITH_STAT_MODS : MAX_STAT_FROM_MODS;
  const totalBudget =
    BASE_BUDGET +
    (masterwork ? MASTERWORK_BUDGET_BONUS : 0) +
    (statMods ? STAT_MODS_BUDGET_BONUS : 0);
  const adjustedTargets = adjustTargetsForFragments(targets, fragmentBonuses);
  const usedBudget = ALL_STAT_NAMES.reduce((s, k) => s + adjustedTargets[k], 0);
  const [results, setResults] = useState<SolverResult[] | null>(null);
  const [solving, setSolving] = useState(false);
  const [debugOpen, setDebugOpen] = useState(true);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => () => { workerRef.current?.terminate(); }, []);

  // Auto re-solve, debounced, whenever targets or options change — gives a live
  // preview of what's achievable instead of requiring a manual "solve" click.
  useEffect(() => {
    if (usedBudget === 0) return;
    const timeout = setTimeout(() => {
      workerRef.current?.terminate();
      setSolving(true);

      const worker = new Worker(
        new URL("../../lib/ghost/solver.worker.ts", import.meta.url)
      );
      worker.onmessage = (e: MessageEvent<SolverResult[]>) => {
        setResults(e.data);
        setSolving(false);
        worker.terminate();
        workerRef.current = null;
      };
      worker.postMessage({ targets: adjustedTargets, options: { masterwork, statMods } });
      workerRef.current = worker;
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets, masterwork, statMods, fragmentBonuses]);

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

  function applyFragmentBonuses(next: ArmorStats) {
    setFragmentBonuses(next);
    setTargets((prev) => clampToCapAndBudget(prev, maxStat, totalBudget, next));
  }

  function handleFragmentBonusChange(stat: ArmorStatName, value: number) {
    applyFragmentBonuses({ ...fragmentBonuses, [stat]: value });
  }

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

  function summarizeAssignments(result: SolverResult): string {
    const counts = new Map<
      string,
      { count: number; primary: string; secondary: string; thirds: string[] }
    >();
    for (const { mod, primaryStat, thirdStat } of result.assignments) {
      const secondaryStat = primaryStat === mod.statA ? mod.statB : mod.statA;
      const key = `${mod.name}|${primaryStat}`;
      const existing = counts.get(key) ?? {
        count: 0,
        primary: STAT_LABELS[primaryStat],
        secondary: STAT_LABELS[secondaryStat],
        thirds: [],
      };
      existing.count++;
      existing.thirds.push(STAT_LABELS[thirdStat]);
      counts.set(key, existing);
    }
    return Array.from(counts.entries())
      .map(([key, { count, primary, secondary, thirds }]) => {
        const name = key.split("|")[0];
        return `${count}× ${name} (+30 ${primary}, +25 ${secondary}, third: ${thirds.join(", ")})`;
      })
      .join(" · ");
  }

  return (
    <div className="space-y-8">
      {/* Target Stats */}
      <section>
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-sm uppercase tracking-widest text-fg-dim text-glow">Target Stats</h2>
          <span
            className={`text-xs uppercase tracking-widest ${
              usedBudget >= totalBudget ? "text-[var(--color-warn)]" : "text-fg-dim"
            }`}
          >
            Budget {usedBudget} / {totalBudget}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {ALL_STAT_NAMES.map((stat) => {
            const cap = effectiveStatCap(maxStat, fragmentBonuses[stat]);
            const atMax = targets[stat] >= cap || usedBudget >= totalBudget;
            return (
              <div key={stat} className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-widest text-fg-dim">
                  {STAT_LABELS[stat]} <span className="text-fg-muted">/ {cap}</span>
                </span>
                <div className="flex border border-border focus-within:border-border-active">
                  <button
                    type="button"
                    onClick={() => setTarget(stat, targets[stat] - 5)}
                    className="px-3 py-2 text-fg-muted hover:text-fg hover:bg-white/5 border-r border-border transition-colors select-none cursor-pointer"
                  >
                    −
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={targets[stat] === 0 ? "" : targets[stat]}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setTarget(stat, isNaN(val) ? 0 : val);
                    }}
                    placeholder="0"
                    className="flex-1 bg-transparent text-center text-sm text-fg focus:outline-none py-2 min-w-0"
                  />
                  <button
                    type="button"
                    onClick={() => setTarget(stat, targets[stat] + 5)}
                    disabled={atMax}
                    className="px-3 py-2 text-fg-muted hover:text-fg hover:bg-white/5 border-l border-border transition-colors select-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-muted"
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Options */}
      <section>
        <h2 className="text-sm uppercase tracking-widest text-fg-dim text-glow mb-4">Options</h2>
        <div className="flex flex-col gap-4">
          <Checkbox
            label="Masterwork"
            checked={masterwork}
            onChange={(e) => handleMasterworkChange(e.target.checked)}
          />

          <Checkbox
            label="Stat Mods"
            checked={statMods}
            onChange={(e) => handleStatModsChange(e.target.checked)}
          />
        </div>
      </section>

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

      {/* Results — auto-updates live as targets/options change */}
      {usedBudget > 0 && (
        <section className="space-y-6">
          <div className="flex items-baseline gap-3">
            <h2 className="text-sm uppercase tracking-widest text-fg-dim text-glow">Results</h2>
            {solving && (
              <span className="text-xs uppercase tracking-widest text-fg-muted">Computing…</span>
            )}
          </div>

          {!results ? null : results.length === 0 ? (
            <p className="text-fg-dim text-sm">No combinations found.</p>
          ) : (
            results.slice(0, 5).map((result, ri) => (
              <div key={ri} className="border border-border p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-fg-dim">#{ri + 1}</span>
                  <span className="text-sm text-fg">{summarizeAssignments(result)}</span>
                </div>

                {/* Projected vs Target */}
                <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs">
                  <span className="text-fg-dim uppercase tracking-widest">Stat</span>
                  <span className="text-fg-dim uppercase tracking-widest">Projected</span>
                  <span className="text-fg-dim uppercase tracking-widest">Target</span>
                  {ALL_STAT_NAMES.map((stat) => {
                    const projected = result.projected[stat] + fragmentBonuses[stat];
                    const target = targets[stat];
                    const deficit = Math.max(0, target - projected);
                    return (
                      <Fragment key={stat}>
                        <span className="text-fg-dim">{STAT_LABELS[stat]}</span>
                        <span className={deficit > 0 ? "text-red-400" : "text-green-400"}>
                          {projected.toFixed(1)}
                        </span>
                        <span className="text-fg-dim">{target}</span>
                      </Fragment>
                    );
                  })}
                </div>

                {/* Debug breakdown */}
                <details open={debugOpen} onToggle={(e) => setDebugOpen((e.target as HTMLDetailsElement).open)}>
                  <summary className="text-xs uppercase tracking-widest text-fg-dim cursor-pointer mb-2">
                    Debug breakdown
                  </summary>
                  <div className="overflow-x-auto">
                    <table className="text-xs w-full border-collapse">
                      <thead>
                        <tr>
                          <th className="text-left text-fg-dim py-1 pr-4">Source</th>
                          {ALL_STAT_NAMES.map((s) => (
                            <th key={s} className="text-fg-dim py-1 px-2 text-right">
                              {STAT_LABELS[s]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {/* Per-piece rows: mod bonuses, with masterwork +5 folded into the cell */}
                        {result.debug.map((row, i) => (
                          <tr key={i} className="border-t border-border/40">
                            <td className="text-fg-dim py-1 pr-4">{row.modName}</td>
                            {ALL_STAT_NAMES.map((s) => {
                              const contribution = row.contributions[s];
                              const mwContribution = masterwork ? row.masterworkContributions[s] : undefined;
                              return (
                                <td key={s} className="text-right px-2 py-1 text-fg-dim">
                                  {contribution !== undefined ? (
                                    `+${contribution}`
                                  ) : mwContribution !== undefined ? (
                                    <span className="text-[var(--color-warn)]">+{mwContribution}</span>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}

                        {/* T5 tuning allocation row (always available) */}
                        {Object.keys(result.t5Allocation).length > 0 && (
                          <tr className="border-t border-border/40 text-fg-dim italic">
                            <td className="py-1 pr-4">T5 Tuning</td>
                            {ALL_STAT_NAMES.map((s) => (
                              <td key={s} className="text-right px-2 py-1">
                                {result.t5Allocation[s] !== undefined
                                  ? `+${result.t5Allocation[s]}`
                                  : "—"}
                              </td>
                            ))}
                          </tr>
                        )}

                        {/* Stat mods allocation row */}
                        {statMods && Object.keys(result.statModAllocation).length > 0 && (
                          <tr className="border-t border-border/40 text-fg-dim italic">
                            <td className="py-1 pr-4">Stat Mods</td>
                            {ALL_STAT_NAMES.map((s) => (
                              <td key={s} className="text-right px-2 py-1">
                                {result.statModAllocation[s] !== undefined
                                  ? `+${result.statModAllocation[s]}`
                                  : "—"}
                              </td>
                            ))}
                          </tr>
                        )}

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

                        {/* Total row */}
                        <tr className="border-t-2 border-border font-bold">
                          <td className="text-fg py-1 pr-4">Total</td>
                          {ALL_STAT_NAMES.map((s) => (
                            <td key={s} className="text-right px-2 py-1 text-fg">
                              {(result.projected[s] + fragmentBonuses[s]).toFixed(1)}
                            </td>
                          ))}
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
