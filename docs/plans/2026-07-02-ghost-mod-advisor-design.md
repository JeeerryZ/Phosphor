# Ghost Mod Advisor — Design Doc

**Date:** 2026-07-02  
**Status:** Approved

## Problem

Players farming Destiny 2 armor can equip a ghost armor mod that focuses dropped armor toward two specific stats (30+25 split, randomized per drop) plus a player-chosen third stat (+20). Given a target stat distribution across the 6 armor stats, it's non-obvious which combination of ghost mods to use across 5 armor pieces.

## Goal

A standalone unauthenticated page at `/ghost-mods` that takes target stat totals as input and outputs which ghost mods to farm with (and how many of each), along with which third stat to pick per mod and a debug breakdown of the math.

## Ghost Mod Data

12 mods, each covering a unique pair of the 6 stats. All share the same structure:
- Focused stat A: 27.5 avg (30 or 25, randomized per drop)
- Focused stat B: 27.5 avg (the other of 30/25)
- Third stat (player-chosen): +20

| Mod | Stat A | Stat B |
|---|---|---|
| Siegebreaker | Health (resilience) | Grenade (discipline) |
| Bulwark | Health (resilience) | Class (recovery) |
| Brawler | Melee (strength) | Health (resilience) |
| Skirmisher | Melee (strength) | Weapon (mobility) |
| Grenadier | Grenade (discipline) | Super (intellect) |
| Demolitionist | Grenade (discipline) | Class (recovery) |
| Colossus | Super (intellect) | Health (resilience) |
| Paragon | Super (intellect) | Melee (strength) |
| Reaver | Class (recovery) | Melee (strength) |
| Specialist | Class (recovery) | Weapon (mobility) |
| Gunner | Weapon (mobility) | Grenade (discipline) |
| Powerhouse | Weapon (mobility) | Super (intellect) |

In-game stat names map to codebase names: Weapon→mobility, Health→resilience, Class→recovery, Grenade→discipline, Super→intellect, Melee→strength.

## Solver Algorithm

Enumerate all multisets of 5 mods from 12 (C(16,5) = 4,368 combinations), and for each try all 4^5 = 1,024 third-stat choices (~4.5M total evaluations, client-side JS). Score each assignment by sum of squared deficits vs target — overshoot carries zero penalty, undershoot is penalized. Return top 5 results.

**Expected value assumption:** since the 30/25 split randomizes per drop, the solver uses 27.5 for each focused stat.

## Page Layout (`/ghost-mods`)

1. **Target Stats** — 6 labeled number inputs (Weapon, Health, Class, Grenade, Super, Melee)
2. **Options** — Masterwork toggle (+10 total, +2 per piece), Stat Mods toggle (6 inputs for +10 mod counts per stat)
3. **Solve button** — runs solver synchronously in-browser
4. **Results** — top 5 ranked combinations, each showing:
   - Mod counts (e.g. "2× Powerhouse, 2× Bulwark, 1× Paragon")
   - Third stat to pick per mod
   - Projected stat totals vs targets
5. **Debug section** (collapsible, open by default) — table: per-mod stat contribution, cumulative running total, gap to target per stat

## Navigation

- Link to `/ghost-mods` from the main optimizer header
- "← Back to Optimizer" link on the ghost mods page

## Out of Scope

- Authentication / live inventory integration (Phase 2)
- T5 stat tuning (orthogonal tool)
- Per-slot (helmet/gauntlet/etc.) assignment — output is counts only
