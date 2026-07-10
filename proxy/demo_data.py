"""Canned data for demo mode (no PalDefender required) — shaped exactly like the
documented PalDefender REST API responses (see ../docs/PalDefenderAPI/*.md), so the app's real
HTTP data source (src/live/dataSource.ts) exercises the actual wire format, not a stand-in.

Uses real species/passive internal names from the bundled PalCalc dataset (Anubis,
GoldenHorse, Boar, ElecLion, Carbunclo, CraftSpeed_up*, Deffence_up*) so pals resolve
cleanly if the real app points at this demo proxy — mirrors src/live/fixtures.ts, though
the two aren't required to be identical.

Player names/ids below are made up, not tied to any real player or SteamID64.

`UserId` is set equal to `PlayerUID` for every demo player so lookups by either identifier
work — real PalDefender data may not have this property (see src/live/types.ts's
PlayerIdentifier note on the still-unverified UserId format).
"""

from __future__ import annotations

ZERO_LOCATION = {"x": 0.0, "y": 0.0, "z": 0.0}


def _pal(pal_id: str, gender: str, **overrides: object) -> dict:
    base = {
        "PalID": pal_id,
        "Nickname": "",
        "Gender": gender,
        "Level": 10,
        "Shiny": False,
        "Passives": [],
        "IVs": {"Health": 60, "AttackMelee": 60, "AttackShot": 60, "Defense": 60},
    }
    base.update(overrides)
    return base


def _player(uid: str, name: str, guild: str = "The Guild", status: str = "Online") -> dict:
    return {
        "Name": name,
        "IP": "",
        "PlayerUID": uid,
        "UserId": uid,
        "GuildName": guild,
        "GuildUUID": "",
        "Status": status,
        "WorldLocation": ZERO_LOCATION,
        "MapLocation": ZERO_LOCATION,
    }


NOVA_UID = "76561198000000001"
EMBER_UID = "76561198000000002"
QUILL_UID = "76561198000000003"

DEMO_PLAYERS: list[dict] = [
    _player(NOVA_UID, "NovaIngame"),
    _player(EMBER_UID, "Ember"),
    _player(QUILL_UID, "Quill", status="Offline"),
]

DEMO_PALS_BY_IDENTIFIER: dict[str, dict] = {
    NOVA_UID: {
        "Meta": {"PlayerUID": NOVA_UID, "Player": NOVA_UID, "TeamCount": 1, "PalboxCount": 1, "BaseCampCount": 1},
        "Pals": {
            "Team": {"t1": _pal("Anubis", "Male", Level=50, Passives=["CraftSpeed_up3", "Deffence_up2"])},
            "Palbox": {"p1": _pal("GoldenHorse", "Female", Level=20, Passives=["CraftSpeed_up1"])},
            "BaseCamps": [
                {"id": "camp-1", "level": 3, "state": "Active", "pals": {"bc1": _pal("Boar", "Male", Level=15)}},
            ],
        },
    },
    EMBER_UID: {
        "Meta": {"PlayerUID": EMBER_UID, "Player": EMBER_UID, "TeamCount": 1, "PalboxCount": 0, "BaseCampCount": 0},
        "Pals": {
            "Team": {"t1": _pal("ElecLion", "Female", Level=35, Passives=["Deffence_up3"])},
            "Palbox": {},
            "BaseCamps": [],
        },
    },
    QUILL_UID: {
        "Meta": {"PlayerUID": QUILL_UID, "Player": QUILL_UID, "TeamCount": 1, "PalboxCount": 0, "BaseCampCount": 0},
        "Pals": {
            "Team": {"t1": _pal("Carbunclo", "male", Level=25, Passives=["CraftSpeed_up2"])},
            "Palbox": {},
            "BaseCamps": [],
        },
    },
}


def find_player(identifier: str) -> dict | None:
    return next((p for p in DEMO_PLAYERS if p["PlayerUID"] == identifier or p["UserId"] == identifier), None)
