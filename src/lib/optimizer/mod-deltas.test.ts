import { describe, it, expect } from "vitest";
import { getModDeltaSet } from "./mod-deltas";
import { vectorKey, zeroVector } from "./vectors";

describe("getModDeltaSet", () => {
  it("includes the all-zero vector (every mod slot empty)", () => {
    const deltas = getModDeltaSet();
    expect(deltas.some((d) => vectorKey(d) === vectorKey(zeroVector()))).toBe(true);
  });

  it("includes +50 to a single stat (five +10 mods on the same stat)", () => {
    const deltas = getModDeltaSet();
    const maxMobility = { ...zeroVector(), mobility: 50 };
    expect(deltas.some((d) => vectorKey(d) === vectorKey(maxMobility))).toBe(true);
  });

  it("is bounded by the number of 5-multisets of the 13 mod options", () => {
    const deltas = getModDeltaSet();
    // C(13 + 5 - 1, 5) = C(17, 5) = 6188 raw multisets; distinct sums must be <= that.
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.length).toBeLessThanOrEqual(6188);
  });

  it("is cached across calls", () => {
    expect(getModDeltaSet()).toBe(getModDeltaSet());
  });
});
