# Extraction run-notes (session 0.6, pulled forward)

Goal: produce raw JSON from the game files that the `/pipeline` normalizer turns into
`dataset.0.6.json`. You do the game-side steps (Parts A–B); hand me the JSON and I run the
normalizer (Part C).

> **Safety:** do all of this in **offline / single-player only**. Never run the game online
> with UE4SS attached. Nothing here modifies your save; UE4SS is a read-only debug attach.

Install path detected on this machine:
`C:\Program Files (x86)\Steam\steamapps\common\Palworld`
Pak: `Pal\Content\Paks\Pal-Windows.pak` (no AES key needed — the mappings file is the only blocker).

---

## Part A — get `Mappings.usmap`

The usmap is a **build-specific decoding key**, not game data. **Source it, don't generate it** —
UE4SS's usmap generator is documented as memory-hungry and unstable, and it crashed on our current
build (RE-UE4SS issues #804/#925/#1122; our log died at "Attempting to dump mappings..."). Sourcing
a build-matched usmap and using it to decode *our own* pak is still our own extraction of the data.

### Where to get a usmap (fast — incl. patch day)

Ranked by speed/reliability. Palworld's pak needs **no AES key**, so the usmap is the only key.

1. **Primary (rolling, per-patch):** [PalworldModding/UsefulFiles → `Mappings.usmap`](https://github.com/PalworldModding/UsefulFiles/blob/master/Mappings.usmap)
   — the pwmodding.wiki's official source, updated per patch. Raw:
   `https://raw.githubusercontent.com/PalworldModding/UsefulFiles/master/Mappings.usmap`
2. **Version-pinned backup:** [TheNaeem/Unreal-Mappings-Archive → `Palworld/<version>/`](https://github.com/TheNaeem/Unreal-Mappings-Archive/tree/main/Palworld)
   — curated, matched to game version (currently up to 0.6.6). Slower to update (curates eventually).
3. **Fastest same-day drops:** the **Palworld Modding Discord** (linked from <https://pwmodding.wiki>).
   On a major patch, dataminers post a fresh usmap here first — usually within hours.
4. ~~elliotks/Palworld-FModel~~ — **dead** (last updated May 2024, stops at v0.2.4.0). Do not use.

**Patch-day (July 10) plan:** watch source #1 and the Discord (#3); a 1.0 usmap typically appears
within hours–a day. Our decode→normalize→schema→diff pipeline is instant and ours, so once a usmap
lands we turn it around immediately. Verify any usmap by loading it in FModel and confirming
`DT_PalMonsterParameter` decodes cleanly (garbled/empty = wrong build → try another source).

**Already fetched for the current build:** `src/pipeline/mappings/Mappings.0.6.6.usmap`
(from source #2, valid `0x30C4` magic, 2.15 MB). Use this for Part B now.

### Fallback / insurance — generate it ourselves

Only if no community usmap exists (true independence). Generation is unreliable but the one
untried lever is **dumping at the main menu** (before loading a save), with several GB of free RAM
— the generator is memory-hungry and is documented to crash if you load past the main menu after
dumping. Steps: install UE4SS (experimental) into `...\Pal\Binaries\Win64\`, set
`GuiConsoleEnabled = 1`, launch offline, and at the **main menu** use the `Dumpers` tab →
`Generate .usmap file` (or the `DumpUSMAP()` Lua function — same code path). Confirm UE4SS attaches
first (it does on this build); a non-attaching UE4SS on the 1.0 build is the real patch-day risk to
check on the 10th.

---

## Part B — extract the DataTables → JSON

Use **FModel** (reliable GUI; recommended) — or the CLI alternative below if you'd rather I drive it.

**FModel:**
1. Install from <https://fmodel.app>.
2. Point it at the Paks directory: `...\Palworld\Pal\Content\Paks`.
3. Set the UE version to **`GAME_UE5_1`** (Directory → Game → UE Versions).
4. Load the mappings: **Settings → General → Local Mapping File** → select your `Mappings.usmap`.
5. Search assets (Ctrl+F) and **export as JSON** these tables (right-click → *Save Properties (.json)*):
   - **`DT_PalMonsterParameter`** — the big one: CombiRank (breeding rank), element types,
     gender ratio, rarity, paldex index, base stats.
   - **`DT_PalNameText`** — internal id → display name.
   - Any **`DT_*Combi*` / breeding** table (e.g. unique/special combos) you can find.
   - If unsure which is which, just export the whole `Pal/Content/Pal/DataTable/` tree — I'll
     pick out what I need in the normalizer. **Exact field names don't matter** to you; I map them.

**CLI alternative (I can drive this):** the spec names `PalworldDataExtractor`
(reference: <https://github.com/PalworldDataTools/PalworldDataExtractor> — verify the exact repo).
If you'd prefer this route, install it and I'll run it against the pak + `.usmap`.

---

## Part C — normalization (DONE for 0.6)

Run: `npm run data:normalize` → reads the FModel export, writes `src/data/dataset.0.6.json`,
self-validates against `DatasetSchema` before writing. Source lives in
[`normalize.ts`](normalize.ts). Loader-gate test: `test/dataset.0.6.test.ts`.

### Inputs actually used (0.6, build 22461598)

Exported to `Output/Exports/Pal/Content/` (the default `--in` root):

- `Pal/DataTable/Character/DT_PalMonsterParameter.json` — 663 rows; ranks, gender, elements, flags.
- `Pal/DataTable/Character/DT_PalCombiUnique.json` — 213 special-combo overrides.
- `L10N/en/Pal/DataTable/Text/DT_PalNameText_Common.json` — **English** names. The default
  `DT_PalNameText` decodes to **Japanese** (Palworld's base text is authored in JP); export the
  `L10N/en` copy for player-facing names. `OverrideNameTextID`, else `PAL_NAME_<CharacterID>`.

### Result: 223 species, 144 special combos (2 gender-dependent)

### Classification decisions (the export is a dev build — this is the judgement)

The 663 rows include far more than the released roster. Rules applied, in order:

1. **Drop admin/duplicate rows** — `BOSS_`/`Boss_`/`RAID_`/`GYM_`/`PREDATOR_`/`SUMMON_`/`Quest_`
   prefixes and `*_Oilrig` / `Yakushima*` field-boss variants. These are combat-stat clones of a
   base tribe, not distinct Pals.
2. **Release gate = "has a resolvable English name."** Released Pals have a localized name; ~60
   unreleased Feybreak stubs (CombiRank 0, ZukanIndex −1) and cut variant forms (`Kirin_Ice`,
   `WindChimes`/`WindChimes_Ice`, …) have **none in either JP or EN** → excluded. This is a
   game-authoritative gate, not a hand-maintained skip list. It keeps the *real* special-combo
   variant children (Pengullet Lux, Azurobe Cryst, Dumud Gild, …) which do have names.
3. **`standardBreedable = !IgnoreCombi`.** `IgnoreCombi` is the game's own "excluded from the
   standard combination formula" flag. Special-combo-only variants and legendaries (Hartalis)
   carry it → `standardBreedable:false`, `otherObtainOnly:true`, but they stay valid parents and
   are still produced via `specialCombos`.
4. **Special-combo parent resolution.** `DT_PalCombiUnique` names parents by **tribe** (sometimes a
   numeric enum the usmap couldn't name, e.g. `262`, and with casing quirks like `Blueplatypus` vs
   `BluePlatypus`) and children by **CharacterID**. Resolved tribe→species case-insensitively via
   the monster table's own `Tribe` field. **69 combos referencing excluded/unreleased species were
   dropped** (future Feybreak content: ElecLion, GrassDragon, …). Referential integrity is enforced
   by the schema, so a bad resolution fails the build, not silently.
5. **Gender-dependent combos** (spec invariant #2): the CatMage+FoxMage pair yields a different
   child by which parent is female. Encoded as **two** `SpecialCombo` entries, each with
   `genderRule.femaleParent` → its child. The ruleset (0.2) resolves this to a distribution.

### Element enum map

`Normal→Neutral`, `Leaf→Grass`, `Earth→Ground`, `Electricity→Electric`; Fire/Water/Ice/Dark/Dragon
pass through. All 9 game elements map onto the schema's closed set.

### Known gaps / provisional (flagged, not silent)

- **`wildCatchable` is an approximation** (`= standardBreedable`). No spawner tables were exported;
  refine from `DT_PalSpawner*` later. Special-only variants and legendaries → not catchable.
- **`passives: []` and `passiveModel.verified:false`.** Passive skills (`DT_PalPassiveSkill*`) were
  not extracted in 0.1; the inheritance odds are placeholder estimates (spec §3.3) — the UI must
  present them as provisional. Do not treat as ground truth.

### Patch-day (July 10) replay

Re-export the same three tables from the 1.0 pak with a 1.0 usmap, then `npm run data:normalize
--out src/data/dataset.1.0.json`. Re-check the classification rules above against 1.0 — Genetic
Recombination may change `IgnoreCombi` semantics and the special-combo table shape. The self-
validation + loader test catch structural breakage immediately.

---

## Troubleshooting

- **No UE4SS console window / game crashes on launch:** UE4SS didn't attach — most likely a
  UE-version/build mismatch. Try the latest release, and check the RE-UE4SS "compatibility"
  notes and the UE4SS log (`...\Win64\UE4SS.log`). This is exactly the patch-day risk we wanted
  to surface early.
- **`Mappings.usmap` not produced:** confirm `GuiConsoleEnabled = 1`, and that you clicked the
  Dumpers-tab button (not just opened the tab). Search the whole game folder for the file.
- **FModel shows garbled/empty properties:** the mapping file isn't loaded or the UE version is
  wrong. Re-check steps B3–B4.
- **Anti-cheat / online prompt:** you're not offline. Close, go single-player, retry.
