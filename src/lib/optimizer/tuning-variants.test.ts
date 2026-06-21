import { describe, it, expect } from "vitest";
import { tuningDeltaVector } from "./tuning-variants";
import { zeroVector } from "./vectors";

describe("tuningDeltaVector", () => {
  it("is zero for 'none' and 'empty'", () => {
    expect(tuningDeltaVector({ kind: "none" })).toEqual(zeroVector());
    expect(tuningDeltaVector({ kind: "empty" })).toEqual(zeroVector());
  });

  it("is +1 to every stat for 'balanced'", () => {
    expect(tuningDeltaVector({ kind: "balanced" })).toEqual({
      mobility: 1,
      resilience: 1,
      recovery: 1,
      discipline: 1,
      intellect: 1,
      strength: 1,
    });
  });

  it("moves 5 points from the decreased stat to the increased stat for 'directional'", () => {
    expect(
      tuningDeltaVector({ kind: "directional", increasedStat: "intellect", decreasedStat: "mobility" })
    ).toEqual({
      ...zeroVector(),
      mobility: -5,
      intellect: 5,
    });
  });
});
