"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { SolverResult } from "@/lib/ghost/solver";
import { ALL_STAT_NAMES, STAT_LABELS } from "@/lib/ghost/mods";
import { EMPTY_ARMOR_STATS } from "@/lib/armor/types";
import type { ArmorStatName, ArmorStats } from "@/lib/armor/types";

export function GhostModAdvisor() {
  const [targets, setTargets] = useState<ArmorStats>({ ...EMPTY_ARMOR_STATS });
  const [masterwork, setMasterwork] = useState(false);
  const [statMods, setStatMods] = useState(false);
  const [results, setResults] = useState<SolverResult[] | null>(null);
  const [solving, setSolving] = useState(false);
  const [debugOpen, setDebugOpen] = useState(true);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => () => { workerRef.current?.terminate(); }, []);

  function handleSolve() {
    workerRef.current?.terminate();
    setSolving(true);
    setResults(null);

    const worker = new Worker(
      new URL("../../lib/ghost/solver.worker.ts", import.meta.url)
    );
    worker.onmessage = (e: MessageEvent<SolverResult[]>) => {
      setResults(e.data);
      setSolving(false);
      worker.terminate();
      workerRef.current = null;
    };
    worker.postMessage({ targets, options: { masterwork, statMods } });
    workerRef.current = worker;
  }

  function setTarget(stat: ArmorStatName, raw: string) {
    const val = parseInt(raw, 10);
    setTargets((prev) => ({ ...prev, [stat]: isNaN(val) ? 0 : val }));
  }

  function summarizeAssignments(result: SolverResult): string {
    const counts = new Map<string, { count: number; thirds: string[] }>();
    for (const { mod, thirdStat } of result.assignments) {
      const existing = counts.get(mod.name) ?? { count: 0, thirds: [] };
      existing.count++;
      existing.thirds.push(STAT_LABELS[thirdStat]);
      counts.set(mod.name, existing);
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
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={masterwork}
              onChange={(e) => setMasterwork(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            <span className="text-sm text-fg-dim">Masterwork</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={statMods}
              onChange={(e) => setStatMods(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            <span className="text-sm text-fg-dim">Stat Mods</span>
          </label>
        </div>
      </section>

      {/* Solve */}
      <Button onClick={handleSolve} disabled={solving}>
        {solving ? "Computing…" : "Find Best Combination"}
      </Button>

      {/* Results */}
      {results && (
        <section className="space-y-6">
          <h2 className="text-sm uppercase tracking-widest text-fg-muted">Results</h2>

          {results.length === 0 ? (
            <p className="text-fg-dim text-sm">No combinations found.</p>
          ) : (
            results.slice(0, 5).map((result, ri) => (
              <div key={ri} className="border border-border p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-fg-muted">#{ri + 1}</span>
                  <span className="text-sm text-fg">{summarizeAssignments(result)}</span>
                </div>

                {/* Projected vs Target */}
                <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs">
                  <span className="text-fg-muted uppercase tracking-widest">Stat</span>
                  <span className="text-fg-muted uppercase tracking-widest">Projected</span>
                  <span className="text-fg-muted uppercase tracking-widest">Target</span>
                  {ALL_STAT_NAMES.map((stat) => {
                    const projected = result.projected[stat];
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
                  <summary className="text-xs uppercase tracking-widest text-fg-muted cursor-pointer mb-2">
                    Debug breakdown
                  </summary>
                  <div className="overflow-x-auto">
                    <table className="text-xs w-full border-collapse">
                      <thead>
                        <tr>
                          <th className="text-left text-fg-muted py-1 pr-4">Source</th>
                          {ALL_STAT_NAMES.map((s) => (
                            <th key={s} className="text-fg-muted py-1 px-2 text-right">
                              {STAT_LABELS[s]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {/* Per-piece rows: mod bonuses + optional MW row */}
                        {result.debug.map((row, i) => (
                          <Fragment key={i}>
                            <tr className="border-t border-border/40">
                              <td className="text-fg-dim py-1 pr-4">{row.modName}</td>
                              {ALL_STAT_NAMES.map((s) => (
                                <td key={s} className="text-right px-2 py-1 text-fg-dim">
                                  {row.contributions[s] !== undefined ? `+${row.contributions[s]}` : "—"}
                                </td>
                              ))}
                            </tr>
                            {masterwork && Object.keys(row.masterworkContributions).length > 0 && (
                              <tr className="border-t border-border/20 text-fg-muted italic">
                                <td className="py-1 pr-4 pl-3">↳ MW</td>
                                {ALL_STAT_NAMES.map((s) => (
                                  <td key={s} className="text-right px-2 py-1">
                                    {row.masterworkContributions[s] !== undefined
                                      ? `+${row.masterworkContributions[s]}`
                                      : "—"}
                                  </td>
                                ))}
                              </tr>
                            )}
                          </Fragment>
                        ))}

                        {/* Stat mods allocation row */}
                        {statMods && Object.keys(result.statModAllocation).length > 0 && (
                          <tr className="border-t border-border/40 text-fg-muted italic">
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
                                result.projected[s] >= targets[s] ? "text-green-400" : "text-red-400"
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
