import { describe, it, expect, vi } from "vitest";

vi.mock("./definitions", () => ({
  getStatDefinition: (hash: number) => ({
    displayProperties: { icon: `/common/destiny2_content/icons/${hash}.png` },
  }),
}));

describe("getArmorStatIcons", () => {
  it("returns an icon path for each of the 6 armor stats", async () => {
    const { getArmorStatIcons } = await import("./stats");
    const icons = getArmorStatIcons();

    expect(Object.keys(icons).sort()).toEqual(
      ["discipline", "intellect", "mobility", "recovery", "resilience", "strength"].sort()
    );
    expect(icons.mobility).toMatch(/^\/common\/destiny2_content\/icons\//);
  });
});
