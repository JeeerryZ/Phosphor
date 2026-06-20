"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import type { ArmorInventory, ArmorItem, ArmorSlot, ArmorStatName, ArmorStats } from "@/lib/armor/types";
import type { OptimizerResult } from "@/lib/optimizer";
import type { EquipLoadoutRequest } from "@/app/api/loadout/equip/route";
import { ARMOR_STAT_ORDER, ARMOR_SLOT_LABELS } from "@/styles/theme";
import { ALL_SLOTS } from "@/lib/optimizer/combine";
import { ExoticPicker } from "./ExoticPicker";
import { OptimizerControls } from "./OptimizerControls";
import { OptimizerResults, OptimizerResultsSkeleton } from "./OptimizerResults";
import { OptimizerDebugOverlay, type OptimizerDebugInfo } from "./OptimizerDebugOverlay";
import { loadSavedBuilds, saveBuild, deleteBuild, type SavedBuild } from "@/lib/builds/storage";

const QUERY_DEBOUNCE_MS = 300;

type Phase = "picker" | "optimizer";

function zeroThresholds(): ArmorStats {
  return { mobility: 0, resilience: 0, recovery: 0, discipline: 0, intellect: 0, strength: 0 };
}

const slideVariants = {
  enter: (dir: number) => ({ x: dir === 1 ? "50%" : "-50%", opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir === 1 ? "-50%" : "50%", opacity: 0 }),
};
const slideTransition = { duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] };

// Short URL param keys per stat
const STAT_PARAM_KEYS: [string, ArmorStatName][] = [
  ["mob", "mobility"], ["res", "resilience"], ["rec", "recovery"],
  ["disc", "discipline"], ["int", "intellect"], ["str", "strength"],
];

interface OptimizerClientProps {
  inventory: ArmorInventory;
  statIcons: Record<ArmorStatName, string>;
  defaultClassType: number;
  characters: Record<string, { classType: number }>;
}

export function OptimizerClient({ inventory, statIcons, defaultClassType, characters }: OptimizerClientProps) {
  const allItems = useMemo(() => {
    const seenIds = new Set<string>();
    return [...inventory.vault, ...Object.values(inventory.characters).flat()].filter((item) => {
      if (seenIds.has(item.itemInstanceId)) return false;
      seenIds.add(item.itemInstanceId);
      return true;
    });
  }, [inventory]);

  const [phase, setPhase] = useState<Phase>("picker");
  const [direction, setDirection] = useState<1 | -1>(1);
  const [classType, setClassType] = useState(defaultClassType);
  const [selectedExotic, setSelectedExotic] = useState<ArmorItem | null>(null);
  const [results, setResults] = useState<OptimizerResult[]>([]);
  const [thresholds, setThresholds] = useState<ArmorStats>(zeroThresholds());
  const [fragmentBonuses, setFragmentBonuses] = useState<ArmorStats>(zeroThresholds());
  const [lockedItems, setLockedItems] = useState<Partial<Record<ArmorSlot, ArmorItem>>>({});
  const [masterworkOnly, setMasterworkOnly] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "timeout">("idle");
  const [debugInfo, setDebugInfo] = useState<OptimizerDebugInfo | null>(null);
  const [absoluteMaxStats, setAbsoluteMaxStats] = useState<Record<ArmorStatName, number> | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [savedBuilds, setSavedBuilds] = useState<SavedBuild[]>([]);
  const [saveMode, setSaveMode] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDone, setSaveDone] = useState(false);
  const [importFragmentsState, setImportFragmentsState] = useState<"idle" | "loading" | "error">("idle");
  const requestIdRef = useRef(0);
  const importFragmentsRequestIdRef = useRef(0);
  const phaseEnteredRef = useRef(false);
  const urlRestoredRef = useRef(false);

  const activeCharacterId =
    Object.entries(characters).find(([, c]) => c.classType === classType)?.[0] ?? null;

  // Derived locked instance IDs for the API
  const lockedItemInstanceIds = useMemo(
    () => Object.fromEntries(
      Object.entries(lockedItems).map(([slot, item]) => [slot, item.itemInstanceId])
    ) as Partial<Record<ArmorSlot, string>>,
    [lockedItems]
  );

  function handleLockSlot(slot: ArmorSlot, item: ArmorItem) {
    setLockedItems((prev) => ({ ...prev, [slot]: item }));
  }

  function handleUnlockSlot(slot: ArmorSlot) {
    setLockedItems((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
  }

  async function handleEquipLoadout(result: OptimizerResult): Promise<{ error?: string }> {
    if (!activeCharacterId) return { error: "No matching character found for this class." };

    const baseTotals: Record<ArmorStatName, number> = {
      mobility: 0, resilience: 0, recovery: 0, discipline: 0, intellect: 0, strength: 0,
    };
    for (const slot of ALL_SLOTS) {
      const choice = result.loadout[slot];
      if (!choice) continue;
      for (const stat of ARMOR_STAT_ORDER) baseTotals[stat] += choice.stats[stat];
    }

    const neededMods: ArmorStatName[] = [];
    for (const stat of ARMOR_STAT_ORDER) {
      const deficit = thresholds[stat] - baseTotals[stat];
      const slots = Math.max(0, Math.ceil(deficit / 10));
      for (let i = 0; i < slots; i++) neededMods.push(stat);
    }

    const modAssignment: Partial<Record<string, ArmorStatName>> = {};
    let modIndex = 0;
    for (const slot of ALL_SLOTS) {
      if (modIndex >= neededMods.length) break;
      if (result.loadout[slot]) modAssignment[slot] = neededMods[modIndex++];
    }

    const items = ALL_SLOTS.flatMap((slot) => {
      const choice = result.loadout[slot];
      if (!choice) return [];
      return [{
        itemInstanceId: choice.item.itemInstanceId,
        itemHash: choice.item.itemHash,
        location: choice.item.location,
        tuningSocketIndex: choice.item.tuningSocketIndex,
        desiredTuning: choice.tuning,
        statModSocketIndex: choice.item.statModSocketIndex,
        statMod: modAssignment[slot],
      }];
    });

    const body: EquipLoadoutRequest = { items, characterId: activeCharacterId };
    const response = await fetch("/api/loadout/equip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      return { error: data.error ?? `Request failed (${response.status})` };
    }
    return {};
  }

  async function runQuery(exotic: ArmorItem | null, currentThresholds: ArmorStats) {
    const requestId = ++requestIdRef.current;
    setStatus("loading");

    // Fragment bonuses reduce what armor needs to provide per stat.
    const adjustedThresholds: ArmorStats = { ...currentThresholds };
    for (const stat of ARMOR_STAT_ORDER) {
      const bonus = fragmentBonuses[stat] ?? 0;
      adjustedThresholds[stat] = Math.max(0, adjustedThresholds[stat] - bonus);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch("/api/optimizer/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(exotic ? { exoticItemInstanceId: exotic.itemInstanceId } : {}),
          classType,
          lockedItemInstanceIds,
          thresholds: adjustedThresholds,
          masterworkOnly,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed: ${response.status}`);
      }

      const data = (await response.json()) as {
        results: OptimizerResult[];
        perStatMax: Record<ArmorStatName, number>;
        debug: OptimizerDebugInfo;
        error?: string;
      };

      if (requestIdRef.current !== requestId) return;
      setResults(data.results);
      setDebugInfo(data.debug);
      setAbsoluteMaxStats((prev) => prev ?? (data.perStatMax as Record<ArmorStatName, number>));
      setStatus("idle");
    } catch (err) {
      clearTimeout(timeoutId);
      if (requestIdRef.current !== requestId) return;
      const isTimeout = err instanceof Error && err.name === "AbortError";
      setStatus(isTimeout ? "timeout" : "error");
    }
  }

  // Load saved builds from localStorage once on mount.
  useEffect(() => { setSavedBuilds(loadSavedBuilds()); }, []);

  // Escape key exits the optimizer phase back to the picker.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && phase === "optimizer") handleChangeExotic();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveBuild = useCallback(() => {
    const build = saveBuild({
      name: saveName.trim() || selectedExotic?.name || "Legendary Build",
      exoticItemHash: selectedExotic?.itemHash ?? null,
      exoticName: selectedExotic?.name ?? null,
      exoticIcon: selectedExotic?.icon ?? null,
      classType,
      thresholds,
      fragmentBonuses,
    });
    setSavedBuilds((prev) => [build, ...prev]);
    setSaveMode(false);
    setSaveDone(true);
    setTimeout(() => setSaveDone(false), 2000);
  }, [saveName, selectedExotic, classType, thresholds, fragmentBonuses]);

  const handleImportFragments = useCallback(async () => {
    if (!activeCharacterId) return;
    const requestId = ++importFragmentsRequestIdRef.current;
    setImportFragmentsState("loading");
    try {
      const response = await fetch(`/api/loadout/fragments?characterId=${activeCharacterId}`);
      if (!response.ok) throw new Error("Import failed");
      const data = (await response.json()) as { stats: ArmorStats };
      if (importFragmentsRequestIdRef.current !== requestId) return;
      setFragmentBonuses(data.stats);
      setImportFragmentsState("idle");
    } catch (err) {
      if (importFragmentsRequestIdRef.current !== requestId) return;
      console.error("Failed to import fragment stats:", err);
      setImportFragmentsState("error");
      setTimeout(() => setImportFragmentsState("idle"), 3000);
    }
  }, [activeCharacterId]);

  const handleLoadBuild = useCallback((build: SavedBuild) => {
    requestIdRef.current += 1;
    phaseEnteredRef.current = true;

    const match = build.exoticItemHash !== null
      ? allItems.find((item) => item.itemHash === build.exoticItemHash && item.tierType === 6 && item.classType === build.classType)
      : null;

    setClassType(build.classType);
    setSelectedExotic(match ?? null);
    setThresholds(build.thresholds);
    setFragmentBonuses(build.fragmentBonuses);
    setLockedItems({});
    setResults([]);
    setAbsoluteMaxStats(null);
    setStatus("loading");
    setDirection(1);
    setPhase("optimizer");
  }, [allItems]);

  const handleDeleteBuild = useCallback((id: string) => {
    deleteBuild(id);
    setSavedBuilds((prev) => prev.filter((b) => b.id !== id));
  }, []);

  // Restore state from URL on first mount (shared links).
  useEffect(() => {
    if (urlRestoredRef.current) return;
    urlRestoredRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const rawHash = params.get("exotic");
    const classParam = params.get("class");
    const targetClass = classParam !== null ? Number(classParam) : null;

    const restored: ArmorStats = zeroThresholds();
    for (const [key, stat] of STAT_PARAM_KEYS) {
      const v = params.get(key);
      if (v) restored[stat] = Number(v);
    }

    const restoredFrag: ArmorStats = zeroThresholds();
    for (const [key, stat] of STAT_PARAM_KEYS) {
      const v = params.get(`fb_${key}`);
      if (v) restoredFrag[stat] = Number(v);
    }

    if (targetClass !== null) setClassType(targetClass);

    if (!rawHash) {
      // Check for no-exotic mode in URL
      if (params.get("noexotic") === "1") {
        requestIdRef.current += 1;
        phaseEnteredRef.current = true;
        setSelectedExotic(null);
        setThresholds(restored);
        setFragmentBonuses(restoredFrag);
        setResults([]);
        setAbsoluteMaxStats(null);
        setStatus("loading");
        setDirection(1);
        setPhase("optimizer");
      }
      return;
    }

    const hash = Number(rawHash);
    const match = allItems.find(
      (item) => item.itemHash === hash && item.tierType === 6 &&
        (targetClass === null || item.classType === targetClass)
    );
    if (!match) return;

    requestIdRef.current += 1;
    phaseEnteredRef.current = true;
    setSelectedExotic(match);
    setThresholds(restored);
    setFragmentBonuses(restoredFrag);
    setResults([]);
    setAbsoluteMaxStats(null);
    setStatus("loading");
    setDirection(1);
    setPhase("optimizer");
  }, [allItems]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep URL in sync so the page is always shareable.
  useEffect(() => {
    if (phase !== "optimizer") return;
    const params = new URLSearchParams();
    params.set("class", String(classType));
    if (selectedExotic) {
      params.set("exotic", String(selectedExotic.itemHash));
    } else {
      params.set("noexotic", "1");
    }
    for (const [key, stat] of STAT_PARAM_KEYS) {
      if (thresholds[stat] > 0) params.set(key, String(thresholds[stat]));
    }
    for (const [key, stat] of STAT_PARAM_KEYS) {
      if (fragmentBonuses[stat] !== 0) params.set(`fb_${key}`, String(fragmentBonuses[stat]));
    }
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, [phase, selectedExotic, classType, thresholds, fragmentBonuses]);

  // Fire immediately on phase entry; debounce all subsequent changes.
  useEffect(() => {
    if (phase !== "optimizer") return;
    const isFirstLoad = phaseEnteredRef.current;
    phaseEnteredRef.current = false;
    const delay = isFirstLoad ? 0 : QUERY_DEBOUNCE_MS;
    const timeout = setTimeout(() => runQuery(selectedExotic, thresholds), delay);
    return () => clearTimeout(timeout);
  }, [phase, selectedExotic, thresholds, masterworkOnly, lockedItems, fragmentBonuses]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelectExotic(item: ArmorItem) {
    requestIdRef.current += 1;
    phaseEnteredRef.current = true;
    setSelectedExotic(item);
    setResults([]);
    setThresholds(zeroThresholds());
    setAbsoluteMaxStats(null);
    setLockedItems({});
    setStatus("loading");
    setDirection(1);
    setPhase("optimizer");
  }

  function handleNoExotic() {
    requestIdRef.current += 1;
    phaseEnteredRef.current = true;
    setSelectedExotic(null);
    setResults([]);
    setThresholds(zeroThresholds());
    setAbsoluteMaxStats(null);
    setLockedItems({});
    setStatus("loading");
    setDirection(1);
    setPhase("optimizer");
  }

  function handleChangeExotic() {
    requestIdRef.current += 1;
    phaseEnteredRef.current = false;
    setResults([]);
    setStatus("idle");
    setAbsoluteMaxStats(null);
    setLockedItems({});
    setDirection(-1);
    setPhase("picker");
    window.history.replaceState(null, "", window.location.pathname);
  }

  const isNoExoticMode = phase === "optimizer" && selectedExotic === null;

  return (
    <>
      {debugInfo && <OptimizerDebugOverlay info={debugInfo} />}

      <div style={{ overflowX: "clip" }}>
        <AnimatePresence mode="wait" custom={direction}>
          {phase === "picker" ? (
            <motion.div
              key="picker"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={slideTransition}
            >
              <ExoticPicker
                items={allItems}
                selectedClassType={classType}
                onSelectClassType={(next) => {
                  requestIdRef.current += 1;
                  setClassType(next);
                  setSelectedExotic(null);
                  setResults([]);
                  setStatus("idle");
                }}
                selectedItemInstanceId={selectedExotic?.itemInstanceId ?? null}
                onSelect={handleSelectExotic}
                onNoExotic={handleNoExotic}
                savedBuilds={savedBuilds}
                onLoadBuild={handleLoadBuild}
                onDeleteBuild={handleDeleteBuild}
              />
            </motion.div>
          ) : (
            <motion.div
              key="optimizer"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={slideTransition}
            >
              {/* Sticky panel */}
              <div className="sticky top-0 z-10" style={{ background: "var(--color-bg)" }}>
                {/* Compact header */}
                <div className="flex items-center gap-3 border border-border px-3 py-2.5 mb-0">
                  <button
                    type="button"
                    onClick={handleChangeExotic}
                    className="flex shrink-0 items-center gap-1.5 text-xs text-fg-muted transition-colors hover:text-fg cursor-pointer"
                    aria-label="Change exotic"
                  >
                    <span>←</span>
                    <span className="hidden sm:inline uppercase tracking-widest text-[10px]">Change</span>
                  </button>

                  <div className="h-4 w-px bg-border shrink-0" />

                  {isNoExoticMode ? (
                    <span className="text-sm text-fg-dim uppercase tracking-widest">⊘ Legendary Only</span>
                  ) : selectedExotic && (
                    <>
                      <div className="relative h-7 w-7 shrink-0 overflow-hidden border border-warn/50">
                        {selectedExotic.icon && (
                          <Image
                            src={`https://www.bungie.net${selectedExotic.icon}`}
                            alt=""
                            fill
                            sizes="28px"
                            className="object-cover"
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 flex items-baseline gap-2">
                        <span
                          className="text-sm font-medium text-warn truncate"
                          style={{ fontFamily: "var(--font-sans)" }}
                        >
                          {selectedExotic.name}
                        </span>
                        <span className="text-[10px] text-fg-muted shrink-0 uppercase tracking-wide">
                          {ARMOR_SLOT_LABELS[selectedExotic.slot]}
                        </span>
                      </div>
                    </>
                  )}

                  {/* Pinned items badge */}
                  {Object.keys(lockedItems).length > 0 && (
                    <span className="hidden sm:inline text-[10px] border border-accent/40 px-2 py-0.5 text-accent/80 shrink-0">
                      ⊙ {Object.keys(lockedItems).length} pinned
                    </span>
                  )}

                  <div className="ml-auto flex items-center gap-2 shrink-0">
                    <span className="text-[10px] tabular-nums text-fg-muted hidden sm:inline">
                      {status === "loading" ? (
                        <span>computing<span className="cursor-blink">▌</span></span>
                      ) : results.length > 0 ? (
                        <span>{results.length} build{results.length === 1 ? "" : "s"}</span>
                      ) : null}
                    </span>

                    {/* Save button / inline input */}
                    {saveMode ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          autoFocus
                          type="text"
                          value={saveName}
                          onChange={(e) => setSaveName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveBuild();
                            if (e.key === "Escape") setSaveMode(false);
                          }}
                          placeholder={selectedExotic?.name ?? "Legendary Build"}
                          className="border border-border-active bg-surface px-2 py-0.5 text-[10px] text-fg w-36 focus:outline-none"
                        />
                        <button type="button" onClick={handleSaveBuild} className="text-[10px] border border-border-active px-2 py-0.5 text-accent cursor-pointer hover:bg-accent/5 transition-colors">OK</button>
                        <button type="button" onClick={() => setSaveMode(false)} className="text-[10px] text-fg-muted cursor-pointer hover:text-fg transition-colors">✕</button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setSaveName(""); setSaveMode(true); }}
                        className="text-[10px] uppercase tracking-widest border border-border px-2 py-0.5 transition-colors cursor-pointer hover:border-border-active hover:text-fg text-fg-muted"
                      >
                        {saveDone ? "SAVED ✓" : "SAVE"}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(window.location.href).then(() => {
                          setShareCopied(true);
                          setTimeout(() => setShareCopied(false), 2000);
                        });
                      }}
                      className="text-[10px] uppercase tracking-widest border border-border px-2 py-0.5 transition-colors cursor-pointer hover:border-border-active hover:text-fg text-fg-muted"
                    >
                      {shareCopied ? "COPIED ✓" : "SHARE"}
                    </button>
                  </div>
                </div>

                {/* Sliders */}
                <OptimizerControls
                  thresholds={thresholds}
                  onThresholdChange={(stat, value) =>
                    setThresholds((prev) => ({ ...prev, [stat]: value }))
                  }
                  statIcons={statIcons}
                  maxStats={absoluteMaxStats}
                  masterworkOnly={masterworkOnly}
                  onMasterworkOnlyChange={(v) => {
                    setMasterworkOnly(v);
                    setAbsoluteMaxStats(null);
                  }}
                  fragmentBonuses={fragmentBonuses}
                  onFragmentBonusChange={(stat, value) =>
                    setFragmentBonuses((prev) => ({ ...prev, [stat]: value }))
                  }
                  lockedItems={lockedItems}
                  onUnlockSlot={handleUnlockSlot}
                  onImportFragments={handleImportFragments}
                  importFragmentsState={importFragmentsState}
                />
              </div>

              {/* Results area */}
              <div className="mt-6">
                {(status === "error" || status === "timeout") && (
                  <p role="alert" className="text-xs text-error">
                    {status === "timeout" ? "Query timed out." : "Something went wrong."}{" "}
                    <button
                      type="button"
                      onClick={() => runQuery(selectedExotic, thresholds)}
                      className="underline underline-offset-2 cursor-pointer hover:text-error/80"
                    >
                      Retry
                    </button>
                  </p>
                )}
                {status === "loading" && <OptimizerResultsSkeleton />}
                {status === "idle" && (
                  <OptimizerResults
                    results={results}
                    thresholds={thresholds}
                    onEquip={handleEquipLoadout}
                    lockedItems={lockedItemInstanceIds}
                    onLockSlot={handleLockSlot}
                    onUnlockSlot={handleUnlockSlot}
                    maxStats={absoluteMaxStats}
                    masterworkOnly={masterworkOnly}
                  />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
