# Ghost Advisor: Subclass Fragment Bonuses

## Problem

Ghost Advisor (`/ghost-mods`) solves for a target stat spread using only ghost mods,
T5 tuning, masterwork, and Stat Mods. It ignores stat bonuses/penalties from equipped
subclass fragments, so a build that's actually achievable with fewer mods (because
fragments already cover part of the target) looks harder than it is.

The main Optimizer (`/`) already solves this exact problem for armor-set search via
`fragmentBonuses` state in `OptimizerClient.tsx` + `OptimizerControls.tsx`: a manual
per-stat +/-5 stepper (-30..+30) plus an "Import from equipped" button that calls
`/api/loadout/fragments?characterId=`, which in turn calls `getEquippedFragmentStats`
(`src/lib/bungie/fragments.ts`) — a generic reader that sums `investmentStats` off
whatever plugs are actually socketed into the equipped subclass. No hardcoded fragment
list is needed; it reads live off the manifest.

Ghost Advisor has no character/session context today — `ghost-mods/page.tsx` is a
static page with no server data fetching. Bringing in "import from equipped" requires
adding that for the first time.

## Approach

Reuse the Optimizer's fragment machinery as-is; add the missing plumbing to Ghost
Advisor.

### 1. `src/app/ghost-mods/page.tsx` becomes an async Server Component

- Calls `getValidSession()`.
- If a session exists: `ensureManifestUpToDate()` + `getProfileWithArmor(session)`,
  then builds `characters: Record<string, { classType: number }>` from
  `profile.characters.data` — identical shape/pattern to `src/app/page.tsx:53-57`.
- If no session: pass `characters={}`.
- Passes `characters` down to `<GhostModAdvisor characters={characters} />`.
- Unauthenticated users keep full access to the manual calculator; only the "Import
  from equipped" button is affected (disabled, see below).

### 2. `GhostModAdvisor.tsx` additions

**State:** `fragmentBonuses: ArmorStats` (default all-zero), `selectedCharacterId`
(only meaningful when `characters` has 2+ entries), `importState:
"idle"|"loading"|"error"` — same three states as `OptimizerClient`.

**UI — new "Subclass Fragments" block** in the Options section, styled to match the
existing Masterwork/Stat Mods checkboxes:

- A per-stat bonus stepper row (reuses the existing -/+ stepper visual pattern already
  used for Target Stats), range -30..+30, step 5, showing `+N`/`-N`/`0`.
- An "Import from equipped" button:
  - Disabled with a "Log in to import" affordance when `characters` is empty.
  - If exactly one character, imports directly on click.
  - If 2+ characters, a `<select>` (labeled via `CLASS_TYPE_LABELS` from
    `src/styles/theme.ts`) appears next to the button to choose which character's
    equipped subclass to read.
  - On click: `fetch(/api/loadout/fragments?characterId=...)`, sets `fragmentBonuses`
    from the response, mirrors `OptimizerClient.handleImportFragments`'s
    loading/error/timeout handling (request-id ref to discard stale responses).

**Solver integration** — fragments are free stat sources external to mods, so they
reduce what the mods need to cover, exactly like the Optimizer's
`adjustedThresholds`:

- Before posting to the worker: `adjustedTargets[stat] = max(0, targets[stat] -
  fragmentBonuses[stat])`. The worker/solver itself is unchanged — it only ever sees
  post-fragment targets.
- Displayed **Projected** column = `result.projected[stat] + fragmentBonuses[stat]`
  (so it compares directly against the user's original, pre-fragment Target for the
  red/green deficit check).
- **Budget bar** (`usedBudget` / `totalBudget`) is computed from the sum of
  `adjustedTargets`, not raw `targets` — budget represents mod capacity, which
  fragments don't consume.
- **Per-stat input cap**: raise from `maxStat` to `maxStat + max(0, fragmentBonuses[stat])`
  so a stat with a positive fragment bonus can be targeted higher (mods still only need
  to cover up to `maxStat` of it). Negative fragment bonuses don't lower the cap — the
  UI will simply show a deficit if unreachable, same as any other over-target today.
- **Debug breakdown table**: new "Subclass Fragments" row (italic, matching the
  existing T5 Tuning / Stat Mods rows), showing each stat's fragment contribution
  (`+N`/`-N`/`—`). The table's "Total" row sums in `fragmentBonuses[stat]` alongside
  `result.projected[stat]` so it reconciles with the Projected column above.

### Out of scope

- No changes to `src/lib/ghost/solver.ts` or the worker — fragments are handled
  entirely as a pre/post adjustment in the component, not a new solver concept.
- No changes to the existing Optimizer fragment UI/logic — only reused.
- No persistence of fragment bonuses across sessions (matches existing Ghost Advisor
  behavior — nothing on this page persists today).

## Testing

- Existing `fragments.test.ts` already covers `getEquippedFragmentStats` — untouched.
- Manual verification in-browser: toggle fragment stepper values, confirm budget bar
  and per-stat caps react correctly; confirm import button states (no session / one
  character / multiple characters) render correctly; confirm solver results still
  match hand-computed expectations for a case with a nonzero fragment bonus.
