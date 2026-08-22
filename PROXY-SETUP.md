# Setting Up Live Data

## The short version

**Fixtures, standings, and the Real Madrid schedule already work with zero
setup.** Those come from ESPN's public API, which doesn't need a key or a
proxy — script.js talks to it directly. Reload the site right now and
you'll see real matches and real tables.

This guide is for the *bonus* layer on top of that: **Top Scorers tables,
the last match's lineup drawn onto the tactical pitch, and a match stats +
goal/card timeline.** That data comes from API-Football, which does need a
key — and a key can't safely sit in your public GitHub repo. So it lives in
a small Cloudflare Worker instead, the same pattern this site already used
for football-data.org.

**Cost:** free. No credit card required for any of this.

**No rush:** skip this entirely and the site still looks complete — fixtures
and standings are real, and the scorers/lineup sections just show a quiet
"add your Worker URL" note instead of breaking.

---

## Step 1 — Get a free API-Football key

1. Go to **https://dashboard.api-football.com/register**
2. Sign up (no credit card needed) and copy your API key from the dashboard.
3. Note the free-plan limit: **100 requests per day, shared across every
   visitor to your site** — not 100 each. The Worker below caches responses
   at Cloudflare's edge specifically to stretch that quota, so this is more
   generous in practice than it sounds, but it's worth knowing the ceiling
   exists. If scorers/lineups ever show "unavailable right now," that's
   almost always the daily quota running dry — it resets at 00:00 UTC, and
   everything else on the site (fixtures, standings, schedules) keeps
   working regardless, since that part is all ESPN and has no such limit.

## Step 2 — Create a free Cloudflare account

1. Go to **https://dash.cloudflare.com/sign-up**
2. Sign up with your email (verify the email when it asks).

## Step 3 — Create the Worker

1. In the Cloudflare dashboard, find **Workers & Pages** in the left sidebar.
2. Click **Create** → **Create Worker**.
3. Give it a name, e.g. `beyond90-proxy` (this becomes part of your URL).
4. Click **Deploy** (it deploys a placeholder "Hello World" — that's fine, we'll replace it).

## Step 4 — Paste in the real code

1. Click **Edit code** (sometimes labeled "Edit Worker" or a `</>` icon).
2. Delete everything in the editor.
3. Open `cloudflare-worker.js` from this folder, copy **all** of it, and paste
   it into the Cloudflare editor.
4. Click **Save and Deploy** (or **Deploy**) in the top right.

## Step 5 — Add your API key as a secret

Your key should live here, not in your GitHub repo.

1. On your Worker's page, go to **Settings** → **Variables and Secrets**.
2. Click **Add** (or **Add variable**).
3. Name: `API_FOOTBALL_KEY`
4. Value: the key you copied in Step 1.
5. Make sure it's set to **Secret / Encrypt** (not plain text), then **Save and Deploy**.

## Step 6 — Copy your Worker's URL

At the top of your Worker's page you'll see a URL that looks like:

```
https://beyond90-proxy.YOURNAME.workers.dev
```

Copy it.

## Step 7 — Tell your site about it

1. Open `script.js` in VS Code.
2. Find this near the top, inside `API_FOOTBALL_CONFIG`:
   ```js
   proxyBaseUrl: "", // paste your Cloudflare Worker URL here...
   ```
3. Paste your URL between the quotes, no trailing slash:
   ```js
   proxyBaseUrl: "https://beyond90-proxy.YOURNAME.workers.dev",
   ```
4. Save, commit, and push to GitHub like you normally do.

That's it — reload the Premier League, La Liga, UCL, or Real Madrid page and
you should see real Top Scorers tables, and the Real Madrid page's
"Tactical Lineup" tab should fill in with the actual XI from Real Madrid's
last finished match. If anything goes wrong (typo in the URL, key not
saved, etc.) those sections just show a quiet "unavailable" note instead of
a broken page — everything else on the site is unaffected.

## Troubleshooting

- **Scorers/lineups still showing "unavailable"?** Open your browser's
  DevTools (F12) → Console tab, and reload the page. Any warning there will
  say what failed (wrong URL, missing key, empty response, daily quota
  exhausted, etc.) — every API-Football call in script.js logs a
  `console.warn` on failure instead of failing silently.
- **Fixtures/standings look wrong or missing?** That's ESPN, not this
  proxy — check the console for a warning starting with "ESPN", and note
  it doesn't depend on anything in this guide at all.
- **Real Madrid's team ID.** `API_FOOTBALL_CONFIG.realMadridTeamId` in
  script.js is set to `541`, which should be correct and stable, but if the
  match report or squad stats sections come back consistently empty, it's
  worth double-checking that number against
  `https://dashboard.api-football.com` (Ids → Teams → search "Real Madrid").
- **Free tier limits:** 100 requests/day total, shared by every visitor,
  resetting at 00:00 UTC. The Worker's edge cache (built into
  cloudflare-worker.js) is what makes that workable — most repeat visits
  within the same few hours cost zero extra requests.
