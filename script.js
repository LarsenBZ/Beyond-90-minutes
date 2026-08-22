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
      espnStandingsUrl() below. Also: ESPN doesn't give soccer a "Matchday
      12" style number the way football-data.org did, so browsing is done
      by date-range "rounds" instead (see buildRoundsFromCalendar) — the
      label reads like "Aug 21 – Aug 24" rather than "Matchday 12".

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
    proxyBaseUrl: "", // <-- EDIT ME once your Worker is deployed (PROXY-SETUP.md Step 7), e.g. "https://beyond90-proxy.YOURNAME.workers.dev"
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
    cacheMinutes: 180
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
    // "645191": "Real Madrid controlled midfield for the first hour before Barcelona's press forced a mistake. Mbappé's second-half brace..."
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
            this.autoLoadPageData();
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

    espnScoreboardUrl(leagueSlug, datesParam) {
        const base = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/scoreboard`;
        return datesParam ? `${base}?dates=${datesParam}` : base;
    }
    // NOTE: soccer standings return an empty {} on /apis/site/v2/ — has to
    // be /apis/v2/ instead. See the comment block at the top of this file.
    espnStandingsUrl(leagueSlug) {
        return `https://site.api.espn.com/apis/v2/sports/soccer/${leagueSlug}/standings`;
    }
    espnTeamScheduleUrl(leagueSlug, teamId) {
        return `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/teams/${teamId}/schedule`;
    }

    /* ---- API-FOOTBALL FETCH + CACHE (via your Cloudflare Worker) -------- */
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

        return {
            id: event.id || null,
            home: (home.team && (home.team.shortDisplayName || home.team.displayName)) || "TBD",
            away: (away.team && (away.team.shortDisplayName || away.team.displayName)) || "TBD",
            time,
            score,
            venue: (comp.venue && comp.venue.fullName) || "Venue TBC",
            status: completed ? "FINISHED" : (isLive ? "IN_PLAY" : "SCHEDULED"),
            isLive,
            statusLabel,
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

    /* ---- ROUND (MATCHDAY-EQUIVALENT) BUILDING ----------------------------
       ESPN gives us the full season's match-dates up front (the scoreboard
       response's leagues[0].calendar array). We cluster consecutive dates
       into "rounds" — a new round starts whenever there's a gap of more
       than 4 days since the last match-date. That naturally separates
       Premier League weekends from each other, UCL midweek rounds from
       each other, and skips over international breaks, without needing an
       explicit "Matchday 12" number that ESPN doesn't give us for soccer.
    ------------------------------------------------------------------ */
    buildRoundsFromCalendar(calendarDates) {
        if (!calendarDates || !calendarDates.length) return [];
        const dates = calendarDates.map(d => new Date(d)).sort((a, b) => a - b);
        const rounds = [];
        let current = [dates[0]];
        for (let i = 1; i < dates.length; i++) {
            const gapDays = (dates[i] - dates[i - 1]) / 86400000;
            // A typical Monday-of-one-round to Friday-of-the-next gap is
            // exactly 4 days, so the boundary has to sit just under that —
            // gapDays > 3 — or back-to-back weekend rounds merge into one.
            if (gapDays > 3) {
                rounds.push(current);
                current = [dates[i]];
            } else {
                current.push(dates[i]);
            }
        }
        rounds.push(current);
        return rounds.map(group => ({ start: group[0], end: group[group.length - 1] }));
    }

    formatRoundLabel(round) {
        const opts = { month: "short", day: "numeric" };
        const startStr = round.start.toLocaleDateString(undefined, opts);
        const endStr = round.end.toLocaleDateString(undefined, opts);
        return startStr === endStr ? startStr : `${startStr} – ${endStr}`;
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
            const scheduleData = await this.fetchEspn(
                this.espnTeamScheduleUrl(ESPN_CONFIG.leagues.laLiga, ESPN_CONFIG.realMadridTeamId),
                ESPN_CONFIG.cacheMinutes, forceRefresh
            );
            const events = (scheduleData.events || []).map(e => this.mapEspnEvent(e));
            const now = new Date();

            const fixtures = events
                .filter(e => e.status !== "FINISHED" && e.rawDate && new Date(e.rawDate) >= now)
                .sort((a, b) => new Date(a.rawDate) - new Date(b.rawDate))
                .slice(0, 5);

            const results = events
                .filter(e => e.status === "FINISHED")
                .sort((a, b) => new Date(b.rawDate) - new Date(a.rawDate))
                .slice(0, 3)
                .map(m => { m.synopsis = RM_MATCH_SYNOPSES[m.id] || null; return m; });

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
                const season = this.currentEuropeanSeasonYear();
                const scorersData = await this.fetchApiFootball(`players/topscorers?league=${API_FOOTBALL_CONFIG.leagues.laLiga}&season=${season}`);
                const scorersList = (scorersData.response || []).slice(0, 10).map(s => this.mapApiFootballScorer(s));
                if (scorersEl) scorersEl.innerHTML = this.renderScorersTable(scorersList);
            } catch (err) {
                console.warn("API-Football La Liga scorers failed on the Real Madrid page:", err);
                if (scorersEl) scorersEl.innerHTML = `<div class="empty-state">Top scorers unavailable right now.</div>`;
            }
        } else if (scorersEl) {
            scorersEl.innerHTML = `<div class="empty-state">Add your Cloudflare Worker URL to see top scorers (see PROXY-SETUP.md).</div>`;
        }

        // Bonus layer, API-Football only: last match's lineup/stats + a
        // squad goals/assists leaderboard. Both quietly no-op (leaving the
        // static example markup in real-madrid.html in place) if the Worker
        // isn't configured yet, or if the daily quota's run dry.
        this.loadRmMatchReport();
        this.loadRmSquadStats();
    }

    async loadHomeSidebarLive() {
        const sidebar = document.getElementById("latest-match-sidebar");
        if (!sidebar) return;
        try {
            const scheduleData = await this.fetchEspn(this.espnTeamScheduleUrl(ESPN_CONFIG.leagues.laLiga, ESPN_CONFIG.realMadridTeamId));
            const now = new Date();
            const next = (scheduleData.events || [])
                .map(e => this.mapEspnEvent(e))
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
    async loadRmMatchReport() {
        if (!this.isApiFootballEnabled()) return;
        try {
            const teamId = API_FOOTBALL_CONFIG.realMadridTeamId;
            const last = await this.fetchApiFootball(`fixtures?team=${teamId}&last=1`);
            const fx = last.response && last.response[0];
            if (!fx) {
                console.warn(`API-Football returned no fixtures for team=${teamId} — double-check API_FOOTBALL_CONFIG.realMadridTeamId against the dashboard.`);
                return;
            }

            const detail = await this.fetchApiFootball(`fixtures?id=${fx.fixture.id}`);
            const match = detail.response && detail.response[0];
            if (!match) return;

            this.renderLineupOnPitch(match);
            this.renderMatchReportPanel(match);
        } catch (err) {
            console.warn("API-Football match report failed — leaving the example lineup/stats in place:", err);
        }
    }

    renderLineupOnPitch(match) {
        const pitchEl = document.querySelector("#rm-tab-lineup .pitch");
        if (!pitchEl || !match.lineups || !match.lineups.length) return;

        const teamId = API_FOOTBALL_CONFIG.realMadridTeamId;
        const rm = match.lineups.find(l => l.team && l.team.id === teamId) || match.lineups[0];
        if (!rm || !rm.startXI || !rm.startXI.length) return;

        pitchEl.querySelectorAll('.player-card').forEach(el => el.remove());
        pitchEl.insertAdjacentHTML('beforeend', this.buildPitchCardsHtml(rm.startXI));

        const label = document.getElementById("rm-formation-label");
        if (label) {
            const isHome = match.teams.home.id === teamId;
            const opponent = isHome ? match.teams.away.name : match.teams.home.name;
            label.textContent = `vs ${opponent}${rm.formation ? ' — ' + rm.formation : ''}`;
        }
    }

    // Converts API-Football's "row:col" grid positions into a percentage
    // top/left for each player card. Row 1 is always the goalkeeper (placed
    // near the bottom of the pitch); higher row numbers move up toward
    // attack. Columns are spread evenly across whatever players share a row.
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

    renderMatchReportPanel(match) {
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
            <span class="section-label">Via API-Football</span>
            <h2>Last Match Report</h2>
            <p class="article-byline">Real Madrid ${rmGoals} – ${oppGoals} ${this.escapeHtml(opponent)}</p>
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
            const season = this.currentEuropeanSeasonYear();
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
        } catch (err) {
            console.warn("API-Football squad stats failed, leaving the example table in place:", err);
        }
    }

    /* ---- RENDER HELPERS ---------------------------------------- */
    renderMatchCard(match, leagueKey) {
        const payload = encodeURIComponent(JSON.stringify({ ...match, league: leagueKey }));
        const timeLabel = match.isLive
            ? `<span class="live-pill">${match.statusLabel || 'LIVE'}</span>`
            : (match.statusLabel || match.time || "Full-time");

        let synopsisBlock = '';
        if (leagueKey === "Real Madrid" && match.status === "FINISHED") {
            if (match.synopsis) {
                synopsisBlock = `
                    <div class="match-synopsis">
                        <span class="match-synopsis-label">Match Synopsis</span>
                        <p>${this.escapeHtml(match.synopsis)}</p>
                    </div>`;
            } else if (match.id) {
                synopsisBlock = `<div class="match-synopsis-hint">No synopsis added yet — match ID ${match.id}</div>`;
            }
        }

        return `
            <div class="match-card" tabindex="0" role="button" data-match='${payload}'>
                <div class="match-time">${timeLabel}</div>
                <div class="match-teams">
                    <span class="teams-name">${match.home} vs ${match.away}</span>
                    <span class="match-score">${match.score}</span>
                </div>
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
   buildRoundsFromCalendar), a full always-current league table (ESPN), a
   Top Scorers list (API-Football, if configured), and live polling while a
   match in the visible round is in progress.
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
            const calendar = (seasonScoreboard.leagues && seasonScoreboard.leagues[0] && seasonScoreboard.leagues[0].calendar) || [];
            this.rounds = this.app.buildRoundsFromCalendar(calendar);

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
            const season = this.app.currentEuropeanSeasonYear();
            const data = await this.app.fetchApiFootball(`players/topscorers?league=${this.apiFootballLeagueId}&season=${season}`);
            const scorers = (data.response || []).slice(0, 10).map(r => this.app.mapApiFootballScorer(r));
            this.scorersEl.innerHTML = this.app.renderScorersTable(scorers);
        } catch (err) {
            console.warn(`API-Football scorers failed for ${this.leagueKey}:`, err);
            this.scorersEl.innerHTML = `<div class="empty-state">Top scorers unavailable right now — API-Football's free plan is 100 requests/day shared by every visitor, so this can run dry. Try again later.</div>`;
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
