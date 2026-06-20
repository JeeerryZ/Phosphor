"use client";

import { motion } from "motion/react";
import { ArmorCard } from "./ArmorCard";
import type { ArmorItem, ArmorSlot } from "@/lib/armor/types";
import { ARMOR_SLOT_LABELS } from "@/styles/theme";

const SLOT_ORDER: ArmorSlot[] = ["helmet", "gauntlets", "chest", "legs", "classItem"];

interface VaultSectionProps {
  items: ArmorItem[];
}

export function VaultSection({ items }: VaultSectionProps) {
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
      transition={{ duration: 0.4, ease: "easeOut", delay: 0.1 }}
    >
      <h2 className="font-display text-void text-glow-arc mb-4 text-xl font-bold uppercase tracking-[0.3em]">
        Vault
      </h2>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {SLOT_ORDER.map((slot) => {
          const slotItems = bySlot.get(slot);
          if (!slotItems || slotItems.length === 0) return null;
          return (
            <div key={slot}>
              <p className="font-display mb-2 text-sm uppercase tracking-[0.3em] text-foreground/40">
                {ARMOR_SLOT_LABELS[slot]} ({slotItems.length})
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
