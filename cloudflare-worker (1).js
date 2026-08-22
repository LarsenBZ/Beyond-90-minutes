/**
 * Beyond 90 Minutes — API-Football proxy
 * ---------------------------------------------------------------
 * This runs on Cloudflare's free tier, NOT in your GitHub repo. It does
 * three jobs a plain static site can't do on its own:
 *   1. Keeps your API-Football key private (it lives here as a secret,
 *      never in your public GitHub code).
 *   2. Adds the CORS headers api-sports.io doesn't provide, so your site's
 *      JavaScript is allowed to read the response.
 *   3. Caches responses at Cloudflare's edge. This is the important one:
 *      API-Football's free plan is 100 requests/DAY, shared by every
 *      single visitor to your site (not 100 each). Edge caching means the
 *      50th visitor in an hour gets the SAME cached response the 1st
 *      visitor triggered, instead of spending another request. Without
 *      this, a handful of people browsing the site around the same time
 *      could burn through the whole day's quota by themselves.
 *
 * Setup instructions are in PROXY-SETUP.md — you don't need to understand
 * this file to use it, just copy/paste it where the guide tells you to.
 *
 * NOTE: ESPN's data (scoreboard, standings, schedules) does NOT go through
 * this proxy — ESPN's public endpoints allow direct browser requests and
 * need no key, so script.js calls them straight from the visitor's
 * browser. This Worker only handles API-Football (top scorers, lineups,
 * match stats).
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    // Browsers send an OPTIONS request first to check permissions — answer it.
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // --- Check the edge cache first -----------------------------------
    // Cloudflare's cache is keyed by request URL, so the exact same
    // /players/topscorers?league=39&season=2026 request from two different
    // visitors' browsers hits this same cached entry.
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      const response = new Response(cachedResponse.body, cachedResponse);
      Object.entries(corsHeaders).forEach(([key, value]) => response.headers.set(key, value));
      response.headers.set("X-Beyond90-Cache", "HIT");
      return response;
    }

    const target = "https://v3.football.api-sports.io" + url.pathname + url.search;

    try {
      const apiResponse = await fetch(target, {
        headers: { "x-apisports-key": env.API_FOOTBALL_KEY }
      });
      const body = await apiResponse.text();

      // Finished-match fixture lookups (fixtures?id=...) never change once
      // the match is over, so those get a long cache. But a LIVE match's
      // fixture-by-id lookup changes minute to minute — caching that for
      // 24 hours the way a finished one is cached would freeze the score,
      // lineup, and stats at whatever they looked like when the first
      // visitor loaded the page. So for fixture-by-id specifically, peek at
      // the match status in the response body and only apply the long
      // cache once it's actually final.
      const isFixtureById = url.pathname === "/fixtures" && url.searchParams.has("id");
      let maxAgeSeconds = 60 * 60 * 3; // default: 3h (topscorers, squad stats, "last fixture" lookups)
      if (isFixtureById) {
        const finishedStatuses = ["FT", "AET", "PEN", "AWD", "WO"];
        let statusShort = null;
        try {
          const parsed = JSON.parse(body);
          const fixture = parsed.response && parsed.response[0];
          statusShort = fixture && fixture.fixture && fixture.fixture.status && fixture.fixture.status.short;
        } catch (err) { /* couldn't parse — fall through to the short cache below */ }
        maxAgeSeconds = finishedStatuses.includes(statusShort) ? 60 * 60 * 24 : 60; // 24h once final, 60s otherwise (live/upcoming)
      }

      const response = new Response(body, {
        status: apiResponse.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${maxAgeSeconds}`,
          "X-Beyond90-Cache": "MISS",
          ...corsHeaders
        }
      });

      // Only cache successful responses — an error or empty-quota response
      // should NOT get stuck in the cache for hours.
      if (apiResponse.ok) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }

      return response;
    } catch (err) {
      return new Response(JSON.stringify({ error: "Proxy fetch failed" }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
  }
};
