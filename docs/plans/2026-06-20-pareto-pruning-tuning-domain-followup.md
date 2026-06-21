# Follow-up: Pareto pruning isn't tuning-domain-aware

**Status:** Confirmed via characterization test (`src/lib/optimizer/combine.test.ts`,
`"[characterization] collapses two same-stat candidates with different allowedIncreaseStats
to one"`), not yet scheduled. Filed alongside `2026-06-20-legendary-tuning-fixed-stat-design.md`
(the fix this follow-up was discovered during review of).

## Confirmed finding (2026-06-21)

Built two `SlotCandidate`s for the same slot with **identical accumulated stats** but
different `allowedIncreaseStats` (`["discipline"]` vs. `["resilience"]`), ran them through
`selectItemCombinations`, and inspected the `tunedCount=1` bucket: **only one survives**.

The collapse happens immediately, at the very first slot fold — not as a rare aggregate
coincidence after combining all 5 slots. `dedupeByStats` runs after *every* slot is folded
in (`selectItemCombinations`'s loop calls `paretoFrontier(dedupeByStats(combos))` once per
slot), and since both candidates have `tunedCount=1` and an identical `vectorKey(stats)` the
moment the helmet slot alone is processed, the second one is discarded right there —
*before* the other 4 slots are even considered. The survivor is whichever candidate appears
first in that slot's candidate list (`dedupeByStats`'s documented first-occurrence-wins
behavior).

**Practical implication:** this isn't a rare "two combos happen to sum to the same total"
edge case — it triggers on *any* two same-stat-roll legendary items in the same slot with
different fixed tuning stats, which is plausible in a real vault (duplicate stat rolls on
legendary armor are common, especially after enough farming). The real-world impact depends
on how often a player's actual vault contains such near-duplicate pairs in the same slot and
whether the discarded one would have reached a better tuned result than the survivor — that
part still isn't measured (would require real profile data, not synthetic test fixtures).

## The gap

`selectItemCombinations` (`src/lib/optimizer/combine.ts`) Pareto-prunes and dedups
`ItemCombination`s within each `tunedCount` bucket using `paretoFrontier`/`dedupeByStats`
(`src/lib/optimizer/pareto.ts` / `vectors.ts`), comparing **only the accumulated `stats`
vector**.

Before the legendary-fixed-tuning-stat fix, this was sound: every tuned slot had an
identical domain (any of the 6 stats), so two combos with equal stats and equal
`tunedCount` really were interchangeable for the purposes of `enumerateBoostCombinations`'s
downstream search — any boost assignment valid for one was valid for the other.

Now that `SlotCandidate.allowedIncreaseStats` can differ per item (a legendary piece
restricted to one fixed stat vs. another legendary piece restricted to a different one,
or an exotic with all 6), two combos can have **identical accumulated stats** but
**different per-slot tuning domains** — and the pruning step has no way to see that
difference. It's possible for a combo to be discarded (as "dominated" or as a duplicate by
stats) in favor of a survivor whose tuning domains can't reach as good a final result after
`enumerateBoostCombinations` + the greedy decrease-stat assignment runs.

This is **not** the bug that prompted the legendary-tuning fix (wrong stat being increased)
— that bug is fixed and verified. This is a separate, rarer correctness gap in the search's
pruning soundness that the fix's new per-item domains exposed.

## Why not fixed immediately

Fixing this properly means rethinking what "dominance" means once "what's achievable beyond
these stats" depends on more than the stats themselves. That's a real design question (does
the dedup/dominance key need to incorporate `allowedIncreaseStats` per slot? does pruning
need to happen after the domain is known rather than before? what's the performance impact
of carrying richer state through the fold in `selectItemCombinations`?) — not a one-line fix,
and not in scope for the bug that was actually reported.

## Suggested next step

The mechanism is now confirmed (see above) — what's still unmeasured is real-world
frequency and impact: how often do actual player vaults contain same-slot legendary pairs
with matching stat rolls but different fixed tuning stats, and when they do, does the
discarded combo actually reach a meaningfully better tuned result than the survivor? That
requires real profile data, not synthetic fixtures — e.g. instrumenting `buildCandidatesBySlot`
or `selectItemCombinations` temporarily to log collision counts against a real vault, or
asking a few players to report on a sample of their own armor. If frequency/impact turns out
to be negligible, this may not be worth the complexity of fixing. If not, brainstorm a design
for incorporating tuning domain into the pruning key before implementing.
