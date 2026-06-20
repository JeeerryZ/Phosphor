"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";

export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15, ease: "linear" }}
    >
      {children}
    </motion.div>
  );
}
