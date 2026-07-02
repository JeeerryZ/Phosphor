/// <reference lib="webworker" />

import { solve } from "./solver";
import type { ArmorStats } from "@/lib/armor/types";
import type { SolverOptions, SolverResult } from "./solver";

self.onmessage = (e: MessageEvent<{ targets: ArmorStats; options: SolverOptions }>) => {
  const results: SolverResult[] = solve(e.data.targets, e.data.options);
  self.postMessage(results);
};
