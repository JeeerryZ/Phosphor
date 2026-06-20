"use client";

import { useState } from "react";
import Image from "next/image";
import {
  ARMOR_STAT_COLORS,
  ARMOR_STAT_LABELS,
  ARMOR_STAT_ORDER,
  ARMOR_STAT_SHORT,
  OPTIMIZER_STAT_MAX,
  OPTIMIZER_STAT_STEP,
  STAT_TIER_HINTS,
  STAT_TIER_HINT_LABELS,
  ARMOR_SLOT_LABELS,
} from "@/styles/theme";
import type { ArmorItem, ArmorSlot, ArmorStatName, ArmorStats } from "@/lib/armor/types";
import { cn } from "@/lib/utils/cn";

interface OptimizerControlsProps {
  thresholds: ArmorStats;
  onThresholdChange: (stat: ArmorStatName, value: number) => void;
  statIcons: Record<ArmorStatName, string>;
  maxStats?: Record<ArmorStatName, number> | null;
  masterworkOnly?: boolean;
  onMasterworkOnlyChange?: (value: boolean) => void;
  fragmentBonuses: ArmorStats;
  onFragmentBonusChange: (stat: ArmorStatName, value: number) => void;
  lockedItems: Partial<Record<ArmorSlot, ArmorItem>>;
  onUnlockSlot: (slot: ArmorSlot) => void;
}

const FRAG_BONUS_MAX = 30;
const FRAG_BONUS_STEP = 5;

export function OptimizerControls({
  thresholds,
  onThresholdChange,
  statIcons,
  maxStats,
  masterworkOnly = true,
  onMasterworkOnlyChange,
  fragmentBonuses,
  onFragmentBonusChange,
  lockedItems,
  onUnlockSlot,
}: OptimizerControlsProps) {
  const hasMax = maxStats !== null && maxStats !== undefined;
  const [fragOpen, setFragOpen] = useState(false);
  const lockedSlots = Object.entries(lockedItems) as [ArmorSlot, ArmorItem][];
  const totalFragBonus = ARMOR_STAT_ORDER.reduce((s, stat) => s + (fragmentBonuses[stat] ?? 0), 0);

  return (
    <div className="bg-surface p-4 border-x border-b border-border">
      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
        {/* Masterwork toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none group">
          <button
            type="button"
            role="switch"
            aria-checked={masterworkOnly}
            onClick={() => onMasterworkOnlyChange?.(!masterworkOnly)}
            className={cn(
              "relative h-4 w-7 shrink-0 border transition-colors cursor-pointer",
              masterworkOnly ? "border-warn/60 bg-warn/10" : "border-border bg-transparent"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-2.5 w-2.5 border transition-all",
                masterworkOnly ? "left-[13px] border-warn bg-warn/40" : "left-[1px] border-border"
              )}
            />
          </button>
          <span className="text-[10px] uppercase tracking-widest text-fg-muted group-hover:text-fg-dim transition-colors">
            Masterwork only
          </span>
        </label>

        {/* Fragment bonuses toggle */}
        <button
          type="button"
          onClick={() => setFragOpen((v) => !v)}
          className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest cursor-pointer transition-colors text-fg-muted hover:text-fg-dim"
        >
          <span>{fragOpen ? "▾" : "▸"}</span>
          Fragment bonuses
          {totalFragBonus > 0 && (
            <span className="text-accent">+{totalFragBonus}</span>
          )}
        </button>
      </div>

      {/* Fragment bonus section */}
      {fragOpen && (
        <div className="mb-3 border border-border bg-surface-raised p-3 flex flex-col gap-2">
          <p className="text-[9px] uppercase tracking-widest text-fg-muted mb-1">
            Stat bonuses from subclass fragments — subtracted from armor requirement
          </p>
          {ARMOR_STAT_ORDER.map((stat) => {
            const bonus = fragmentBonuses[stat] ?? 0;
            const color = ARMOR_STAT_COLORS[stat];
            return (
              <div key={stat} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-[10px] uppercase tracking-widest" style={{ color: bonus > 0 ? color : "var(--color-fg-muted)" }}>
                  {ARMOR_STAT_SHORT[stat]}
                </span>
                <button
                  type="button"
                  disabled={bonus <= 0}
                  onClick={() => onFragmentBonusChange(stat, Math.max(0, bonus - FRAG_BONUS_STEP))}
                  className="h-5 w-5 border border-border text-[10px] text-fg-muted hover:border-border-active hover:text-fg-dim disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  −
                </button>
                <span className="w-6 text-center text-xs tabular-nums" style={{ color: bonus > 0 ? color : "var(--color-fg-muted)" }}>
                  {bonus > 0 ? `+${bonus}` : "0"}
                </span>
                <button
                  type="button"
                  disabled={bonus >= FRAG_BONUS_MAX}
                  onClick={() => onFragmentBonusChange(stat, Math.min(FRAG_BONUS_MAX, bonus + FRAG_BONUS_STEP))}
                  className="h-5 w-5 border border-border text-[10px] text-fg-muted hover:border-border-active hover:text-fg-dim disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  +
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Locked slots */}
      {lockedSlots.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {lockedSlots.map(([slot, item]) => (
            <div
              key={slot}
              className="flex items-center gap-1.5 border border-accent/30 bg-accent/5 px-2 py-0.5 text-[10px]"
            >
              <span className="text-accent/70 uppercase tracking-wider">{ARMOR_SLOT_LABELS[slot]}</span>
              <span className="text-fg-muted truncate max-w-[10rem]">{item.name}</span>
              <button
                type="button"
                onClick={() => onUnlockSlot(slot)}
                className="text-fg-muted hover:text-fg cursor-pointer ml-0.5"
                aria-label={`Unlock ${ARMOR_SLOT_LABELS[slot]}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {ARMOR_STAT_ORDER.map((stat) => {
          const sliderMax = maxStats?.[stat] ?? OPTIMIZER_STAT_MAX;
          const value = Math.min(thresholds[stat], sliderMax);
          const pct = sliderMax > 0 ? (value / sliderMax) * 100 : 0;
          const color = ARMOR_STAT_COLORS[stat];
          const active = value > 0;

          // Ghost shadow: the achievable-but-not-yet-targeted range.
          // Shows as a dim version of the stat color from the current value to the slider max.
          const ghostColor = `${color}28`; // ~16% opacity
          const trackBg =
            active
              ? `linear-gradient(to right, ${color} 0% ${pct}%, ${hasMax ? ghostColor : "var(--color-border)"} ${pct}% 100%)`
              : hasMax
                ? ghostColor
                : "var(--color-border)";

          return (
            <div key={stat} className="flex items-center gap-3">
              {/* Icon + label */}
              <div className="flex w-24 shrink-0 items-center gap-1.5">
                {statIcons[stat] && (
                  <div className="relative h-4 w-4 shrink-0 opacity-50">
                    <Image
                      src={`https://www.bungie.net${statIcons[stat]}`}
                      alt=""
                      fill
                      sizes="16px"
                      className="object-contain"
                    />
                  </div>
                )}
                <span
                  className="text-[11px] uppercase tracking-widest transition-colors"
                  style={{ color: active ? color : "var(--color-fg-muted)" }}
                >
                  {ARMOR_STAT_SHORT[stat]}
                </span>
              </div>

              {/* Slider */}
              <input
                type="range"
                min={0}
                max={sliderMax}
                step={OPTIMIZER_STAT_STEP}
                value={value}
                onChange={(e) => onThresholdChange(stat, Number(e.target.value))}
                aria-label={`${ARMOR_STAT_LABELS[stat]} threshold`}
                className="flex-1"
                style={
                  {
                    "--thumb-color": color,
                    background: trackBg,
                  } as React.CSSProperties
                }
              />

              {/* Value + tier + cooldown hint */}
              <div className={cn(
                "w-32 shrink-0 text-right transition-colors",
                active ? "text-fg" : "text-fg-muted"
              )}>
                <span className="text-xs tabular-nums">{value}</span>
                {active && (() => {
                  const tier = Math.min(Math.floor(value / 10), 10);
                  const hint = STAT_TIER_HINTS[stat][tier];
                  return (
                    <span className="ml-1.5 text-[10px]" style={{ color: "var(--color-fg-muted)" }}>
                      T{tier}
                      {hint && (
                        <span className="ml-1" style={{ color: ARMOR_STAT_COLORS[stat], opacity: 0.55 }}>
                          {hint} {STAT_TIER_HINT_LABELS[stat]}
                        </span>
                      )}
                    </span>
                  );
                })()}
              </div>

              {/* Max — always rendered for layout stability */}
              <span className="w-10 shrink-0 text-[10px] tabular-nums text-fg-muted text-right">
                {hasMax ? `/${maxStats![stat]}` : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
