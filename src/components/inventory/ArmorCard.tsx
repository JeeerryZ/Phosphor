"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { cn } from "@/lib/utils/cn";
import type { ArmorItem } from "@/lib/armor/types";
import { ARMOR_STAT_LABELS, ARMOR_STAT_MAX, ARMOR_STAT_ORDER, ARMOR_SLOT_LABELS } from "@/styles/theme";

const TIER_EXOTIC = 6;
const TIER_LEGENDARY = 5;

interface ArmorCardProps {
  item: ArmorItem;
  index?: number;
}

export function ArmorCard({ item, index = 0 }: ArmorCardProps) {
  const isExotic = item.tierType === TIER_EXOTIC;
  const isLegendary = item.tierType === TIER_LEGENDARY;

  const totalStats = ARMOR_STAT_ORDER.reduce((sum, stat) => sum + item.stats[stat], 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut", delay: index * 0.04 }}
      whileHover={{ scale: 1.02 }}
      className={cn(
        "rounded-lg border bg-panel/80 p-3 backdrop-blur-sm transition-shadow",
        isExotic
          ? "border-solar/50 hover:glow-solar"
          : isLegendary
            ? "border-void/40 hover:glow-void"
            : "border-border hover:border-foreground/30"
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "relative h-12 w-12 shrink-0 overflow-hidden rounded border",
            isExotic ? "border-solar/60" : isLegendary ? "border-void/50" : "border-border"
          )}
        >
          <Image
            src={`https://www.bungie.net${item.icon}`}
            alt={item.name}
            fill
            sizes="48px"
            className="object-cover"
          />
          {item.isMasterworked && (
            <div
              title="Masterworked"
              className="absolute right-0 top-0 h-0 w-0 border-t-[11px] border-l-[11px] border-t-[#ceae33] border-l-transparent"
            />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{item.name}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-display text-xs uppercase tracking-wider text-foreground/50">
              {ARMOR_SLOT_LABELS[item.slot]}
            </p>
            {item.gearTier !== undefined && (
              <span className="font-display rounded-sm border border-arc/40 px-1 text-[9px] font-semibold uppercase tracking-wider text-arc">
                Tier {item.gearTier}
              </span>
            )}
          </div>
        </div>
        <div className="ml-auto shrink-0 text-right">
          <p className="font-display text-arc text-glow-arc text-lg font-bold leading-none">
            {totalStats}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-foreground/40">Total</p>
          {item.power > 0 && (
            <p className="mt-1 text-[10px] tabular-nums text-foreground/40">{item.power} PWR</p>
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
                  "w-16 shrink-0 text-[10px] uppercase tracking-wider",
                  isIncreased ? "text-strand" : isDecreased ? "text-foreground/30" : "text-foreground/50"
                )}
              >
                {ARMOR_STAT_LABELS[stat]}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-raised">
                <motion.div
                  className={cn("h-full rounded-full", isIncreased ? "bg-strand" : "bg-arc")}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, ease: "easeOut", delay: index * 0.04 + 0.1 }}
                />
              </div>
              <span className="w-7 shrink-0 text-right text-[11px] tabular-nums text-foreground/70">
                {value}
              </span>
              <span className="w-6 shrink-0 text-[10px] font-semibold tabular-nums">
                {isIncreased && <span className="text-strand">+5</span>}
                {isDecreased && <span className="text-foreground/30">-5</span>}
              </span>
            </div>
          );
        })}
      </div>

      {item.tuning.kind === "balanced" && (
        <p className="font-display mt-2 text-[10px] uppercase tracking-wider text-foreground/40">
          Balanced tuning (+1 all)
        </p>
      )}
      {item.tuning.kind === "empty" && (
        <p className="font-display mt-2 text-[10px] uppercase tracking-wider text-foreground/30">
          Tuning socket empty
        </p>
      )}
    </motion.div>
  );
}
