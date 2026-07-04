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

## Part A — UE4SS → generate `Mappings.usmap`

Palworld is Unreal Engine **5.1**. You need a UE4SS build that supports UE5.1 (any recent
RE-UE4SS release does).

1. **Download UE4SS.** Grab the latest **Standard** zip from
   <https://github.com/UE4SS-RE/RE-UE4SS/releases> (the normal one, not the `_dev`/debug build).
2. **Install it.** Extract the zip's contents directly into:
   `...\Palworld\Pal\Binaries\Win64\`
   You should end up with `dwmapi.dll`, `UE4SS.dll`, `UE4SS-settings.ini`, and a `Mods\` folder
   sitting next to `Palworld-Win64-Shipping.exe`.
3. **Enable the debug console.** Open `UE4SS-settings.ini`, find the `[Debug]` section, and set:
   ```ini
   ConsoleEnabled = 1
   GuiConsoleEnabled = 1
   GuiConsoleVisible = 1
   ```
4. **Launch Palworld (offline).** A separate **UE4SS debug console** window opens alongside the
   game. If it doesn't, UE4SS didn't attach — see Troubleshooting (this is the #1 patch-day risk,
   good to shake out now).
5. **Dump the mappings.** In the UE4SS console window, open the **`Dumpers`** tab and click
   **`Generate .usmap file`** (a.k.a. "Dump Mappings"). It writes **`Mappings.usmap`** — usually
   into the game root or the `Win64` folder. Search the game folder for `Mappings.usmap` to find it.

You can now close the game. That `.usmap` is build-specific — regenerate it after every patch.

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

## Part C — hand it to me

Drop the exported JSON somewhere in the repo (e.g. `src/pipeline/raw/`) or just tell me the path.
I'll write/run the normalizer to map it into `dataset.0.6.json`, flip `meta.provisional` to
`false`, and the schema validator will enforce that every species now has a real `rank` and
`genderRatio`. If anything's missing, the validator tells us exactly what.

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
