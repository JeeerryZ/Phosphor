"use client";

import { useEffect, useRef, useState } from "react";
import type { ArmorInventory, ArmorItem, ArmorStatName, ArmorStats } from "@/lib/armor/types";
import type { OptimizerResult } from "@/lib/optimizer";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { ExoticPicker } from "./ExoticPicker";
import { OptimizerControls } from "./OptimizerControls";
import { OptimizerResults } from "./OptimizerResults";

const QUERY_DEBOUNCE_MS = 300;

function zeroThresholds(): ArmorStats {
  return {
    mobility: 0,
    resilience: 0,
    recovery: 0,
    discipline: 0,
    intellect: 0,
    strength: 0,
  };
}

interface OptimizerClientProps {
  inventory: ArmorInventory;
  statIcons: Record<ArmorStatName, string>;
  defaultClassType: number;
}

export function OptimizerClient({ inventory, statIcons, defaultClassType }: OptimizerClientProps) {
  const allItems = [...inventory.vault, ...Object.values(inventory.characters).flat()];

  const [classType, setClassType] = useState(defaultClassType);
  const [selectedExotic, setSelectedExotic] = useState<ArmorItem | null>(null);
  const [results, setResults] = useState<OptimizerResult[]>([]);
  const [thresholds, setThresholds] = useState<ArmorStats>(zeroThresholds());
  const [optimizeFor, setOptimizeFor] = useState<ArmorStatName>(ARMOR_STAT_ORDER[0]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const requestIdRef = useRef(0);

  async function runQuery(exotic: ArmorItem, currentThresholds: ArmorStats, currentOptimizeFor: ArmorStatName) {
    const requestId = ++requestIdRef.current;
    setStatus("loading");

    try {
      const response = await fetch("/api/optimizer/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exoticItemInstanceId: exotic.itemInstanceId,
          thresholds: currentThresholds,
          optimizeFor: currentOptimizeFor,
        }),
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      const data = (await response.json()) as { results: OptimizerResult[] };
      if (requestIdRef.current !== requestId) return;
      setResults(data.results);
      setStatus("idle");
    } catch {
      if (requestIdRef.current !== requestId) return;
      setStatus("error");
    }
  }

  useEffect(() => {
    if (!selectedExotic) return;

    const timeout = setTimeout(() => {
      runQuery(selectedExotic, thresholds, optimizeFor);
    }, QUERY_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [selectedExotic, thresholds, optimizeFor]);

  function handleSelectExotic(item: ArmorItem) {
    requestIdRef.current += 1;
    setSelectedExotic(item);
    setResults([]);
    setThresholds(zeroThresholds());
    setOptimizeFor(ARMOR_STAT_ORDER[0]);
  }

  return (
    <div className="flex flex-col gap-6">
      <ExoticPicker
        items={allItems}
        selectedClassType={classType}
        onSelectClassType={(next) => {
          requestIdRef.current += 1;
          setClassType(next);
          setSelectedExotic(null);
          setResults([]);
          setStatus("idle");
        }}
        selectedItemInstanceId={selectedExotic?.itemInstanceId ?? null}
        onSelect={handleSelectExotic}
      />

      {selectedExotic && (
        <>
          <OptimizerControls
            thresholds={thresholds}
            onThresholdChange={(stat, value) => setThresholds((prev) => ({ ...prev, [stat]: value }))}
            optimizeFor={optimizeFor}
            onOptimizeForChange={setOptimizeFor}
            statIcons={statIcons}
          />

          {status === "loading" && (
            <p role="status" aria-live="polite" className="text-sm text-foreground/50">
              Computing combinations...
            </p>
          )}
          {status === "error" && (
            <p role="alert" className="text-sm text-red-400">
              Something went wrong computing results.{" "}
              <button
                type="button"
                onClick={() => runQuery(selectedExotic, thresholds, optimizeFor)}
                className="underline"
              >
                Retry
              </button>
            </p>
          )}
          {status === "idle" && <OptimizerResults results={results} optimizeFor={optimizeFor} />}
        </>
      )}
    </div>
  );
}
