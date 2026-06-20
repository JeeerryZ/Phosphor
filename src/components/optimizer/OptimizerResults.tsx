"use client";

import { useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import {
  ARMOR_STAT_COLORS,
  ARMOR_STAT_LABELS,
  ARMOR_STAT_ORDER,
  ARMOR_STAT_SHORT,
  ARMOR_SLOT_LABELS,
} from "@/styles/theme";
import type { ArmorSlot, ArmorStatName, ArmorStats, ArmorItem } from "@/lib/armor/types";
import type { OptimizerResult } from "@/lib/optimizer";
import { cn } from "@/lib/utils/cn";

const SLOT_ORDER: ArmorSlot[] = ["helmet", "gauntlets", "chest", "legs", "classItem"];

type SortKey = ArmorStatName | "total";
type SortDir = "asc" | "desc";
type EquipState = "idle" | "loading" | "success" | "error";
type DimCopyState = "idle" | "copied";

function totalOf(r: OptimizerResult) {
  return ARMOR_STAT_ORDER.reduce((s, stat) => s + r.stats[stat], 0);
}

interface OptimizerResultsProps {
  results: OptimizerResult[];
  thresholds: ArmorStats;
  onEquip: (result: OptimizerResult) => Promise<{ error?: string }>;
  lockedItems: Partial<Record<ArmorSlot, string>>;
  onLockSlot: (slot: ArmorSlot, item: ArmorItem) => void;
  onUnlockSlot: (slot: ArmorSlot) => void;
  maxStats?: Record<ArmorStatName, number> | null;
  masterworkOnly?: boolean;
}

export function OptimizerResults({ results, thresholds, onEquip, lockedItems, onLockSlot, onUnlockSlot, maxStats, masterworkOnly }: OptimizerResultsProps) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [equipStates, setEquipStates] = useState<Record<string, EquipState>>({});
  const [dimCopyStates, setDimCopyStates] = useState<Record<string, DimCopyState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (results.length === 0) {
    // Find the stat whose threshold exceeds what the armor pool can provide.
    let bottleneckStat: ArmorStatName | null = null;
    if (maxStats) {
      for (const stat of ARMOR_STAT_ORDER) {
        if (thresholds[stat] > 0 && thresholds[stat] > (maxStats[stat] ?? 0)) {
          bottleneckStat = stat;
          break;
        }
      }
    }
    // If no threshold is even set yet there's nothing to "lower" — the candidate pool itself
    // is empty for some slot (e.g. the masterwork filter excludes every item in that slot).
    const anyThresholdSet = ARMOR_STAT_ORDER.some((stat) => thresholds[stat] > 0);
    return (
      <div className="mt-2 space-y-1">
        <p className="text-sm text-fg-muted">No combinations meet the current thresholds.</p>
        {bottleneckStat && (
          <p className="text-sm text-fg-muted">
            <span className="text-warn">↓</span>{" "}
            Try lowering {ARMOR_STAT_LABELS[bottleneckStat]} — max your armor can reach is{" "}
            <span className="text-fg-dim tabular-nums">{maxStats![bottleneckStat]}</span>.
          </p>
        )}
        {!bottleneckStat && !anyThresholdSet && masterworkOnly && (
          <p className="text-sm text-fg-muted">
            <span className="text-warn">↓</span>{" "}
            "Masterwork only" may be excluding every piece in one of your slots — try turning it off.
          </p>
        )}
      </div>
    );
  }

  function handleSortClick(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const sorted = [...results].sort((a, b) => {
    if (!sortKey) return 0;
    const av = sortKey === "total" ? totalOf(a) : a.stats[sortKey];
    const bv = sortKey === "total" ? totalOf(b) : b.stats[sortKey];
    return sortDir === "desc" ? bv - av : av - bv;
  });

  const sortKeys: { key: SortKey; label: string }[] = [
    { key: "total", label: "Total" },
    ...ARMOR_STAT_ORDER.map((s) => ({ key: s as SortKey, label: ARMOR_STAT_SHORT[s] })),
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Sort + count */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] uppercase tracking-widest text-fg-muted mr-1">Sort</span>
        {sortKeys.map(({ key, label }) => {
          const active = sortKey === key;
          const color = key !== "total" ? ARMOR_STAT_COLORS[key as ArmorStatName] : undefined;
          return (
            <button
              key={key}
              type="button"
              onClick={() => handleSortClick(key)}
              className={cn(
                "flex items-center gap-1 border px-2 py-0.5 text-[12px] uppercase tracking-wider transition-colors cursor-pointer",
                active
                  ? "border-border-active text-fg"
                  : "border-border text-fg-muted hover:border-border-active hover:text-fg-dim"
              )}
            >
              {color && active && (
                <span
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ background: color }}
                />
              )}
              {label}
              {active && (
                <span className="text-[11px] text-fg-dim">
                  {sortDir === "desc" ? "↓" : "↑"}
                </span>
              )}
            </button>
          );
        })}
        <span className="ml-auto text-[12px] text-fg-muted">
          {results.length} build{results.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Result cards */}
      <AnimatePresence mode="popLayout" initial={false}>
        {sorted.map((result, index) => {
          const resultKey = SLOT_ORDER.map((slot) => {
            const c = result.loadout[slot];
            if (!c) return "-";
            return `${c.item.itemInstanceId}:${c.tuning.kind}${c.tuning.kind === "directional" ? `:${c.tuning.increasedStat}-${c.tuning.decreasedStat}` : ""}`;
          }).join("|");

          const total = totalOf(result);
          const isExpanded = expanded.has(resultKey);

          return (
            <motion.div
              key={resultKey}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.18, delay: index * 0.025 }}
              className="border border-border bg-surface overflow-hidden"
            >
              {/* Summary row — always visible */}
              <button
                type="button"
                onClick={() => toggleExpanded(resultKey)}
                className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left cursor-pointer hover:bg-surface-raised transition-colors"
                aria-expanded={isExpanded}
              >
                {/* Index */}
                <span className="text-[12px] tabular-nums text-fg-muted w-5 shrink-0">
                  {String(index + 1).padStart(2, "0")}
                </span>

                {/* Stat pills */}
                {ARMOR_STAT_ORDER.map((stat) => {
                  const value = result.stats[stat];
                  const tier = Math.floor(value / 10);
                  const met = thresholds[stat] > 0 && value >= thresholds[stat];
                  const color = ARMOR_STAT_COLORS[stat];
                  return (
                    <span
                      key={stat}
                      className="flex items-center gap-1 text-sm tabular-nums"
                      style={{ color: met ? color : "var(--color-fg-muted)" }}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full shrink-0"
                        style={{ background: color, opacity: met ? 1 : 0.3 }}
                      />
                      {value}
                      {/* 10-segment tier bar */}
                      <span className="flex items-center gap-px ml-0.5">
                        {Array.from({ length: 10 }, (_, i) => (
                          <span
                            key={i}
                            className="h-1.5 w-[3px] shrink-0"
                            style={{
                              background: i < tier ? color : "var(--color-border)",
                              opacity: i < tier ? (met ? 0.9 : 0.45) : 0.2,
                            }}
                          />
                        ))}
                      </span>
                    </span>
                  );
                })}

                {/* Total */}
                <span className="ml-auto text-sm tabular-nums text-fg-dim">
                  ∑{total}
                </span>

                {/* Chevron */}
                <span
                  className={cn(
                    "text-fg-muted text-[12px] transition-transform duration-200 shrink-0",
                    isExpanded ? "rotate-90" : ""
                  )}
                >
                  ▶
                </span>
              </button>

              {/* Expanded detail */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    style={{ overflow: "hidden" }}
                  >
                    <div className="border-t border-border px-3 pb-4 pt-3">
                      {/* Armor grid */}
                      <div className="grid grid-cols-5 gap-2 mb-4">
                        {SLOT_ORDER.map((slot) => {
                          const choice = result.loadout[slot];
                          if (!choice) return <div key={slot} />;
                          const isExotic = choice.item.tierType === 6;
                          return (
                            <div key={slot} className="flex flex-col items-center gap-1 text-center">
                              <div
                                className={cn(
                                  "relative h-12 w-12 shrink-0 overflow-hidden border",
                                  isExotic ? "border-warn/70" : "border-border"
                                )}
                              >
                                {choice.item.icon && (
                                  <Image
                                    src={`https://www.bungie.net${choice.item.icon}`}
                                    alt={choice.item.name}
                                    fill
                                    sizes="48px"
                                    className="object-cover"
                                  />
                                )}
                              </div>
                              <p className="text-[11px] text-fg-muted uppercase tracking-wide">
                                {ARMOR_SLOT_LABELS[slot]}
                              </p>
                              <p
                                className={cn(
                                  "line-clamp-2 text-[12px] leading-tight",
                                  isExotic ? "text-warn" : "text-fg-dim"
                                )}
                                style={{ fontFamily: "var(--font-sans)" }}
                              >
                                {choice.item.name}
                              </p>
                              {choice.tuning.kind === "directional" && (
                                <p className="text-[11px] leading-snug" style={{ color: "var(--color-accent)" }}>
                                  +{ARMOR_STAT_SHORT[choice.tuning.increasedStat]}
                                  {" / "}
                                  <span className="text-fg-muted">
                                    -{ARMOR_STAT_SHORT[choice.tuning.decreasedStat]}
                                  </span>
                                </p>
                              )}
                              {/* Pin button */}
                              {(() => {
                                const isLocked = lockedItems[slot] === choice.item.itemInstanceId;
                                return (
                                  <button
                                    type="button"
                                    onClick={() => isLocked ? onUnlockSlot(slot) : onLockSlot(slot, choice.item)}
                                    title={isLocked ? "Unpin this slot" : "Pin this piece"}
                                    className={cn(
                                      "mt-0.5 text-[11px] uppercase tracking-wider border px-1.5 py-0.5 transition-colors cursor-pointer",
                                      isLocked
                                        ? "border-accent/50 text-accent"
                                        : "border-border text-fg-muted hover:border-border-active hover:text-fg-dim"
                                    )}
                                  >
                                    {isLocked ? "⊙ locked" : "⊙ pin"}
                                  </button>
                                );
                              })()}
                            </div>
                          );
                        })}
                      </div>

                      {/* Stat contribution breakdown */}
                      <div className="mt-3 border-t border-border pt-3">
                        <p className="text-[11px] uppercase tracking-widest text-fg-muted mb-2">Stat breakdown</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
                          {ARMOR_STAT_ORDER.map((stat) => {
                            const total = result.stats[stat];
                            const color = ARMOR_STAT_COLORS[stat];
                            // Sum raw armor stats across all slots (before any mods)
                            let armorBase = 0;
                            let tuningBonus = 0;
                            for (const slot of SLOT_ORDER) {
                              const choice = result.loadout[slot];
                              if (!choice) continue;
                              const baseStat = choice.item.stats[stat];
                              armorBase += baseStat;
                              if (choice.tuning.kind === "directional") {
                                if (choice.tuning.increasedStat === stat) tuningBonus += 5;
                                if (choice.tuning.decreasedStat === stat) tuningBonus -= 5;
                              }
                            }
                            const modBonus = total - armorBase - tuningBonus;
                            return (
                              <div key={stat} className="flex items-center gap-1.5 text-[11px] tabular-nums">
                                <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
                                <span style={{ color }} className="uppercase tracking-wide w-8 shrink-0">
                                  {ARMOR_STAT_SHORT[stat]}
                                </span>
                                <span className="text-fg">{total}</span>
                                <span className="text-fg-muted">
                                  = {armorBase}
                                  {tuningBonus !== 0 && <span className="text-accent"> {tuningBonus > 0 ? `+${tuningBonus}` : tuningBonus} T5</span>}
                                  {modBonus > 0 && <span className="text-fg-dim"> +{modBonus} mod</span>}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Footer */}
                      <div className="flex items-center justify-between mt-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] text-fg-muted">
                            {result.freeSlots === 5
                              ? "5 free mod slots"
                              : result.freeSlots === 0
                                ? "All mods committed"
                                : `${result.freeSlots} free mod slot${result.freeSlots === 1 ? "" : "s"}`}
                          </span>
                          {/* DIM export */}
                          <button
                            type="button"
                            onClick={() => {
                              const ids = SLOT_ORDER
                                .map((slot) => result.loadout[slot]?.item.itemInstanceId)
                                .filter(Boolean)
                                .map((id) => `id:${id}`)
                                .join(" or ");
                              navigator.clipboard.writeText(ids).then(() => {
                                setDimCopyStates((prev) => ({ ...prev, [resultKey]: "copied" }));
                                setTimeout(() => setDimCopyStates((prev) => ({ ...prev, [resultKey]: "idle" })), 2000);
                              });
                            }}
                            className="border border-border px-2 py-0.5 text-[11px] uppercase tracking-wider text-fg-muted hover:border-border-active hover:text-fg-dim transition-colors cursor-pointer"
                          >
                            {dimCopyStates[resultKey] === "copied" ? "COPIED ✓" : "COPY FOR DIM"}
                          </button>
                        </div>
                        <EquipButton
                          state={equipStates[resultKey] ?? "idle"}
                          onClick={async () => {
                            setEquipStates((prev) => ({ ...prev, [resultKey]: "loading" }));
                            const { error } = await onEquip(result);
                            const next = error ? "error" : "success";
                            setEquipStates((prev) => ({ ...prev, [resultKey]: next }));
                            setTimeout(
                              () => setEquipStates((prev) => ({ ...prev, [resultKey]: "idle" })),
                              3000
                            );
                          }}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function OptimizerResultsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          className="border border-border bg-surface px-3 py-2.5 animate-pulse"
          style={{ opacity: 1 - i * 0.15 }}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <div className="h-2.5 w-4 rounded-sm bg-border" />
            {Array.from({ length: 6 }, (_, j) => (
              <div key={j} className="h-2.5 rounded-sm bg-border" style={{ width: `${36 + j * 4}px` }} />
            ))}
            <div className="ml-auto h-2.5 w-8 rounded-sm bg-border" />
            <div className="h-2.5 w-2.5 rounded-sm bg-border" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EquipButton({ state, onClick }: { state: EquipState; onClick: () => void }) {
  const config: Record<EquipState, { label: string; cls: string }> = {
    idle: { label: "Equip Loadout", cls: "border-border-active text-accent hover:bg-accent/8" },
    loading: { label: "Equipping…", cls: "border-border text-fg-muted" },
    success: { label: "Equipped ✓", cls: "border-success/40 text-success" },
    error: { label: "Failed — Retry", cls: "border-error/40 text-error hover:bg-error/8" },
  };
  const { label, cls } = config[state];

  return (
    <button
      type="button"
      disabled={state === "loading"}
      onClick={onClick}
      className={cn(
        "border px-4 py-1.5 text-[13px] uppercase tracking-wider transition-colors cursor-pointer disabled:cursor-wait",
        cls
      )}
    >
      {label}
    </button>
  );
}
