"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";

const FRAMES = ["\\", "|", "/", "-"] as const;

export function Spinner({ className }: { className?: string }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 120);
    return () => clearInterval(id);
  }, []);

  return (
    <span className={cn("font-mono text-accent text-base", className)}>
      [{FRAMES[frame]}] loading...
    </span>
  );
}
