# Palworld Breeding Calculator — Server-Side Setup (Admin Runbook)

This is the full build for wiring your breeding calculator to live pal data from your
Palworld server, reachable securely by you and your friends over Tailscale.

## Architecture

```
[Your Windows home server]
  ├─ Palworld Dedicated Server (Steam)
  │    └─ PalDefender (d3d9 loader) ── REST API on 127.0.0.1  (holds the admin token)
  │
  ├─ Broker (FastAPI)  ── binds 127.0.0.1 only
  │    ├─ holds the PalDefender token (never leaves this machine)
  │    ├─ talks to PalDefender over localhost
  │    ├─ maps each caller's Tailscale identity -> their SteamID64
  │    └─ /mypals (self-only)   /players + /pals/{id} (admin-only)
  │
  └─ Tailscale + `tailscale serve` ── exposes the broker over HTTPS on the tailnet ONLY,
                                       injecting the caller's identity as a header

[You]     -> tailnet -> broker (full: any player)
[Friends] -> tailnet -> broker (/mypals: their own pals only)
```

Key security property: **PalDefender and the broker only ever listen on localhost.**
The *only* thing exposed to the tailnet is the broker, and only through `tailscale serve`,
which is tailnet-only and tells the broker who each caller is. Nothing touches the public internet.

Do this in order: PalDefender -> Broker -> Tailscale -> SteamID map -> App changes.

---

## Part A — PalDefender ("the mod")

PalDefender loads via `d3d9.dll` on Windows, so **you do not need UE4SS** (which avoids the
open UE4SS dedicated-server character-reset bug entirely).

1. **Download** the latest Windows PalDefender release
   (GitHub: `Ultimeit/PalDefender`, or Nexus mod #451). Wiki: https://ultimeit.github.io/PalDefender/

2. **Install:** stop the dedicated server, then extract the PalDefender files (including
   `d3d9.dll`) into your server's `Pal\Binaries\Win64` folder.

3. **First run:** start the server once so PalDefender generates its config files
   (`d3d9_config.json` and the PalDefender config), then stop it.

4. **Enable the REST API.** In PalDefender's config, turn on the REST API, set a port, and set
   a **bearer token** (recent versions use a token/permission-list system).
   - **VERIFY exact keys/default port** against the wiki's RESTAPI section — they differ by
     version. The shape you're looking for: an enable flag, a port, and a token.
   - **Bind it to `127.0.0.1`** (localhost) if the config allows a bind address. If it only
     binds to all interfaces, that's fine — Windows Firewall should still block the port from
     the LAN/internet (see Part F). The broker reaches it locally either way.

5. **Confirm the endpoints exist.** With the server running, from the server itself:
   ```powershell
   curl -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:PORT/players
   curl -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:PORT/pals/76561198XXXXXXXXX
   ```
   - `/players` should list everyone; `/pals/{steamid}` should return that player's pals.
   - **VERIFY the `/pals` response includes what the calculator needs:** species/ID, gender,
     level, passives, and **IVs/talents**. IV inheritance is core to breeding — if IVs aren't
     in `/pals`, check whether `/exportpals` (PalTemplate files) carries them and read from
     that instead. Note the exact field names; you'll map them in the app (Part E).

> The vanilla Palworld REST API (`RESTAPIEnabled` in `PalWorldSettings.ini`) is a *separate*,
> weaker API that has no pal data. Ignore it; use PalDefender's.

---

## Part B — The Broker

The broker is the only component that holds the token and the only one exposed (via Tailscale).
It enforces "you only get your own pals."

### B1. Install Python + deps (on the server)

```powershell
# Python 3.11+ from python.org, then:
pip install fastapi "uvicorn[standard]" httpx
```

### B2. `broker.py` (reference implementation)

Save this next to a `.env` (or set real env vars). Fill in the `STEAMID_MAP` and `ADMIN_LOGIN`.

```python
# broker.py
import os, time, httpx
from fastapi import FastAPI, Request, HTTPException

PALDEFENDER_BASE  = os.environ.get("PALDEFENDER_BASE", "http://127.0.0.1:8213")  # VERIFY port
PALDEFENDER_TOKEN = os.environ["PALDEFENDER_TOKEN"]           # bearer token, server-side only
ADMIN_LOGIN       = os.environ.get("ADMIN_LOGIN", "you@example.com").lower()
CACHE_TTL         = int(os.environ.get("CACHE_TTL", "60"))   # seconds

# Tailscale login (email) -> SteamID64. Seed this once (see Part D).
STEAMID_MAP = {
    "you@example.com":     "76561198000000000",
    # "friend1@gmail.com": "76561198111111111",
}

app = FastAPI()
_cache: dict[str, tuple[float, object]] = {}

async def pd_get(path: str):
    now = time.time()
    hit = _cache.get(path)
    if hit and now - hit[0] < CACHE_TTL:
        return hit[1]
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{PALDEFENDER_BASE}{path}",
                        headers={"Authorization": f"Bearer {PALDEFENDER_TOKEN}"})
        r.raise_for_status()
        data = r.json()
    _cache[path] = (now, data)
    return data

def identity(req: Request) -> str:
    # `tailscale serve` injects this for authenticated tailnet callers.
    login = req.headers.get("Tailscale-User-Login")
    if not login:
        raise HTTPException(401, "No Tailscale identity — are you connected to the tailnet?")
    return login.lower()

def require_admin(req: Request):
    if identity(req) != ADMIN_LOGIN:
        raise HTTPException(403, "Admin only")

@app.get("/health")
async def health():
    return {"ok": True}

@app.get("/whoami")           # handy for debugging identity
async def whoami(req: Request):
    return {"login": identity(req)}

@app.get("/mypals")           # friends: their own pals only
async def mypals(req: Request):
    who = identity(req)
    steamid = STEAMID_MAP.get(who)
    if not steamid:
        raise HTTPException(403, f"{who} isn't linked to a SteamID yet — send yours to the admin.")
    return await pd_get(f"/pals/{steamid}")   # VERIFY path

@app.get("/players")          # admin: everyone
async def players(req: Request):
    require_admin(req)
    return await pd_get("/players")

@app.get("/pals/{steamid}")   # admin: any player
async def pals(steamid: str, req: Request):
    require_admin(req)
    return await pd_get(f"/pals/{steamid}")
```

### B3. Run it (bound to localhost)

```powershell
# env vars for the session (or use a .env loader)
$env:PALDEFENDER_TOKEN="your-token"; $env:ADMIN_LOGIN="you@example.com"
uvicorn broker:app --host 127.0.0.1 --port 8080
```

The broker binds `127.0.0.1:8080`. It is **not** directly reachable from anywhere — Tailscale
will be the only door (Part C).

### B4. Run it as a service (so it survives reboots)

Use **NSSM** (`nssm install PalworldBroker`) pointing at your Python + `uvicorn broker:app
--host 127.0.0.1 --port 8080`, or a Task Scheduler task set to "run at startup." Set env vars
in the service definition so the token never sits in a plaintext startup script you might share.

---

## Part C — Tailscale

1. **Create a Tailscale account** (sign in with Google/GitHub/Microsoft) and **install Tailscale
   on the server**. Run `tailscale up`. Note the machine's MagicDNS name (e.g. `palworld-server`).

2. **Enable HTTPS + MagicDNS** in the admin console (DNS settings -> enable MagicDNS, and enable
   HTTPS certificates). `tailscale serve` needs these to issue a cert for your `*.ts.net` name.

3. **Expose the broker over the tailnet** with identity injection:
   ```powershell
   tailscale serve --bg 8080
   tailscale serve status     # confirm it's proxying https://<magicdns>.<tailnet>.ts.net -> 127.0.0.1:8080
   ```
   - This serves the broker over **HTTPS on the tailnet only** (not public — that would be
     `tailscale funnel`, which we're deliberately not using).
   - `serve` adds `Tailscale-User-Login` (and `-User-Name`) headers for each authenticated
     caller — that's what the broker reads for scoping.
   - **VERIFY the exact `serve` syntax** with `tailscale serve --help`; the CLI has changed
     across versions (some use `tailscale serve https / http://127.0.0.1:8080`).

4. **Invite your friends** (Users -> Invite in the admin console). The free Personal plan covers
   6 users in your tailnet; for more, use **node sharing** (Machines -> the broker node -> Share).

5. **Lock friends down with ACLs** so they can reach *only* the broker's HTTPS port and nothing
   else on your network (SSH, RDP, ComfyUI, game servers, etc.). Tag the server node and restrict:
   ```jsonc
   {
     "groups": {
       "group:admin":   ["you@example.com"],
       "group:friends": ["friend1@gmail.com", "friend2@gmail.com"]
     },
     "tagOwners": { "tag:palworld": ["group:admin"] },
     "acls": [
       { "action": "accept", "src": ["group:admin"],   "dst": ["*:*"] },
       { "action": "accept", "src": ["group:friends"], "dst": ["tag:palworld:443"] }
     ]
   }
   ```
   Apply `tag:palworld` to the server node in the admin console. **VERIFY** against current
   Tailscale docs — they're migrating ACLs toward "grants" syntax, but classic `acls` still works.

Your friends' final connection target is: `https://<magicdns-name>.<your-tailnet>.ts.net`

---

## Part D — Link friends to their pals (SteamID map)

The one manual coordination step. The broker needs to know which Tailscale login owns which pals.

1. Ask each friend for their **SteamID64** (17 digits, e.g. `76561198…`). They can get it from
   their Steam profile URL or a lookup site (put this in the friends' doc — it's already there).
2. Add a line to `STEAMID_MAP` in `broker.py`: `"friend@gmail.com": "76561198XXXXXXXXX"`.
3. Restart the broker service.

To seed/spot-check SteamIDs, hit `/players` as admin — PalDefender returns everyone currently
known to the world, so you can match names to IDs.

---

## Part E — What to add to the calculator app (brief)

Three small additions; the breeding engine you already have doesn't change.

1. **Connection config.** One value: the broker base URL
   (`https://<magicdns>.<tailnet>.ts.net`). No token in the client — Tailscale identity *is* the
   auth. (Your admin build can carry a small "admin mode" flag to reveal player selection.)

2. **Data layer.**
   - Friend build: `GET {base}/mypals` on load -> normalize -> that's the player's inventory.
   - Admin build: `GET {base}/players` to populate a player picker, then `GET {base}/pals/{id}`.
   - **Normalize** PalDefender's pal objects into your existing pal model here (species, gender,
     level, passives, IVs/talents). This is the one place the **VERIFY**'d field names from
     Part A get mapped — keep it in a single adapter function so a schema change is a one-file fix.

3. **Feed the pathfinder.** The fetched pals become the "what I already have" inventory for your
   inverse/goal-driven feature: *"I want this species with these passives — cheapest/most-certain
   path from my current box."* Same ranked-paths output you designed for the PoE2 tool, just with
   pals as the owned-materials set.

**Serving note (avoids CORS):** simplest is to **serve the friend SPA from the broker itself**
(FastAPI `StaticFiles`) so the app and the API are same-origin over the tailnet — no CORS config,
no separate host. If you'd rather host the SPA elsewhere, add CORS on the broker allowing that
origin, but same-origin is less to manage.

---

## Part F — Security checklist

- [ ] PalDefender REST API reachable only on `127.0.0.1` (or blocked from LAN/WAN by firewall).
- [ ] Broker binds `127.0.0.1` only; never `0.0.0.0`.
- [ ] The PalDefender token exists **only** in the broker's env/service config — never in any
      client build, repo, or message to friends. It's root-equivalent on your server.
- [ ] Windows Firewall: no inbound rule opening the PalDefender or broker port to the network.
- [ ] Tailscale ACLs restrict `group:friends` to the broker port only.
- [ ] Broker enforces `/mypals` from identity, and **ignores any player id a client sends** for
      the friend path (only admin endpoints accept an id).
- [ ] Using `tailscale serve` (tailnet-only), **not** `tailscale funnel` (public).

---

## Part G — Smoke test

1. `curl http://127.0.0.1:8080/health` on the server -> `{"ok": true}`.
2. From your own laptop (on the tailnet): open `https://<magicdns>.<tailnet>.ts.net/whoami`
   -> shows your login. Then `/players` works (you're admin).
3. Have one friend connect (Part D done for them) and open `/mypals` -> only their pals.
4. Confirm a non-linked friend gets the friendly "send your SteamID" 403, not a crash.

---

## Troubleshooting

- **401 "No Tailscale identity":** the caller isn't going through `tailscale serve`, or isn't
  connected to the tailnet. Check `tailscale serve status` and that they're logged in.
- **403 "not linked to a SteamID":** add them to `STEAMID_MAP`, restart broker.
- **Empty/500 from PalDefender:** re-check token, port, and that the server is running; confirm
  the endpoint path against the wiki (`/pals/{id}` vs a variant).
- **`/pals` missing IVs:** switch that path to read from `/exportpals` PalTemplate files instead.
- **After a Palworld/PalDefender update things break:** pin a known-good PalDefender version;
  re-verify the `/pals` schema and your adapter after each update.
