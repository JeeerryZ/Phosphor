import { describe, it, expect } from "vitest";
import { dominates, paretoFrontier } from "./pareto";
import { zeroVector } from "./vectors";

describe("dominates", () => {
  it("is true when a is >= b in every stat and > in at least one", () => {
    const a = { ...zeroVector(), mobility: 10, resilience: 5 };
    const b = { ...zeroVector(), mobility: 10, resilience: 4 };
    expect(dominates(a, b)).toBe(true);
  });

  it("is false for equal vectors", () => {
    const a = { ...zeroVector(), mobility: 10 };
    const b = { ...zeroVector(), mobility: 10 };
    expect(dominates(a, b)).toBe(false);
  });

  it("is false when a is better in one stat but worse in another", () => {
    const a = { ...zeroVector(), mobility: 10, resilience: 0 };
    const b = { ...zeroVector(), mobility: 5, resilience: 5 };
    expect(dominates(a, b)).toBe(false);
  });
});

describe("paretoFrontier", () => {
  it("removes items dominated by another item", () => {
    const items = [
      { id: "best", stats: { ...zeroVector(), mobility: 10, resilience: 10 } },
      { id: "dominated", stats: { ...zeroVector(), mobility: 10, resilience: 5 } },
      { id: "tradeoff", stats: { ...zeroVector(), mobility: 20, resilience: 0 } },
    ];

    const frontier = paretoFrontier(items);
    expect(frontier.map((i) => i.id).sort()).toEqual(["best", "tradeoff"]);
  });
});
