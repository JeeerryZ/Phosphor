# Legendary T5 Tuning: Fixed Increase Stat — Design

**Goal:** Stop the optimizer from treating every legendary armor piece's Tier 5 tuning
socket as a free choice among all 6 stats. In reality, a legendary piece's tuning socket
can only ever *increase* one specific stat (fixed per item instance); only the *decrease*
stat is freely chosen among the other 5. Exotic armor remains free-choice on both ends
(confirmed with the user).

## Root cause

The static manifest definition for every legendary armor piece's tuning socket lists the
same `reusablePlugSetHash`, containing all 30 directional tuning plugs (every
increase/decrease pair) — verified directly against the manifest DB. This is a superset;
Bungie narrows it per-instance via a separate "live" profile component,
`ItemReusablePlugs` (component type 310, `DestinyItemReusablePlugsComponent`), which we
don't currently fetch. Each plug entry there carries `canInsert: boolean` — the actual
per-instance insertion eligibility. Our code only ever saw the static superset, so it
assumed every legendary piece could boost any stat.

## Data layer

**`src/lib/bungie/profile.ts`** — add `COMPONENT_ITEM_REUSABLE_PLUGS = 310` to the
`components` array in `getProfileWithArmor`.

**`src/lib/armor/transform.ts`** — new helper:

```typescript
const TIER_LEGENDARY = 5;

function readLegendaryTuningIncreaseStat(
  itemInstanceId: string,
  tuningSocketIndex: number,
  profile: DestinyProfileResponse
): ArmorStatName | undefined {
  const livePlugs = profile.itemComponents.reusablePlugs.data?.[itemInstanceId]?.plugs[tuningSocketIndex] ?? [];
  const increaseStats = new Set<ArmorStatName>();
  for (const plug of livePlugs) {
    if (!plug.canInsert) continue;
    const directional = STAT_TUNING_PLUGS[plug.plugItemHash];
    if (directional) increaseStats.add(directional.increasedStat);
  }
  return increaseStats.size === 1 ? [...increaseStats][0] : undefined;
}
```

Called from `transformItem` only when `tierType === TIER_LEGENDARY && tuningSocketIndex !== undefined`.
Result stored on a new optional `ArmorItem.legendaryTuningIncreaseStat` field. If the live
data is ever ambiguous (0 or >1 distinct stats — not expected in practice), the field stays
`undefined` and that piece is treated as having no usable tuning, rather than silently
reverting to free-choice.

## Optimizer combinatorics

**`src/lib/optimizer/combine.ts`** (`SlotCandidate`) — add `allowedIncreaseStats: ArmorStatName[]`:
- Exotic candidates: all 6 stats (unchanged free-choice behavior).
- Legendary candidates: `[item.legendaryTuningIncreaseStat]` if set, else `[]` (and `hasTuning`
  becomes `false` for that candidate in the ambiguous case, keeping `tunedCount` accounting honest).

**`src/lib/optimizer/query.ts`** — replace `enumerateBoostDistributions(k)` (which generates
every *multiset* of size `k` from the 6 stats — valid only when every tuned slot has an
identical, interchangeable domain) with a per-slot Cartesian product:

```typescript
function* enumerateBoostCombinations(domains: ArmorStatName[][]): Generator<ArmorStatName[]> {
  if (domains.length === 0) { yield []; return; }
  const [first, ...rest] = domains;
  for (const stat of first) {
    for (const tail of enumerateBoostCombinations(rest)) {
      yield [stat, ...tail];
    }
  }
}
```

In the main `buildResults` loop, for each `combo`, the ordered list of tuned slots
(`ALL_SLOTS.filter(slot => combo.choices[slot]?.hasTuning)`) and their domains
(`tunedSlots.map(slot => combo.choices[slot]!.allowedIncreaseStats)`) are computed per-combo
(since which physical item occupies which slot varies combo-to-combo), then
`enumerateBoostCombinations(domains)` replaces the old call. The rest of the loop (greedy
decrease-stat assignment, feasibility check, tier-key dedup) is unchanged — it only consumed
`boosts: ArmorStatName[]` of length `tunedCount`, which the new generator still produces.

Net effect: correctness fix, plus a meaningful search-space reduction (legendary domains of
size 1 instead of contributing to the previous 252-way multiset enumeration).

## Testing

- `transform.test.ts`: extend with cases for `readLegendaryTuningIncreaseStat` — single
  valid increase stat resolves correctly; `canInsert: false` entries are ignored; ambiguous
  (0 or 2+ distinct stats) returns `undefined`.
- `combine.test.ts` or a new `query.test.ts` case: a regression test proving a legendary
  piece with a fixed increase stat never appears in a result with a *different* stat
  increased — this is the test that would have caught the original bug.
- New unit test for `enumerateBoostCombinations`: given asymmetric domains (e.g.
  `[["discipline"], ["mobility", "resilience"]]`), yields exactly the Cartesian product.
- Full existing suite must stay green (`combine.test.ts`, `query.test.ts`,
  `query.performance.test.ts` — the performance test's budget may need rechecking since the
  search space should shrink, not grow).

## Out of scope

Surfacing which stat a legendary piece is locked to in the picker/inventory UI is a nice
future enhancement but not required to fix the optimizer's correctness — not included here.
