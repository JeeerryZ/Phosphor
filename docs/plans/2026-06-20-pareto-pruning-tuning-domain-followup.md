# Follow-up: Pareto pruning isn't tuning-domain-aware

**Status:** Known limitation, not yet scheduled. Filed alongside
`2026-06-20-legendary-tuning-fixed-stat-design.md` (the fix this follow-up was discovered
during review of).

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

Before scheduling a fix, validate real-world impact: construct a test with two legendary
candidates in the same slot that have identical base stats but different
`legendaryTuningIncreaseStat` values, confirm whether `selectItemCombinations` actually
drops one of them today, and assess whether the lost combo would have produced a
meaningfully better result. If the impact is negligible in practice (e.g. because items with
truly identical stat rolls but different tuning-favored stats are rare in a typical vault),
this may not be worth the complexity of fixing. If it's not negligible, brainstorm a design
for incorporating tuning domain into the pruning key before implementing.
