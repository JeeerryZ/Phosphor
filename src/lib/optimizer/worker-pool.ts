import os from "node:os";
import path from "node:path";
import Piscina from "piscina";
import type { ComboResultEntry } from "./combo-results";

/** Upper bound on pool size, independent of the host's core count. */
const MAX_WORKERS = 8;

let pool: Piscina | undefined;

/** Lazily-created singleton Piscina pool, reused for the process's lifetime. */
export function getOptimizerPool(): Piscina {
  if (!pool) {
    pool = new Piscina({
      // Resolve relative to the project root (process.cwd()) rather than __dirname: Next.js's
      // bundler (Turbopack/webpack) rewrites __dirname for app code to a virtual path that
      // doesn't exist on disk, which breaks worker_threads' real filesystem lookup.
      filename: path.resolve(process.cwd(), "src/lib/optimizer/optimizer-worker.js"),
      maxThreads: Math.min(os.cpus().length, MAX_WORKERS),
    });
  }
  return pool;
}

/** The pool's configured thread count, used to scale per-bucket iteration budgets. */
export function getOptimizerPoolSize(): number {
  return getOptimizerPool().maxThreads;
}

export interface ComboTaskInput {
  comboStats: Int32Array;
  adjustmentStatsFlat: Int32Array;
  adjustmentCount: number;
  modDeltaFlat: Int32Array;
  modCount: number;
  thresholdValues: Int32Array;
  optimizeForIndex: number;
  statCount: number;
}

/** Runs one combo's `(adjustment x mod)` search on the worker pool. */
export function runComboTask(input: ComboTaskInput): Promise<ComboResultEntry[]> {
  return getOptimizerPool().run(input);
}
