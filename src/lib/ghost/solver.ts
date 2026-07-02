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
  /** Ghost mod bonuses: +27.5 to statA & statB, +20 to thirdStat. */
  contributions: Partial<Record<ArmorStatName, number>>;
  /** Masterwork bonus: +5 to each of the 3 stats NOT covered by this piece's mod. */
  masterworkContributions: Partial<Record<ArmorStatName, number>>;
}

export interface SolverResult {
  assignments: GhostModAssignment[];
  /** Final projected stats (ghost mods + masterwork + stat mod allocation). */
  projected: ArmorStats;
  /** Stats from ghost mods + masterwork only, before stat mod allocation. */
  baseProjected: ArmorStats;
  /** How the +50 stat mod pool was distributed (only when statMods enabled). */
  statModAllocation: Partial<Record<ArmorStatName, number>>;
  score: number;
  debug: DebugContribution[];
}

export interface SolverOptions {
  masterwork: boolean;
  /** When true, solver optimally allocates 5×+10 = +50 across stat deficits. */
  statMods: boolean;
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

function computeBase(
  assignments: GhostModAssignment[],
  masterwork: boolean
): { stats: ArmorStats; debug: DebugContribution[] } {
  const stats: ArmorStats = { ...EMPTY_ARMOR_STATS };
  const debug: DebugContribution[] = [];

  for (const { mod, thirdStat } of assignments) {
    stats[mod.statA] += 27.5;
    stats[mod.statB] += 27.5;
    stats[thirdStat] += 20;

    const masterworkContributions: Partial<Record<ArmorStatName, number>> = {};
    if (masterwork) {
      // +5 to each stat NOT covered by this piece's ghost mod (the 3 zero stats)
      for (const s of ALL_STAT_NAMES) {
        if (s !== mod.statA && s !== mod.statB && s !== thirdStat) {
          stats[s] += 5;
          masterworkContributions[s] = 5;
        }
      }
    }

    debug.push({
      modName: mod.name,
      contributions: {
        [mod.statA]: 27.5,
        [mod.statB]: 27.5,
        [thirdStat]: 20,
      } as Partial<Record<ArmorStatName, number>>,
      masterworkContributions,
    });
  }

  return { stats, debug };
}

// Greedily allocate 5×+10 to stats with the largest deficit vs targets.
function allocateStatMods(
  base: ArmorStats,
  targets: ArmorStats
): { stats: ArmorStats; allocation: Partial<Record<ArmorStatName, number>> } {
  const stats: ArmorStats = { ...base };
  const allocation: Partial<Record<ArmorStatName, number>> = {};

  for (let i = 0; i < 5; i++) {
    let biggestDeficit = 0;
    let pick: ArmorStatName | null = null;
    for (const s of ALL_STAT_NAMES) {
      const deficit = Math.max(0, targets[s] - stats[s]);
      if (deficit > biggestDeficit) {
        biggestDeficit = deficit;
        pick = s;
      }
    }
    if (pick === null) break; // No remaining deficits — stop early
    stats[pick] += 10;
    allocation[pick] = (allocation[pick] ?? 0) + 10;
  }

  return { stats, allocation };
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
  const heap: {
    score: number;
    assignments: GhostModAssignment[];
    projected: ArmorStats;
    baseProjected: ArmorStats;
    statModAllocation: Partial<Record<ArmorStatName, number>>;
    debug: DebugContribution[];
  }[] = [];

  for (const modCombo of multisetCombinations(GHOST_MODS, 5)) {
    const thirdStatChoices = modCombo.map((mod) =>
      ALL_STAT_NAMES.filter((s) => s !== mod.statA && s !== mod.statB)
    );

    for (const thirdStats of cartesianProduct(thirdStatChoices)) {
      const assignments: GhostModAssignment[] = modCombo.map((mod, i) => ({
        mod,
        thirdStat: thirdStats[i],
      }));

      const { stats: baseStats, debug } = computeBase(assignments, options.masterwork);

      let projected = baseStats;
      let statModAllocation: Partial<Record<ArmorStatName, number>> = {};
      if (options.statMods) {
        const result = allocateStatMods(baseStats, targets);
        projected = result.stats;
        statModAllocation = result.allocation;
      }

      const score = computeScore(projected, targets);

      if (heap.length < 5 || score < heap[heap.length - 1].score) {
        heap.push({ score, assignments, projected, baseProjected: baseStats, statModAllocation, debug });
        heap.sort((a, b) => a.score - b.score);
        if (heap.length > 5) heap.pop();
      }
    }
  }

  return heap.map(({ assignments, projected, baseProjected, statModAllocation, score, debug }) => ({
    assignments,
    projected,
    baseProjected,
    statModAllocation,
    score,
    debug,
  }));
}
