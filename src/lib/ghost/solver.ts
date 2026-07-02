import { EMPTY_ARMOR_STATS } from "@/lib/armor/types";
import type { ArmorStatName, ArmorStats } from "@/lib/armor/types";
import { ALL_STAT_NAMES, GHOST_MODS } from "./mods";
import type { GhostMod } from "./mods";

export interface GhostModAssignment {
  mod: GhostMod;
  /** Which of the mod's two stats gets the +30 (the other gets +25). */
  primaryStat: ArmorStatName;
  thirdStat: ArmorStatName;
}

export interface DebugContribution {
  modName: string;
  /** Ghost mod bonuses: +30 to primaryStat, +25 to the other main stat, +20 to thirdStat. */
  contributions: Partial<Record<ArmorStatName, number>>;
  /** Masterwork bonus: +5 to each of the 3 stats NOT covered by this piece's mod. */
  masterworkContributions: Partial<Record<ArmorStatName, number>>;
}

export interface SolverResult {
  assignments: GhostModAssignment[];
  /** Final projected stats (ghost mods + masterwork + T5 tuning + stat mod allocation). */
  projected: ArmorStats;
  /** Stats from ghost mods + masterwork only, before T5 tuning / stat mod allocation. */
  baseProjected: ArmorStats;
  /** How the +50 stat mod pool was distributed (only when statMods enabled). */
  statModAllocation: Partial<Record<ArmorStatName, number>>;
  /** How the +25 T5 tuning pool (5 pieces × +5, always available) was distributed. */
  t5Allocation: Partial<Record<ArmorStatName, number>>;
  score: number;
  debug: DebugContribution[];
}

export interface SolverOptions {
  masterwork: boolean;
  /** When true, solver optimally allocates 5×+10 = +50 across stat deficits. */
  statMods: boolean;
}

// T5 armor stat tuning: each piece can freely move +5 into a stat of choice (the -5
// dump always lands on an unused stat, so it's effectively a free +5 — see project
// memory "T5 Tuning Model Insight"). Always available, independent of any toggle.
const T5_TUNING_SLOTS = 5;
const T5_TUNING_VALUE = 5;
const STAT_MODS_SLOTS = 5;
const STAT_MODS_VALUE = 10;

const STAT_INDEX: Record<ArmorStatName, number> = Object.fromEntries(
  ALL_STAT_NAMES.map((s, i) => [s, i])
) as Record<ArmorStatName, number>;

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

function arrayToStats(arr: number[]): ArmorStats {
  const stats: ArmorStats = { ...EMPTY_ARMOR_STATS };
  for (let i = 0; i < ALL_STAT_NAMES.length; i++) {
    stats[ALL_STAT_NAMES[i]] = arr[i];
  }
  return stats;
}

interface HeapEntry {
  score: number;
  assignments: GhostModAssignment[];
  projected: ArmorStats;
  baseProjected: ArmorStats;
  statModAllocation: Partial<Record<ArmorStatName, number>>;
  t5Allocation: Partial<Record<ArmorStatName, number>>;
  debug: DebugContribution[];
}

export function solve(targets: ArmorStats, options: SolverOptions): SolverResult[] {
  const heap: HeapEntry[] = [];

  const numStats = ALL_STAT_NAMES.length;
  const targetArr = ALL_STAT_NAMES.map((s) => targets[s]);

  // Prune: a mod whose statA/statB pair has ZERO overlap with any targeted stat is
  // always dominated by some mod that does have overlap (that mod's primary/secondary
  // lands real value on a target instead of wasting it, while still able to match the
  // same third-stat contribution). Safe to drop such mods entirely — never excludes
  // the true optimum. Falls back to all mods when nothing is targeted.
  const hasAnyTarget = targetArr.some((t) => t > 0);
  const relevantMods = hasAnyTarget
    ? GHOST_MODS.filter((mod) => targets[mod.statA] > 0 || targets[mod.statB] > 0)
    : GHOST_MODS;
  const modsToSearch = relevantMods.length > 0 ? relevantMods : GHOST_MODS;

  // Mutable scratch buffers reused across the whole search to avoid per-iteration
  // allocation — this loop runs tens of millions of times.
  const base = new Array<number>(numStats).fill(0);
  const primaryIdx = new Array<number>(5).fill(0);
  const maxAllocations = T5_TUNING_SLOTS + STAT_MODS_SLOTS;
  const allocatedIdx = new Array<number>(maxAllocations).fill(-1);
  const allocatedValue = new Array<number>(maxAllocations).fill(0);
  const allocatedIsT5 = new Array<boolean>(maxAllocations).fill(false);

  for (const modCombo of multisetCombinations(modsToSearch, 5)) {
    const statAIdx = modCombo.map((mod) => STAT_INDEX[mod.statA]);
    const statBIdx = modCombo.map((mod) => STAT_INDEX[mod.statB]);
    // Prune: an untargeted third-stat choice contributes zero benefit to the score,
    // so it's always at least as good (never worse) to prefer a targeted stat among
    // the remaining options. Falls back to all 4 options if none of them are targeted.
    const thirdStatChoices = modCombo.map((mod) => {
      const options = ALL_STAT_NAMES.filter((s) => s !== mod.statA && s !== mod.statB);
      if (!hasAnyTarget) return options;
      const targetedOptions = options.filter((s) => targets[s] > 0);
      return targetedOptions.length > 0 ? targetedOptions : options;
    });

    for (const thirdStats of cartesianProduct(thirdStatChoices)) {
      const thirdIdx = thirdStats.map((s) => STAT_INDEX[s]);
      const masterworkIdx: number[][] = [];

      base.fill(0);
      for (let i = 0; i < 5; i++) {
        base[statAIdx[i]] += 25;
        base[statBIdx[i]] += 25;
        base[thirdIdx[i]] += 20;

        const uncovered: number[] = [];
        if (options.masterwork) {
          for (let s = 0; s < numStats; s++) {
            if (s !== statAIdx[i] && s !== statBIdx[i] && s !== thirdIdx[i]) {
              base[s] += 5;
              uncovered.push(s);
            }
          }
        }
        masterworkIdx.push(uncovered);
      }

      // Enumerate which of each piece's 2 stats gets the +5 bonus (30 vs 25).
      for (let mask = 0; mask < 32; mask++) {
        for (let i = 0; i < 5; i++) {
          const bit = (mask >> i) & 1;
          const p = bit ? statBIdx[i] : statAIdx[i];
          primaryIdx[i] = p;
          base[p] += 5;
        }

        // Combined greedy: at each step, apply whichever available token (T5's +5,
        // always available; Stat Mods' +10, if enabled) to whichever stat yields the
        // biggest reduction in squared deficit. This is optimal for this separable,
        // diminishing-returns allocation problem (see project memory on T5 tuning).
        let allocatedCount = 0;
        let t5Remaining = T5_TUNING_SLOTS;
        let statModsRemaining = options.statMods ? STAT_MODS_SLOTS : 0;
        while (t5Remaining > 0 || statModsRemaining > 0) {
          let bestBenefit = 0;
          let bestStat = -1;
          let bestValue = 0;
          let bestIsT5 = true;
          for (let s = 0; s < numStats; s++) {
            const deficit = targetArr[s] - base[s];
            const oldPenalty = deficit > 0 ? deficit * deficit : 0;
            if (t5Remaining > 0) {
              const newDeficit = deficit - T5_TUNING_VALUE;
              const newPenalty = newDeficit > 0 ? newDeficit * newDeficit : 0;
              const benefit = oldPenalty - newPenalty;
              if (benefit > bestBenefit) {
                bestBenefit = benefit;
                bestStat = s;
                bestValue = T5_TUNING_VALUE;
                bestIsT5 = true;
              }
            }
            if (statModsRemaining > 0) {
              const newDeficit = deficit - STAT_MODS_VALUE;
              const newPenalty = newDeficit > 0 ? newDeficit * newDeficit : 0;
              const benefit = oldPenalty - newPenalty;
              if (benefit > bestBenefit) {
                bestBenefit = benefit;
                bestStat = s;
                bestValue = STAT_MODS_VALUE;
                bestIsT5 = false;
              }
            }
          }
          if (bestStat === -1) break;
          base[bestStat] += bestValue;
          allocatedIdx[allocatedCount] = bestStat;
          allocatedValue[allocatedCount] = bestValue;
          allocatedIsT5[allocatedCount] = bestIsT5;
          allocatedCount++;
          if (bestIsT5) t5Remaining--; else statModsRemaining--;
        }

        let score = 0;
        for (let s = 0; s < numStats; s++) {
          const deficit = targetArr[s] - base[s];
          if (deficit > 0) score += deficit * deficit;
        }

        if (heap.length < 5 || score < heap[heap.length - 1].score) {
          const projected = arrayToStats(base);
          for (let k = 0; k < allocatedCount; k++) base[allocatedIdx[k]] -= allocatedValue[k];
          const baseProjected = arrayToStats(base);

          const statModAllocation: Partial<Record<ArmorStatName, number>> = {};
          const t5Allocation: Partial<Record<ArmorStatName, number>> = {};
          for (let k = 0; k < allocatedCount; k++) {
            const statName = ALL_STAT_NAMES[allocatedIdx[k]];
            if (allocatedIsT5[k]) {
              t5Allocation[statName] = (t5Allocation[statName] ?? 0) + allocatedValue[k];
            } else {
              statModAllocation[statName] = (statModAllocation[statName] ?? 0) + allocatedValue[k];
            }
          }

          const assignments: GhostModAssignment[] = modCombo.map((mod, i) => ({
            mod,
            primaryStat: ALL_STAT_NAMES[primaryIdx[i]],
            thirdStat: thirdStats[i],
          }));

          const debug: DebugContribution[] = modCombo.map((mod, i) => {
            const secondaryIdx = primaryIdx[i] === statAIdx[i] ? statBIdx[i] : statAIdx[i];
            const masterworkContributions: Partial<Record<ArmorStatName, number>> = {};
            for (const s of masterworkIdx[i]) {
              masterworkContributions[ALL_STAT_NAMES[s]] = 5;
            }
            return {
              modName: mod.name,
              contributions: {
                [ALL_STAT_NAMES[primaryIdx[i]]]: 30,
                [ALL_STAT_NAMES[secondaryIdx]]: 25,
                [thirdStats[i]]: 20,
              } as Partial<Record<ArmorStatName, number>>,
              masterworkContributions,
            };
          });

          heap.push({ score, assignments, projected, baseProjected, statModAllocation, t5Allocation, debug });
          heap.sort((a, b) => a.score - b.score);
          if (heap.length > 5) heap.pop();
        } else {
          for (let k = 0; k < allocatedCount; k++) base[allocatedIdx[k]] -= allocatedValue[k];
        }

        for (let i = 0; i < 5; i++) base[primaryIdx[i]] -= 5;
      }
    }
  }

  return heap.map(({ assignments, projected, baseProjected, statModAllocation, t5Allocation, score, debug }) => ({
    assignments,
    projected,
    baseProjected,
    statModAllocation,
    t5Allocation,
    score,
    debug,
  }));
}
