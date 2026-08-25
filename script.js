/* ==========================================================================
   Beyond 90 Minutes — Core JavaScript
   Handles: navigation, dark mode, article search/filter, live league data,
   round-by-round browsing with live polling, league Top Scorers lists, the
   match detail modal, Real Madrid post-match synopses, and Real Madrid tab
   switching.

   WHERE THE DATA COMES FROM (two APIs, split by what each is good at):

   1. ESPN's public site API (site.api.espn.com) — scoreboard, standings,
      and team schedules. No API key, no rate limit, no proxy needed — your
      browser talks to it directly. This is why fixtures/standings just work
      the moment you load the page, with nothing to configure.

      Gotcha we ran into: soccer standings return an empty {} on the
      "/apis/site/v2/" path. You have to use "/apis/v2/" instead — see
      espnStandingsUrl() below. Also: ESPN doesn't give soccer an explicit
      "Matchday 12" field the way football-data.org did, so rounds are
      built by clustering the season's own match-dates and numbering them
      in order instead (see buildRounds/buildStageRounds further down) —
      the label reads "Matchday 12", figured out from the schedule itself
      rather than read off a field ESPN doesn't provide.

   2. API-Football (v3.football.api-sports.io) — everything ESPN's soccer
      coverage doesn't reliably give: season top scorers, a finished match's
      lineups/formation, and match stats (shots, possession, cards) and
      events (who scored, when). This one DOES need a key, so it's routed
      through your Cloudflare Worker proxy (cloudflare-worker.js) exactly
      like football-data.org used to be — the key stays server-side, never
      in this file or your public repo.

      IMPORTANT — free-tier quota: API-Football's free plan is 100
      requests/DAY, and that's ONE shared quota across every visitor to
      your site (not 100 per visitor). Two things protect that budget:
        a) This file caches every API-Football response in localStorage for
           API_FOOTBALL_CONFIG.cacheMinutes (long, on purpose).
        b) The Worker itself caches responses at Cloudflare's edge (see
           cloudflare-worker.js), so even a brand new visitor with an empty
           cache usually gets a cached copy instead of spending a request.
      If the scorers/lineups/stats sections ever show "unavailable right
      now", the quota probably ran dry for the day — everything else on the
      site (fixtures, standings, schedules) keeps working regardless, since
      that's all ESPN and has no daily limit.

   A NOTE ON THE TACTICAL LINEUP TAB (Real Madrid page): this used to be
   100% API-Football, which turned out to be a dead end for lineups —
   API-Football's free plan doesn't cover the current season's matches at
   all (see maxFreeSeason below), so it could never draw a real current XI.
   As of this update the pitch is drawn from ESPN's own summary endpoint
   instead (site.api.espn.com/.../summary?event={id}, documented to return
   a "lineups" field for soccer) — same free/unlimited/no-key source as
   everything else on the site. See loadRmLineup() + findRmLineupBlock() +
   extractLineupStarters() further down. Caveat, in the interest of being
   straight about it: the exact shape of ESPN's soccer "lineups" payload
   wasn't something a live match/finished match round-trip could fully
   confirm field-by-field while building this, so the parser tries several
   plausible field names defensively and logs the raw block to the console
   if it can't find starters, rather than pretending it's 100% verified.
   If the pitch shows "showing an example" on the live site, open DevTools
   → Console for the logged raw payload — the fix from there is almost
   always just adding the actual field name to extractLineupStarters().
   The "Last Match Report" panel below the pitch (goals/cards timeline +
   possession/shots/corners table) is untouched by this change and still
   uses API-Football, so it's still subject to the same free-plan season
   cap as before.

   A NOTE ON REAL MADRID SYNOPSES: see RM_MATCH_SYNOPSES below. Synopses
   live in this file itself, keyed by match ID, so they deploy with the
   rest of the site and are visible to every visitor. One thing changed
   with this rewrite: match IDs are now ESPN's event IDs (still just
   numbers, e.g. "645191"), not football-data.org's — if you'd already
   started adding synopses under the old ID scheme, you'll need to re-find
   the match by date on the live site and grab its new ID from the hint
   text under a finished match with no synopsis yet.
   ========================================================================== */

const ESPN_CONFIG = {
    leagues: {
        premierLeague: "eng.1",
        laLiga: "esp.1",
        championsLeague: "uefa.champions"
    },
    realMadridTeamId: 86, // ESPN's internal team ID for Real Madrid
    cacheMinutes: 5
};

const API_FOOTBALL_CONFIG = {
    // Paste your Cloudflare Worker URL here (see PROXY-SETUP.md). Leave it
    // blank and the site still works fine — fixtures/standings/schedules
    // (ESPN) all still load live, you just won't get top scorers, lineups,
    // or match stats until this is set.
    proxyBaseUrl: "https://beyond90-proxy.braulioz147.workers.dev",
    leagues: {
        premierLeague: 39,
        laLiga: 140,
        championsLeague: 2
    },
    // API-Football's team ID for Real Madrid. Team IDs are stable, but if
    // the match report or squad stats sections ever come back empty, this
    // is the first thing worth double-checking against
    // https://dashboard.api-football.com (Ids → Teams → search "Real Madrid").
    realMadridTeamId: 541,
    // Deliberately long — the free plan is 100 requests/DAY, shared by every
    // visitor, so we lean hard on caching. The Worker also caches at
    // Cloudflare's edge on top of this, see cloudflare-worker.js.
    cacheMinutes: 180,
    // CONFIRMED Aug 2026 by hitting the Worker URL directly: API-Football's
    // free plan returns { "errors": { "plan": "Free plans do not have
    // access to this season, try from 2022 to 2024." } } for season=2026.
    // This isn't a bug in this site's code — the free plan simply doesn't
    // cover the current 2025/26 season at all. Season-scoped calls (top
    // scorers, squad stats) fall back to this year instead, so the site
    // shows real data rather than a permanent "unavailable" message — the
    // UI labels it as that season wherever it's used so it's never
    // mistaken for current. Bump this the day API-Football's free plan
    // actually covers the current season again.
    maxFreeSeason: 2024
};

/* ---- REAL MADRID POST-MATCH SYNOPSES -------------------------------------
   HOW TO USE THIS, after a Real Madrid match finishes:
     1. Open the live site's Real Madrid page and look under "Recent Results".
        A finished match with no synopsis yet shows a small hint line like
        "No synopsis added yet — match ID 645191".
     2. Copy that number and add a line below: "645191": "Your synopsis..."
     3. Save, commit, and push to GitHub like normal. Once it deploys, your
        synopsis replaces the hint for every visitor — not just you, and not
        just on this device.
   Text can be as long as you want (a full paragraph or several) — it'll
   wrap naturally under the match card and in the match's detail popup.
   ---------------------------------------------------------------------- */
const RM_MATCH_SYNOPSES = {
    // Espanyol 1-2 Real Madrid, La Liga Round 2, Aug 22 2026 (Mourinho's second spell begins)
    "401882912": `Espanyol vs Real Madrid
La Liga round 2
The start of the second Jose Mourinho era

First half 1-1
Formation: 4-2-3-1
Real Madrid debuted with a defense formed by Carreras, Huijsen, Konate, and Dumfries. Through this lineup Mourinho has shown that if you play not a high level you will be benched in the case if Rudiger and Trent. Carreras most likely started because of the break Cucurella had after the World Cup. Mourinho formed a midfield with Bernardo Silva, Fede Valverde, and Bellingham. Valverde showed himself as a defensive pivot while Bernardo controlled the ball. Bellingham played as a box to box midfielder keeping high intensity and pressure while entering the box supporting the attack. Arda Guler most likely played in the right due to Dumfries playing as Arda Guler isn't a winger similar to Vinicus letting Dumfries overlap and progress in attack. Vinicius and Mbappe showed themselves as the stars in attack.

The score would be opened by Bellingham with a header after a free kick assist by Arda Guler. The attack flowed through both of them and they were the best players on the pitch. The first half was marked by conflict between Vinicius and the Espanyol fans with many fouls and yellow cards given and not given. Espanyol would score through their striker as Fede Valverde had not followed his mark leaving the striker alone against Courtois.

Second Half 2-1
Formation: 4-2-3-1
The match would continue as Espanyol would continue to create plays while Real Madrid were not able to score against a low block defense. Yan Diomande and Marc Cucurella would substitute Arda Guler and Alvaro Carreras at the 64th minute. Cucurella played a safe game while Diomande showed a lot of his flair as a creative fast player. At the 80th minute Mourinho with the score 1-1 would make substitutions that were important to the goal scored in the 90th minute. One of the substitutions was Carlos Espi for Bellingham. Carlos Espi would score in a play created by Yan Diomande with a pass to Mbappe in the box. carlos Espi would find the ball and score a really important goal for the player.

Post-Match
Mourinho's team won a difficult match with not a great Vini, but this game showed that Bellingham and Arda Guler can work together at least in league matches.`
};

class Beyond90App {
    constructor() {
        /* ---- SAMPLE / FALLBACK DATA -----------------------------------
           Shown if a live fetch fails (network hiccup, ESPN/API-Football
           having a bad day, etc.) so the site never looks broken.
        ------------------------------------------------------------------ */
        this.mockData = {
            "Premier League": {
                matchdayLabel: "Sample",
                fixtures: [
                    { home: "Arsenal", away: "Chelsea", time: "Sat, 15:00", score: "VS", venue: "Emirates Stadium" },
                    { home: "Manchester City", away: "Liverpool", time: "Sun, 16:30", score: "VS", venue: "Etihad Stadium" }
                ],
                standings: [
                    { pos: 1, team: "Arsenal", mp: 5, w: 4, d: 1, l: 0, gd: 9, pts: 13 },
                    { pos: 2, team: "Liverpool", mp: 5, w: 4, d: 0, l: 1, gd: 7, pts: 12 },
                    { pos: 3, team: "Manchester City", mp: 5, w: 3, d: 1, l: 1, gd: 5, pts: 10 }
                ],
                scorers: [
                    { player: "Erling Haaland", team: "Manchester City", goals: 7, assists: 1 },
                    { player: "Mohamed Salah", team: "Liverpool", goals: 6, assists: 3 },
                    { player: "Bukayo Saka", team: "Arsenal", goals: 4, assists: 2 }
                ]
            },
            "UEFA Champions League": {
                matchdayLabel: "Sample",
                fixtures: [
                    { home: "Real Madrid", away: "Bayern Munich", time: "Tue, 20:00", score: "VS", venue: "Santiago Bernabéu" },
                    { home: "PSG", away: "Inter Milan", time: "Wed, 20:00", score: "VS", venue: "Parc des Princes" }
                ],
                standings: [
                    { pos: 1, team: "Real Madrid", mp: 2, w: 2, d: 0, l: 0, gd: 4, pts: 6 },
                    { pos: 2, team: "Bayern Munich", mp: 2, w: 2, d: 0, l: 0, gd: 3, pts: 6 },
                    { pos: 3, team: "PSG", mp: 2, w: 1, d: 1, l: 0, gd: 2, pts: 4 }
                ],
                scorers: [
                    { player: "Kylian Mbappé", team: "Real Madrid", goals: 5, assists: 1 },
                    { player: "Harry Kane", team: "Bayern Munich", goals: 4, assists: 2 },
                    { player: "Ousmane Dembélé", team: "PSG", goals: 3, assists: 3 }
                ]
            },
            "La Liga": {
                matchdayLabel: "Sample",
                fixtures: [
                    { home: "Real Madrid", away: "Barcelona", time: "Sun, 21:00", score: "VS", venue: "Santiago Bernabéu" },
                    { home: "Atlético Madrid", away: "Sevilla", time: "Sat, 18:30", score: "VS", venue: "Cívitas Metropolitano" }
                ],
                standings: [
                    { pos: 1, team: "Real Madrid", mp: 6, w: 5, d: 1, l: 0, gd: 12, pts: 16 },
                    { pos: 2, team: "Barcelona", mp: 6, w: 5, d: 0, l: 1, gd: 10, pts: 15 },
                    { pos: 3, team: "Atlético Madrid", mp: 6, w: 4, d: 1, l: 1, gd: 6, pts: 13 }
                ],
                scorers: [
                    { player: "Kylian Mbappé", team: "Real Madrid", goals: 8, assists: 2 },
                    { player: "Robert Lewandowski", team: "Barcelona", goals: 6, assists: 1 },
                    { player: "Vinícius Jr", team: "Real Madrid", goals: 5, assists: 4 }
                ]
            },
            "Real Madrid": {
                fixtures: [
                    { home: "Real Madrid", away: "Barcelona", time: "Oct 26, 20:00", score: "VS", venue: "Santiago Bernabéu" }
                ],
                results: [
                    { home: "Real Madrid", away: "Atlético Madrid", score: "2 - 1", venue: "Santiago Bernabéu" }
                ],
                standings: [
                    { pos: 1, team: "Real Madrid", mp: 6, w: 5, d: 1, l: 0, gd: 12, pts: 16 },
                    { pos: 2, team: "Barcelona", mp: 6, w: 5, d: 0, l: 1, gd: 10, pts: 15 }
                ],
                scorers: [
                    { player: "Kylian Mbappé", team: "Real Madrid", goals: 8, assists: 2 },
                    { player: "Robert Lewandowski", team: "Barcelona", goals: 6, assists: 1 },
                    { player: "Vinícius Jr", team: "Real Madrid", goals: 5, assists: 4 }
                ]
            }
        };

        this.init();
    }

    init() {
        document.addEventListener("DOMContentLoaded", () => {
            this.setupNavigation();
            this.setupThemeToggle();
            this.setupArticleSearch();
            this.setupRmTabs();
            this.setupModal();
            this.setupImageFallback();
            this.autoLoadPageData();
            this.setupVisibilityRefresh();
        });
    }

    /* ---- IMAGE FALLBACK --------------------------------------------------
       Cover photos (article covers, article-grid card images) are set as
       an inline CSS background-image. If a photo file is missing or
       misnamed — a common gotcha: GitHub Pages is case-sensitive, so
       "Julian-Alvarez.jpg" and "julian-alvarez.jpg" are different files
       there even though they're the same file on Windows/Mac — a broken
       background-image just leaves a blank box. Unlike an <img> tag, a CSS
       background has no built-in onerror. This probes each one with a
       throwaway Image() and, if it 404s, clears the inline style so the
       gradient placeholder already defined in style.css shows through
       instead of a blank void.
    ------------------------------------------------------------------ */
    setupImageFallback() {
        const els = document.querySelectorAll('.article-cover[style*="background-image"], .card-image[style*="background-image"]');
        els.forEach(el => {
            const match = el.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
            if (!match || !match[1]) return;
            const probe = new Image();
            probe.onerror = () => { el.style.backgroundImage = ""; };
            probe.src = match[1];
        });
    }

    // Browsers throttle setInterval timers hard in a backgrounded tab —
    // sometimes pausing them almost entirely — so the 60s live-polling used
    // throughout this file can go stale for as long as the tab isn't in
    // focus, only catching up once something forces a fresh run. This is
    // that something: the moment the tab becomes visible again, everything
    // currently on screen refreshes immediately instead of waiting on
    // whatever's left of its throttled timer.
    setupVisibilityRefresh() {
        let lastRefresh = Date.now();
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState !== "visible") return;
            const now = Date.now();
            if (now - lastRefresh < 10000) return; // debounce rapid tab-switching
            lastRefresh = now;

            if (this.plHub) this.plHub.loadRound(true);
            if (this.laLigaHub) this.laLigaHub.loadRound(true);
            if (this.uclHub) this.uclHub.loadRound(true);

            const page = document.body.getAttribute("data-page");
            if (page === "real-madrid") this.loadRmOverviewLive(true);
            else if (page === "home") this.loadHomeSidebarLive();
        });
    }

    /* ---- NAVIGATION ---------------------------------------------------- */
    setupNavigation() {
        const toggle = document.getElementById("menu-toggle");
        const nav = document.getElementById("nav-menu");
        if (toggle && nav) {
            toggle.addEventListener("click", () => nav.classList.toggle("active"));
            nav.querySelectorAll("a").forEach(link =>
                link.addEventListener("click", () => nav.classList.remove("active"))
            );
        }
    }

    /* ---- DARK MODE ------------------------------------------------------ */
    setupThemeToggle() {
        const btn = document.getElementById("theme-toggle");
        if (!btn) return;

        let saved = null;
        try { saved = localStorage.getItem("beyond90-theme"); } catch (err) { /* ignore */ }

        const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (saved === "dark" || (!saved && prefersDark)) {
            document.body.classList.add("dark-theme");
            btn.textContent = "☀️";
        }

        btn.addEventListener("click", () => {
            const isDark = document.body.classList.toggle("dark-theme");
            btn.textContent = isDark ? "☀️" : "🌙";
            try { localStorage.setItem("beyond90-theme", isDark ? "dark" : "light"); } catch (err) { /* ignore */ }
        });
    }

    /* ---- ARTICLE SEARCH & FILTER ---------------------------------------- */
    setupArticleSearch() {
        const searchInput = document.getElementById("article-search");
        const categoryButtons = document.querySelectorAll("#category-filters .rm-nav-btn");
        const articleCards = document.querySelectorAll(".article-card");
        const emptyState = document.getElementById("articles-empty-state");

        if (!searchInput && categoryButtons.length === 0) return;

        let currentCategory = "ALL";
        let searchQuery = "";

        const filterArticles = () => {
            let visibleCount = 0;
            articleCards.forEach(card => {
                const category = card.getAttribute("data-category") || "";
                const title = card.getAttribute("data-title") || "";
                const matchesCategory = currentCategory === "ALL" || category === currentCategory;
                const matchesSearch = title.toLowerCase().includes(searchQuery.toLowerCase());
                const visible = matchesCategory && matchesSearch;
                card.style.display = visible ? "flex" : "none";
                if (visible) visibleCount++;
            });
            if (emptyState) emptyState.style.display = visibleCount === 0 ? "block" : "none";
        };

        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                searchQuery = e.target.value;
                filterArticles();
            });
        }

        categoryButtons.forEach(btn => {
            btn.addEventListener("click", (e) => {
                categoryButtons.forEach(b => b.classList.remove("active"));
                e.target.classList.add("active");
                currentCategory = e.target.getAttribute("data-category") || "ALL";
                filterArticles();
            });
        });
    }

    /* ---- REAL MADRID TABS ---------------------------------------- */
    setupRmTabs() {
        const buttons = document.querySelectorAll(".rm-sub-nav [data-tab]");
        if (!buttons.length) return;
        buttons.forEach(btn => {
            btn.addEventListener("click", () => {
                buttons.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                document.querySelectorAll(".rm-tab-page").forEach(tab => tab.classList.remove("active"));
                const target = document.getElementById(`rm-tab-${btn.getAttribute("data-tab")}`);
                if (target) target.classList.add("active");
            });
        });
    }

    /* ---- PAGE AUTO-LOAD ---------------------------------------- */
    autoLoadPageData() {
        const page = document.body.getAttribute("data-page");

        if (page === "premier-league") {
            this.plHub = new CompetitionHub(this, {
                espnLeague: ESPN_CONFIG.leagues.premierLeague,
                apiFootballLeagueId: API_FOOTBALL_CONFIG.leagues.premierLeague,
                leagueKey: "Premier League",
                fixturesId: "pl-fixtures-container",
                standingsId: "pl-standings-container",
                scorersId: "pl-scorers-container",
                statusId: "pl-sync-status",
                labelId: "pl-md-label",
                prevId: "pl-md-prev",
                nextId: "pl-md-next",
                refreshId: "pl-refresh-btn"
            });
            this.plHub.init();
        } else if (page === "ucl") {
            this.uclHub = new CompetitionHub(this, {
                espnLeague: ESPN_CONFIG.leagues.championsLeague,
                apiFootballLeagueId: API_FOOTBALL_CONFIG.leagues.championsLeague,
                leagueKey: "UEFA Champions League",
                fixturesId: "ucl-fixtures-container",
                standingsId: "ucl-standings-container",
                scorersId: "ucl-scorers-container",
                statusId: "ucl-sync-status",
                labelId: "ucl-md-label",
                prevId: "ucl-md-prev",
                nextId: "ucl-md-next",
                refreshId: "ucl-refresh-btn"
            });
            this.uclHub.init();
        } else if (page === "la-liga") {
            this.laLigaHub = new CompetitionHub(this, {
                espnLeague: ESPN_CONFIG.leagues.laLiga,
                apiFootballLeagueId: API_FOOTBALL_CONFIG.leagues.laLiga,
                leagueKey: "La Liga",
                fixturesId: "ll-fixtures-container",
                standingsId: "ll-standings-container",
                scorersId: "ll-scorers-container",
                statusId: "ll-sync-status",
                labelId: "ll-md-label",
                prevId: "ll-md-prev",
                nextId: "ll-md-next",
                refreshId: "ll-refresh-btn"
            });
            this.laLigaHub.init();
        } else if (page === "real-madrid") {
            this.loadRmOverviewLive();
        } else if (page === "home") {
            this.loadHomeSidebarLive();
        }
    }

    isApiFootballEnabled() {
        return Boolean(API_FOOTBALL_CONFIG.proxyBaseUrl && API_FOOTBALL_CONFIG.proxyBaseUrl.trim().length > 8);
    }

    // European club seasons start around July — before that, "this year" is
    // still last year's season as far as the APIs are concerned.
    currentEuropeanSeasonYear() {
        const now = new Date();
        return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    }

    // The season to actually request from API-Football — clamped to the
    // free plan's real coverage (see the maxFreeSeason comment above). Use
    // this instead of currentEuropeanSeasonYear() for any API-Football
    // call; keep using currentEuropeanSeasonYear() directly for anything
    // ESPN-based, which has no such restriction.
    apiFootballSeasonYear() {
        return Math.min(this.currentEuropeanSeasonYear(), API_FOOTBALL_CONFIG.maxFreeSeason);
    }

    // True when we had to fall back to an older season than the live one
    // because of the free-plan restriction — callers use this to decide
    // whether to label a heading with the season, so it's never confused
    // for current data.
    isApiFootballSeasonCapped() {
        return this.apiFootballSeasonYear() < this.currentEuropeanSeasonYear();
    }

    /* ---- ESPN FETCH + CACHE ---------------------------------------------
       No key, no proxy — straight to ESPN, cached in localStorage for a
       few minutes so flipping between pages doesn't re-fetch constantly.
    ------------------------------------------------------------------ */
    async fetchEspn(url, cacheMinutes = ESPN_CONFIG.cacheMinutes, forceRefresh = false) {
        const cacheKey = `espn_cache_${url}`;
        if (!forceRefresh) {
            try {
                const cached = localStorage.getItem(cacheKey);
                if (cached) {
                    const { timestamp, data } = JSON.parse(cached);
                    if (Date.now() - timestamp < cacheMinutes * 60000) return data;
                }
            } catch (err) { /* localStorage unavailable — just fetch fresh */ }
        }
        const response = await fetch(url);
        if (!response.ok) throw new Error(`ESPN request failed (${response.status}) for ${url}`);
        const data = await response.json();
        try { localStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data })); } catch (err) { /* storage full — not fatal */ }
        return data;
    }

    espnScoreboardUrl(leagueSlug, datesParam, limit) {
        const base = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/scoreboard`;
        if (!datesParam) return base;
        return `${base}?dates=${datesParam}${limit ? `&limit=${limit}` : ''}`;
    }
    // NOTE: soccer standings return an empty {} on /apis/site/v2/ — has to
    // be /apis/v2/ instead. See the comment block at the top of this file.
    espnStandingsUrl(leagueSlug) {
        return `https://site.api.espn.com/apis/v2/sports/soccer/${leagueSlug}/standings`;
    }
    // Full match report (documented by ESPN to include a "lineups" field
    // for soccer) — used to draw the Tactical Lineup pitch. See the note
    // at the top of this file for how confident we are in the exact shape.
    espnSummaryUrl(leagueSlug, eventId) {
        return `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/summary?event=${eventId}`;
    }

    // Real Madrid's fixtures/results — built from the SAME scoreboard
    // endpoint the league hubs use (verified working), filtered down to
    // matches involving Real Madrid, rather than the separate
    // teams/{id}/schedule resource. That endpoint is real and documented,
    // but soccer isn't guaranteed to return the same shape American sports
    // do — that's very likely why this page was coming up empty. Scoreboard
    // is a shape we've already confirmed with real data, so this leans on
    // the safer bet. Covers La Liga + Champions League; doesn't currently
    // include Copa del Rey (ESPN slug esp.copa_del_rey, if you want to add
    // it — same pattern, just another league to fetch and merge).
    async fetchRmMatches(forceRefresh = false) {
        const now = new Date();
        const start = new Date(now); start.setUTCDate(start.getUTCDate() - 30);
        const end = new Date(now); end.setUTCDate(end.getUTCDate() + 60);
        const fmt = d => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
        const datesParam = `${fmt(start)}-${fmt(end)}`;

        const leagueSlugs = [ESPN_CONFIG.leagues.laLiga, ESPN_CONFIG.leagues.championsLeague];
        const responses = await Promise.allSettled(
            leagueSlugs.map(slug => this.fetchEspn(this.espnScoreboardUrl(slug, datesParam), ESPN_CONFIG.cacheMinutes, forceRefresh))
        );

        const rmId = String(ESPN_CONFIG.realMadridTeamId);
        const matches = [];
        responses.forEach((result, i) => {
            if (result.status !== "fulfilled") {
                console.warn(`ESPN fetch failed for ${leagueSlugs[i]} while building Real Madrid's schedule:`, result.reason);
                return;
            }
            (result.value.events || []).forEach(e => {
                const mapped = this.mapEspnEvent(e);
                mapped.leagueSlug = leagueSlugs[i];
                if (mapped.homeId === rmId || mapped.awayId === rmId) matches.push(mapped);
            });
        });
        return matches;
    }

    /* ---- API-FOOTBALL FETCH + CACHE (via your Cloudflare Worker) -------- */
    // Turns a failed API-Football fetch into a small, visible technical
    // detail (the HTTP status + endpoint, or "Failed to fetch" for a
    // network/CORS problem) so a failure is diagnosable right there on the
    // page — without needing to open DevTools. Meant to sit under a
    // friendlier one-line explanation, not replace it.
    // Updates a heading to show which season is actually on screen, but
    // only when it differs from the live current one (the free-plan season
    // cap) — e.g. "Top Scorers (2023/24)". Leaves the heading alone once
    // the cap no longer applies, so this quietly stops doing anything the
    // day the free plan (or a paid upgrade) covers the current season.
    labelSeasonHeading(elementId, baseLabel, seasonUsed) {
        const el = document.getElementById(elementId);
        if (!el) return;
        el.textContent = seasonUsed < this.currentEuropeanSeasonYear()
            ? `${baseLabel} (${seasonUsed}/${String(seasonUsed + 1).slice(2)})`
            : baseLabel;
    }

    apiFootballFailureNote(err) {
        const msg = (err && err.message) || "unknown error";
        return `<div style="margin-top:6px; font-size:0.8em; opacity:0.7;">(${this.escapeHtml(msg)})</div>`;
    }

    async fetchApiFootball(path, forceRefresh = false) {
        const cacheKey = `af_cache_${path}`;
        if (!forceRefresh) {
            try {
                const cached = localStorage.getItem(cacheKey);
                if (cached) {
                    const { timestamp, data } = JSON.parse(cached);
                    if (Date.now() - timestamp < API_FOOTBALL_CONFIG.cacheMinutes * 60000) return data;
                }
            } catch (err) { /* localStorage unavailable — just fetch fresh */ }
        }
        const base = API_FOOTBALL_CONFIG.proxyBaseUrl.replace(/\/+$/, '');
        const response = await fetch(`${base}/${path}`);
        if (!response.ok) throw new Error(`API-Football proxy request failed (${response.status}) for ${path}`);
        const data = await response.json();
        try { localStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data })); } catch (err) { /* not fatal */ }
        return data;
    }

    /* ---- ESPN RESPONSE → CARD/TABLE SHAPE --------------------------------
       Mapped into the same shape the old football-data.org version used
       (id/home/away/time/score/venue/status/isLive/statusLabel/etc.) so
       renderMatchCard, the modal, and RM_MATCH_SYNOPSES all keep working
       unchanged. matchday/stage/group are always null now — ESPN doesn't
       expose a matchday number for soccer — so those modal rows just don't
       render (see openMatchModal's conditionals further down).
    ------------------------------------------------------------------ */
    mapEspnEvent(event) {
        const comp = (event.competitions && event.competitions[0]) || {};
        const status = comp.status || event.status || {};
        const statusType = status.type || {};
        const state = statusType.state; // "pre" | "in" | "post"
        const completed = Boolean(statusType.completed);
        const isLive = state === "in";

        const competitors = comp.competitors || [];
        const home = competitors.find(c => c.homeAway === "home") || {};
        const away = competitors.find(c => c.homeAway === "away") || {};
        const homeId = home.team && home.team.id;
        const awayId = away.team && away.team.id;

        const rawDate = comp.date || event.date || null;
        const date = new Date(rawDate);
        const time = isNaN(date.getTime())
            ? "TBD"
            : date.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

        let score = "VS";
        if ((completed || isLive) && home.score != null && away.score != null) {
            score = `${home.score} - ${away.score}`;
        }

        const desc = statusType.description || "";
        let statusLabel = null;
        if (isLive) {
            statusLabel = status.displayClock && status.displayClock !== "0'" ? `LIVE ${status.displayClock}` : "LIVE";
        } else if (/postponed/i.test(desc)) {
            statusLabel = "Postponed";
        } else if (/cancel/i.test(desc)) {
            statusLabel = "Cancelled";
        } else if (/suspend/i.test(desc)) {
            statusLabel = "Suspended";
        }

        // Goals + cards, straight from ESPN — no API-Football call needed,
        // and no daily quota either. ESPN embeds this list (competitions[0]
        // .details) right on the same scoreboard payload we already fetch,
        // and it updates live as a match progresses, same as the score does.
        // Confirmed field names against a real finished match's response.
        const events = (comp.details || [])
            .filter(d => d && (d.scoringPlay || d.yellowCard || d.redCard))
            .map(d => {
                const athlete = d.athletesInvolved && d.athletesInvolved[0];
                const teamId = d.team && d.team.id;
                return {
                    seconds: (d.clock && d.clock.value) || 0,
                    minute: (d.clock && d.clock.displayValue) || "",
                    type: d.redCard ? "red" : (d.yellowCard ? "yellow" : "goal"),
                    teamSide: teamId === homeId ? "home" : (teamId === awayId ? "away" : null),
                    player: (athlete && (athlete.shortName || athlete.displayName)) || "Unknown",
                    ownGoal: Boolean(d.ownGoal),
                    penalty: Boolean(d.penaltyKick)
                };
            })
            .sort((a, b) => a.seconds - b.seconds);

        return {
            id: event.id || null,
            home: (home.team && (home.team.shortDisplayName || home.team.displayName)) || "TBD",
            away: (away.team && (away.team.shortDisplayName || away.team.displayName)) || "TBD",
            homeId: homeId || null,
            awayId: awayId || null,
            time,
            score,
            venue: (comp.venue && comp.venue.fullName) || "Venue TBC",
            status: completed ? "FINISHED" : (isLive ? "IN_PLAY" : "SCHEDULED"),
            isLive,
            statusLabel,
            events,
            halftime: null,
            matchday: null,
            stage: null,
            group: null,
            rawDate
        };
    }

    extractEspnStandingsEntries(data) {
        if (data && data.children && data.children[0] && data.children[0].standings && data.children[0].standings.entries) {
            return data.children[0].standings.entries;
        }
        if (data && data.standings && data.standings.entries) return data.standings.entries;
        return [];
    }

    mapEspnStandingsRow(entry) {
        const stat = (name) => {
            const found = (entry.stats || []).find(s => s.name === name);
            return found ? found.value : null;
        };
        return {
            pos: stat("rank"),
            team: (entry.team && (entry.team.shortDisplayName || entry.team.displayName)) || "Unknown",
            mp: stat("gamesPlayed"),
            w: stat("wins"),
            d: stat("ties"),
            l: stat("losses"),
            gd: stat("pointDifferential"),
            pts: stat("points")
        };
    }

    mapApiFootballScorer(row) {
        const stats = (row.statistics && row.statistics[0]) || {};
        return {
            player: (row.player && row.player.name) || "Unknown",
            team: (stats.team && stats.team.name) || "Unknown",
            goals: (stats.goals && stats.goals.total) || 0,
            assists: (stats.goals && stats.goals.assists) ?? null
        };
    }

    /* ---- ROUND (MATCHDAY) BUILDING ----------------------------------------
       ESPN's scoreboard response describes a season's calendar in one of
       TWO different shapes depending on the competition — confirmed
       against real fetches, Aug 23 2026:

         "day"  — a flat array of match-date strings for the whole season.
                  This is what Premier League and La Liga use. Since every
                  team plays every round with no byes, we can cluster
                  consecutive dates into weekly rounds (clusterDates below)
                  and just number them in order — round 1 IS Matchday 1,
                  round 2 IS Matchday 2, etc. Accurate as long as a fixture
                  reschedule doesn't shift a match into a totally different
                  week's cluster.

         "list" — ONE wrapper entry whose own `entries` array is the
                  competition's actual named STAGES, each with a real
                  start/end date and ESPN's own official label. This is
                  UCL's new format: League Phase, Knockout Round Playoffs,
                  Round of 16, Quarterfinals, Semifinals, Final. We use
                  those labels directly (far better than a guessed date
                  range), and for any stage that spans more than one
                  matchday/leg — the League Phase, or a two-legged
                  knockout tie — we fetch just that stage's own date
                  window and cluster IT too, producing labels like
                  "League Phase — Matchday 3" or "Round of 16 — Leg 2".

       Before this fix, every competition was run through the "day" logic
       above, including "list"-shaped ones. `new Date()` on a stage OBJECT
       (not a date string) produces Invalid Date, which collapsed UCL's
       entire season into one unusable "round" spanning the whole year —
       the real cause behind UCL's matchday browsing not working right.
    ------------------------------------------------------------------ */
    async buildRounds(seasonScoreboard, espnLeague) {
        const leagueObj = (seasonScoreboard.leagues && seasonScoreboard.leagues[0]) || {};
        const calendarType = leagueObj.calendarType;
        const calendar = leagueObj.calendar || [];

        if (calendarType === "list") {
            return this.buildStageRounds(calendar, espnLeague);
        }

        // Flat day-list (Premier League, La Liga, …) — cluster into weekly
        // rounds and number them in order.
        const dates = (calendar || []).map(d => new Date(d)).filter(d => !isNaN(d.getTime()));
        return this.clusterDates(dates).map((r, i) => ({
            start: r.start,
            end: r.end,
            label: `Matchday ${i + 1}`
        }));
    }

    // Stage-shaped competitions (UCL). Each named stage becomes at least
    // one browsable round; stages spanning multiple matchdays or legs get
    // sub-divided using the same date-clustering technique.
    async buildStageRounds(calendar, espnLeague) {
        const stageEntries = (calendar[0] && calendar[0].entries) || [];
        if (!stageEntries.length) return [];

        const results = await Promise.allSettled(stageEntries.map(stage => {
            const start = new Date(stage.startDate);
            const end = new Date(stage.endDate);
            const datesParam = `${this.formatYmd(start)}-${this.formatYmd(end)}`;
            return this.fetchEspn(this.espnScoreboardUrl(espnLeague, datesParam, 1000));
        }));

        const rounds = [];
        stageEntries.forEach((stage, i) => {
            const result = results[i];
            const stageEvents = (result.status === "fulfilled" && result.value.events) || [];
            if (result.status !== "fulfilled") {
                console.warn(`ESPN fetch failed for stage "${stage.label}":`, result.reason);
            }
            const eventDates = stageEvents.map(e => {
                const comp = (e.competitions && e.competitions[0]) || {};
                return new Date(comp.date || e.date);
            }).filter(d => !isNaN(d.getTime()));

            const subRounds = this.clusterDates(eventDates);
            const stageLabel = stage.label || "Round";
            const fallbackStart = new Date(stage.startDate);
            const fallbackEnd = new Date(stage.endDate);

            if (!subRounds.length) {
                // No events fetched (fetch failed, or nothing scheduled yet
                // for a future stage) — still show it as a browsable round
                // using the stage's own date window, so the arrows don't
                // just skip a whole stage of the competition.
                rounds.push({ start: fallbackStart, end: fallbackEnd, label: stageLabel });
            } else if (subRounds.length === 1) {
                rounds.push({ start: subRounds[0].start, end: subRounds[0].end, label: stageLabel });
            } else if (/league phase|group stage/i.test(stageLabel)) {
                subRounds.forEach((sr, j) => rounds.push({ start: sr.start, end: sr.end, label: `${stageLabel} — Matchday ${j + 1}` }));
            } else if (subRounds.length === 2) {
                rounds.push({ start: subRounds[0].start, end: subRounds[0].end, label: `${stageLabel} — Leg 1` });
                rounds.push({ start: subRounds[1].start, end: subRounds[1].end, label: `${stageLabel} — Leg 2` });
            } else {
                subRounds.forEach((sr, j) => rounds.push({ start: sr.start, end: sr.end, label: `${stageLabel} (${j + 1})` }));
            }
        });
        return rounds;
    }

    // Groups a list of Dates into rounds — a new round starts whenever
    // there's a gap of more than 3 days since the previous match-date.
    // That naturally separates one weekend/midweek round from the next
    // (and skips over international breaks) without needing an explicit
    // matchday number from ESPN.
    clusterDates(dates) {
        if (!dates.length) return [];
        const sorted = [...dates].sort((a, b) => a - b);
        const groups = [];
        let current = [sorted[0]];
        for (let i = 1; i < sorted.length; i++) {
            const gapDays = (sorted[i] - sorted[i - 1]) / 86400000;
            if (gapDays > 3) {
                groups.push(current);
                current = [sorted[i]];
            } else {
                current.push(sorted[i]);
            }
        }
        groups.push(current);
        return groups.map(g => ({ start: g[0], end: g[g.length - 1] }));
    }

    formatYmd(d) {
        return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    }

    formatRoundLabel(round) {
        return round.label;
    }

    // ESPN wants YYYYMMDD-YYYYMMDD. Widen by a day on each side so a match
    // near midnight in the visitor's timezone doesn't get trimmed off.
    formatDatesParam(round) {
        const fmt = d => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
        const start = new Date(round.start); start.setUTCDate(start.getUTCDate() - 1);
        const end = new Date(round.end); end.setUTCDate(end.getUTCDate() + 1);
        return `${fmt(start)}-${fmt(end)}`;
    }

    formatStage(stage) {
        if (!stage) return "Fixtures";
        return stage.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    }

    skeletonBlock(count) {
        return `<div class="skeleton-wrapper">${Array.from({ length: count }).map(() => '<div class="skeleton-card"></div>').join('')}</div>`;
    }

    /* ---- REAL MADRID OVERVIEW (team-scoped) ------------------------------ */
    async loadRmOverviewLive(forceRefresh = false) {
        const fixturesEl = document.getElementById("rm-fixtures-container");
        const resultsEl = document.getElementById("rm-results-container");
        const standingsEl = document.getElementById("rm-standings-container");
        const scorersEl = document.getElementById("rm-scorers-container");

        if (fixturesEl) fixturesEl.innerHTML = this.skeletonBlock(1);
        if (resultsEl) resultsEl.innerHTML = this.skeletonBlock(1);
        if (standingsEl) standingsEl.innerHTML = this.skeletonBlock(3);
        if (scorersEl) scorersEl.innerHTML = this.skeletonBlock(3);

        try {
            const events = await this.fetchRmMatches(forceRefresh);
            const now = new Date();

            // Live matches were vanishing from both lists here: once kickoff
            // passes, a live match's kickoff time is in the past (fails the
            // "upcoming" check) but its status isn't "FINISHED" yet either
            // (fails the "recent result" check) — so it fell through both
            // filters and just disappeared mid-match. Pulling live matches
            // out as their own bucket first, and always including them in
            // "Upcoming Matches" regardless of kickoff time, fixes that.
            const live = events.filter(e => e.isLive);
            const upcoming = events
                .filter(e => !e.isLive && e.status !== "FINISHED" && e.rawDate && new Date(e.rawDate) >= now)
                .sort((a, b) => new Date(a.rawDate) - new Date(b.rawDate));
            const fixtures = [...live, ...upcoming].slice(0, 5);

            const results = events
                .filter(e => !e.isLive && e.status === "FINISHED")
                .sort((a, b) => new Date(b.rawDate) - new Date(a.rawDate))
                .slice(0, 3)
                .map(m => { m.synopsis = RM_MATCH_SYNOPSES[m.id] || null; return m; });

            const fixturesHeading = document.getElementById("rm-fixtures-heading");
            if (fixturesHeading) fixturesHeading.textContent = live.length ? "Live Now" : "Upcoming Matches";

            if (fixturesEl) {
                fixturesEl.innerHTML = fixtures.length
                    ? fixtures.map(f => this.renderMatchCard(f, "Real Madrid")).join('')
                    : `<div class="empty-state">No upcoming fixtures returned right now.</div>`;
            }
            if (resultsEl) {
                resultsEl.innerHTML = results.length
                    ? results.map(r => this.renderMatchCard(r, "Real Madrid")).join('')
                    : `<div class="empty-state">No recent results returned right now.</div>`;
            }

            if (this.rmPollTimer) { clearInterval(this.rmPollTimer); this.rmPollTimer = null; }
            if (fixtures.some(f => f.isLive) || results.some(r => r.isLive)) {
                this.rmPollTimer = setInterval(() => this.loadRmOverviewLive(true), 60000);
            }
        } catch (err) {
            console.warn("ESPN Real Madrid schedule fetch failed, showing sample data instead:", err);
            this.loadRmOverview();
        }

        // Standings/scorers reuse the same La Liga cache key as the La Liga
        // hub page, so visiting both usually costs zero extra requests.
        try {
            const standingsData = await this.fetchEspn(this.espnStandingsUrl(ESPN_CONFIG.leagues.laLiga), ESPN_CONFIG.cacheMinutes, forceRefresh);
            const table = this.extractEspnStandingsEntries(standingsData).map(e => this.mapEspnStandingsRow(e));
            if (standingsEl) standingsEl.innerHTML = this.renderStandingsTable(table, "Real Madrid");
        } catch (err) {
            console.warn("ESPN La Liga standings failed on the Real Madrid page:", err);
            if (standingsEl) standingsEl.innerHTML = `<div class="empty-state">Standings unavailable right now.</div>`;
        }

        if (this.isApiFootballEnabled()) {
            try {
                const season = this.apiFootballSeasonYear();
                const scorersData = await this.fetchApiFootball(`players/topscorers?league=${API_FOOTBALL_CONFIG.leagues.laLiga}&season=${season}`);
                const scorersList = (scorersData.response || []).slice(0, 10).map(s => this.mapApiFootballScorer(s));
                if (scorersEl) scorersEl.innerHTML = this.renderScorersTable(scorersList);
                this.labelSeasonHeading("rm-scorers-heading", "La Liga Top Scorers", season);
            } catch (err) {
                console.warn("API-Football La Liga scorers failed on the Real Madrid page:", err);
                if (scorersEl) scorersEl.innerHTML = `<div class="empty-state">Top scorers unavailable right now.${this.apiFootballFailureNote(err)}</div>`;
            }
        } else if (scorersEl) {
            scorersEl.innerHTML = `<div class="empty-state">Add your Cloudflare Worker URL to see top scorers (see PROXY-SETUP.md).</div>`;
        }

        // Tactical Lineup pitch — ESPN, free, always attempted (no Worker
        // needed). Last Match Report stats + squad goals/assists leaderboard
        // are still the API-Football "bonus layer" and quietly no-op
        // (leaving the static example markup in real-madrid.html in place)
        // if the Worker isn't configured yet, or if the daily quota's run dry.
        this.loadRmLineup();
        this.loadRmMatchReport();
        this.loadRmSquadStats();
    }

    async loadHomeSidebarLive() {
        const sidebar = document.getElementById("latest-match-sidebar");
        if (!sidebar) return;
        try {
            const events = await this.fetchRmMatches();
            const now = new Date();
            const next = events
                .filter(e => e.status !== "FINISHED" && e.rawDate && new Date(e.rawDate) >= now)
                .sort((a, b) => new Date(a.rawDate) - new Date(b.rawDate))
                .slice(0, 1);
            sidebar.innerHTML = next.length
                ? next.map(f => this.renderMatchCard(f, "Real Madrid")).join('')
                : `<div class="empty-state">No upcoming fixture found.</div>`;
        } catch (err) {
            console.warn("ESPN homepage fetch failed, showing sample data instead:", err);
            this.loadHomeSidebar();
        }
    }

    /* ---- SAMPLE-DATA LOADERS (fallback on fetch failure) ------------------ */
    loadHomeSidebar() {
        const sidebar = document.getElementById("latest-match-sidebar");
        const data = this.mockData["Real Madrid"];
        if (!sidebar || !data) return;
        sidebar.innerHTML = data.fixtures.map(f => this.renderMatchCard(f, "Real Madrid")).join("");
    }

    loadRmOverview() {
        const fixturesEl = document.getElementById("rm-fixtures-container");
        const resultsEl = document.getElementById("rm-results-container");
        const data = this.mockData["Real Madrid"];
        if (!data) return;

        if (fixturesEl) {
            fixturesEl.innerHTML = data.fixtures.length
                ? data.fixtures.map(f => this.renderMatchCard(f, "Real Madrid")).join('')
                : `<div class="empty-state">No fixtures scheduled right now.</div>`;
        }
        if (resultsEl) {
            resultsEl.innerHTML = data.results.map(r => this.renderMatchCard(
                { home: r.home, away: r.away, score: r.score, time: "Full-time", venue: r.venue, status: "FINISHED" }, "Real Madrid"
            )).join('');
        }
    }

    /* ---- REAL MADRID BONUS LAYER (API-Football) --------------------------
       Last finished match's lineup drawn onto the tactical pitch, plus a
       compact stats + goal/card timeline panel, and a squad goals/assists
       leaderboard. All optional — each quietly leaves the existing static
       example markup in place if API-Football isn't configured or fails.
    ------------------------------------------------------------------ */
    // Statuses API-Football uses for a match that's actually in progress —
    // used by loadRmMatchReport (stats/events, still API-Football) to know
    // whether to keep polling. The pitch/lineup below no longer needs this —
    // loadRmLineup uses ESPN's own isLive flag instead.
    static LIVE_STATUSES = ["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"];

    /* ---- TACTICAL LINEUP PITCH (ESPN — free, no key, no daily quota) -----
       Picks Real Madrid's live match if one's in progress right now,
       otherwise their most recent finished match, and asks ESPN's summary
       endpoint for that match's lineups. Written defensively (see the
       file-header note) — if it can't find starters it logs the raw ESPN
       payload to the console rather than just failing quietly, so a field-
       name mismatch is a quick console-log fix rather than a mystery.
    ------------------------------------------------------------------ */
    async loadRmLineup(forceRefresh = false) {
        try {
            const events = await this.fetchRmMatches(forceRefresh);
            const live = events.find(e => e.isLive);
            const finished = events
                .filter(e => !e.isLive && e.status === "FINISHED")
                .sort((a, b) => new Date(b.rawDate) - new Date(a.rawDate))[0];
            const target = live || finished;

            if (!target) {
                this.markRmLineupUnavailable("No Real Madrid match found yet to show a lineup for — showing an example for now.");
                return;
            }

            const summary = await this.fetchEspn(
                this.espnSummaryUrl(target.leagueSlug, target.id),
                ESPN_CONFIG.cacheMinutes,
                forceRefresh || target.isLive
            );

            const block = this.findRmLineupBlock(summary);
            if (!block) {
                console.warn("ESPN summary had no lineup block for Real Madrid (or an unexpected shape) — raw response:", summary);
                this.markRmLineupUnavailable("ESPN hasn't published a lineup for this match yet — showing an example for now.");
                return;
            }

            const starters = this.extractLineupStarters(block);
            if (!starters.length) {
                console.warn("Found a Real Madrid lineup block but couldn't parse any starters out of it — raw block:", block);
                this.markRmLineupUnavailable("Couldn't read the lineup ESPN sent back for this match — showing an example for now.");
                return;
            }

            this.renderEspnLineupOnPitch(starters, block, target);

            if (this.rmLineupPollTimer) { clearInterval(this.rmLineupPollTimer); this.rmLineupPollTimer = null; }
            if (target.isLive) {
                this.rmLineupPollTimer = setInterval(() => this.loadRmLineup(true), 60000);
            }
        } catch (err) {
            console.warn("ESPN lineup fetch failed — leaving the example lineup in place:", err);
            this.markRmLineupUnavailable("Live lineup unavailable right now — ESPN's data for this match may not be published yet. Showing an example for now.");
        }
    }

    // ESPN documents the top-level key as "lineups" for soccer; "rosters"
    // is kept as a fallback since that's the key some of ESPN's other
    // sports use for the same kind of block.
    findRmLineupBlock(summary) {
        const blocks = (summary && (summary.lineups || summary.rosters)) || [];
        const teamId = String(ESPN_CONFIG.realMadridTeamId);
        return blocks.find(b => b && b.team && String(b.team.id) === teamId) || null;
    }

    // Tries a few plausible field names for the player list and for each
    // player's name/number/position/starter-status (see the file-header
    // note on why this isn't 100%-confirmed against a live payload). Falls
    // back to "first 11 entries" if no usable starter flag is found at all.
    extractLineupStarters(block) {
        const rawEntries = block.entries || block.roster || block.athletes || block.players || [];
        const normalized = rawEntries.map(entry => {
            const athlete = entry.athlete || entry.player || {};
            const position = entry.position || {};
            const posAbbr = (position.abbreviation || position.name || entry.positionAbbreviation || "").toString().toUpperCase();
            const hasStarterFlag = entry.starter !== undefined || entry.isStarter !== undefined;
            const starter = hasStarterFlag ? Boolean(entry.starter ?? entry.isStarter) : null;
            return {
                name: athlete.shortName || athlete.displayName || athlete.fullName || entry.playerName || "",
                number: athlete.jersey ?? entry.jersey ?? "",
                posAbbr,
                starter
            };
        }).filter(p => p.name);

        const withFlag = normalized.filter(p => p.starter !== null);
        if (withFlag.length >= 9) return withFlag.filter(p => p.starter).slice(0, 11);
        return normalized.slice(0, 11);
    }

    renderEspnLineupOnPitch(starters, block, target) {
        const pitchEl = document.querySelector("#rm-tab-lineup .pitch");
        if (!pitchEl) return;

        const startXI = this.mapEspnStartersToGrid(starters);
        pitchEl.querySelectorAll('.player-card').forEach(el => el.remove());
        pitchEl.insertAdjacentHTML('beforeend', this.buildPitchCardsHtml(startXI));

        const label = document.getElementById("rm-formation-label");
        if (label) {
            const rmId = String(ESPN_CONFIG.realMadridTeamId);
            const isHome = String(target.homeId) === rmId;
            const opponent = isHome ? target.away : target.home;
            const rawFormation = block.formation;
            const formation = typeof rawFormation === "string"
                ? rawFormation
                : (rawFormation && (rawFormation.name || rawFormation.displayName)) || "";
            label.textContent = `vs ${opponent}${formation ? ' — ' + formation : ''}`;
        }
    }

    // Buckets starters into GK / defense / midfield / attack purely from
    // each player's position abbreviation (ESPN may not hand us a neat
    // formation grid the way API-Football did), then reuses the same
    // "row:col" shape buildPitchCardsHtml already expects — so the actual
    // pixel-placement logic below didn't need to change at all.
    mapEspnStartersToGrid(starters) {
        const rowFor = (abbr) => {
            if (/^(GK|G)$/.test(abbr)) return 1;
            if (/^(D|CB|LB|RB|LWB|RWB|WB|SW)/.test(abbr)) return 2;
            if (/^(M|CM|CDM|CAM|DM|AM|LM|RM|WM)/.test(abbr)) return 3;
            return 4; // forwards/wingers, and anything unrecognized, default to the attacking row
        };
        const rows = {};
        starters.forEach(p => {
            const row = rowFor(p.posAbbr);
            (rows[row] = rows[row] || []).push(p);
        });
        const startXI = [];
        Object.keys(rows).forEach(row => {
            rows[row].forEach((p, i) => {
                startXI.push({ player: { name: p.name, number: p.number, grid: `${row}:${i + 1}` } });
            });
        });
        return startXI;
    }

    /* ---- LAST MATCH REPORT (stats/events — still API-Football) ----------
       The pitch above is now ESPN-powered (loadRmLineup); this part
       (possession/shots/corners table + goal/card timeline) is otherwise
       unchanged and still needs your Cloudflare Worker + API-Football key,
       so it's still subject to the free-plan season cap noted on
       API_FOOTBALL_CONFIG.maxFreeSeason.
    ------------------------------------------------------------------ */
    async loadRmMatchReport(forceRefresh = false) {
        if (!this.isApiFootballEnabled()) {
            this.markRmMatchReportUnavailable("Add your Cloudflare Worker URL to see match stats and a goal/card timeline here (see PROXY-SETUP.md). The Tactical Lineup pitch above doesn't need this — it's powered by ESPN directly.");
            return;
        }
        try {
            const teamId = API_FOOTBALL_CONFIG.realMadridTeamId;

            // Prefer today's fixture if Real Madrid are playing right now (or
            // about to) — that's when a live events/stats panel actually
            // matters. Falls back to the last finished match otherwise.
            let fx = null;
            const todayStr = new Date().toISOString().slice(0, 10);
            try {
                const todayResp = await this.fetchApiFootball(`fixtures?team=${teamId}&date=${todayStr}`, forceRefresh);
                fx = (todayResp.response || [])[0] || null;
            } catch (err) { /* fine — fall through to the last finished match */ }

            if (!fx) {
                const last = await this.fetchApiFootball(`fixtures?team=${teamId}&last=1`);
                fx = (last.response || [])[0] || null;
            }
            if (!fx) {
                console.warn(`API-Football returned no fixtures for team=${teamId} — double-check API_FOOTBALL_CONFIG.realMadridTeamId against the dashboard.`);
                this.markRmMatchReportUnavailable(`No fixtures came back for Real Madrid — most likely API-Football's free plan not covering the current season (confirmed: it only covers up to ${API_FOOTBALL_CONFIG.maxFreeSeason}). Could also be worth double-checking API_FOOTBALL_CONFIG.realMadridTeamId (currently ${teamId}) against the dashboard.`);
                return;
            }

            const isLive = Beyond90App.LIVE_STATUSES.includes(fx.fixture.status.short);
            const detail = await this.fetchApiFootball(`fixtures?id=${fx.fixture.id}`, forceRefresh || isLive);
            const match = detail.response && detail.response[0];
            if (!match) {
                this.markRmMatchReportUnavailable("The fixture came back without match details — try again shortly.");
                return;
            }

            this.renderMatchReportPanel(match, isLive);

            if (this.rmReportPollTimer) { clearInterval(this.rmReportPollTimer); this.rmReportPollTimer = null; }
            if (isLive) {
                this.rmReportPollTimer = setInterval(() => this.loadRmMatchReport(true), 60000);
            }
        } catch (err) {
            console.warn("API-Football match report failed — leaving the example stats in place:", err);
            this.markRmMatchReportUnavailable(
                `Match stats unavailable right now — most likely API-Football's free plan not covering the current season (confirmed: only up to ${API_FOOTBALL_CONFIG.maxFreeSeason}). Could also be the Cloudflare Worker (see PROXY-SETUP.md) or the daily 100-request quota.`,
                this.apiFootballFailureNote(err)
            );
        }
    }

    // Pitch-only failure message — touches #rm-formation-label alone, so it
    // can never stomp on the separately-loading Last Match Report panel.
    markRmLineupUnavailable(message) {
        const label = document.getElementById("rm-formation-label");
        if (label) label.textContent = message;
    }

    // Match-report-only failure message — touches #rm-match-report alone,
    // so it can never stomp on the separately-loading pitch/formation label.
    markRmMatchReportUnavailable(message, detailHtml = '') {
        const reportEl = document.getElementById("rm-match-report");
        if (reportEl) reportEl.innerHTML = `<div class="empty-state">${this.escapeHtml(message)}${detailHtml}</div>`;
    }

    // Converts a "row:col" grid position into a percentage top/left for
    // each player card. Row 1 is always the goalkeeper (placed near the
    // bottom of the pitch); higher row numbers move up toward attack.
    // Columns are spread evenly across whatever players share a row. Fed by
    // loadRmLineup/mapEspnStartersToGrid above — "row:col" is just a
    // convenient shared shape, not something ESPN's API returns verbatim.
    buildPitchCardsHtml(startXI) {
        const players = (startXI || []).map(p => p.player).filter(p => p && p.grid);
        const rows = {};
        players.forEach(p => {
            const parts = p.grid.split(':').map(Number);
            const row = parts[0], col = parts[1];
            if (!rows[row]) rows[row] = [];
            rows[row].push({ ...p, col });
        });
        const rowNumbers = Object.keys(rows).map(Number).sort((a, b) => a - b);
        const maxRow = rowNumbers[rowNumbers.length - 1] || 1;

        let html = '';
        rowNumbers.forEach(row => {
            const rowPlayers = rows[row].sort((a, b) => a.col - b.col);
            const count = rowPlayers.length;
            const top = maxRow <= 1 ? 90 : 92 - ((row - 1) / (maxRow - 1)) * 82;
            rowPlayers.forEach((p, i) => {
                const left = ((i + 1) / (count + 1)) * 100;
                html += `
                    <div class="player-card" style="top:${top}%; left:${left}%;">
                        <span class="num">${p.number ?? ''}</span>
                        <span class="name">${this.escapeHtml(p.name || '')}</span>
                    </div>`;
            });
        });
        return html;
    }

    renderMatchReportPanel(match, isLive) {
        const el = document.getElementById("rm-match-report");
        if (!el) return;

        const teamId = API_FOOTBALL_CONFIG.realMadridTeamId;
        const isHome = match.teams.home.id === teamId;
        const rmGoals = isHome ? match.goals.home : match.goals.away;
        const oppGoals = isHome ? match.goals.away : match.goals.home;
        const opponent = isHome ? match.teams.away.name : match.teams.home.name;

        const events = (match.events || [])
            .filter(e => e.type === "Goal" || e.type === "Card")
            .sort((a, b) => (a.time.elapsed + (a.time.extra || 0)) - (b.time.elapsed + (b.time.extra || 0)));

        const eventsHtml = events.length ? `
            <ul class="match-report-timeline">
                ${events.map(e => {
                    const minute = `${e.time.elapsed}${e.time.extra ? '+' + e.time.extra : ''}'`;
                    const icon = e.type === "Goal" ? "⚽" : (e.detail === "Red Card" ? "🟥" : "🟨");
                    const assist = e.assist && e.assist.name ? ` (assist: ${this.escapeHtml(e.assist.name)})` : "";
                    return `<li><strong>${minute}</strong> ${icon} ${this.escapeHtml((e.player && e.player.name) || '')}${assist} — ${this.escapeHtml((e.team && e.team.name) || '')}</li>`;
                }).join('')}
            </ul>` : `<p class="empty-state">No goal or card events returned for this match.</p>`;

        const statsBlocks = match.statistics || [];
        const rmStats = statsBlocks.find(s => s.team && s.team.id === teamId);
        const oppStats = statsBlocks.find(s => s.team && s.team.id !== teamId);
        const wantedStats = ["Ball Possession", "Total Shots", "Shots on Goal", "Corner Kicks", "Fouls", "Yellow Cards", "Red Cards"];
        const statVal = (block, type) => {
            if (!block) return "—";
            const found = (block.statistics || []).find(s => s.type === type);
            return (found && found.value !== null && found.value !== undefined) ? found.value : "—";
        };
        const statsHtml = `
            <div class="table-wrapper">
                <table class="standings-table">
                    <thead><tr><th style="text-align:left;">Stat</th><th>Real Madrid</th><th>${this.escapeHtml(opponent)}</th></tr></thead>
                    <tbody>
                        ${wantedStats.map(type => `<tr><td class="team-cell">${type}</td><td>${statVal(rmStats, type)}</td><td>${statVal(oppStats, type)}</td></tr>`).join('')}
                    </tbody>
                </table>
            </div>`;

        el.innerHTML = `
            <span class="section-label">Via API-Football${isLive ? ' — updating every 60s' : ''}</span>
            <h2>${isLive ? 'Live Match Report' : 'Last Match Report'}</h2>
            <p class="article-byline">${isLive ? '<span class="live-pill">LIVE</span> ' : ''}Real Madrid ${rmGoals} – ${oppGoals} ${this.escapeHtml(opponent)}</p>
            ${eventsHtml}
            ${statsHtml}
        `;
    }

    async loadRmSquadStats() {
        const el = document.getElementById("rm-squad-stats-container");
        if (!el || !this.isApiFootballEnabled()) return;

        el.innerHTML = this.skeletonBlock(4);
        try {
            const teamId = API_FOOTBALL_CONFIG.realMadridTeamId;
            const season = this.apiFootballSeasonYear();
            const [page1, page2] = await Promise.all([
                this.fetchApiFootball(`players?team=${teamId}&season=${season}&page=1`),
                this.fetchApiFootball(`players?team=${teamId}&season=${season}&page=2`)
            ]);
            const rows = [...(page1.response || []), ...(page2.response || [])]
                .map(row => {
                    const stats = row.statistics || [];
                    const goals = stats.reduce((sum, s) => sum + ((s.goals && s.goals.total) || 0), 0);
                    const assists = stats.reduce((sum, s) => sum + ((s.goals && s.goals.assists) || 0), 0);
                    const position = (stats[0] && stats[0].games && stats[0].games.position) || "—";
                    return { player: row.player.name, pos: position, goals, assists };
                })
                .filter(r => r.goals > 0 || r.assists > 0)
                .sort((a, b) => (b.goals - a.goals) || (b.assists - a.assists))
                .slice(0, 10);

            el.innerHTML = rows.length ? `
                <div class="table-wrapper">
                    <table class="standings-table">
                        <thead><tr><th style="text-align:left;">Player</th><th>Pos</th><th>Goals</th><th>Assists</th></tr></thead>
                        <tbody>
                            ${rows.map(r => `<tr><td class="team-cell">${this.escapeHtml(r.player)}</td><td>${r.pos}</td><td><strong>${r.goals}</strong></td><td>${r.assists}</td></tr>`).join('')}
                        </tbody>
                    </table>
                </div>` : `<div class="empty-state">No player stats returned yet this season.</div>`;

            // API-Football's free plan doesn't cover the current season (see
            // API_FOOTBALL_CONFIG.maxFreeSeason) — say so plainly right on
            // the page instead of quietly passing off older stats as
            // current.
            const introEl = document.getElementById("rm-stats-intro");
            if (introEl) {
                introEl.textContent = this.isApiFootballSeasonCapped()
                    ? `Goals and assists for the ${season}/${String(season + 1).slice(2)} season — API-Football's free plan doesn't cover the current season yet, via API-Football.`
                    : "Goals and assists across all competitions this season, via API-Football.";
            }
        } catch (err) {
            console.warn("API-Football squad stats failed:", err);
            // This used to leave the shimmering loading skeleton on screen
            // forever on failure — replacing it with a clear message is the
            // actual fix, not just the console.warn.
            el.innerHTML = `<div class="empty-state">Squad stats unavailable right now — this can mean the Cloudflare Worker needs a check (see PROXY-SETUP.md) or the daily 100-request quota ran dry. Try again later.${this.apiFootballFailureNote(err)}</div>`;
        }
    }

    /* ---- RENDER HELPERS ---------------------------------------- */
    // Compact goal/card line for a match card: "⚽ Saka 23' · 🟨 Yirenkyi 27'".
    // Caps at 6 so a blowout doesn't take over the card; full list goes in
    // the modal instead. Sample data has no .events, so this quietly no-ops.
    formatEventsStrip(events, limit) {
        if (!events || !events.length) return '';
        const shown = limit ? events.slice(0, limit) : events;
        const icon = { goal: '⚽', yellow: '🟨', red: '🟥' };
        const items = shown.map(e => {
            const tag = e.ownGoal ? ' (OG)' : (e.penalty ? ' (pen)' : '');
            return `${icon[e.type] || '⚽'} ${this.escapeHtml(e.player)} ${e.minute}${tag}`;
        });
        const extra = limit && events.length > limit ? ` +${events.length - limit} more` : '';
        return items.join(' · ') + extra;
    }

    renderMatchCard(match, leagueKey) {
        // NOTE: this attribute MUST use double quotes, not single quotes.
        // encodeURIComponent leaves apostrophes (') unescaped by spec — so
        // any text containing one (e.g. a synopsis with "Mourinho's") would
        // prematurely close a single-quoted attribute and corrupt the
        // surrounding HTML, silently breaking that card's click-to-expand.
        // This was a real bug: the one synopsis on the site so far contains
        // "Mourinho's", which is exactly what broke it.
        const payload = encodeURIComponent(JSON.stringify({ ...match, league: leagueKey }));
        const timeLabel = match.isLive
            ? `<span class="live-pill">${match.statusLabel || 'LIVE'}</span>`
            : (match.statusLabel || match.time || "Full-time");

        const eventsStrip = this.formatEventsStrip(match.events, 6);
        const eventsBlock = eventsStrip ? `<div class="match-events-strip">${eventsStrip}</div>` : '';

        let synopsisBlock = '';
        if (leagueKey === "Real Madrid" && match.status === "FINISHED") {
            if (match.synopsis) {
                // Only a short teaser lives on the card itself — the full
                // write-up (which can run long) shows in the modal when the
                // card is clicked/tapped, same as everything else on it.
                synopsisBlock = `
                    <div class="match-synopsis">
                        <span class="match-synopsis-label">Match Synopsis</span>
                        <p>${this.escapeHtml(this.truncateSynopsis(match.synopsis))}</p>
                        <span class="match-synopsis-cta">Tap to read the full write-up →</span>
                    </div>`;
            } else if (match.id) {
                synopsisBlock = `<div class="match-synopsis-hint">No synopsis added yet — match ID ${match.id}</div>`;
            }
        }

        return `
            <div class="match-card" tabindex="0" role="button" data-match="${payload}">
                <div class="match-time">${timeLabel}</div>
                <div class="match-teams">
                    <span class="teams-name">${match.home} vs ${match.away}</span>
                    <span class="match-score">${match.score}</span>
                </div>
                ${eventsBlock}
                ${synopsisBlock}
            </div>
        `;
    }

    renderScorersTable(scorers) {
        if (!scorers.length) {
            return `<div class="empty-state">No scorer data returned right now.</div>`;
        }
        return `
            <div class="table-wrapper">
                <table class="standings-table">
                    <thead>
                        <tr><th style="text-align:left;">Player</th><th style="text-align:left;">Team</th><th>Goals</th><th>Assists</th></tr>
                    </thead>
                    <tbody>
                        ${scorers.map(s => `
                            <tr>
                                <td class="team-cell">${s.player}</td>
                                <td>${s.team}</td>
                                <td><strong>${s.goals}</strong></td>
                                <td>${s.assists ?? '—'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    renderStandingsTable(standings, highlightTeam) {
        return `
            <div class="table-wrapper">
                <table class="standings-table">
                    <thead>
                        <tr>
                            <th>Pos</th><th style="text-align:left;">Team</th><th>MP</th>
                            <th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${standings.map(s => `
                            <tr class="${s.team === highlightTeam ? 'highlight-row' : ''}">
                                <td>${s.pos}</td>
                                <td class="team-cell">${s.team}</td>
                                <td>${s.mp}</td>
                                <td>${s.w ?? '—'}</td>
                                <td>${s.d ?? '—'}</td>
                                <td>${s.l ?? '—'}</td>
                                <td>${s.gd ?? '—'}</td>
                                <td><strong>${s.pts}</strong></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // Flattens a (possibly multi-paragraph) synopsis into a one-line teaser
    // for the compact match card. The full text still renders in the modal.
    truncateSynopsis(text, maxLen = 140) {
        const flat = String(text).replace(/\s+/g, ' ').trim();
        if (flat.length <= maxLen) return flat;
        return flat.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
    }

    /* ---- MATCH DETAIL MODAL ---------------------------------------- */
    setupModal() {
        const modal = document.getElementById("match-modal");
        if (!modal) return;

        document.addEventListener("click", (e) => {
            const card = e.target.closest("[data-match]");
            if (card) this.openMatchModal(card.getAttribute("data-match"));
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                const card = e.target.closest("[data-match]");
                if (card) {
                    e.preventDefault();
                    this.openMatchModal(card.getAttribute("data-match"));
                }
            }
            if (e.key === "Escape") this.closeMatchModal();
        });

        modal.addEventListener("click", (e) => {
            if (e.target === modal) this.closeMatchModal();
        });
        modal.querySelectorAll(".modal-close").forEach(btn =>
            btn.addEventListener("click", () => this.closeMatchModal())
        );
    }

    openMatchModal(payload) {
        const modal = document.getElementById("match-modal");
        const content = document.getElementById("modal-details-content");
        if (!modal || !content) return;

        let match;
        try { match = JSON.parse(decodeURIComponent(payload)); } catch (err) { return; }

        const statusRow = match.isLive
            ? `<div class="modal-detail-row"><span>Status</span><span class="live-pill">${match.statusLabel || 'LIVE'}</span></div>`
            : (match.statusLabel ? `<div class="modal-detail-row"><span>Status</span><span>${match.statusLabel}</span></div>` : '');

        const halftimeRow = match.halftime
            ? `<div class="modal-detail-row"><span>Half-time</span><span>${match.halftime}</span></div>` : '';

        const stageRow = (match.matchday !== undefined && match.matchday !== null)
            ? `<div class="modal-detail-row"><span>Matchday</span><span>${match.matchday}</span></div>`
            : (match.stage ? `<div class="modal-detail-row"><span>Stage</span><span>${this.formatStage(match.stage)}</span></div>` : '');

        const groupRow = match.group ? `<div class="modal-detail-row"><span>Group</span><span>${match.group}</span></div>` : '';

        const eventsRow = (match.events && match.events.length) ? `
            <ul class="match-report-timeline">
                ${match.events.map(e => {
                    const icon = e.type === "goal" ? "⚽" : (e.type === "red" ? "🟥" : "🟨");
                    const tag = e.ownGoal ? " (OG)" : (e.penalty ? " (pen)" : "");
                    const side = e.teamSide === "home" ? match.home : (e.teamSide === "away" ? match.away : "");
                    return `<li><strong>${e.minute}</strong> ${icon} ${this.escapeHtml(e.player)}${tag}${side ? ` — ${this.escapeHtml(side)}` : ""}</li>`;
                }).join('')}
            </ul>` : '';

        const synopsisRow = match.synopsis
            ? `<div class="modal-synopsis">
                   <span class="modal-synopsis-label">Match Synopsis</span>
                   <p>${this.escapeHtml(match.synopsis)}</p>
               </div>`
            : '';

        content.innerHTML = `
            <div class="modal-competition">${match.league || "Match Details"}</div>
            <div class="modal-fixture">${match.home} vs ${match.away}</div>
            ${statusRow}
            <div class="modal-detail-row"><span>Kickoff</span><span>${match.time || "Full-time"}</span></div>
            <div class="modal-detail-row"><span>Score</span><span>${match.score}</span></div>
            ${halftimeRow}
            ${stageRow}
            ${groupRow}
            ${match.venue ? `<div class="modal-detail-row"><span>Venue</span><span>${match.venue}</span></div>` : ''}
            ${eventsRow}
            ${synopsisRow}
        `;

        modal.classList.add("active");
        document.body.style.overflow = "hidden";
    }

    closeMatchModal() {
        const modal = document.getElementById("match-modal");
        if (!modal) return;
        modal.classList.remove("active");
        document.body.style.overflow = "";
    }
}

/* ==========================================================================
   COMPETITION HUB
   Powers the Premier League, UCL, and La Liga pages: round-by-round
   browsing with ← → arrows (grouped from ESPN's season calendar — see
   buildRounds/buildStageRounds), a full always-current league table
   (ESPN), a Top Scorers list (API-Football, if configured), and live
   polling while a match in the visible round is in progress.
   ========================================================================== */
class CompetitionHub {
    constructor(app, config) {
        this.app = app;
        this.espnLeague = config.espnLeague;
        this.apiFootballLeagueId = config.apiFootballLeagueId;
        this.leagueKey = config.leagueKey;
        this.fixturesEl = document.getElementById(config.fixturesId);
        this.standingsEl = document.getElementById(config.standingsId);
        this.scorersEl = document.getElementById(config.scorersId);
        this.statusEl = document.getElementById(config.statusId);
        this.labelEl = document.getElementById(config.labelId);
        this.prevBtn = document.getElementById(config.prevId);
        this.nextBtn = document.getElementById(config.nextId);
        this.refreshBtn = document.getElementById(config.refreshId);
        this.rounds = [];
        this.roundIndex = 0;
        this.pollTimer = null;
    }

    async init() {
        if (this.prevBtn) this.prevBtn.addEventListener("click", () => this.go(-1));
        if (this.nextBtn) this.nextBtn.addEventListener("click", () => this.go(1));
        if (this.refreshBtn) this.refreshBtn.addEventListener("click", () => this.loadRound(true));

        if (this.fixturesEl) this.fixturesEl.innerHTML = this.app.skeletonBlock(3);
        if (this.standingsEl) this.standingsEl.innerHTML = this.app.skeletonBlock(6);
        if (this.scorersEl) this.scorersEl.innerHTML = this.app.skeletonBlock(5);
        if (this.statusEl) this.statusEl.textContent = "Status: Fetching from ESPN…";

        try {
            const seasonScoreboard = await this.app.fetchEspn(this.app.espnScoreboardUrl(this.espnLeague));
            this.rounds = await this.app.buildRounds(seasonScoreboard, this.espnLeague);

            const now = new Date();
            let idx = this.rounds.findIndex(r => r.end >= now);
            if (idx === -1) idx = Math.max(this.rounds.length - 1, 0);
            this.roundIndex = idx;

            await this.loadRound();
        } catch (err) {
            console.warn(`ESPN fetch failed for ${this.leagueKey}, showing sample data instead:`, err);
            this.loadSample();
            return;
        }

        this.loadStandings();
        this.loadScorers();
    }

    async loadRound(forceRefresh = false) {
        if (!this.rounds.length) return;
        const round = this.rounds[this.roundIndex];
        if (this.labelEl) this.labelEl.textContent = this.app.formatRoundLabel(round);
        if (this.prevBtn) this.prevBtn.disabled = this.roundIndex === 0;
        if (this.nextBtn) this.nextBtn.disabled = this.roundIndex === this.rounds.length - 1;
        if (this.fixturesEl) this.fixturesEl.innerHTML = this.app.skeletonBlock(3);

        try {
            const data = await this.app.fetchEspn(
                this.app.espnScoreboardUrl(this.espnLeague, this.app.formatDatesParam(round)),
                ESPN_CONFIG.cacheMinutes, forceRefresh
            );
            const events = (data.events || []).map(e => this.app.mapEspnEvent(e))
                .sort((a, b) => new Date(a.rawDate) - new Date(b.rawDate));

            if (this.fixturesEl) {
                this.fixturesEl.innerHTML = events.length
                    ? events.map(m => this.app.renderMatchCard(m, this.leagueKey)).join('')
                    : `<div class="empty-state">No matches found for this window.</div>`;
            }
            const count = events.length;
            if (this.statusEl) this.statusEl.textContent = `Status: Synced with ESPN (${count} match${count === 1 ? '' : 'es'} loaded)`;
            this.manageLivePolling(events);
        } catch (err) {
            console.warn(`ESPN round fetch failed for ${this.leagueKey}:`, err);
            if (this.fixturesEl) this.fixturesEl.innerHTML = `<div class="empty-state">Couldn't load this window right now — try Refresh.</div>`;
            if (this.statusEl) this.statusEl.textContent = "Status: ESPN fetch failed";
        }
    }

    async loadStandings() {
        if (!this.standingsEl) return;
        try {
            const data = await this.app.fetchEspn(this.app.espnStandingsUrl(this.espnLeague));
            const table = this.app.extractEspnStandingsEntries(data).map(e => this.app.mapEspnStandingsRow(e));
            this.standingsEl.innerHTML = this.app.renderStandingsTable(table, null);
        } catch (err) {
            console.warn(`ESPN standings failed for ${this.leagueKey}:`, err);
            this.standingsEl.innerHTML = `<div class="empty-state">Standings unavailable right now.</div>`;
        }
    }

    async loadScorers() {
        if (!this.scorersEl) return;
        if (!this.app.isApiFootballEnabled()) {
            this.scorersEl.innerHTML = `<div class="empty-state">Add your Cloudflare Worker URL to see top scorers (see PROXY-SETUP.md).</div>`;
            return;
        }
        try {
            const season = this.app.apiFootballSeasonYear();
            const data = await this.app.fetchApiFootball(`players/topscorers?league=${this.apiFootballLeagueId}&season=${season}`);
            const scorers = (data.response || []).slice(0, 10).map(r => this.app.mapApiFootballScorer(r));
            this.scorersEl.innerHTML = this.app.renderScorersTable(scorers);
            this.app.labelSeasonHeading(this.scorersEl.id.replace("-container", "-heading"), "Top Scorers", season);
        } catch (err) {
            console.warn(`API-Football scorers failed for ${this.leagueKey}:`, err);
            this.scorersEl.innerHTML = `<div class="empty-state">Top scorers unavailable right now — API-Football's free plan is 100 requests/day shared by every visitor, so this can run dry. Try again later.${this.app.apiFootballFailureNote(err)}</div>`;
        }
    }

    go(delta) {
        const next = this.roundIndex + delta;
        if (next < 0 || next >= this.rounds.length) return;
        this.roundIndex = next;
        this.loadRound();
    }

    manageLivePolling(events) {
        if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
        const isLive = events.some(m => m.isLive);
        if (isLive) {
            if (this.statusEl) this.statusEl.textContent = "Status: Live — updating every 60 seconds";
            this.pollTimer = setInterval(() => this.loadRound(true), 60000);
        }
    }

    loadSample() {
        const data = this.app.mockData[this.leagueKey];
        if (!data) return;
        if (this.labelEl) this.labelEl.textContent = data.matchdayLabel || "Sample";
        if (this.prevBtn) this.prevBtn.disabled = true;
        if (this.nextBtn) this.nextBtn.disabled = true;
        if (this.fixturesEl) this.fixturesEl.innerHTML = data.fixtures.map(f => this.app.renderMatchCard(f, this.leagueKey)).join('');
        if (this.standingsEl) this.standingsEl.innerHTML = this.app.renderStandingsTable(data.standings, null);
        if (this.scorersEl) {
            this.scorersEl.innerHTML = data.scorers
                ? this.app.renderScorersTable(data.scorers)
                : `<div class="empty-state">Sample data — connect live data to see real scorers.</div>`;
        }
        if (this.statusEl) this.statusEl.textContent = "Status: Showing sample data";
    }
}

const app = new Beyond90App();
