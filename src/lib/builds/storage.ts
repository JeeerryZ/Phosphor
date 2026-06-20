import type { ArmorStats } from "@/lib/armor/types";

const STORAGE_KEY = "setbuilder-builds";

export interface SavedBuild {
  id: string;
  name: string;
  /** itemHash of the selected exotic, or null for legendary-only builds. */
  exoticItemHash: number | null;
  /** Cached display info so the picker can render without a full inventory lookup. */
  exoticName: string | null;
  exoticIcon: string | null;
  classType: number;
  thresholds: ArmorStats;
  fragmentBonuses: ArmorStats;
  savedAt: number;
}

export function loadSavedBuilds(): SavedBuild[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as SavedBuild[];
  } catch {
    return [];
  }
}

export function saveBuild(build: Omit<SavedBuild, "id" | "savedAt">): SavedBuild {
  const saved: SavedBuild = { ...build, id: crypto.randomUUID(), savedAt: Date.now() };
  const builds = loadSavedBuilds();
  builds.unshift(saved);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(builds));
  return saved;
}

export function deleteBuild(id: string): void {
  const builds = loadSavedBuilds().filter((b) => b.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(builds));
}
