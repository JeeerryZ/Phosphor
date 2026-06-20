"use client";

import { useEffect, useState } from "react";
import type { OptimizerPoolStats } from "@/lib/optimizer/worker-pool";

export interface OptimizerDebugInfo {
  elapsedMs: number;
  resultCount: number;
  combosEvaluated: number;
  boostDistributionsChecked: number;
  feasibleCombinations: number;
  uniqueKeys: number;
  pool: OptimizerPoolStats;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function Row({ label, value, dim }: { label: string; value: string | number; dim?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-[12px] uppercase tracking-widest" style={{ color: "var(--color-fg-muted)" }}>
        {label}
      </span>
      <span
        className="font-mono text-sm tabular-nums"
        style={{ color: dim ? "var(--color-fg-muted)" : "var(--color-accent)" }}
      >
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-border my-1" />;
}

interface Props {
  info: OptimizerDebugInfo;
}

export function OptimizerDebugOverlay({ info }: Props) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "d" || e.key === "D") {
        if ((e.target as HTMLElement).tagName === "INPUT") return;
        setVisible((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { pool } = info;

  return (
    <div
      className="fixed right-4 bottom-4 z-50 w-52 border border-border select-none"
      style={{ background: "var(--color-surface)" }}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 border-b border-border cursor-pointer hover:bg-surface-raised transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <span className="text-[12px]" style={{ color: "var(--color-fg-muted)" }}>▶</span>
          <span className="text-[12px] uppercase tracking-widest" style={{ color: "var(--color-fg-muted)" }}>
            Optimizer
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] tracking-widest" style={{ color: "var(--color-fg-muted)" }}>
            {info.elapsedMs} ms
          </span>
          <span className="text-[11px]" style={{ color: "var(--color-fg-muted)" }}>
            {visible ? "▲" : "▼"}
          </span>
        </div>
      </button>

      {/* Body */}
      {visible && (
        <div className="px-3 py-2.5 flex flex-col gap-1">
          <Row label="Results" value={info.resultCount} />
          <Row label="Unique keys" value={fmt(info.uniqueKeys)} />
          <Row label="Feasible" value={fmt(info.feasibleCombinations)} />

          <Divider />

          <Row label="Distributions" value={fmt(info.boostDistributionsChecked)} />
          <Row label="Combos" value={fmt(info.combosEvaluated)} />

          <Divider />

          <Row label="Threads" value={`${pool.liveThreads} / ${pool.maxThreads}`} />
          <Row label="Utilization" value={`${Math.round(pool.utilization * 100)}%`} dim={pool.utilization < 0.3} />
          <Row label="Completed" value={fmt(pool.completed)} dim />
          {pool.queueSize > 0 && (
            <Row label="Queue" value={pool.queueSize} />
          )}

          <Divider />

          <p className="text-[11px] text-center" style={{ color: "var(--color-fg-muted)" }}>
            press D to toggle
          </p>
        </div>
      )}
    </div>
  );
}
