"use client";

import { useState } from "react";
import Image from "next/image";
import { motion } from "motion/react";
import { cn } from "@/lib/utils/cn";
import type { ArmorItem } from "@/lib/armor/types";
import { groupExoticVariants } from "@/lib/armor/exotic-grouping";
import { CLASS_TYPE_LABELS, ARMOR_SLOT_LABELS } from "@/styles/theme";
import type { SavedBuild } from "@/lib/builds/storage";

const TIER_EXOTIC = 6;
const CLASS_TABS = [0, 1, 2] as const;

interface ExoticPickerProps {
  items: ArmorItem[];
  selectedClassType: number;
  onSelectClassType: (classType: number) => void;
  selectedItemInstanceId: string | null;
  onSelect: (item: ArmorItem) => void;
  onNoExotic: () => void;
  savedBuilds: SavedBuild[];
  onLoadBuild: (build: SavedBuild) => void;
  onDeleteBuild: (id: string) => void;
}

export function ExoticPicker({
  items,
  selectedClassType,
  onSelectClassType,
  selectedItemInstanceId,
  onSelect,
  onNoExotic,
  savedBuilds,
  onLoadBuild,
  onDeleteBuild,
}: ExoticPickerProps) {
  const [search, setSearch] = useState("");
  const [savesOpen, setSavesOpen] = useState(true);

  const classExotics = items.filter(
    (item) => item.tierType === TIER_EXOTIC && item.classType === selectedClassType
  );

  const exotics = groupExoticVariants(classExotics)
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((item) => !search || item.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex flex-col gap-4">
      {/* Saved builds */}
      {savedBuilds.length > 0 && (
        <div className="border border-border">
          <button
            type="button"
            onClick={() => setSavesOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] uppercase tracking-widest text-fg-muted hover:text-fg-dim transition-colors cursor-pointer"
          >
            <span>{savesOpen ? "▾" : "▸"}</span>
            My Saves
            <span className="text-fg-muted/50">({savedBuilds.length})</span>
          </button>
          {savesOpen && (
            <div className="border-t border-border divide-y divide-border">
              {savedBuilds.map((build) => (
                <div key={build.id} className="flex items-center gap-3 px-3 py-2 hover:bg-surface-raised transition-colors group">
                  {/* Exotic icon or placeholder */}
                  <div className="relative h-8 w-8 shrink-0 border border-border overflow-hidden">
                    {build.exoticIcon ? (
                      <Image
                        src={`https://www.bungie.net${build.exoticIcon}`}
                        alt=""
                        fill
                        sizes="32px"
                        className="object-cover"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-[12px] text-fg-muted">⊘</span>
                    )}
                  </div>

                  {/* Build info */}
                  <button
                    type="button"
                    onClick={() => onLoadBuild(build)}
                    className="flex-1 min-w-0 text-left cursor-pointer"
                  >
                    <p className="text-[13px] font-medium text-fg-dim group-hover:text-fg transition-colors truncate">
                      {build.name}
                    </p>
                    <p className="text-[11px] text-fg-muted mt-0.5 truncate">
                      {CLASS_TYPE_LABELS[build.classType]} ·{" "}
                      {build.exoticName ?? "Legendary Only"} ·{" "}
                      {new Date(build.savedAt).toLocaleDateString()}
                    </p>
                  </button>

                  {/* Delete */}
                  <button
                    type="button"
                    onClick={() => onDeleteBuild(build.id)}
                    className="text-fg-muted hover:text-error transition-colors cursor-pointer text-sm opacity-0 group-hover:opacity-100 shrink-0"
                    aria-label="Delete saved build"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Class tabs */}
      <div className="flex gap-0 border-b border-border">
        {CLASS_TABS.map((classType) => (
          <button
            key={classType}
            type="button"
            onClick={() => { onSelectClassType(classType); setSearch(""); }}
            className={cn(
              "relative px-5 py-2.5 text-sm uppercase tracking-[0.15em] transition-colors cursor-pointer",
              classType === selectedClassType ? "text-accent" : "text-fg-muted hover:text-fg-dim"
            )}
          >
            {CLASS_TYPE_LABELS[classType]}
            {classType === selectedClassType && (
              <motion.div
                layoutId="class-tab-underline"
                className="absolute bottom-0 left-0 right-0 h-px bg-accent"
              />
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted text-base select-none">⌕</span>
        <input
          type="text"
          placeholder="Search exotics…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full border border-border bg-surface pl-8 pr-3 py-1.5 text-base text-fg placeholder:text-fg-muted focus:border-border-active focus:outline-none transition-colors"
        />
      </div>

      {/* No-exotic option */}
      <button
        type="button"
        onClick={onNoExotic}
        className="w-full border border-border bg-surface px-4 py-2.5 text-left transition-colors hover:border-border-active hover:bg-surface-raised cursor-pointer"
      >
        <span className="text-sm uppercase tracking-widest text-fg-muted">⊘ Legendary Only</span>
        <span className="ml-3 text-[12px] text-fg-muted opacity-60">optimize without an exotic</span>
      </button>

      {/* Exotic grid */}
      {exotics.length === 0 ? (
        <p className="py-16 text-center text-base text-fg-muted">
          {search ? `No exotics matching "${search}"` : "No exotics found for this class"}
        </p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2">
          {exotics.map((item, index) => {
            const selected = item.itemInstanceId === selectedItemInstanceId;
            const isExoticClassItem = item.slot === "classItem" && item.exoticPerks?.length;
            return (
              <button
                key={item.itemInstanceId}
                type="button"
                onClick={() => onSelect(item)}
                className={cn(
                  "group flex flex-col items-center gap-1.5 p-2 border transition-colors cursor-pointer text-center",
                  selected
                    ? "border-warn/60 bg-warn/5"
                    : "border-border hover:border-border-active hover:bg-surface-raised"
                )}
              >
                {/* Icon */}
                <div className={cn(
                  "relative h-14 w-14 overflow-hidden border",
                  selected ? "border-warn/50" : "border-border group-hover:border-border-active"
                )}>
                  {item.icon && (
                    <Image
                      src={`https://www.bungie.net${item.icon}`}
                      alt={item.name}
                      fill
                      sizes="56px"
                      className="object-cover"
                      priority={index < 7}
                    />
                  )}
                </div>

                {/* Name */}
                <p
                  className={cn(
                    "w-full text-[13px] font-medium leading-tight line-clamp-2",
                    selected ? "text-warn" : "text-fg-dim group-hover:text-fg"
                  )}
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  {item.name}
                </p>

                {/* Slot */}
                <p className="text-[11px] text-fg-muted uppercase tracking-wide">
                  {ARMOR_SLOT_LABELS[item.slot]}
                </p>

                {/* Exotic class item perks */}
                {isExoticClassItem && (
                  <div className="w-full space-y-0.5 border-t border-border/50 pt-1 mt-0.5">
                    {item.exoticPerks!.map((perk) => (
                      <p key={perk.name} className="text-[10px] text-fg-muted leading-tight truncate" title={perk.description}>
                        {perk.name}
                      </p>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
