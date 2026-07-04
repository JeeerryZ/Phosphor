import { describe, it, expect } from "vitest";
import { adjustTargetsForFragments, effectiveStatCap } from "./fragmentTargets";
import { EMPTY_ARMOR_STATS } from "@/lib/armor/types";

describe("adjustTargetsForFragments", () => {
  it("subtracts positive fragment bonuses from targets", () => {
    const targets = { ...EMPTY_ARMOR_STATS, resilience: 100 };
    const fragmentBonuses = { ...EMPTY_ARMOR_STATS, resilience: 20 };
    expect(adjustTargetsForFragments(targets, fragmentBonuses).resilience).toBe(80);
  });

  it("adds the deficit back when fragment bonus is negative", () => {
    const targets = { ...EMPTY_ARMOR_STATS, mobility: 100 };
    const fragmentBonuses = { ...EMPTY_ARMOR_STATS, mobility: -10 };
    expect(adjustTargetsForFragments(targets, fragmentBonuses).mobility).toBe(110);
  });

  it("floors at zero when the fragment bonus exceeds the target", () => {
    const targets = { ...EMPTY_ARMOR_STATS, strength: 10 };
    const fragmentBonuses = { ...EMPTY_ARMOR_STATS, strength: 25 };
    expect(adjustTargetsForFragments(targets, fragmentBonuses).strength).toBe(0);
  });

  it("leaves untouched stats at zero", () => {
    const targets = { ...EMPTY_ARMOR_STATS, resilience: 50 };
    const fragmentBonuses = { ...EMPTY_ARMOR_STATS };
    const result = adjustTargetsForFragments(targets, fragmentBonuses);
    expect(result.mobility).toBe(0);
    expect(result.resilience).toBe(50);
  });
});

describe("effectiveStatCap", () => {
  it("raises the cap by a positive fragment bonus", () => {
    expect(effectiveStatCap(175, 20)).toBe(195);
  });

  it("does not lower the cap for a negative fragment bonus", () => {
    expect(effectiveStatCap(175, -20)).toBe(175);
  });

  it("leaves the cap unchanged when there is no bonus", () => {
    expect(effectiveStatCap(175, 0)).toBe(175);
  });
});
