# Palworld Breeding Calculator — Setup for Players

This tool lets you see the pals **everyone on the server owns** and plan breeding —
"I want *this* pal with *these* passives, how do I get there, using whatever's already in
anyone's box."

Setup is a one-time thing, ~2 minutes.

---

## What you'll need

- Whatever device you'll use the calculator on (PC, Mac, phone).
- Two things from the admin: a **Tailscale invite email** and the **calculator link**.

---

## Step 1 — Install Tailscale and accept the invite

Tailscale is a small, free app that creates a secure private connection to the server.
Nothing about your machine is exposed to the internet — it's the safe way in.

1. Open the **Tailscale invite email** from the admin and click **Accept**. Sign in with
   Google/Microsoft/GitHub (whatever you like).
2. Install the Tailscale app for your device:
   - Windows / macOS: https://tailscale.com/download
   - iPhone / Android: search **Tailscale** in the App Store / Play Store.
3. Open Tailscale and **log in with the same account** you accepted the invite with.
4. Make sure it says **Connected** (Windows/Mac: the tray icon is active; phone: the toggle is on).

> Keep Tailscale running/connected whenever you want to use the calculator. You can leave it on
> in the background — it won't slow anything down or route your normal traffic.

---

## Step 2 — Open the calculator

1. With Tailscale connected, open the **calculator link** the admin gave you
   (looks like `https://something.ts.net`).
2. Go to the **Server Pals** tab — every player's pals load there automatically.
3. Check the box next to whichever players' pals you want to use as inputs for a breeding
   plan (your own included, if you're on the server too), then go plan in the other tabs as
   normal.

That's the whole thing. Connect Tailscale → open the link → everyone's boxes are there.

---

## Good to know

- **Everyone who can open the link sees everyone's pals** — there's no per-player privacy
  here, and nothing here lets anyone change anything on the server. It's read-only, by
  design, so this isn't an oversight.
- Players show up under their in-game character name automatically. If you'd rather see a
  different name for someone, there's an optional name-override table in Settings — purely
  cosmetic, doesn't affect what data loads.
- You don't need any password, key, or SteamID for the calculator itself; being connected
  to Tailscale with your invited account *is* what gets you in the door.
- On mobile, Tailscale just needs its toggle on; then open the link in your browser as normal.

---

## If it doesn't work

- **Page won't load / "using demo/mock data" shown** → check Tailscale says **Connected**.
  If the calculator link itself loads but shows demo data instead of real players, the
  admin hasn't finished pointing it at the real proxy yet — ping them.
- **No players show up** → the admin's PalDefender/proxy setup might be down; ping them.
- **Still stuck** → send the admin a screenshot of the error.
