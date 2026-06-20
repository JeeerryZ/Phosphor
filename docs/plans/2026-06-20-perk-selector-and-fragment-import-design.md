# Perk Selector + Fragment Import — Design

**Goal:** Let players (1) pick which owned perk pair to use on an exotic class item, and
(2) auto-fill the Fragment Bonuses sliders from whatever's actually socketed on their
equipped subclass right now.

## 1. Exotic class item perk selector

**Problem:** `ExoticPicker.tsx` groups every owned copy of an exotic class item by
`itemHash` alone, keeping only the highest-stat copy. If you own the same exotic with two
different perk pairs, only one (whichever has higher stats) is ever shown or selectable.

**Change:** Group by `itemHash` + a sorted perk-name signature, but only for items that
carry `exoticPerks` (i.e. class item exotics — other slots are unaffected and keep the
existing single-card-per-hash behavior). Each distinct perk pair you own becomes its own
card in the grid; ties within an identical perk pair still keep the highest-stat copy.

No changes needed anywhere else — `onSelect` already receives a concrete `ArmorItem`
with its own `itemInstanceId`, so the rest of the picker → optimizer → equip pipeline is
untouched.

## 2. Auto-import fragments from equipped subclass

**Problem:** `fragmentBonuses` (in `OptimizerClient.tsx`) is filled entirely by hand via
+/- buttons in `OptimizerControls.tsx`. There's no way to pull in what's actually socketed
on the currently equipped subclass.

**Data source:** No new Bungie API components are required. `COMPONENT_CHARACTER_EQUIPMENT`
and `COMPONENT_ITEM_SOCKETS` (both already fetched in `getProfileWithArmor`) are enough:

1. Find the equipped subclass: the item in `characterEquipment.data[characterId].items`
   with `bucketHash === 3284755031` (Subclass bucket — a stable Destiny 2 constant,
   following the existing pattern of `ARMOR_BUCKET_HASHES`/`ARMOR_STAT_HASHES`).
2. Read that item's sockets (already available via `itemComponents.sockets.data`).
3. For each socketed `plugHash`, look up the manifest item definition and sum any
   `investmentStats` entries whose `statTypeHash` matches one of the 6 armor stat hashes
   into an `ArmorStats` accumulator. This naturally captures only Fragments — Aspects and
   Supers carry no raw stat investment — without needing to filter by socket category.

**API:** New route `GET /api/loadout/fragments?characterId=...`, mirroring the auth/session
pattern of the existing `/api/optimizer/compute` route. Returns the resulting `ArmorStats`
(values may be negative, since some fragments trade one stat for another).

**UI:**
- A new "Import from equipped" button next to the Fragment Bonuses header in
  `OptimizerControls.tsx`. On click, fetches once and **overwrites** all 6 fragment
  values — not merged with manual edits, so the result is predictable. You can still
  hand-tune with +/- afterward.
- The existing +/- stepper currently clamps to 0–30. Extend the range to **-30 to +30**.
  Negative values render in the warn/red color (vs. the current accent color for
  positive) to visually flag "this raises the armor requirement for this stat."
- No changes needed to the query math: `runQuery` already computes
  `Math.max(0, threshold - bonus)`, which correctly *increases* the effective threshold
  when `bonus` is negative.

**Error handling:** If the resolved character has no equipped subclass item (shouldn't
normally happen, but the bucket lookup could come up empty), the route returns a 404 with
a message; the button surfaces an inline error rather than silently zeroing the fields.

## Testing

- Unit test for the new fragment-extraction helper: given a fake profile response with a
  mocked subclass item + sockets + manifest plug definitions (some with positive,
  negative, and zero/irrelevant `investmentStats`), assert the summed `ArmorStats` is
  correct and ignores non-armor stat hashes.
- Unit test for the perk-pair grouping key in the picker: given items with the same hash
  but different perk pairs, assert both appear as separate entries; given items with an
  identical perk pair, assert only the highest-stat one survives.
