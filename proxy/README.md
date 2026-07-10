# PalCalc PalDefender proxy

A thin FastAPI proxy that mirrors PalDefender's REST API (`../docs/PalDefenderAPI/*.md`,
https://ultimeit.github.io/PalDefender/RESTAPI/) as closely as possible, so the PalCalc app
never has to know PalDefender exists — it just talks to this proxy using the exact same
paths and response shapes. See `../docs/UI_REQUIREMENTS.md` for the feature this serves and
`../docs/SETUP_admin_runbook.md` for the full PalDefender + Tailscale deployment picture
(note: that doc still describes an earlier, more complex design with per-friend
`/mypals` scoping — this proxy deliberately does **not** implement that; every caller who
can reach it gets full read access, since there's nothing here that lets anyone change
anything).

## What it adds on top of PalDefender

PalDefender itself doesn't need any of this — it's what a browser-based SPA on a different
origin needs that a game server's REST API doesn't provide:

- **CORS** — so the app (served from wherever) can call this cross-origin.
- **Optional caller auth** — a `PROXY_TOKEN` you can set to require callers to send
  `Authorization: Bearer <token>`. Off by default; Tailscale network reachability is the
  gate in that case.
- **A short-TTL cache** — PalDefender's own docs note its REST endpoints have a 5-second
  game-thread timeout; caching (default 5s) avoids hammering it if several people (or the
  app's auto-poll) hit it around the same time.
- **Demo mode** — serves canned data (`demo_data.py`) instead of calling PalDefender at
  all, so you can stand this up and point the real app at it before PalDefender/Tailscale
  are ready. Auto-selected whenever `PALDEFENDER_TOKEN` isn't set.

Every route otherwise forwards PalDefender's response body and status code verbatim,
including its `{Error: {Code, Message, Details}}` error shape on failures — the app parses
that shape generically, so a proxy-side failure (e.g. can't reach PalDefender) uses the same
contract with its own `Code` (e.g. `PROXY_UPSTREAM_UNREACHABLE`).

## Run it

```powershell
python -m venv .venv
.venv\Scripts\pip install -r requirements-dev.txt   # includes pytest
copy .env.example .env                              # then edit .env
.venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port 8080
```

Leave `PALDEFENDER_TOKEN` blank in `.env` to run in demo mode — `GET /health` will report
`{"ok": true, "mode": "demo"}` and `/v1/pdapi/players` / `/v1/pdapi/pals/<id>` will serve the
fixtures in `demo_data.py`. Point the PalCalc app's Settings → "Proxy base URL" at
`http://127.0.0.1:8080` to test the real HTTP path end-to-end without PalDefender running.

Fill in `PALDEFENDER_TOKEN` (and `PALDEFENDER_BASE` if it's not on the default port — verify
against your PalDefender config, ports vary by version) to switch to live mode.

## Test

```powershell
.venv\Scripts\python -m pytest -v
```

`tests/test_paldefender_client.py` covers the real HTTP client against a mocked transport
(no network) and the demo client; `tests/test_app.py` covers the FastAPI routes, CORS, auth,
and caching.

## Deploying alongside PalDefender (piece 3)

Once PalDefender + Tailscale are set up per `../docs/SETUP_admin_runbook.md` Parts A and C:

1. Copy this `proxy/` directory to the server (or clone the repo there).
2. Set real env vars — `PALDEFENDER_TOKEN` at minimum — via a `.env` file or your service
   manager's env config (NSSM, Task Scheduler). Never put the token in a client build.
3. Run `uvicorn app:app --host 127.0.0.1 --port 8080` as a service so it survives reboots.
4. `tailscale serve --bg 8080` to expose it over the tailnet (HTTPS, tailnet-only — not
   `tailscale funnel`).
5. Point the app's Settings → "Proxy base URL" at the resulting `https://<magicdns>.<tailnet>.ts.net`.

This proxy binds `127.0.0.1` only (see `uvicorn` command above) — it is never directly
reachable from the LAN/WAN, matching the admin runbook's security posture even though the
per-friend identity scoping it originally described isn't implemented here.
