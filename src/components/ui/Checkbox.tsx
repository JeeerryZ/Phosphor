"use client";

import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
}

export function Checkbox({ label, className, checked, ...props }: CheckboxProps) {
  return (
    <label className={cn("flex items-center gap-3 cursor-pointer select-none group", className)}>
      <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center border border-border bg-white/[0.02] transition-colors group-hover:border-border-active peer-focus-visible:ring-2">
        <input
          type="checkbox"
          checked={checked}
          className="peer absolute inset-0 opacity-0 cursor-pointer"
          {...props}
        />
        <svg
          viewBox="0 0 16 16"
          fill="none"
          className={cn(
            "h-3 w-3 text-accent transition-opacity",
            checked ? "opacity-100" : "opacity-0"
          )}
        >
          <path
            d="M3 8.5L6.5 12L13 4.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="square"
          />
        </svg>
        <span
          className={cn(
            "absolute inset-0 -z-10 bg-accent/10 transition-opacity",
            checked ? "opacity-100" : "opacity-0"
          )}
        />
      </span>
      <span className="text-sm text-fg-dim">{label}</span>
    </label>
  );
}
