"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils/cn";

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={cn("relative h-10 w-10", className)}>
      <motion.span
        className="absolute inset-0 rounded-full border-2 border-arc/20 border-t-arc"
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
      />
      <motion.span
        className="absolute inset-2 rounded-full border-2 border-void/20 border-b-void"
        animate={{ rotate: -360 }}
        transition={{ repeat: Infinity, duration: 1.4, ease: "linear" }}
      />
    </div>
  );
}
