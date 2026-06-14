"use client";

import { ARMOR_STAT_LABELS, ARMOR_STAT_ORDER, ARMOR_SLOT_LABELS } from "@/styles/theme";
import type { ArmorSlot, ArmorStatName } from "@/lib/armor/types";
import type { OptimizerResult } from "@/lib/optimizer";
import { cn } from "@/lib/utils/cn";

const SLOT_ORDER: ArmorSlot[] = ["helmet", "gauntlets", "chest", "legs", "classItem"];

interface OptimizerResultsProps {
  results: OptimizerResult[];
  optimizeFor: ArmorStatName;
}

export function OptimizerResults({ results, optimizeFor }: OptimizerResultsProps) {
  if (results.length === 0) {
    return (
      <p className="mt-4 text-sm text-foreground/50">
        No combination meets the current thresholds. Try lowering one or more sliders.
      </p>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-xs uppercase tracking-wider text-foreground/40">
        {results.length} combination{results.length === 1 ? "" : "s"}
      </p>
      {results.map((result, index) => {
        const resultKey = SLOT_ORDER.map((slot) => {
          const choice = result.loadout[slot];
          return choice
            ? `${choice.item.itemInstanceId}:${choice.tuning.kind}${
                choice.tuning.kind === "directional"
                  ? `:${choice.tuning.increasedStat}-${choice.tuning.decreasedStat}`
                  : ""
              }`
            : "-";
        }).join("|");

        return (
          <details key={resultKey} className="rounded-lg border border-border bg-panel/80 p-3">
            <summary
              className="flex cursor-pointer flex-wrap gap-3 text-sm"
              aria-label={`Loadout ${index + 1} of ${results.length}, expand for details`}
            >
              {ARMOR_STAT_ORDER.map((stat) => (
                <span
                  key={stat}
                  className={cn(
                    "tabular-nums",
                    stat === optimizeFor ? "font-semibold text-arc" : "text-foreground/70"
                  )}
                >
                  {ARMOR_STAT_LABELS[stat]} {result.stats[stat]}
                </span>
              ))}
            </summary>
            <div className="mt-3 flex flex-col gap-1 text-xs text-foreground/60">
              {SLOT_ORDER.map((slot) => {
                const choice = result.loadout[slot];
                if (!choice) return null;
                return (
                  <p key={slot}>
                    <span className="text-foreground/40">{ARMOR_SLOT_LABELS[slot]}:</span> {choice.item.name}
                    {choice.tuning.kind === "directional" && (
                      <span>
                        {" "}
                        (tuning: +{ARMOR_STAT_LABELS[choice.tuning.increasedStat]} / -
                        {ARMOR_STAT_LABELS[choice.tuning.decreasedStat]})
                      </span>
                    )}
                    {choice.tuning.kind === "balanced" && <span> (tuning: balanced)</span>}
                  </p>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}
