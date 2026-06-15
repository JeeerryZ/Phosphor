# Optimizer Stat Headroom ("Shadow Max") + Slider Prettify Design

## Goal

For each of the 6 threshold sliders in the optimizer, show a "shadow" zone indicating
how much higher that stat could go without violating any of the current thresholds
(including its own) - i.e. the headroom available given everything the user has
already locked in. Replace the plain native `<input type="range">` sliders with a
custom-styled slider that visualizes this headroom alongside the current value.

## Background

`computeOptimizerQuery` (`src/lib/optimizer/query.ts`) already does a single pass over
`(combo, adj, mod)` candidates in `buildResults`, filtering by `query.thresholds` and
keeping the top `RESULT_LIMIT` (50) results sorted by `optimizeFor`. The "shadow max"
feature piggybacks on this same pass: every candidate that passes the threshold filter
is a feasible loadout, so tracking a running per-stat max across those candidates gives
"the highest each stat reaches among currently-feasible loadouts" for free.

## Data flow changes

### `buildResults` (src/lib/optimizer/query.ts)

- Add a 6-element `Int32Array` accumulator (`maxStatValues`), initialized so "no value
  seen yet" is detectable (e.g. fill with `Number.MIN_SAFE_INTEGER` or track a separate
  `hasAny` boolean).
- For every candidate that passes `meetsThresholds`, update
  `maxStatValues[i] = Math.max(maxStatValues[i], sumValues[i])` for all 6 stats - in
  addition to the existing tier-dedup `best` bookkeeping. This is O(1) extra work only
  on the already-rare "passing" path.
- Change return type from `OptimizerResult[]` to:
  ```typescript
  interface BuildResultsOutput {
    results: OptimizerResult[];
    maxStats: StatVector | null; // null if zero candidates passed thresholds
  }
  ```

### `computeOptimizerQuery` (src/lib/optimizer/query.ts)

- Return type becomes `{ results: OptimizerResult[]; maxStats: StatVector | null }`.
- The topK-widening `while` loop already re-runs `buildResults` and overwrites
  `results` each iteration; carry `maxStats` through the same way so the returned
  `maxStats` corresponds to the same iteration as the returned `results`.
- If a non-exotic slot has no candidates (existing early-return `[]` case), return
  `{ results: [], maxStats: null }`.

### `/api/optimizer/compute` (src/app/api/optimizer/compute/route.ts)

- Response body becomes `{ results: OptimizerResult[]; maxStats: StatVector | null }`.

## Frontend changes

### `OptimizerClient.tsx`

- New state: `maxStats: StatVector | null` (default `null`).
- Reset to `null` whenever a new exotic is selected (alongside the existing
  `thresholds`/`optimizeFor` reset) and at the start of each `runQuery` call... actually
  no reset needed mid-query - just overwrite from the response like `results`. On
  exotic switch, reset to `null` since the previous exotic's headroom no longer applies.
- Pass `maxStats` down to `OptimizerControls`.

### `OptimizerControls.tsx`

- Pass `maxStats?.[stat] ?? null` as the `shadowMax` prop to each slider.

### New component: `ThresholdSlider.tsx` (src/components/optimizer/)

Props:
```typescript
interface ThresholdSliderProps {
  value: number;
  max: number; // OPTIMIZER_STAT_MAX
  step: number; // OPTIMIZER_STAT_STEP
  shadowMax: number | null; // maxStats[stat], or null if unavailable
  onChange: (value: number) => void;
  ariaLabel: string;
  highlighted: boolean; // stat === optimizeFor
}
```

Renders a `relative h-2 w-full` stack (bottom to top):

1. **Base track**: full-width rounded bar, `bg-panel-raised` (the default/"beyond
   headroom" zone, 0-200).
2. **Shadow/headroom zone**: absolutely positioned div spanning
   `value/max*100%` to `shadowMax/max*100%`, only rendered when
   `shadowMax !== null && shadowMax > value`. Color: `bg-arc/20` (low-opacity accent).
3. **Filled zone**: absolutely positioned div spanning `0%` to `value/max*100%`.
   Color: `bg-arc` normally, a brighter/glowing variant (e.g. add `glow-arc`) when
   `highlighted` is true, to preserve the existing optimizeFor emphasis.
4. **`<input type="range">`**: overlaid (`absolute inset-0`), `appearance-none
   bg-transparent` so the track is invisible and the layers below show through;
   only the thumb is visible.

All percentages clamped to `[0, 100]`.

### Slider thumb styling (src/app/globals.css)

Add rules for `input[type="range"].threshold-slider`:
- `::-webkit-slider-thumb` / `::-moz-range-thumb`: circular (~14px), `bg-arc`,
  border matching `--color-panel`, `box-shadow` glow on hover/focus consistent with
  existing `.glow-arc` utility.
- `::-webkit-slider-runnable-track` / track (Firefox): fully transparent, since the
  visual track is rendered by the layered divs.

## Testing

- **Backend** (`query.test.ts`): unit tests asserting
  - `maxStats[stat]` equals the max value of `stat` across all `results`-eligible
    candidates for representative fixtures (including cases where a stat's max comes
    from a different combo than the one in `results`).
  - `maxStats` is `null` when `results` is empty (no candidate passes thresholds).
  - `maxStats` is consistent with `results` after the topK-widening loop runs more
    than one iteration.
- **Frontend**: no existing component-test setup; verify via manual browser e2e
  (same flow as the prior optimizer e2e pass):
  - Select an exotic, confirm each slider shows a shadow zone reflecting headroom.
  - Raise a threshold and confirm the filled zone grows and the shadow zone
    shrinks/recomputes after the debounced re-query.
  - Confirm the empty-state (impossible thresholds) hides/omits shadow zones
    (since `maxStats` is `null`).
  - Confirm exotic switching resets `maxStats` along with thresholds/optimizeFor.

## Out of scope / explicitly rejected

- A "ceiling before this slider becomes the bottleneck" variant (computed by zeroing
  out each stat's own threshold and re-checking the other 5) - would roughly double
  the hot-loop cost, rejected for performance reasons given the existing budget is
  already tuned close to the limit.
- Adopting shadcn/ui or Radix UI's `Slider` primitive - doesn't provide the multi-zone
  shadow track we need, so it would add a dependency without removing custom code.
