"use client";

import { useState } from "react";
import type { ArmorInventory, ArmorItem, ArmorStatName, ArmorStats } from "@/lib/armor/types";
import type { OptimizerResult } from "@/lib/optimizer";
import { ARMOR_STAT_ORDER } from "@/styles/theme";
import { ExoticPicker } from "./ExoticPicker";
import { OptimizerControls } from "./OptimizerControls";
import { OptimizerResults } from "./OptimizerResults";

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

  async function handleSelectExotic(item: ArmorItem) {
    setSelectedExotic(item);
    setResults([]);
    setThresholds(zeroThresholds());
    setStatus("loading");

    try {
      const response = await fetch("/api/optimizer/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exoticItemInstanceId: item.itemInstanceId }),
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      const data = (await response.json()) as { results: OptimizerResult[] };
      setResults(data.results);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <ExoticPicker
        items={allItems}
        selectedClassType={classType}
        onSelectClassType={(next) => {
          setClassType(next);
          setSelectedExotic(null);
          setResults([]);
        }}
        selectedItemInstanceId={selectedExotic?.itemInstanceId ?? null}
        onSelect={handleSelectExotic}
      />

      {status === "loading" && <p className="text-sm text-foreground/50">Computing combinations...</p>}
      {status === "error" && (
        <p className="text-sm text-red-400">
          Something went wrong computing results.{" "}
          {selectedExotic && (
            <button type="button" onClick={() => handleSelectExotic(selectedExotic)} className="underline">
              Retry
            </button>
          )}
        </p>
      )}

      {selectedExotic && status === "idle" && (
        <>
          <OptimizerControls
            thresholds={thresholds}
            onThresholdChange={(stat, value) => setThresholds((prev) => ({ ...prev, [stat]: value }))}
            optimizeFor={optimizeFor}
            onOptimizeForChange={setOptimizeFor}
            statIcons={statIcons}
          />
          <OptimizerResults results={results} thresholds={thresholds} optimizeFor={optimizeFor} />
        </>
      )}
    </div>
  );
}
