import { describe, it, expect } from "vitest";
import { getOptimizerPool, getOptimizerPoolSize } from "./worker-pool";

describe("getOptimizerPool", () => {
  it("returns a singleton pool with a positive thread count", () => {
    const pool = getOptimizerPool();
    expect(pool).toBe(getOptimizerPool());
    expect(getOptimizerPoolSize()).toBeGreaterThan(0);
  });

  it("runs a task that sums values from a SharedArrayBuffer", async () => {
    const sharedBuffer = new SharedArrayBuffer(4 * 4);
    new Int32Array(sharedBuffer).set([1, 2, 3, 4]);

    const result = await getOptimizerPool().run({ sharedBuffer, length: 4 });

    expect(result).toBe(10);
  });
});
