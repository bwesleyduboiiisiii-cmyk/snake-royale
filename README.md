# Snake Royale — TikTok LIVE (GitHub + Vercel + Supabase)

Battle-royale snake game for TikTok LIVE. Viewers' profile pics are the snake heads;
they affect their own snake by sending gifts / liking / sharing your live. Last snake
standing gets a shoutout, then a 60s "who wants to join" lobby, then it auto-starts again.

## How the pieces fit
```
Viewer gift on TikTok
   -> bridge/bridge.js   (runs on YOUR computer; talks to TikTok)
   -> POST /api/event     (Vercel serverless function; checks a secret)
   -> Supabase `events`   (one row per event; Realtime is on)
   -> index.html          (the overlay, hosted on Vercel; subscribes via Realtime)
```
The bridge MUST run locally — Vercel is serverless and can't hold a live TikTok
connection. Everything else lives in the cloud.

---

## STEP 1 — Supabase (2 min)
1. Go to supabase.com -> New project. Pick a name + password, wait for it to finish.
2. Left sidebar -> **SQL Editor** -> **New query**. Paste the contents of `supabase.sql`, click **Run**.
   (Creates the `events` table, turns on Realtime, sets read-only RLS.)
3. Left sidebar -> **Project Settings -> API**. Copy three things, you'll need them:
   - **Project URL**            (e.g. https://abcd1234.supabase.co)
   - **anon public** key        (safe for the browser)
   - **service_role** key       (SECRET — server only, never in the browser)

## STEP 2 — Put your Supabase values in the overlay
Open `index.html`, near the top (in the `<head>`), fill these two lines:
```html
window.SB_URL  = "https://abcd1234.supabase.co";   // your Project URL
window.SB_ANON = "your-anon-public-key";            // anon public key
```
(Only the anon key goes here. Never the service_role key.)

## STEP 3 — GitHub
1. Put this whole folder into a new GitHub repo (GitHub Desktop -> Add -> Create,
   then Publish). The `.gitignore` already keeps `.env` and `node_modules` out.

## STEP 4 — Vercel (deploy the overlay + the /api function)
1. vercel.com -> **Add New -> Project** -> import your repo -> **Deploy**.
2. After it deploys, open **Project -> Settings -> Environment Variables** and add:
   - `SUPABASE_URL`          = your Project URL
   - `SUPABASE_SERVICE_ROLE` = your service_role key
   - `EVENT_INGEST_SECRET`   = a long random string (make one up)
3. **Redeploy** (Deployments -> ... -> Redeploy) so the env vars take effect.
4. Your overlay is now live at `https://your-app.vercel.app`.

## STEP 5 — The bridge (runs on your PC each stream)
1. Install Node 18+ (nodejs.org) if you don't have it.
2. In the `bridge` folder: copy `.env.example` to `.env` and fill in:
   - `TIKTOK_USER`         = your @username (no @)
   - `APP_URL`             = https://your-app.vercel.app
   - `EVENT_INGEST_SECRET` = the SAME string you put in Vercel
   - `SIGN_API_KEY`        = your free key from eulerstream.com (already filled in the example)
3. Open a terminal in the `bridge` folder, run once:  `npm install`

## Each stream (the only recurring steps)
1. Go LIVE on TikTok.
2. In the `bridge` folder:  `npm start`   (leave the window open)
3. In OBS: add a **Browser Source** = `https://your-app.vercel.app`
   - Press **H** to hide host controls, or use `?hud=min&bg=transparent` for a clean overlay.
4. Play. To run it in someone else's live, either edit `TIKTOK_USER` in `.env`,
   or start with:  `npm start -- theirusername`  (i.e. `node bridge.js theirusername`).

---

## Test without going live
- Open `index.html` (deployed URL or the local file) and flip on **Test bots** — full game runs offline.
- To test the cloud path end-to-end, insert a row by hand in Supabase (Table editor -> `events` -> Insert):
  `kind = gift`, `user_name = TestViewer`, `payload = {"diamonds": 100}` — you should see it hit the overlay instantly.

## Gift -> effect
- like = speed + grow     - share = shield     - small gift = grow/boost
- 10+ diamonds = shield   - 100+ diamonds = RAMPAGE (invincible, eats other snakes)

## Troubleshooting
- **Overlay says "Connecting to Supabase…" forever** -> SB_URL/SB_ANON not set in `index.html`, or `supabase.sql` wasn't run.
- **Bridge prints 401 bad secret** -> `EVENT_INGEST_SECRET` differs between `.env` and Vercel.
- **Bridge "connect failed / sign / rate limit"** -> your `SIGN_API_KEY` is missing or wrong.
- **Gifts don't show but bridge prints "200 ok"** -> Realtime not enabled: re-run `supabase.sql`.
- **OBS shows an old version after a deploy** -> right-click the Browser Source -> Refresh cache.
