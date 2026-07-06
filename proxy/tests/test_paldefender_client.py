import httpx
import pytest

from demo_data import DWIRE_UID, KIT_UID
from paldefender_client import DemoPalDefenderClient, PalDefenderError, RealPalDefenderClient


def make_real_client(handler, token: str = "") -> RealPalDefenderClient:
    transport = httpx.MockTransport(handler)
    http_client = httpx.AsyncClient(transport=transport)
    return RealPalDefenderClient("http://paldefender.local", token, client=http_client)


@pytest.mark.asyncio
async def test_get_players_passes_through_success_body():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/pdapi/players"
        return httpx.Response(200, json={"Meta": {"PlayerCount": 0, "OnlineCount": 0}, "Players": []})

    client = make_real_client(handler)
    result = await client.get_players()
    assert result == {"Meta": {"PlayerCount": 0, "OnlineCount": 0}, "Players": []}


@pytest.mark.asyncio
async def test_sends_authorization_header_when_token_set():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(200, json={"Meta": {}, "Pals": {"Team": {}, "Palbox": {}, "BaseCamps": []}})

    client = make_real_client(handler, token="secret-token")
    await client.get_pals("some-id")
    assert seen["auth"] == "Bearer secret-token"


@pytest.mark.asyncio
async def test_maps_documented_error_body_on_non_2xx():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"Error": {"Code": "PLAYER_NOT_FOUND", "Message": "no such player", "Details": {}}})

    client = make_real_client(handler)
    with pytest.raises(PalDefenderError) as exc_info:
        await client.get_pals("missing")
    assert exc_info.value.status_code == 404
    assert exc_info.value.code == "PLAYER_NOT_FOUND"
    assert exc_info.value.message == "no such player"


@pytest.mark.asyncio
async def test_maps_network_failure_to_upstream_unreachable():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    client = make_real_client(handler)
    with pytest.raises(PalDefenderError) as exc_info:
        await client.get_players()
    assert exc_info.value.status_code == 502
    assert exc_info.value.code == "PROXY_UPSTREAM_UNREACHABLE"


@pytest.mark.asyncio
async def test_maps_timeout_to_upstream_timeout():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("timed out", request=request)

    client = make_real_client(handler)
    with pytest.raises(PalDefenderError) as exc_info:
        await client.get_players()
    assert exc_info.value.status_code == 504
    assert exc_info.value.code == "PROXY_UPSTREAM_TIMEOUT"


@pytest.mark.asyncio
async def test_demo_client_lists_players():
    client = DemoPalDefenderClient()
    result = await client.get_players()
    assert result["Meta"]["PlayerCount"] == len(result["Players"])
    assert any(p["PlayerUID"] == KIT_UID for p in result["Players"])


@pytest.mark.asyncio
async def test_demo_client_returns_pals_for_known_player():
    client = DemoPalDefenderClient()
    result = await client.get_pals(KIT_UID)
    assert result["Pals"]["Team"]["t1"]["PalID"] == "Anubis"


@pytest.mark.asyncio
async def test_demo_client_supports_lookup_by_either_identifier():
    client = DemoPalDefenderClient()
    # UserId is set equal to PlayerUID for demo players (see demo_data.py).
    result = await client.get_pals(DWIRE_UID)
    assert result["Pals"]["Team"]["t1"]["PalID"] == "Carbunclo"


@pytest.mark.asyncio
async def test_demo_client_raises_player_not_found_for_unknown_identifier():
    client = DemoPalDefenderClient()
    with pytest.raises(PalDefenderError) as exc_info:
        await client.get_pals("nope")
    assert exc_info.value.status_code == 404
    assert exc_info.value.code == "PLAYER_NOT_FOUND"
