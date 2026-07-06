"""Env var loading + client selection. Demo mode is auto-selected when no PalDefender token
is configured (mirroring the app's own "empty base URL -> mock data source" rule in
src/live/dataSource.ts) — no separate toggle needed unless you want to force one path or
the other, hence the explicit DEMO_MODE override.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from paldefender_client import DemoPalDefenderClient, PalDefenderClient, RealPalDefenderClient


def _load_dotenv(path: Path) -> None:
    """Minimal `.env` loader (no extra dependency) — only sets vars not already present in
    the environment, so real env vars (e.g. from an NSSM service config) always win."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def _env_bool(name: str, default: bool = False) -> bool:
    val = os.environ.get(name)
    if val is None or val == "":
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


@dataclass
class Settings:
    paldefender_base: str = "http://127.0.0.1:8213"
    paldefender_token: str = ""
    proxy_token: str = ""
    cors_origins: list[str] = field(default_factory=lambda: ["*"])
    cache_ttl_seconds: float = 5.0
    demo_mode: bool = True


def load_settings() -> Settings:
    _load_dotenv(Path(__file__).parent / ".env")

    paldefender_token = os.environ.get("PALDEFENDER_TOKEN", "")
    origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()] or ["*"]

    return Settings(
        paldefender_base=os.environ.get("PALDEFENDER_BASE", "http://127.0.0.1:8213"),
        paldefender_token=paldefender_token,
        proxy_token=os.environ.get("PROXY_TOKEN", ""),
        cors_origins=origins,
        cache_ttl_seconds=float(os.environ.get("CACHE_TTL_SECONDS", "5")),
        demo_mode=_env_bool("DEMO_MODE", default=not paldefender_token),
    )


def build_client(settings: Settings) -> PalDefenderClient:
    if settings.demo_mode:
        return DemoPalDefenderClient()
    return RealPalDefenderClient(settings.paldefender_base, settings.paldefender_token)
