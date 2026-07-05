import type { ReactNode } from "react";

export function Toast({ children }: { children: ReactNode }) {
  return (
    <div className="animate-toast-in fixed bottom-6 right-6 z-[9999] flex items-center gap-3 border border-border-active bg-surface-raised px-4 py-3 text-sm shadow-[0_0_20px_rgba(232,160,48,0.15)]">
      {children}
    </div>
  );
}
