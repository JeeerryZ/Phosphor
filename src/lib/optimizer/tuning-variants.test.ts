import { describe, it, expect } from "vitest";
import { directionalTuningPairs, tuningDeltaVector, tuningDeltas } from "./tuning-variants";
import { dedupeByStats, vectorKey, zeroVector } from "./vectors";

describe("directionalTuningPairs", () => {
  it("returns all 30 ordered pairs of distinct stats", () => {
    const pairs = directionalTuningPairs();
    expect(pairs).toHaveLength(30);
    expect(pairs.every((p) => p.increasedStat !== p.decreasedStat)).toBe(true);

    const keys = new Set(pairs.map((p) => `${p.increasedStat}->${p.decreasedStat}`));
    expect(keys.size).toBe(30);
  });
});

describe("tuningDeltas", () => {
  it("returns 32 entries: empty + balanced + 30 directional", () => {
    const deltas = tuningDeltas();
    expect(deltas).toHaveLength(32);
    expect(deltas.filter((d) => d.tuning.kind === "empty")).toHaveLength(1);
    expect(deltas.filter((d) => d.tuning.kind === "balanced")).toHaveLength(1);
    expect(deltas.filter((d) => d.tuning.kind === "directional")).toHaveLength(30);
  });

  it("the empty delta is zero", () => {
    const empty = tuningDeltas().find((d) => d.tuning.kind === "empty");
    expect(empty?.delta).toEqual(zeroVector());
  });

  it("the balanced delta adds +1 to every stat", () => {
    const balanced = tuningDeltas().find((d) => d.tuning.kind === "balanced");
    expect(balanced?.delta).toEqual({
      mobility: 1,
      resilience: 1,
      recovery: 1,
      discipline: 1,
      intellect: 1,
      strength: 1,
    });
  });

  it("each directional delta moves 5 points from the decreased stat to the increased stat", () => {
    const directional = tuningDeltas().find(
      (d) =>
        d.tuning.kind === "directional" &&
        d.tuning.increasedStat === "intellect" &&
        d.tuning.decreasedStat === "mobility"
    );

    expect(directional?.delta).toEqual({
      ...zeroVector(),
      mobility: -5,
      intellect: 5,
    });
  });

  it("has no duplicate delta vectors", () => {
    expect(dedupeByStats(tuningDeltas().map((d) => ({ stats: d.delta })))).toHaveLength(32);
  });
});

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

  it("matches tuningDeltas for 'directional'", () => {
    const directional = tuningDeltas().find((d) => d.tuning.kind === "directional")!;
    expect(vectorKey(tuningDeltaVector(directional.tuning))).toBe(vectorKey(directional.delta));
  });
});
