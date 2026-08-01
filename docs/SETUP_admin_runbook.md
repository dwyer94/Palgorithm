# Palworld Breeding Calculator — Server-Side Setup (Admin Runbook)

This is the full build for wiring your breeding calculator to live pal data from your
Palworld server, reachable securely by you and your friends over Tailscale.

**This doc reflects what's actually built** (see `proxy/` in this repo and
`docs/UI_REQUIREMENTS.md` for the design decisions behind it). It superseded an earlier
draft that assumed a friend-scoped `/mypals` endpoint keyed to Tailscale identity — that
was dropped: the proxy exposes no mutation endpoints, so there's nothing to protect by
restricting who sees whose pals. Every caller who can reach the proxy gets full read access
to every player's data. Tailscale's job is purely "can this device reach the proxy at all,"
not "who is this and what do they own."

## Architecture

```
[Your Windows home server]
  ├─ Palworld Dedicated Server (Steam)
  │    └─ PalDefender (d3d9 loader) ── REST API on 127.0.0.1  (holds the admin token)
  │
  ├─ Proxy (FastAPI, proxy/ in this repo) ── binds 127.0.0.1 only
  │    ├─ holds the PalDefender token (never leaves this machine)
  │    ├─ mirrors PalDefender's REST API 1:1 (same paths, same response/error shapes)
  │    ├─ adds CORS (for the browser app), an optional caller token, and a short-TTL cache
  │    └─ GET /v1/pdapi/players · /v1/pdapi/player/{id} · /v1/pdapi/pals/{id}
  │
  └─ Tailscale + `tailscale serve` ── exposes the proxy over HTTPS on the tailnet ONLY

[You]     -> tailnet -> proxy (full read access)
[Friends] -> tailnet -> proxy (same full read access — nothing here can be changed, only viewed)
```

Key security property: **PalDefender and the proxy only ever listen on localhost.**
The *only* thing exposed to the tailnet is the proxy, and only through `tailscale serve`,
which is tailnet-only. Nothing touches the public internet.

Do this in order: PalDefender -> Proxy -> Tailscale -> App config.

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

4. **Enable the REST API.** In PalDefender's config, turn on the REST API, set a port, and
   set a **bearer token**.
   - **VERIFY exact keys/default port** against the wiki's RESTAPI section — they differ by
     version. The shape you're looking for: an enable flag, a port, and a token.
   - **Bind it to `127.0.0.1`** (localhost) if the config allows a bind address. If it only
     binds to all interfaces, that's fine — Windows Firewall should still block the port from
     the LAN/internet (see Part E). The proxy reaches it locally either way.

5. **Confirm the endpoints exist.** Endpoints are documented in `docs/PalDefenderAPI/*.md` in
   this repo and at https://ultimeit.github.io/PalDefender/RESTAPI/. With the server
   running, from the server itself:
   ```powershell
   curl -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:PORT/v1/pdapi/players
   curl -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:PORT/v1/pdapi/pals/76561198XXXXXXXXX
   ```
   - `/v1/pdapi/players` lists everyone; `/v1/pdapi/pals/{id}` returns that player's pals
     (`{id}` can be a `UserId` or `PlayerUID` — see `src/live/types.ts`'s note on which one
     is actually reliable once you've inspected a real response).
   - Confirmed from the documented schema: `/v1/pdapi/pals/{id}` already includes `IVs`
     (`Health`/`AttackMelee`/`AttackShot`/`Defense`) directly on each pal — no need to fall
     back to `/exportpals`/PalTemplate files for IV data.

> The vanilla Palworld REST API (`RESTAPIEnabled` in `PalWorldSettings.ini`) is a *separate*,
> weaker API that has no pal data. Ignore it; use PalDefender's.

---

## Part B — The Proxy

The proxy (`proxy/` in this repo) is the only component that holds the PalDefender token
and the only one exposed (via Tailscale). It mirrors PalDefender's API as closely as
possible — see `proxy/README.md` for the authoritative, up-to-date instructions; this is
the short version.

### B1. Install + configure

```powershell
cd proxy
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env
notepad .env
```

Fill in `.env`:
- `PALDEFENDER_BASE` — e.g. `http://127.0.0.1:8213` (**VERIFY** the port from Part A)
- `PALDEFENDER_TOKEN` — the bearer token from Part A. Leaving this blank runs the proxy in
  **demo mode** (canned data, no PalDefender needed) — useful for testing the app<->proxy
  connection before this section is finished.
- `PROXY_TOKEN` — optional. If set, callers must send it as a bearer token. Leave blank to
  rely purely on Tailscale network access as the gate (this repo's default assumption,
  since there's nothing here a caller could misuse beyond reading pal data).
- `CORS_ORIGINS` — defaults to `*`. Tighten this to whatever origin you're actually loading
  the web app from in your browser — e.g. `https://palgorithm.dev` if you're using the
  public hosted app and pointing it at your own self-hosted proxy, or your own origin if
  you're running a separate copy of the frontend yourself (see
  docs/PRODUCTION_READINESS_PLAN.md Phase 1's CORS note for why `*` isn't a real risk here
  either way — this is a precision setting, not a security one).
- `CACHE_TTL_SECONDS` — defaults to 5. PalDefender's own docs note a 5-second game-thread
  timeout on its REST calls; this cache keeps repeated polling from hammering it.

### B2. Run it (bound to localhost)

```powershell
.venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port 8080
```

The proxy binds `127.0.0.1:8080`. It is **not** directly reachable from anywhere —
Tailscale will be the only door (Part C).

### B3. Run it as a service (so it survives reboots)

Use **NSSM** (`nssm install PalworldProxy`) pointing at
`<proxy>\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8080` with
working directory set to `proxy\`, or a Task Scheduler task set to "run at startup." Set env
vars in the service definition (or keep them in `proxy\.env`) so the token never sits in a
plaintext startup script you might share.

---

## Part C — Tailscale

1. **Create a Tailscale account** (sign in with Google/GitHub/Microsoft) and **install
   Tailscale on the server**. Run `tailscale up`. Note the machine's MagicDNS name (e.g.
   `palworld-server`).

2. **Enable HTTPS + MagicDNS** in the admin console (DNS settings -> enable MagicDNS, and
   enable HTTPS certificates). `tailscale serve` needs these to issue a cert for your
   `*.ts.net` name.

3. **Expose the proxy over the tailnet:**
   ```powershell
   tailscale serve --bg 8080
   tailscale serve status     # confirm it's proxying https://<magicdns>.<tailnet>.ts.net -> 127.0.0.1:8080
   ```
   - This serves the proxy over **HTTPS on the tailnet only** (not public — that would be
     `tailscale funnel`, which we're deliberately not using).
   - Unlike an earlier version of this doc, the proxy does **not** read any Tailscale
     identity headers — it doesn't need to know *who* is calling, only that they're on the
     tailnet at all. `tailscale serve` is doing access control, not identity injection, here.
   - **VERIFY the exact `serve` syntax** with `tailscale serve --help`; the CLI has changed
     across versions (some use `tailscale serve https / http://127.0.0.1:8080`).

4. **Invite your friends** (Users -> Invite in the admin console). The free Personal plan
   covers 6 users in your tailnet; for more, use **node sharing** (Machines -> the proxy
   node -> Share).

5. **Restrict friends to just the proxy's port** so they can't reach anything else on your
   network (SSH, RDP, ComfyUI, the game server's other ports, etc.):
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
   Apply `tag:palworld` to the proxy's node in the admin console. Note this ACL is about
   **network segmentation** (friends can't reach your other services), not about who sees
   whose pal data — everyone in `group:friends` gets the same full read access once they
   can reach port 443 at all. **VERIFY** against current Tailscale docs — they're migrating
   ACLs toward "grants" syntax, but classic `acls` still works.

Your friends' final connection target is: `https://<magicdns-name>.<your-tailnet>.ts.net`

### Which base URLs the hosted app can actually reach

If you point people at the hosted app (`https://www.palgorithm.dev`) rather than serving it
yourself, the browser constrains what Settings' proxy base URL is allowed to be. Two separate
rules apply, and only the first is ours:

1. **The app's `connect-src` policy** (`render.yaml`) has to name the origin. It allows
   `https://*.ts.net`, plus `localhost` / `127.0.0.1` / `[::1]` on any port.
2. **Mixed-content blocking**, which the browser applies before CSP is consulted: an `https`
   page may not fetch `http`. Loopback is the standing exception — `http://localhost:8212`
   works, `http://192.168.1.50:8212` and `http://100.x.x.x:8080` (a raw Tailscale IP) do not,
   and no CSP change can make them.

So, in practice:

| Proxy base URL | Hosted app | App served from your own machine/tailnet |
| --- | --- | --- |
| `https://<magicdns>.<tailnet>.ts.net` | ✅ | ✅ |
| `http://localhost:<port>` (browser on the same box as the proxy) | ✅¹ | ✅ |
| `http://<LAN or Tailscale IP>:<port>` | ❌ mixed content | ✅ |

¹ Chrome additionally applies Private Network Access checks to public→loopback requests; if
it preflights, the proxy needs to answer with `Access-Control-Allow-Private-Network: true`.

`tailscale serve` (Part C) exists precisely to turn case 3 into case 1 by putting a real
certificate in front of a loopback-bound proxy — that remains the supported setup. Running the
app locally (`npm run dev`) sends no CSP header at all, so any of these work there.

---

## Part D — (Optional) Friendly display names

There's no SteamID-to-Tailscale-identity mapping to maintain anymore — every friend gets
the same full read access regardless of who they are. The only reason to collect a friend's
SteamID64 now is cosmetic: PalDefender returns each player's in-game character name for
free, and the app shows that automatically, but if someone wants a nicer label than their
in-game name, the app's Settings has a display-name override table (SteamID64/PlayerUID ->
name) that anyone using the app can edit locally. This is entirely optional and
per-app-install — there's no server-side list to keep in sync.

---

## Part E — What's already in the calculator app

Fully implemented — see `src/live/` and `docs/UI_REQUIREMENTS.md` for the design, this is
just a pointer to where it lives:

1. **Connection config** (Settings view): proxy base URL and an optional bearer token
   (only needed if you set `PROXY_TOKEN` on the proxy). No other client-side auth — an
   empty base URL runs the app against its own internal demo data.
2. **Data layer** (`src/live/dataSource.ts`, `src/live/normalize.ts`): fetches
   `/v1/pdapi/players` and `/v1/pdapi/pals/{id}`, normalizes into the app's pal model
   (species, gender, passives, IVs), flags anything that doesn't resolve against the
   bundled dataset instead of guessing.
3. **Server Pals view** (`src/ui/ServerPalsView.tsx`): browse every connected player's
   pals, select which players' pals should feed the planner.
4. **Planner integration**: selected players' pals merge into the same roster the
   single-target and hub planners already use — "what am I able to breed toward" now
   spans your box plus whichever server players' boxes you've selected.

---

## Part F — Security checklist

- [ ] PalDefender REST API reachable only on `127.0.0.1` (or blocked from LAN/WAN by firewall).
- [ ] Proxy binds `127.0.0.1` only; never `0.0.0.0`.
- [ ] The PalDefender token exists **only** in the proxy's `.env`/service config — never in
      any client build, repo, or message to friends. It's root-equivalent on your server.
- [ ] If you set `PROXY_TOKEN`, it's likewise only in the proxy's env — the app's Settings
      field for it is stored in the browser's localStorage, which is fine for a personal/
      trusted-friend tool but isn't a secret vault.
- [ ] Windows Firewall: no inbound rule opening the PalDefender or proxy port to the network.
- [ ] Tailscale ACLs restrict `group:friends` to the proxy's port only.
- [ ] Using `tailscale serve` (tailnet-only), **not** `tailscale funnel` (public).
- [ ] You're comfortable that anyone who can reach the proxy sees *everyone's* pals — this
      is intentional (no mutation endpoints exist), not an oversight.

---

## Part G — Smoke test

1. `curl http://127.0.0.1:8080/health` on the server -> `{"ok": true, "mode": "live"}`
   (or `"demo"` if `PALDEFENDER_TOKEN` is still blank).
2. `curl http://127.0.0.1:8080/v1/pdapi/players` on the server -> real player list.
3. From your own laptop (on the tailnet): open
   `https://<magicdns>.<tailnet>.ts.net/health` -> same response as step 1.
4. Point the app's Settings -> "Proxy base URL" at that same tailnet URL -> the Server Pals
   view should populate with real players.
5. Have a friend connect (Tailscale + the app link) and confirm they see the same data.

---

## Troubleshooting

- **App shows "using demo/mock data"**: the base URL field in Settings is empty, or the
  proxy itself is running in demo mode because `PALDEFENDER_TOKEN` is blank in its `.env`.
- **Proxy returns `PROXY_UPSTREAM_UNREACHABLE`**: PalDefender isn't running, the port in
  `PALDEFENDER_BASE` is wrong, or Windows Firewall is blocking localhost traffic (rare, but
  check if you have unusual firewall rules).
- **Proxy returns `PROXY_UPSTREAM_TIMEOUT`**: PalDefender's own docs note its REST calls
  have an internal 5-second game-thread timeout; this can happen under server load.
- **401 `INVALID_TOKEN` from the proxy**: you set `PROXY_TOKEN` on the proxy but the app's
  Settings doesn't have a matching bearer token (or a friend's app install doesn't).
- **CORS error in the browser console**: check `CORS_ORIGINS` in the proxy's `.env` isn't
  restricted to an origin that doesn't match where the app is actually served from.
- **After a Palworld/PalDefender update things break**: pin a known-good PalDefender
  version; re-verify the `/v1/pdapi/pals` schema against `docs/PalDefenderAPI/*.md` and
  `src/live/normalize.ts` after each update — that's the one file that needs correcting if
  field names change.
