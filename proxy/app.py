"""FastAPI proxy mirroring PalDefender's REST API (../PalDefenderAPI/*.md) for PalCalc's
live server connection feature (see ../docs/UI_REQUIREMENTS.md). It adds only what
PalDefender itself doesn't provide: CORS (so a browser SPA on a different origin can call
it), optional caller auth, and a short-TTL cache to avoid hammering PalDefender's
game-thread callbacks (which the docs note have their own 5s timeout). Every route
otherwise forwards PalDefender's response verbatim — errors included, same `{Error: {Code,
Message, Details}}` shape either way, so the app's error handling doesn't need to
distinguish "PalDefender said no" from "the proxy itself hit a snag".

Run: uvicorn app:app --host 127.0.0.1 --port 8080
"""

from __future__ import annotations

import time
from typing import Awaitable, Callable

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import build_client, load_settings
from paldefender_client import PalDefenderError

settings = load_settings()
client = build_client(settings)

app = FastAPI(title="PalCalc PalDefender Proxy")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET"],
    allow_headers=["Authorization"],
)


class ProxyError(Exception):
    """Errors that originate in the proxy itself (auth) rather than PalDefender — kept in
    the same wire shape as `PalDefenderError` so callers see one consistent contract."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


@app.exception_handler(ProxyError)
async def handle_proxy_error(_request: Request, exc: ProxyError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"Error": {"Code": exc.code, "Message": exc.message, "Details": {}}})


@app.exception_handler(PalDefenderError)
async def handle_paldefender_error(_request: Request, exc: PalDefenderError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=exc.to_body())


def require_auth(request: Request) -> None:
    """No-op when `PROXY_TOKEN` is unset — Tailscale network reachability is the only gate
    in that case (docs/UI_REQUIREMENTS.md: no per-caller identity scoping needed since
    there's nothing to mutate)."""
    if not settings.proxy_token:
        return
    if request.headers.get("Authorization") != f"Bearer {settings.proxy_token}":
        raise ProxyError(401, "INVALID_TOKEN", "Missing or invalid proxy token.")


_cache: dict[str, tuple[float, dict]] = {}


async def cached(key: str, fetch: Callable[[], Awaitable[dict]]) -> dict:
    now = time.monotonic()
    hit = _cache.get(key)
    if hit and now - hit[0] < settings.cache_ttl_seconds:
        return hit[1]
    data = await fetch()
    _cache[key] = (now, data)
    return data


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "mode": "demo" if settings.demo_mode else "live"}


@app.get("/v1/pdapi/players")
async def get_players(request: Request) -> dict:
    require_auth(request)
    return await cached("players", client.get_players)


@app.get("/v1/pdapi/player/{identifier}")
async def get_player(identifier: str, request: Request) -> dict:
    require_auth(request)
    return await cached(f"player:{identifier}", lambda: client.get_player(identifier))


@app.get("/v1/pdapi/pals/{identifier}")
async def get_pals(identifier: str, request: Request) -> dict:
    require_auth(request)
    return await cached(f"pals:{identifier}", lambda: client.get_pals(identifier))
