import { describe, it, expect } from "vitest";
import { addVectors, zeroVector, vectorKey, dedupeByStats, flattenStatVectors, type StatVector } from "./vectors";

describe("zeroVector", () => {
  it("has all six stats at zero", () => {
    expect(zeroVector()).toEqual({
      mobility: 0,
      resilience: 0,
      recovery: 0,
      discipline: 0,
      intellect: 0,
      strength: 0,
    });
  });
});

describe("addVectors", () => {
  it("sums each stat independently, including negative deltas", () => {
    const a = { mobility: 10, resilience: 20, recovery: 0, discipline: 5, intellect: 0, strength: 0 };
    const b = { mobility: 5, resilience: 0, recovery: 10, discipline: -5, intellect: 0, strength: 0 };
    expect(addVectors(a, b)).toEqual({
      mobility: 15,
      resilience: 20,
      recovery: 10,
      discipline: 0,
      intellect: 0,
      strength: 0,
    });
  });
});

describe("vectorKey", () => {
  it("is equal for equal vectors and different for different vectors", () => {
    const a = zeroVector();
    const b = zeroVector();
    expect(vectorKey(a)).toBe(vectorKey(b));

    const c = { ...zeroVector(), mobility: 1 };
    expect(vectorKey(a)).not.toBe(vectorKey(c));
  });
});

describe("dedupeByStats", () => {
  it("keeps only the first item for each distinct stat vector", () => {
    const items = [
      { id: "a", stats: zeroVector() },
      { id: "b", stats: zeroVector() },
      { id: "c", stats: { ...zeroVector(), mobility: 1 } },
    ];
    expect(dedupeByStats(items).map((i) => i.id)).toEqual(["a", "c"]);
  });
});

describe("flattenStatVectors", () => {
  it("flattens an array of stat vectors into a row-major Int32Array using ARMOR_STAT_ORDER", () => {
    const vectors: StatVector[] = [
      { mobility: 1, resilience: 2, recovery: 3, discipline: 4, intellect: 5, strength: 6 },
      { mobility: 10, resilience: 20, recovery: 30, discipline: 40, intellect: 50, strength: 60 },
    ];

    expect(flattenStatVectors(vectors)).toEqual(Int32Array.from([1, 2, 3, 4, 5, 6, 10, 20, 30, 40, 50, 60]));
  });

  it("returns an empty Int32Array for an empty input", () => {
    expect(flattenStatVectors([])).toEqual(new Int32Array(0));
  });
});
