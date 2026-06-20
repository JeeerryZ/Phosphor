"use client";

import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost";
}

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 px-5 py-2 text-base uppercase tracking-widest transition-colors cursor-pointer disabled:cursor-not-allowed",
        variant === "primary" &&
          "border border-border-active text-accent hover:bg-accent/10",
        variant === "ghost" &&
          "border border-border text-fg-dim hover:text-foreground hover:border-border-active",
        className
      )}
      {...props}
    />
  );
}
