/**
 * Beyond 90 Minutes — football-data.org proxy
 * ---------------------------------------------------------------
 * This runs on Cloudflare's free tier, NOT in your GitHub repo. It does
 * two jobs a plain static site can't do on its own:
 *   1. Keeps your football-data.org API key private (it lives here as a
 *      secret, never in your public GitHub code).
 *   2. Adds the CORS headers football-data.org doesn't provide, so your
 *      site's JavaScript is allowed to read the response.
 *
 * Setup instructions are in PROXY-SETUP.md — you don't need to understand
 * this file to use it, just copy/paste it where the guide tells you to.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const target = "https://api.football-data.org" + url.pathname + url.search;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    // Browsers send an OPTIONS request first to check permissions — answer it.
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const apiResponse = await fetch(target, {
        headers: { "X-Auth-Token": env.FOOTBALL_DATA_API_KEY }
      });
      const body = await apiResponse.text();

      return new Response(body, {
        status: apiResponse.status,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Proxy fetch failed" }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
  }
};
