import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { addVectors, vectorKey, zeroVector, type StatVector } from "./vectors";

const MOD_SLOTS_PER_LOADOUT = 5;

/** A single mod slot is empty, +10 to one stat, or +5 to one stat - 13 options. */
function modOptions(): StatVector[] {
  const options: StatVector[] = [zeroVector()];
  for (const stat of ARMOR_STAT_ORDER) {
    options.push({ ...zeroVector(), [stat]: 10 });
    options.push({ ...zeroVector(), [stat]: 5 });
  }
  return options;
}

let cachedModDeltaSet: StatVector[] | null = null;

/**
 * All distinct stat-vector sums achievable by independently choosing a mod option for each of
 * the loadout's `MOD_SLOTS_PER_LOADOUT` mod slots. Item-independent, so computed once and cached.
 */
export function getModDeltaSet(): StatVector[] {
  if (cachedModDeltaSet) {
    return cachedModDeltaSet;
  }

  const options = modOptions();
  let current = new Map<string, StatVector>([[vectorKey(zeroVector()), zeroVector()]]);

  for (let i = 0; i < MOD_SLOTS_PER_LOADOUT; i++) {
    const next = new Map<string, StatVector>();
    for (const acc of current.values()) {
      for (const option of options) {
        const sum = addVectors(acc, option);
        next.set(vectorKey(sum), sum);
      }
    }
    current = next;
  }

  cachedModDeltaSet = Array.from(current.values());
  return cachedModDeltaSet;
}
