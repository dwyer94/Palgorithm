# UI Requirements — Live Additions

Running scratchpad of concrete UI elements we need, added to as we design each piece.
Not a spec — once an area is stable, promote it into `PALWORLD_BREEDING_OPTIMIZER_SPEC.md`
proper. Until then, this is the source of truth for "what needs a screen/control."

Baseline (session 0.5, unstyled, functional): `RosterView`, `SingleTargetView`, `HubView`,
`ForwardCalculatorView`, `ReverseLookupView`, `SettingsView`.

---

## Feature: Live server connection (PalDefender via proxy)

Context: a self-hosted Python proxy mirrors the real PalDefender REST API 1:1
(confirmed against `PalDefenderAPI/*.md`: `GET /v1/pdapi/players`,
`GET /v1/pdapi/pals/<player_identifier>`, `GET /v1/pdapi/player/<player_identifier>`,
bearer-token auth, permission-gated), reachable over Tailscale. No mutation endpoints are
exposed, so every connected user (you + friends, all via Tailscale) gets full read access
to every player's pals — there is no per-friend `/mypals` scoping to build. See
`docs/SETUP_admin_runbook.md` / `docs/SETUP_friends_guide.md` for the server-side half of
this (note: those docs still describe the old assumed endpoint paths and the dropped
`/mypals` flow — hold off updating them until pieces 1 and 2 are done, per plan).

**Real response shapes to design the adapter against** (source: `PalDefenderAPI/*.md`,
official docs at https://ultimeit.github.io/PalDefender/RESTAPI/):
- `/players` returns `{ Meta: { PlayerCount, OnlineCount }, Players: [{ Name, IP,
  PlayerUID, UserId, GuildName, GuildUUID, Status, WorldLocation, MapLocation }] }`.
  `UserId` is "platform user ID, or empty string when unavailable" — NOT guaranteed to be
  populated or in any particular format; `PlayerUID` (Palworld's own save-data ID) is the
  more reliable identifier and may be what we actually key on. **VERIFY** `UserId`'s exact
  format (raw SteamID64? prefixed?) once PalDefender is live.
- `/pals/<player_identifier>` (identifier = `UserId` or `PlayerUID`) returns
  `{ Meta: {...}, Pals: { Team: {...byInstanceId}, Palbox: {...byInstanceId}, BaseCamps:
  [{ id, level, state, pals: {...byInstanceId} }] } }` — pals are objects keyed by
  instance ID across three locations, not a flat array. The normalizer must flatten
  Team + Palbox + all BaseCamps[].pals into one list, tagging each with its source
  location (team/palbox/base camp + which camp).
- Pal object fields of interest: `PalID` (species identifier, resolve against
  `Species.internalName`/`aliases` in the dataset — same "match across sources" seam the
  schema already anticipates), `Gender` (string, exact casing/format **VERIFY**, normalize
  to our lowercase `male`/`female`), `Passives` (`string[]` of passive IDs, resolve
  against the dataset's passive catalog), `IVs: { Health, AttackMelee, AttackShot,
  Defense }` (not a single generic IV — four named stats), plus `Level`, `Nickname`,
  `Shiny`, etc. that aren't breeding-relevant but are reasonable to surface in the UI.

### Settings additions (`SettingsView`)

- [ ] **Proxy connection config**
  - Base URL field (the tailnet HTTPS address, e.g. `https://palworld-server.tailnetname.ts.net`)
  - Optional bearer token field (only if the proxy ends up requiring one — TBD against
    the proxy's actual auth story; may be unnecessary since Tailscale is the access gate)
  - "Test connection" action -> hits a health/`/players` check, shows success/error inline
- [ ] **Refresh policy**
  - Toggle: manual refresh only vs. auto-poll on an interval
  - Interval control (seconds/minutes), only enabled when auto-poll is on
  - Sensible default: manual-only until proven stable, matches "on demand or configurable
    interval" from the original ask
- [ ] **Display name resolution — API name first, manual override second**
  - Discovery: PalDefender's `/players` already returns a `Name` field ("current or saved
    player name") for free — no mapping needed for the common case. Display name
    resolution order: manual override (if set) -> API `Name` (if non-empty) -> raw
    identifier (`PlayerUID`/`UserId`) as last resort.
  - The manual mapping table still exists but is now explicitly an **override**, not the
    primary path — for cases where the in-game `Name` is blank, a placeholder, or the
    user just prefers a different label. Keyed on whatever stable identifier the pal data
    is keyed on (`PlayerUID`, pending the `UserId` format verification above).
  - Table UI: rows of (identifier, override display name), add/edit/delete
  - Should support setting an override inline from the player list too (see below) —
    not just from Settings — so you're not round-tripping to Settings mid-browse
  - Persisted in `localStorage` alongside existing `Settings` (new store shape TBD)

### New view: Server Pals / Live Roster browser

- [ ] Player list: one row per entry returned by `/players`, showing resolved display
  name (override -> API `Name` -> raw identifier, per resolution order above) with an
  affordance to set/edit an override right there
- [ ] Per-player pal list: expand/select a player -> fetch and show their pals
      (species, gender, passives, IVs/talents — matches existing `RosterEntry`-ish shape
      once normalized)
- [ ] Connection/loading/error states: not connected (no config set), connecting,
      connected + last-refreshed timestamp, error (proxy unreachable, timeout, bad
      response) with a retry action
- [ ] Manual refresh control (button), plus auto-poll countdown/indicator if enabled

### Planner integration (affects `SingleTargetView`, `HubView`, and any "available pals"
input)

- [ ] Decision: fetched server pals are a **separate, read-only, owner-tagged pool** —
  never merged/imported into the persisted local `RosterEntry[]` roster. Functionally
  they behave the same as roster pals to the solver; they're just sourced differently
  and not saved to `localStorage`.
- [ ] Planner views need a way to pick **which pools feed the search**: local roster
  (always available) plus a multi-select of connected players' live pals (checkbox per
  player, "select all / none" convenience)
- [ ] Results/plan display should indicate provenance when a suggested parent comes from
  a specific player's box (e.g. a small "owned by {name}" tag), since the user acting on
  the plan needs to know whose pal to actually use/trade for

### Seed data for the display name override mapping

Known server roster today (from the admin), given as SteamID64 -> preferred name. Since
API `Name` is now the primary source and this is only a fallback/override, this seed data
matters less than before — but keep it as the starting content for the override table in
case in-game names differ from these. **Note:** these are SteamID64s; the override table
may end up keyed on `PlayerUID` instead once the real `/players` response is inspected
(see VERIFY note above) — re-key if so.

| SteamID64 | Display name |
|---|---|
| 76561198106031331 | Kit |
| 76561198061667425 | InputComet |
| 76561198146926388 | D-Wire |
| 76561198140338260 | Capn' Crain |
| 76561198053299466 | ScootScoot |
| 76561198253583281 | Kris |
| 76561198131149693 | Canter |
| 76561198074507245 | Wiggum |

### Explicitly out of scope for this feature (per decisions made)

- No `/mypals` identity-scoped endpoint — full read access for anyone on the tailnet
- No live Steam Web API integration — manual name mapping only
- No write/mutation endpoints of any kind
