# Palworld Breeding Calculator — Setup for Players

This tool lets you see the pals in your own box on our server and plan breeding —
"I want *this* pal with *these* passives, how do I get there from what I've got."

You only see **your own** pals, and setup is a one-time thing. ~5 minutes.

---

## What you'll need

- The **Steam account** you play Palworld on.
- Whatever device you'll use the calculator on (PC, Mac, phone).
- Two things from the admin: a **Tailscale invite email** and the **calculator link**.

---

## Step 1 — Send the admin your SteamID64 (one time)

This is how the tool knows which pals are yours.

1. Go to your Steam profile in a browser.
2. Copy your **SteamID64** — it's a 17-digit number starting with `7656…`.
   - Easiest way: open https://steamid.io/ , paste your Steam profile URL, and copy the
     **steamID64** value it shows.
3. Send that number to the admin. That's it — you only do this once.

---

## Step 2 — Install Tailscale and accept the invite

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

## Step 3 — Open the calculator

1. With Tailscale connected, open the **calculator link** the admin gave you
   (looks like `https://something.ts.net`).
2. Your pals load automatically. Start planning breeds.

That's the whole thing. Connect Tailscale → open the link → your box is there.

---

## If it doesn't work

- **"Not connected" / page won't load** → open Tailscale and check it says **Connected**. If not,
  log in again.
- **"No identity" error** → you're not logged into Tailscale, or logged in with a different
  account than the one you accepted the invite with. Log in with the invited account.
- **"You're not linked to a SteamID yet"** → the admin hasn't added your SteamID64 yet. Make sure
  you did Step 1 and give them a nudge.
- **You see no pals / wrong pals** → double-check the SteamID64 you sent is the account you
  actually play on.
- **Still stuck** → send the admin a screenshot of the error.

---

## Good to know

- You can only ever see **your own** pals through this — not other players'.
- You don't need any password or key for the calculator itself; being connected to Tailscale
  with your invited account *is* the login.
- On mobile, Tailscale just needs its toggle on; then open the link in your browser as normal.
