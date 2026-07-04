# /data

`dataset.<version>.json` (bundled static asset) + the loader. Schema lives in §6 of the
spec; loader/validator land in session 0.1. All game data (ranks, special combos,
three-way reachability, passive-inheritance odds) is loaded from here — never hardcoded
(CLAUDE.md invariant 3).
