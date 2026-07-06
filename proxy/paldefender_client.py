"""The swappable seam between this proxy and where pal data actually comes from — a real
PalDefender REST API (`RealPalDefenderClient`) or in-memory demo data (`DemoPalDefenderClient`),
mirroring the mock/real split in src/live/dataSource.ts on the app side. `app.py` only talks
to the `PalDefenderClient` protocol and forwards whatever dict comes back verbatim, so the
proxy stays a thin, honest 1:1 mirror of PalDefender's actual response shapes.
"""

from __future__ import annotations

from typing import Protocol

import httpx

from demo_data import DEMO_PALS_BY_IDENTIFIER, DEMO_PLAYERS, find_player


class PalDefenderError(Exception):
    """Carries enough to reproduce PalDefender's own `{Error: {Code, Message, Details}}`
    error shape (see ../PalDefenderAPI/*.md) so callers of this proxy see the same contract
    whether the error originated at PalDefender or at the proxy itself (e.g. upstream
    unreachable)."""

    def __init__(self, status_code: int, code: str, message: str, details: object | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details if details is not None else {}

    def to_body(self) -> dict:
        return {"Error": {"Code": self.code, "Message": self.message, "Details": self.details}}


class PalDefenderClient(Protocol):
    async def get_players(self) -> dict: ...
    async def get_player(self, identifier: str) -> dict: ...
    async def get_pals(self, identifier: str) -> dict: ...


class RealPalDefenderClient:
    """Forwards to a real PalDefender REST API over HTTP, holding the bearer token so it
    never has to leave this process (see docs/SETUP_admin_runbook.md's security checklist).
    Accepts an injectable `httpx.AsyncClient` for testing against a mock transport."""

    def __init__(self, base_url: str, token: str, client: httpx.AsyncClient | None = None, timeout: float = 8.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._timeout = timeout
        self._client = client or httpx.AsyncClient()

    async def _get(self, path: str) -> dict:
        headers = {"Authorization": f"Bearer {self._token}"} if self._token else {}
        try:
            response = await self._client.get(f"{self._base_url}{path}", headers=headers, timeout=self._timeout)
        except httpx.TimeoutException as err:
            raise PalDefenderError(504, "PROXY_UPSTREAM_TIMEOUT", f"PalDefender did not respond in time: {err}") from err
        except httpx.HTTPError as err:
            raise PalDefenderError(502, "PROXY_UPSTREAM_UNREACHABLE", f"Could not reach PalDefender: {err}") from err

        try:
            body = response.json()
        except ValueError as err:
            raise PalDefenderError(502, "PROXY_UPSTREAM_INVALID_RESPONSE", "PalDefender returned non-JSON.") from err

        if response.is_error:
            if isinstance(body, dict) and "Error" in body:
                error = body["Error"]
                raise PalDefenderError(response.status_code, error.get("Code", "UNKNOWN"), error.get("Message", ""), error.get("Details"))
            raise PalDefenderError(response.status_code, "UNKNOWN", f"PalDefender returned HTTP {response.status_code}.")

        return body

    async def get_players(self) -> dict:
        return await self._get("/v1/pdapi/players")

    async def get_player(self, identifier: str) -> dict:
        return await self._get(f"/v1/pdapi/player/{identifier}")

    async def get_pals(self, identifier: str) -> dict:
        return await self._get(f"/v1/pdapi/pals/{identifier}")


class DemoPalDefenderClient:
    """Serves canned data (see demo_data.py) so the app<->proxy HTTP path can be exercised
    before PalDefender/Tailscale are set up. Same response shapes as the real client."""

    async def get_players(self) -> dict:
        return {"Meta": {"PlayerCount": len(DEMO_PLAYERS), "OnlineCount": sum(1 for p in DEMO_PLAYERS if p["Status"] == "Online")}, "Players": DEMO_PLAYERS}

    async def get_player(self, identifier: str) -> dict:
        player = find_player(identifier)
        if player is None:
            raise PalDefenderError(404, "PLAYER_NOT_FOUND", f"No online player matched '{identifier}'.")
        return {"Player": player}

    async def get_pals(self, identifier: str) -> dict:
        player = find_player(identifier)
        if player is None:
            raise PalDefenderError(404, "PLAYER_NOT_FOUND", f"No online player matched '{identifier}'.")
        return DEMO_PALS_BY_IDENTIFIER.get(
            player["PlayerUID"],
            {
                "Meta": {"PlayerUID": player["PlayerUID"], "Player": identifier, "TeamCount": 0, "PalboxCount": 0, "BaseCampCount": 0},
                "Pals": {"Team": {}, "Palbox": {}, "BaseCamps": []},
            },
        )
