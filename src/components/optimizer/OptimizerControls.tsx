"use client";

import Image from "next/image";
import { ARMOR_STAT_LABELS, ARMOR_STAT_ORDER, OPTIMIZER_STAT_MAX, OPTIMIZER_STAT_STEP } from "@/styles/theme";
import type { ArmorStatName, ArmorStats } from "@/lib/armor/types";
import { cn } from "@/lib/utils/cn";

interface OptimizerControlsProps {
  thresholds: ArmorStats;
  onThresholdChange: (stat: ArmorStatName, value: number) => void;
  optimizeFor: ArmorStatName;
  onOptimizeForChange: (stat: ArmorStatName) => void;
  statIcons: Record<ArmorStatName, string>;
}

export function OptimizerControls({
  thresholds,
  onThresholdChange,
  optimizeFor,
  onOptimizeForChange,
  statIcons,
}: OptimizerControlsProps) {
  return (
    <div className="rounded-lg border border-border bg-panel/80 p-4">
      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="optimize-for" className="font-display text-xs uppercase tracking-wider text-foreground/60">
          Optimize for
        </label>
        <select
          id="optimize-for"
          value={optimizeFor}
          onChange={(e) => onOptimizeForChange(e.target.value as ArmorStatName)}
          className="rounded border border-border bg-panel px-2 py-1 text-sm"
        >
          {ARMOR_STAT_ORDER.map((stat) => (
            <option key={stat} value={stat}>
              {ARMOR_STAT_LABELS[stat]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ARMOR_STAT_ORDER.map((stat) => (
          <div key={stat} className="flex items-center gap-2">
            {statIcons[stat] && (
              <div className="relative h-5 w-5 shrink-0">
                <Image src={`https://www.bungie.net${statIcons[stat]}`} alt="" fill className="object-contain" />
              </div>
            )}
            <span
              className={cn(
                "w-20 shrink-0 text-xs uppercase tracking-wider",
                stat === optimizeFor ? "text-arc" : "text-foreground/60"
              )}
            >
              {ARMOR_STAT_LABELS[stat]}
            </span>
            <input
              type="range"
              min={0}
              max={OPTIMIZER_STAT_MAX}
              step={OPTIMIZER_STAT_STEP}
              value={thresholds[stat]}
              onChange={(e) => onThresholdChange(stat, Number(e.target.value))}
              className="flex-1"
            />
            <span className="w-10 shrink-0 text-right text-xs tabular-nums">{thresholds[stat]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
