# Handoff — Session 0.1 (Project scaffold + schema + dataset bootstrap)

_Last updated: 2026-07-04 (extraction + normalization done). Read this to resume cold._

## TL;DR — where we are

**0.1 is essentially complete.** FModel export ran cleanly against `Mappings.0.6.6.usmap`, the
normalizer is written, and `dataset.0.6.json` is generated + validated + tested.

- Extract lives in `Output/Exports/Pal/Content/` (untracked). Three tables used:
  `DT_PalMonsterParameter`, `DT_PalCombiUnique`, and the **English** `L10N/en/.../DT_PalNameText_Common`.
- `src/pipeline/normalize.ts` → `npm run data:normalize` → `src/data/dataset.0.6.json`
  (**223 species, 144 special combos, 2 gender-dependent**; `meta.provisional:false`).
- All decisions/classification rules documented in
  [src/pipeline/EXTRACTION.md](src/pipeline/EXTRACTION.md) → "Part C".
- Green: `npm run build` ✓, `npm run lint` ✓, `npm test` ✓ (14 tests, incl.
  `test/dataset.0.6.test.ts` — the loader-gate for the real dataset).

**Only remaining 0.1 item:** vendor the oracle fixture for 0.2 (item 4 below). Then → Session 0.2.

---

## Decisions locked this session (with why)

- **Spec is source of truth; fixed 5 correctness issues in it** (see git history / spec §3.2, §7.1–7.3,
  §4.2): unsafe rarest-parent pruning → sound pruning; Knuth–Dijkstra exactness caveat (heuristic,
  not proven optimum); gender-dependent specials → `forward()` takes optional genders + distribution;
  three-way reachability; provisional passive-odds. Also reframed the **hub** as an *optional* perk-carrier
  overlay (final-cross injection), not a mandatory routing point.
- **Schema/validation tooling: Zod** (single source of truth — TS types via `z.infer` + runtime
  validation, no drift, no codegen).
- **Package manager: npm. Tailwind: v3.** Node 25 / npm 11 on this machine.
- **Data source: community bootstrap + oracle** — but **schema is defined by app needs, NOT by any
  source** (see memory `data-sources-are-swappable-standins`). All source parsing is quarantined in
  the `/pipeline` normalizer.
- **Extraction strategy: own the pipeline, source the usmap.** UE4SS's usmap *generator* crashes on
  this build (known issue, unreliable even for the community). A usmap is just a decoding key, so we
  source a build-matched one and run our own decode→normalize→schema→diff pipeline. See memory
  `extraction-purpose-is-patch-day`: the pipeline exists for **fast 1.0 data on July 10**, so keep
  self-generation as insurance but don't gate on it.

## Done

**Committed** (`f9538a6`, `00851ce`):
- Full Vite + React 18 + TS (strict) + Tailwind v3 scaffold; Vitest, ESLint 9 (flat), Prettier;
  `/src` skeleton (data, ruleset, solver, store, ui, pipeline) + `/test`, each README'd to its spec
  section. Scripts: `npm run dev|build|test|lint`. `git init` done.
- **`src/data/schema.ts`** — source-agnostic Zod schema. Key feature: **provisional→final contract**
  (`rank`/`genderRatio` may be null while `meta.provisional: true`; enforced non-null once a dataset
  declares itself final — this is the gate our extraction output must pass). Three-way reachability,
  gender ratios, provisioned optional fields (icon/rarity/workSuitabilities/baseStats/…),
  `verified:false` passiveModel.
- **`src/data/loader.ts`** — validating loader (`parseDataset`/`safeParseDataset`/`formatIssues`).
- **7 passing tests** (`test/loader.test.ts` + `test/smoke.test.ts`), incl. provisional/final contract
  + referential integrity. Fixture: `test/fixtures/dataset.sample.json`.
- **`src/pipeline/EXTRACTION.md`** — extraction run-notes (0.6 pulled forward).

**Uncommitted working tree** (commit when ready):
- `src/pipeline/EXTRACTION.md` (modified) — rewrote Part A to "source the usmap" + patch-day sources.
- `src/pipeline/mappings/Mappings.0.6.6.usmap` (new, ~2.15 MB) — build-matched usmap, verified valid.
  _Decide whether to commit this community binary or gitignore it._

## Remaining for session 0.1

1. ~~Run FModel export~~ ✅ Done — clean decode, English names re-exported from `L10N/en`.
2. ~~Write the `/pipeline` normalizer~~ ✅ Done — `src/pipeline/normalize.ts`. `standardBreedable`
   derived from the game's own `IgnoreCombi` flag (not a computed child-set — we don't have the
   full CombiRank matrix yet; that's the 0.2 ruleset's job). CombiRank→`rank`,
   MaleProbability→`genderRatio`, elements mapped, sequential game-file `index`.
   `meta.provisional:false` — validator enforces every species has real rank + genderRatio.
3. ~~Commit `dataset.0.6.json` + normalizer; loader validates it~~ ✅ Generated + tested
   (`test/dataset.0.6.test.ts`). **Not yet committed** — commit when ready (see below).
4. ~~Vendor the oracle fixture~~ ✅ Done — `test/oracle/` (beckerfelipee `AllCombos.csv` +
   `Pals.csv` + MIT `LICENSE.beckerfelipee`, MIT). Symmetric 138×138 name-keyed child matrix;
   lookup semantics + 0.2 caveats in [test/oracle/README.md](test/oracle/README.md). Quarantined —
   oracle only, never loaded by the app.

**Committed:** `Output/` (raw export) is now tracked so the normalizer re-runs from a clean checkout;
`FModel.exe` is gitignored.

**0.1 is closed.** → **Session 0.2** (BreedingRuleset interface + `combirank-0.6` impl). Start there:
implement `forward()`/`reverse()` behind the ruleset interface, then wire the `test/oracle` matrix
into the ruleset-vs-oracle harness (spec §11) and keep it green.

## Patch-day usmap sources (for July 10)
1. Rolling/primary: `PalworldModding/UsefulFiles/Mappings.usmap`
2. Version-pinned: `TheNaeem/Unreal-Mappings-Archive/Palworld/<version>/`
3. Fastest same-day: Palworld Modding Discord (via pwmodding.wiki)
4. Dead — do not use: elliotks/Palworld-FModel (stopped v0.2.4.0)

## Guardrails (don't violate — see CLAUDE.md + memory/)
- Breeding rules only behind `BreedingRuleset`; all game data from the dataset JSON.
- Solver consumes edge outcomes as a **distribution**, never assumes one deterministic child.
- Objective = fewest **distinct** breeding combinations (shared intermediates counted once).
- Don't let any community dump's shape/gaps drive the schema; quarantine source parsing in `/pipeline`.
- Phase 0 UI is functional + unstyled (design is session 0.D).

## Verify anytime
`npm run build` · `npm run lint` · `npm test` (all currently green: build ✓, lint ✓, 7 tests ✓).
Local Palworld build id: `22461598` (path: `C:\Program Files (x86)\Steam\steamapps\common\Palworld`).
