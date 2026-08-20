# Setting Up Live Data (Cloudflare Worker Proxy)

This is optional. Your site works great right now with sample data — every
page loads instantly and looks complete. Do this whenever you have a spare
15 minutes; there's no rush and no risk of breaking anything.

**What this does:** lets your site show real fixtures/standings from
football-data.org instead of the sample numbers, without exposing your API
key publicly and without hitting the CORS error that blocks calling the API
directly from a browser.

**Cost:** free. No credit card required for what we're doing.

---

## Step 1 — Create a free Cloudflare account

1. Go to **https://dash.cloudflare.com/sign-up**
2. Sign up with your email (verify the email when it asks).

## Step 2 — Create the Worker

1. In the Cloudflare dashboard, find **Workers & Pages** in the left sidebar.
2. Click **Create** → **Create Worker**.
3. Give it a name, e.g. `beyond90-proxy` (this becomes part of your URL).
4. Click **Deploy** (it deploys a placeholder "Hello World" — that's fine, we'll replace it).

## Step 3 — Paste in the real code

1. Click **Edit code** (sometimes labeled "Edit Worker" or a `</>` icon).
2. Delete everything in the editor.
3. Open `cloudflare-worker.js` from this folder, copy **all** of it, and paste
   it into the Cloudflare editor.
4. Click **Save and Deploy** (or **Deploy**) in the top right.

## Step 4 — Add your API key as a secret

Your key should live here, not in your GitHub repo.

1. On your Worker's page, go to **Settings** → **Variables and Secrets**.
2. Click **Add** (or **Add variable**).
3. Name: `FOOTBALL_DATA_API_KEY`
4. Value: your football-data.org key (the one you already have)
5. Make sure it's set to **Secret / Encrypt** (not plain text), then **Save and Deploy**.

Don't have a key yet, or want a fresh one? Register free at
**https://www.football-data.org/client/register**.

## Step 5 — Copy your Worker's URL

At the top of your Worker's page you'll see a URL that looks like:

```
https://beyond90-proxy.YOURNAME.workers.dev
```

Copy it.

## Step 6 — Tell your site about it

1. Open `script.js` in VS Code.
2. Find this near the top:
   ```js
   proxyBaseUrl: "", // EDIT ME — paste your Cloudflare Worker URL here...
   ```
3. Paste your URL between the quotes, no trailing slash:
   ```js
   proxyBaseUrl: "https://beyond90-proxy.YOURNAME.workers.dev",
   ```
4. Save, commit, and push to GitHub like you normally do.

That's it — reload the Premier League, UCL, or Real Madrid page and you
should see real fixtures and standings. If anything goes wrong (typo in the
URL, key not saved, etc.) the site automatically falls back to the sample
data instead of showing a broken page, so there's no way to "break" the site
by experimenting here.

## Troubleshooting

- **Still showing sample data?** Open your browser's DevTools (F12) →
  Console tab, and reload the page. Any error message there will say what
  failed (wrong URL, missing key, etc.).
- **"Status: Showing sample data (live fetch unavailable)"** on the
  Premier League / UCL pages means the same thing — check the console.
- **Free tier limits:** 10 requests/minute, and scores can lag real kickoffs
  by up to a minute or two. That's a football-data.org limit, not something
  to fix.
