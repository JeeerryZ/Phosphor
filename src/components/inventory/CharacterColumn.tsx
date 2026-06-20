"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { ArmorCard } from "./ArmorCard";
import type { ArmorItem, ArmorSlot } from "@/lib/armor/types";
import { ARMOR_SLOT_LABELS, CLASS_TYPE_LABELS } from "@/styles/theme";

const SLOT_ORDER: ArmorSlot[] = ["helmet", "gauntlets", "chest", "legs", "classItem"];

interface CharacterColumnProps {
  classType: number;
  light: number;
  emblemPath: string;
  emblemBackgroundPath: string;
  items: ArmorItem[];
}

export function CharacterColumn({
  classType,
  light,
  emblemPath,
  emblemBackgroundPath,
  items,
}: CharacterColumnProps) {
  const bySlot = new Map<ArmorSlot, ArmorItem[]>();
  for (const item of items) {
    const list = bySlot.get(item.slot);
    if (list) {
      list.push(item);
    } else {
      bySlot.set(item.slot, [item]);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="flex min-w-0 flex-1 flex-col"
    >
      <div className="border-border bg-panel/80 relative mb-4 overflow-hidden rounded-lg border">
        <div className="relative h-16 w-full">
          <Image
            src={`https://www.bungie.net${emblemBackgroundPath}`}
            alt=""
            fill
            sizes="400px"
            priority
            className="object-cover"
          />
          <div className="from-panel/95 absolute inset-0 bg-gradient-to-r to-transparent" />
        </div>
        <div className="absolute inset-0 flex items-center gap-3 px-4">
          <div className="border-arc/40 relative h-10 w-10 shrink-0 overflow-hidden rounded border">
            <Image
              src={`https://www.bungie.net${emblemPath}`}
              alt=""
              fill
              sizes="40px"
              className="object-cover"
            />
          </div>
          <div>
            <p className="font-display text-base font-semibold uppercase tracking-wider">
              {CLASS_TYPE_LABELS[classType] ?? "Guardian"}
            </p>
            <p className="font-display text-arc text-glow-arc text-sm">Power {light}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {SLOT_ORDER.map((slot) => {
          const slotItems = bySlot.get(slot);
          if (!slotItems || slotItems.length === 0) return null;
          return (
            <div key={slot}>
              <p className="font-display mb-2 text-sm uppercase tracking-[0.3em] text-foreground/40">
                {ARMOR_SLOT_LABELS[slot]}
              </p>
              <div className="flex flex-col gap-2">
                {slotItems.map((item, index) => (
                  <ArmorCard key={item.itemInstanceId} item={item} index={index} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
