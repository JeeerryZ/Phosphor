"use client";

import Image from "next/image";
import { cn } from "@/lib/utils/cn";
import type { ArmorItem } from "@/lib/armor/types";
import { CLASS_TYPE_LABELS } from "@/styles/theme";

const TIER_EXOTIC = 6;
const CLASS_TABS = [0, 1, 2] as const;

interface ExoticPickerProps {
  items: ArmorItem[];
  selectedClassType: number;
  onSelectClassType: (classType: number) => void;
  selectedItemInstanceId: string | null;
  onSelect: (item: ArmorItem) => void;
}

export function ExoticPicker({
  items,
  selectedClassType,
  onSelectClassType,
  selectedItemInstanceId,
  onSelect,
}: ExoticPickerProps) {
  const exotics = items.filter(
    (item) => item.tierType === TIER_EXOTIC && item.classType === selectedClassType
  );

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {CLASS_TABS.map((classType) => (
          <button
            key={classType}
            type="button"
            onClick={() => onSelectClassType(classType)}
            className={cn(
              "font-display rounded border px-3 py-1 text-xs uppercase tracking-wider transition-colors",
              classType === selectedClassType
                ? "border-arc text-arc"
                : "border-border text-foreground/50 hover:text-foreground"
            )}
          >
            {CLASS_TYPE_LABELS[classType]}
          </button>
        ))}
      </div>

      {exotics.length === 0 ? (
        <p className="text-sm text-foreground/50">No exotic armor owned for this class.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {exotics.map((item) => (
            <button
              key={item.itemInstanceId}
              type="button"
              onClick={() => onSelect(item)}
              className={cn(
                "rounded-lg border bg-panel/80 p-2 text-left transition-colors",
                item.itemInstanceId === selectedItemInstanceId
                  ? "border-arc"
                  : "border-border hover:border-foreground/30"
              )}
            >
              <div className="relative mb-2 h-12 w-12 overflow-hidden rounded border border-border">
                <Image
                  src={`https://www.bungie.net${item.icon}`}
                  alt={item.name}
                  fill
                  sizes="48px"
                  className="object-cover"
                />
              </div>
              <p className="truncate text-xs font-semibold">{item.name}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
