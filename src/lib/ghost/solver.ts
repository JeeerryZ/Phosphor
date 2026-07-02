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
