# Armor Set Optimizer - Design

## Summary

A new `/optimizer` page where the player picks one owned exotic armor piece, locks it into its
slot, and sees every Pareto-optimal combination of their remaining legendary armor (+ Tier 5
tuning + stat mods) that produces a distinct final 6-stat total. Minimum-stat sliders filter the
results client-side; an "optimize for" selector sorts by a chosen stat, enabling queries like
"pin Super to 180, show me the max Weapons I can get."

This is the Phase 2 "armor optimization engine" referenced in the README/CLAUDE.md roadmap.
Card-style restyling (removing rarity badges, etc.) is being handled incrementally alongside this
work, not as a separate redesign pass.

## Game mechanics this models

- 6 armor stats: Weapons (mobility), Health (resilience), Class (recovery), Grenade (discipline),
  Super (intellect), Melee (strength). Display labels/order/hashes already exist in
  `src/styles/theme.ts` and `src/lib/armor/types.ts`.
- A loadout = 1 item per slot (helmet, gauntlets, chest, legs, class item). The locked exotic
  occupies its slot; the other 4 slots are legendary-only (Destiny only allows one equipped
  exotic armor piece).
- **Tier 5 tuning** (`src/lib/armor/tuning.ts`): Tier 5 armor has a tuning socket that can be set
  to one of 30 directional swaps (+5 to one stat / -5 to another), "balanced" (+1 all), or empty.
  Non-Tier-5 armor has no tuning (`kind: "none"`).
- **Stat mods**: each of the 5 equipped pieces (including the exotic) has exactly one general mod
  slot, independently giving +10 to one stat, +5 to one stat, or nothing (13 choices per slot).
- Per-stat totals across a 5-piece loadout are effectively uncapped up to ~200 (5 pieces x ~40
  max each); no "wasted points past 100" cap in the new system.

## Architecture

### Route & data flow

1. `/optimizer` (new page, separate from `/inventory`) loads the player's armor inventory via the
   existing pipeline: `getValidSession` -> `ensureManifestUpToDate` -> `getProfileWithArmor` ->
   `transformProfileToArmorInventory`.
2. **Exotic picker**: class tabs (Titan/Hunter/Warlock) + grid of owned exotic armor for that
   class (vault + characters), styled like a simplified `ArmorCard`. Selecting one POSTs its
   `itemInstanceId` to `/api/optimizer/compute`.
3. Server re-derives the inventory, runs the precompute algorithm (below), and returns the full
   Pareto-frontier result set with provenance.
4. Client renders 6 minimum-stat sliders (0-200) + an "optimize for" stat dropdown. Both only
   filter/sort the already-fetched result array - no further requests.

### Algorithm (`src/lib/optimizer/`, pure functions)

1. **Per-item tuning variants**: for each candidate legendary (and the locked exotic), compute the
   set of achievable stat vectors from its base stats + each applicable Tier 5 tuning option (30
   directional + balanced + none/empty for Tier-5 armor; just the base vector otherwise). Dedupe
   identical vectors.
2. **Pareto pruning per slot**: drop any item-variant whose stat vector is dominated (<= in all 6
   stats, < in at least one) by another candidate in the same slot.
3. **Incremental combination across the 4 open slots**: combine slot-by-slot (vector sum),
   Pareto-pruning the running combined set after each step. Result: a small set of "base loadout
   totals," each tagged with provenance (4 items + tuning choice per item).
4. **Mod-delta set (computed once, item-independent)**: the set of all distinct 6-dim sums from 5
   independent picks (with repetition) from {none, +10 to stat i, +5 to stat i} (13 options).
5. **Final results**: for each base total, add every mod-delta, dedupe globally by final 6-stat
   vector (same final stats from different tuning/mod assignments collapse to one result), then
   Pareto-prune the combined set to the global frontier. Each surviving vector keeps one example
   provenance (5 items + tuning + mod assignment).

The Pareto frontier guarantees that "max stat B given stat A >= X" queries are answerable from the
returned set - the optimum for any such query always lies on the frontier.

## UI components

- `OptimizerExoticPicker` - class tabs + exotic grid, reuses `ArmorCard`-style presentation.
- `OptimizerControls` - 6 stat sliders (with Destiny stat icons from
  `DestinyStatDefinition.displayProperties.icon` via the manifest, same `bungie.net` icon pattern
  as item icons) + "optimize for" dropdown.
- `OptimizerResults` - sorted/filtered list of result rows (6 stat totals + sum), each expandable
  to show the 5 items + tuning + mod assignment that achieves it.

## Error handling

- No valid session -> redirect to `/` (existing pattern).
- Manifest stale/missing -> `ensureManifestUpToDate` runs as part of the page load, same as
  `/inventory`.
- No owned exotics for the selected class -> empty state prompting a class switch.
- `/api/optimizer/compute` failure -> inline error message + retry.
- No results meet current slider thresholds -> empty state suggesting which stat(s) to lower.

## Testing

Add Vitest as a dev dependency. Unit-test the pure algorithm functions in `src/lib/optimizer/`
against synthetic item data:

- Tuning-variant generation (including the 30 directional swaps, balanced, empty/none).
- Pareto-dominance/pruning.
- Mod-delta set generation (13^5 raw combinations -> distinct sums).
- Incremental slot combination and final dedup/frontier.

## Open implementation details (left for the implementation plan)

- Exact API contract for `/api/optimizer/compute` (request/response shapes).
- Slider step granularity (raw stat values aren't necessarily multiples of 5/10).
- Result list virtualization/pagination if the frontier is large in practice.
