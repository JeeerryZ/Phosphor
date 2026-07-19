"use client";

import Image from "next/image";
import { cn } from "@/lib/utils/cn";
import type { ArmorItem } from "@/lib/armor/types";
import { ARMOR_STAT_LABELS, ARMOR_STAT_MAX, ARMOR_STAT_ORDER, ARMOR_SLOT_LABELS } from "@/styles/theme";

const TIER_EXOTIC = 6;

interface ArmorCardProps {
  item: ArmorItem;
  index?: number;
}

export function ArmorCard({ item, index = 0 }: ArmorCardProps) {
  const isExotic = item.tierType === TIER_EXOTIC;
  const totalStats = ARMOR_STAT_ORDER.reduce((sum, stat) => sum + item.stats[stat], 0);

  return (
    <div
      className={cn(
        "border bg-panel p-3 transition-colors",
        isExotic ? "border-warn hover:border-warn" : "border-border hover:border-border-active"
      )}
      style={{ animationDelay: `${index * 0.04}s` }}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "relative h-12 w-12 shrink-0 overflow-hidden border",
            isExotic ? "border-warn" : "border-border"
          )}
        >
          <Image
            src={`https://www.bungie.net${item.icon}`}
            alt={item.name}
            fill
            sizes="48px"
            className="object-cover icon-terminal"
          />
          {item.isMasterworked && (
            <div
              title="Masterworked"
              className="absolute right-0 top-0 h-0 w-0 border-t-[11px] border-l-[11px] border-t-warn border-l-transparent"
            />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-fg">{item.name}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm uppercase tracking-wider text-fg-muted">
              {ARMOR_SLOT_LABELS[item.slot]}
            </p>
            {item.gearTier !== undefined && (
              <span className="border border-border-active px-1 text-[11px] uppercase tracking-wider text-accent">
                T{item.gearTier}
              </span>
            )}
          </div>
        </div>
        <div className="ml-auto shrink-0 text-right">
          <p className="text-accent text-lg font-bold leading-none tabular-nums">{totalStats}</p>
          <p className="text-[12px] uppercase tracking-wider text-fg-muted">Total</p>
          {item.power > 0 && (
            <p className="mt-1 text-[12px] tabular-nums text-fg-muted">{item.power} PWR</p>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        {ARMOR_STAT_ORDER.map((stat) => {
          const value = item.stats[stat];
          const pct = Math.max(0, Math.min(100, (value / ARMOR_STAT_MAX) * 100));
          const isIncreased = item.tuning.kind === "directional" && item.tuning.increasedStat === stat;
          const isDecreased = item.tuning.kind === "directional" && item.tuning.decreasedStat === stat;

          return (
            <div key={stat} className="flex items-center gap-2">
              <span
                className={cn(
                  "w-16 shrink-0 text-[12px] uppercase tracking-wider",
                  isIncreased ? "text-accent" : isDecreased ? "text-fg-muted" : "text-fg-dim"
                )}
              >
                {ARMOR_STAT_LABELS[stat]}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden bg-surface-raised">
                <div
                  className={cn("h-full transition-[width]", isIncreased ? "bg-accent" : "bg-fg-dim")}
                  style={{
                    width: `${pct}%`,
                    transition: `width 0.2s steps(8)`,
                    transitionDelay: `${index * 0.04 + 0.1}s`,
                  }}
                />
              </div>
              <span className="w-7 shrink-0 text-right text-[13px] tabular-nums text-fg">
                {value}
              </span>
              <span className="w-6 shrink-0 text-[12px] font-semibold tabular-nums">
                {isIncreased && <span className="text-accent">+5</span>}
                {isDecreased && <span className="text-fg-muted">-5</span>}
              </span>
            </div>
          );
        })}
      </div>

      {item.tuning.kind === "balanced" && (
        <p className="mt-2 text-[12px] uppercase tracking-wider text-fg-muted">
          balanced tuning (+1 all)
        </p>
      )}
      {item.tuning.kind === "empty" && (
        <p className="mt-2 text-[12px] uppercase tracking-wider text-fg-muted">
          tuning socket empty
        </p>
      )}
    </div>
  );
}
