import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { zeroVector, type StatVector } from "./vectors";

const MOD_SLOTS_PER_LOADOUT = 5;
const MOD_BONUS = 10;

/**
 * Maximum total stat points mods can contribute across all stats combined: each of the
 * `MOD_SLOTS_PER_LOADOUT` general mod slots adds at most `MOD_BONUS` to one stat. Every entry in
 * `getModDeltaSet()` sums to exactly this value.
 */
export const MOD_BUDGET = MOD_SLOTS_PER_LOADOUT * MOD_BONUS;

/**
 * All ways to distribute `slots` indistinguishable tokens across `statCount` stats, as arrays of
 * per-stat counts summing to `slots` (combinations with repetition).
 */
function* tokenAllocations(slots: number, statCount: number): Generator<number[]> {
  if (statCount === 1) {
    yield [slots];
    return;
  }
  for (let count = 0; count <= slots; count++) {
    for (const rest of tokenAllocations(slots - count, statCount - 1)) {
      yield [count, ...rest];
    }
  }
}

let cachedModDeltaSet: StatVector[] | null = null;

/**
 * The Pareto frontier of achievable stat-vector sums from independently choosing a mod option
 * (none, +5, or +10 to one stat) for each of the loadout's `MOD_SLOTS_PER_LOADOUT` mod slots.
 *
 * A mod slot below +10 (or empty) can always be raised to +10 on the same stat, strictly
 * improving that stat with no other change - so every non-dominated combination uses all 5
 * slots at +10. The frontier is therefore exactly the ways to distribute 5 "+10" tokens across
 * the 6 stats: C(5 + 6 - 1, 5) = 252 vectors.
 */
export function getModDeltaSet(): StatVector[] {
  if (cachedModDeltaSet) {
    return cachedModDeltaSet;
  }

  const result: StatVector[] = [];
  for (const counts of tokenAllocations(MOD_SLOTS_PER_LOADOUT, ARMOR_STAT_ORDER.length)) {
    const vector = zeroVector();
    ARMOR_STAT_ORDER.forEach((stat, i) => {
      vector[stat] = counts[i] * MOD_BONUS;
    });
    result.push(vector);
  }

  cachedModDeltaSet = result;
  return cachedModDeltaSet;
}
