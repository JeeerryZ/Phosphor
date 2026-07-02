"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";

export function Toast({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="fixed bottom-6 right-6 z-[9999] flex items-center gap-3 border border-border-active bg-surface-raised px-4 py-3 text-sm shadow-[0_0_20px_rgba(232,160,48,0.15)]"
    >
      {children}
    </motion.div>
  );
}
