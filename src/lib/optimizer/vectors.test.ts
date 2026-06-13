import { describe, it, expect } from "vitest";
import { addVectors, subtractVectors, zeroVector, vectorKey, dedupeByStats } from "./vectors";

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

describe("subtractVectors", () => {
  it("subtracts each stat independently, including negative results", () => {
    const a = { mobility: 10, resilience: 20, recovery: 0, discipline: 5, intellect: 0, strength: 0 };
    const b = { mobility: 5, resilience: 0, recovery: 10, discipline: -5, intellect: 0, strength: 0 };
    expect(subtractVectors(a, b)).toEqual({
      mobility: 5,
      resilience: 20,
      recovery: -10,
      discipline: 10,
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
