"use client";

import type { ButtonHTMLAttributes } from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { cn } from "@/lib/utils/cn";

interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof HTMLMotionProps<"button">>,
    HTMLMotionProps<"button"> {
  variant?: "primary" | "ghost";
}

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
  return (
    <motion.button
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={cn(
        "font-display inline-flex items-center justify-center gap-2 rounded-md px-6 py-3 text-base font-semibold uppercase tracking-wider transition-colors",
        variant === "primary" &&
          "bg-arc/10 text-arc border border-arc/40 hover:bg-arc/20 hover:border-arc glow-arc",
        variant === "ghost" &&
          "border border-border text-foreground/80 hover:text-foreground hover:border-foreground/40",
        className
      )}
      {...props}
    />
  );
}
