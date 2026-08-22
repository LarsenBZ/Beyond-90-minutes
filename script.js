/* ==========================================================================
   Beyond 90 Minutes — Core JavaScript
   Handles: navigation, dark mode, article search/filter, live league data
   (football-data.org), matchday-by-matchday browsing with live polling,
   league Top Scorers lists, the match detail modal, Real Madrid post-match
   synopses, and the Real Madrid tab switching.

   A NOTE ON THE FREE FOOTBALL-DATA.ORG TIER, so future-you isn't
   surprised: the free plan gives you fixtures, results, scores,
   standings, AND a season-long Top Scorers list (goals/assists per
   player) for PL / La Liga / UCL and a few others. What it does NOT
   give you — lineups, substitutions, cards, or a specific match's own
   goal-scorer/event timeline — is a paid add-on ("deep data pack").
   So there's no way to have the API tell us who scored in a specific
   Real Madrid match; that's exactly what RM_MATCH_SYNOPSES below is
   for — you write that part by hand, same way a real analyst would.

   A NOTE ON REAL MADRID SYNOPSES: see RM_MATCH_SYNOPSES below. Unlike
   an older version of this file which saved notes to localStorage
   (private, one device only), synopses now live in this file itself.
   That means they deploy with the rest of the site to GitHub Pages
   and are visible to every visitor, not just you.
   ========================================================================== */

const FOOTBALL_DATA_CONFIG = {
    proxyBaseUrl: "https://beyond90-proxy.braulioz147.workers.dev/",
    cacheMinutes: 5,  // how long to reuse a response before asking the API again
    teams: {
        realMadrid: 86
    },
    competitions: {
        premierLeague: "PL",
        championsLeague: "CL",
        laLiga: "PD"
    }
};

/* ---- REAL MADRID POST-MATCH SYNOPSES -------------------------------------
   HOW TO USE THIS, after a Real Madrid match finishes:
     1. Open the live site's Real Madrid page and look under "Recent Results".
        A finished match with no synopsis yet shows a small hint line like
        "No synopsis added yet — match ID 546987".
     2. Copy that number and add a line below: "546987": "Your synopsis..."
     3. Save, commit, and push to GitHub like normal. Once it deploys, your
        synopsis replaces the hint for every visitor — not just you, and not
        just on this device.
   Text can be as long as you want (a full paragraph or several) — it'll
   wrap naturally under the match card and in the match's detail popup.
   ---------------------------------------------------------------------- */
const RM_MATCH_SYNOPSES = {
    // "546987": "Real Madrid controlled midfield for the first hour before Barcelona's press forced a mistake. Mbappé's second-half brace..."
};

class Beyond90App {
    constructor() {
        /* ---- SAMPLE / FALLBACK DATA -----------------------------------
           Shown immediately if the live fetch fails, or if you clear out
           proxyBaseUrl above. Keeping this around means the site always
           has something to show instead of a blank page.
        ------------------------------------------------------------------ */
        this.mockData = {
            "Premier League": {
                matchdayLabel: "Sample Matchday",
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
                matchdayLabel: "Sample Matchday",
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
                matchdayLabel: "Sample Matchday",
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
                code: FOOTBALL_DATA_CONFIG.competitions.premierLeague,
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
                code: FOOTBALL_DATA_CONFIG.competitions.championsLeague,
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
                code: FOOTBALL_DATA_CONFIG.competitions.laLiga,
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
            this.isLiveDataEnabled() ? this.loadRmOverviewLive() : this.loadRmOverview();
        } else if (page === "home") {
            this.isLiveDataEnabled() ? this.loadHomeSidebarLive() : this.loadHomeSidebar();
        }
    }

    isLiveDataEnabled() {
        return Boolean(FOOTBALL_DATA_CONFIG.proxyBaseUrl && FOOTBALL_DATA_CONFIG.proxyBaseUrl.trim().length > 8);
    }

    /* ---- FOOTBALL-DATA.ORG FETCH (via your proxy) + CACHE -----------------
       Caches each response in localStorage for a few minutes so switching
       between pages, or reloading, doesn't burn through the 10-req/min
       free-tier limit. Pass forceRefresh=true (the Refresh button, and the
       live-polling timer, both do this) to skip the cache and ask the
       proxy directly.
    ------------------------------------------------------------------ */
    async fetchFootballData(endpoint, forceRefresh = false) {
        const cacheKey = `fd_cache_${endpoint}`;

        if (!forceRefresh) {
            try {
                const cached = localStorage.getItem(cacheKey);
                if (cached) {
                    const { timestamp, data } = JSON.parse(cached);
                    if (Date.now() - timestamp < FOOTBALL_DATA_CONFIG.cacheMinutes * 60000) {
                        return data;
                    }
                }
            } catch (err) { /* localStorage unavailable — just fetch fresh */ }
        }

        // Strip a trailing slash so pasting the Worker URL either way
        // ("...workers.dev" or "...workers.dev/") never produces a
        // double-slash path like ".dev//v4/..." — some servers 404 on that.
        const base = FOOTBALL_DATA_CONFIG.proxyBaseUrl.replace(/\/+$/, '');
        const response = await fetch(`${base}/v4${endpoint}`);
        if (!response.ok) {
            throw new Error(`Proxy request failed (${response.status}) for ${endpoint}`);
        }
        const data = await response.json();

        try {
            localStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data }));
        } catch (err) { /* storage full or unavailable — not fatal */ }

        return data;
    }

    /* ---- API RESPONSE → CARD/TABLE SHAPE ---------------------------------- */
    mapMatch(match) {
        const date = new Date(match.utcDate);
        const status = match.status || "SCHEDULED";
        const isLive = status === "IN_PLAY" || status === "PAUSED";
        const finished = status === "FINISHED";
        const time = isNaN(date.getTime())
            ? "TBD"
            : date.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

        let score = "VS";
        if ((finished || isLive) && match.score && match.score.fullTime && match.score.fullTime.home !== null) {
            score = `${match.score.fullTime.home} - ${match.score.fullTime.away}`;
        }

        let statusLabel = null;
        if (isLive) statusLabel = status === "PAUSED" ? "HT" : (match.minute ? `LIVE ${match.minute}'` : "LIVE");
        else if (status === "POSTPONED") statusLabel = "Postponed";
        else if (status === "SUSPENDED") statusLabel = "Suspended";
        else if (status === "CANCELLED") statusLabel = "Cancelled";
        else if (status === "AWARDED") statusLabel = "Awarded";

        const halftime = (match.score && match.score.halfTime && match.score.halfTime.home !== null)
            ? `${match.score.halfTime.home} - ${match.score.halfTime.away}`
            : null;

        return {
            id: match.id || null,
            home: (match.homeTeam && (match.homeTeam.shortName || match.homeTeam.name)) || "TBD",
            away: (match.awayTeam && (match.awayTeam.shortName || match.awayTeam.name)) || "TBD",
            time,
            score,
            venue: match.venue || "Venue TBC",
            status,
            isLive,
            statusLabel,
            halftime,
            matchday: (match.matchday !== undefined && match.matchday !== null) ? match.matchday : null,
            stage: match.stage || null,
            group: match.group || null,
            rawDate: match.utcDate || null
        };
    }

    mapStandingsRow(row) {
        return {
            pos: row.position,
            team: (row.team && (row.team.shortName || row.team.name)) || "Unknown",
            mp: row.playedGames,
            w: row.won,
            d: row.draw,
            l: row.lost,
            gd: row.goalDifference,
            pts: row.points
        };
    }

    formatStage(stage) {
        if (!stage) return "Fixtures";
        return stage.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    }

    skeletonBlock(count) {
        return `<div class="skeleton-wrapper">${Array.from({ length: count }).map(() => '<div class="skeleton-card"></div>').join('')}</div>`;
    }

    /* ---- REAL MADRID (team-scoped, not matchday-paged) ---------------------- */
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
            const teamId = FOOTBALL_DATA_CONFIG.teams.realMadrid;
            const [scheduled, finished, standings, scorers] = await Promise.all([
                this.fetchFootballData(`/teams/${teamId}/matches?status=SCHEDULED&limit=5`, forceRefresh),
                this.fetchFootballData(`/teams/${teamId}/matches?status=FINISHED&limit=3`, forceRefresh),
                this.fetchFootballData(`/competitions/${FOOTBALL_DATA_CONFIG.competitions.laLiga}/standings`, forceRefresh),
                this.fetchFootballData(`/competitions/${FOOTBALL_DATA_CONFIG.competitions.laLiga}/scorers?limit=10`, forceRefresh)
            ]);

            const fixtures = (scheduled.matches || []).map(m => this.mapMatch(m));

            // Attach each finished match's public synopsis (RM_MATCH_SYNOPSES,
            // near the top of this file) so renderMatchCard can show it.
            const results = (finished.matches || []).slice(-3).reverse().map(m => {
                const mapped = this.mapMatch(m);
                mapped.synopsis = RM_MATCH_SYNOPSES[mapped.id] || null;
                return mapped;
            });

            const totalTable = (standings.standings || []).find(s => s.type === "TOTAL") || (standings.standings || [])[0] || { table: [] };
            const table = totalTable.table.map(r => this.mapStandingsRow(r));
            const scorersList = (scorers.scorers || []).map(s => this.mapScorer(s));

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
            if (standingsEl) standingsEl.innerHTML = this.renderStandingsTable(table, "Real Madrid");
            if (scorersEl) scorersEl.innerHTML = this.renderScorersTable(scorersList);

            // Live polling: if Real Madrid is mid-match right now, refresh every 60s.
            if (this.rmPollTimer) { clearInterval(this.rmPollTimer); this.rmPollTimer = null; }
            if (fixtures.some(f => f.isLive)) {
                this.rmPollTimer = setInterval(() => this.loadRmOverviewLive(true), 60000);
            }
        } catch (err) {
            console.warn("Live Real Madrid fetch failed, showing sample data instead:", err);
            this.loadRmOverview();
        }
    }

    async loadHomeSidebarLive() {
        const sidebar = document.getElementById("latest-match-sidebar");
        if (!sidebar) return;
        try {
            const teamId = FOOTBALL_DATA_CONFIG.teams.realMadrid;
            const data = await this.fetchFootballData(`/teams/${teamId}/matches?status=SCHEDULED&limit=1`);
            const fixtures = (data.matches || []).slice(0, 1).map(m => this.mapMatch(m));
            sidebar.innerHTML = fixtures.length
                ? fixtures.map(f => this.renderMatchCard(f, "Real Madrid")).join('')
                : `<div class="empty-state">No upcoming fixture found.</div>`;
        } catch (err) {
            console.warn("Live homepage fetch failed, showing sample data instead:", err);
            this.loadHomeSidebar();
        }
    }

    /* ---- SAMPLE-DATA LOADERS (fallback + used when no proxy URL set) ------- */
    loadHomeSidebar() {
        const sidebar = document.getElementById("latest-match-sidebar");
        const data = this.mockData["Real Madrid"];
        if (!sidebar || !data) return;
        sidebar.innerHTML = data.fixtures.map(f => this.renderMatchCard(f, "Real Madrid")).join("");
    }

    loadRmOverview() {
        const fixturesEl = document.getElementById("rm-fixtures-container");
        const standingsEl = document.getElementById("rm-standings-container");
        const resultsEl = document.getElementById("rm-results-container");
        const scorersEl = document.getElementById("rm-scorers-container");
        const data = this.mockData["Real Madrid"];
        if (!data) return;

        if (fixturesEl) {
            fixturesEl.innerHTML = data.fixtures.length
                ? data.fixtures.map(f => this.renderMatchCard(f, "Real Madrid")).join('')
                : `<div class="empty-state">No fixtures scheduled right now.</div>`;
        }
        if (standingsEl) standingsEl.innerHTML = this.renderStandingsTable(data.standings, "Real Madrid");
        if (resultsEl) {
            resultsEl.innerHTML = data.results.map(r => this.renderMatchCard(
                { home: r.home, away: r.away, score: r.score, time: "Full-time", venue: r.venue, status: "FINISHED" }, "Real Madrid"
            )).join('');
        }
        if (scorersEl) {
            scorersEl.innerHTML = data.scorers
                ? this.renderScorersTable(data.scorers)
                : `<div class="empty-state">Sample data — connect live data to see real scorers.</div>`;
        }
    }

    /* ---- RENDER HELPERS ---------------------------------------- */
    renderMatchCard(match, leagueKey) {
        const payload = encodeURIComponent(JSON.stringify({ ...match, league: leagueKey }));
        const timeLabel = match.isLive
            ? `<span class="live-pill">${match.statusLabel || 'LIVE'}</span>`
            : (match.statusLabel || match.time || "Full-time");

        // Real Madrid post-match synopsis (RM_MATCH_SYNOPSES near the top of
        // this file). Shown right on the card so every visitor sees it, not
        // hidden behind a click. A finished RM match with nothing added yet
        // shows a small hint with the match ID instead, so you know what key
        // to use.
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

    mapScorer(row) {
        return {
            player: (row.player && row.player.name) || "Unknown",
            team: (row.team && (row.team.shortName || row.team.name)) || "Unknown",
            goals: row.goals ?? 0,
            assists: row.assists
        };
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

        // Event delegation: catches match-cards even though they're
        // injected into the page later by the loaders above.
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
   Powers the Premier League, UCL, and La Liga pages: matchday-by-matchday
   browsing with ← → arrows, a full always-current league table, and live
   polling while a match is in progress.

   How the matchday paging works: one API call gets EVERY match in the
   competition's season (not one call per matchday — that would burn
   through the 10-requests/minute free-tier limit fast). The matches are
   then grouped client-side by matchday number. For competitions that
   have a knockout stage without matchday numbers (Champions League
   Round of 16 onward), matches are grouped by stage name instead, so
   the arrows keep working right through to the final.
   ========================================================================== */
class CompetitionHub {
    constructor(app, config) {
        this.app = app;
        this.code = config.code;
        this.leagueKey = config.leagueKey;
        this.fixturesEl = document.getElementById(config.fixturesId);
        this.standingsEl = document.getElementById(config.standingsId);
        this.scorersEl = document.getElementById(config.scorersId);
        this.statusEl = document.getElementById(config.statusId);
        this.labelEl = document.getElementById(config.labelId);
        this.prevBtn = document.getElementById(config.prevId);
        this.nextBtn = document.getElementById(config.nextId);
        this.refreshBtn = document.getElementById(config.refreshId);
        this.pages = [];
        this.pageIndex = 0;
        this.pollTimer = null;
    }

    async init() {
        if (this.prevBtn) this.prevBtn.addEventListener("click", () => this.go(-1));
        if (this.nextBtn) this.nextBtn.addEventListener("click", () => this.go(1));
        if (this.refreshBtn) this.refreshBtn.addEventListener("click", () => this.load(true));
        await this.load();
    }

    async load(forceRefresh = false) {
        if (this.fixturesEl) this.fixturesEl.innerHTML = this.app.skeletonBlock(3);
        if (this.standingsEl) this.standingsEl.innerHTML = this.app.skeletonBlock(6);
        if (this.scorersEl) this.scorersEl.innerHTML = this.app.skeletonBlock(5);
        if (this.statusEl) this.statusEl.textContent = "Status: Fetching from football-data.org…";

        if (!this.app.isLiveDataEnabled()) {
            this.loadSample();
            return;
        }

        try {
            const [matchesData, standingsData, scorersData] = await Promise.all([
                this.app.fetchFootballData(`/competitions/${this.code}/matches`, forceRefresh),
                this.app.fetchFootballData(`/competitions/${this.code}/standings`, forceRefresh),
                this.app.fetchFootballData(`/competitions/${this.code}/scorers?limit=10`, forceRefresh)
            ]);

            this.buildPages(matchesData.matches || []);
            this.renderStandings(standingsData);
            this.renderScorers(scorersData);
            this.renderPage();

            const count = (matchesData.matches || []).length;
            if (this.statusEl) this.statusEl.textContent = `Status: Synced with football-data.org (${count} matches loaded)`;
            this.manageLivePolling();
        } catch (err) {
            console.warn(`Live fetch failed for ${this.leagueKey}, showing sample data instead:`, err);
            this.loadSample();
            if (this.statusEl) this.statusEl.textContent = "Status: Showing sample data — check your Cloudflare Worker URL and API key (see PROXY-SETUP.md)";
        }
    }

    buildPages(matches) {
        const groups = new Map();
        matches.forEach(m => {
            const hasMatchday = m.matchday !== undefined && m.matchday !== null;
            const key = hasMatchday ? `MD-${m.matchday}` : `ST-${m.stage}`;
            if (!groups.has(key)) {
                groups.set(key, {
                    key,
                    label: hasMatchday ? `Matchday ${m.matchday}` : this.app.formatStage(m.stage),
                    matches: [],
                    earliest: m.utcDate
                });
            }
            const g = groups.get(key);
            g.matches.push(m);
            if (new Date(m.utcDate) < new Date(g.earliest)) g.earliest = m.utcDate;
        });

        this.pages = Array.from(groups.values()).sort((a, b) => new Date(a.earliest) - new Date(b.earliest));

        // Default to the first page that isn't entirely finished (i.e. the
        // "current" matchday), falling back to the last page if the whole
        // season is already done.
        const openStatuses = new Set(["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED", "SUSPENDED"]);
        let idx = this.pages.findIndex(p => p.matches.some(m => openStatuses.has(m.status)));
        this.pageIndex = idx === -1 ? Math.max(this.pages.length - 1, 0) : idx;
    }

    renderPage() {
        if (!this.fixturesEl) return;
        if (!this.pages.length) {
            this.fixturesEl.innerHTML = `<div class="empty-state">No fixtures returned right now.</div>`;
            if (this.labelEl) this.labelEl.textContent = "—";
            return;
        }

        const page = this.pages[this.pageIndex];
        if (this.labelEl) this.labelEl.textContent = page.label;
        if (this.prevBtn) this.prevBtn.disabled = this.pageIndex === 0;
        if (this.nextBtn) this.nextBtn.disabled = this.pageIndex === this.pages.length - 1;

        const cards = page.matches
            .slice()
            .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
            .map(m => this.app.renderMatchCard(this.app.mapMatch(m), this.leagueKey));

        this.fixturesEl.innerHTML = cards.join('') || `<div class="empty-state">No matches found for this matchday.</div>`;
    }

    go(delta) {
        const next = this.pageIndex + delta;
        if (next < 0 || next >= this.pages.length) return;
        this.pageIndex = next;
        this.renderPage();
        this.manageLivePolling();
    }

    renderStandings(standingsData) {
        if (!this.standingsEl) return;
        const totalTable = (standingsData.standings || []).find(s => s.type === "TOTAL") || (standingsData.standings || [])[0] || { table: [] };
        const table = totalTable.table.map(r => this.app.mapStandingsRow(r));
        this.standingsEl.innerHTML = this.app.renderStandingsTable(table, null);
    }

    renderScorers(scorersData) {
        if (!this.scorersEl) return;
        const scorers = (scorersData.scorers || []).map(s => this.app.mapScorer(s));
        this.scorersEl.innerHTML = this.app.renderScorersTable(scorers);
    }

    manageLivePolling() {
        if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
        const page = this.pages[this.pageIndex];
        const isLive = page && page.matches.some(m => m.status === "IN_PLAY" || m.status === "PAUSED");
        if (isLive) {
            if (this.statusEl) this.statusEl.textContent = "Status: Live — updating every 60 seconds";
            this.pollTimer = setInterval(() => this.load(true), 60000);
        }
    }

    loadSample() {
        const data = this.app.mockData[this.leagueKey];
        if (!data) return;
        this.pages = [{ key: "sample", label: data.matchdayLabel || "Sample Matchday", matches: [] }];
        this.pageIndex = 0;
        if (this.labelEl) this.labelEl.textContent = this.pages[0].label;
        if (this.prevBtn) this.prevBtn.disabled = true;
        if (this.nextBtn) this.nextBtn.disabled = true;
        if (this.fixturesEl) {
            this.fixturesEl.innerHTML = data.fixtures.map(f => this.app.renderMatchCard(f, this.leagueKey)).join('');
        }
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
