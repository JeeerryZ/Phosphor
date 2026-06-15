// Plain CommonJS Piscina worker entry point. Kept as .js (not .ts) so it can be loaded by
// worker_threads at runtime without a separate build step - see Task 0 of
// docs/plans/2026-06-15-optimizer-worker-thread-pool-implementation.md.
//
// For this spike, the worker simply echoes back the sum of an input SharedArrayBuffer's values,
// proving that (a) the worker file loads under both `next dev` and a production build, and (b) a
// SharedArrayBuffer round-trips correctly.
module.exports = ({ sharedBuffer, length }) => {
  const view = new Int32Array(sharedBuffer, 0, length);
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += view[i];
  }
  return sum;
};
