import pytest
from fastapi.testclient import TestClient

import app as app_module
from demo_data import KIT_UID
from paldefender_client import PalDefenderError


@pytest.fixture
def client():
    return TestClient(app_module.app)


@pytest.fixture(autouse=True)
def reset_state():
    """app.py's settings/cache are module-level (see app.py's docstring on why — small
    script, no DI framework needed) — reset between tests so one test's auth/cache changes
    can't leak into another."""
    yield
    app_module.settings.proxy_token = ""
    app_module._cache.clear()


def test_health_reports_demo_mode_by_default(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True, "mode": "demo"}


def test_players_route_returns_demo_players(client):
    response = client.get("/v1/pdapi/players")
    assert response.status_code == 200
    body = response.json()
    assert any(p["PlayerUID"] == KIT_UID for p in body["Players"])


def test_pals_route_returns_demo_pals_for_known_player(client):
    response = client.get(f"/v1/pdapi/pals/{KIT_UID}")
    assert response.status_code == 200
    assert response.json()["Pals"]["Team"]["t1"]["PalID"] == "Anubis"


def test_pals_route_returns_documented_error_shape_for_unknown_player(client):
    response = client.get("/v1/pdapi/pals/does-not-exist")
    assert response.status_code == 404
    assert response.json() == {"Error": {"Code": "PLAYER_NOT_FOUND", "Message": "No online player matched 'does-not-exist'.", "Details": {}}}


def test_upstream_error_from_the_client_is_forwarded_verbatim(client, monkeypatch):
    async def failing_get_players():
        raise PalDefenderError(502, "PROXY_UPSTREAM_UNREACHABLE", "Could not reach PalDefender: boom")

    monkeypatch.setattr(app_module.client, "get_players", failing_get_players)
    response = client.get("/v1/pdapi/players")
    assert response.status_code == 502
    assert response.json()["Error"]["Code"] == "PROXY_UPSTREAM_UNREACHABLE"


def test_cors_header_present_for_configured_origin(client):
    response = client.get("/v1/pdapi/players", headers={"Origin": "http://localhost:5173"})
    assert response.headers.get("access-control-allow-origin") == "*"


def test_no_auth_required_when_proxy_token_unset(client):
    assert app_module.settings.proxy_token == ""
    response = client.get("/v1/pdapi/players")
    assert response.status_code == 200


def test_auth_rejects_missing_or_wrong_token_when_proxy_token_set(client):
    app_module.settings.proxy_token = "expected-token"

    unauthenticated = client.get("/v1/pdapi/players")
    assert unauthenticated.status_code == 401
    assert unauthenticated.json()["Error"]["Code"] == "INVALID_TOKEN"

    wrong = client.get("/v1/pdapi/players", headers={"Authorization": "Bearer wrong"})
    assert wrong.status_code == 401


def test_auth_accepts_correct_token_when_proxy_token_set(client):
    app_module.settings.proxy_token = "expected-token"
    response = client.get("/v1/pdapi/players", headers={"Authorization": "Bearer expected-token"})
    assert response.status_code == 200


def test_responses_are_cached_within_ttl(client, monkeypatch):
    calls = {"count": 0}

    async def counting_get_players():
        calls["count"] += 1
        return {"Meta": {"PlayerCount": 0, "OnlineCount": 0}, "Players": []}

    monkeypatch.setattr(app_module.client, "get_players", counting_get_players)
    client.get("/v1/pdapi/players")
    client.get("/v1/pdapi/players")
    assert calls["count"] == 1  # second call served from cache within TTL
