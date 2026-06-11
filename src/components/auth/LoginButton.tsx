"use client";

import { motion } from "motion/react";

export function LoginButton() {
  return (
    <motion.a
      href="/api/auth/login"
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className="font-display inline-flex items-center justify-center gap-2 rounded-md border border-arc/40 bg-arc/10 px-8 py-3 text-base font-semibold uppercase tracking-wider text-arc glow-arc transition-colors hover:border-arc hover:bg-arc/20"
    >
      Login with Bungie
    </motion.a>
  );
}
