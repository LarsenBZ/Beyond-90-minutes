/* ==========================================================================
   Beyond 90 Minutes — Core JavaScript
   Handles: navigation, dark mode, article search/filter, live league data
   (football-data.org), match detail modal, and Real Madrid tab switching.
   ========================================================================== */

/* --------------------------------------------------------------------------
   FOOTBALL-DATA.ORG CONFIG
   --------------------------------------------------------------------------
   IMPORTANT — read this before you touch anything below.

   football-data.org's API does NOT allow a browser to call it directly
   with your key (I tested it — it fails with a CORS error, and even if it
   didn't, your key would be sitting in plain text in your public GitHub
   repo for anyone to copy and use up your quota). The fix is a tiny free
   "proxy" — a small server that holds your key privately and forwards
   requests to football-data.org on the site's behalf. I wrote that proxy
   for you; see PROXY-SETUP.md in this folder for the 10-minute, no-code,
   copy/paste setup on Cloudflare's free tier.

   Until you deploy the proxy, this site runs perfectly well on the sample
   data further down in this file — nothing is broken by leaving
   proxyBaseUrl blank. Once you deploy the proxy, paste its URL below and
   every page switches to real data automatically.
------------------------------------------------------------------------- */
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

const LEAGUE_CODE_MAP = {
    "Premier League": FOOTBALL_DATA_CONFIG.competitions.premierLeague,
    "UEFA Champions League": FOOTBALL_DATA_CONFIG.competitions.championsLeague
};

class Beyond90App {
    constructor() {
        /* ---- SAMPLE / FALLBACK DATA -----------------------------------
           Used the moment the page loads (before the live fetch resolves
           is not the case here — this is only used if the live fetch
           fails, or if you clear out the API key above). Keeping this
           around means the site always has something to show.
        ------------------------------------------------------------------ */
        this.mockData = {
            "Premier League": {
                fixtures: [
                    { home: "Arsenal", away: "Chelsea", time: "Sat, 15:00", score: "VS", venue: "Emirates Stadium" },
                    { home: "Manchester City", away: "Liverpool", time: "Sun, 16:30", score: "VS", venue: "Etihad Stadium" }
                ],
                results: [
                    { home: "Newcastle", away: "Tottenham", score: "2 - 1", venue: "St James' Park" }
                ],
                standings: [
                    { pos: 1, team: "Arsenal", mp: 5, pts: 13 },
                    { pos: 2, team: "Liverpool", mp: 5, pts: 12 },
                    { pos: 3, team: "Manchester City", mp: 5, pts: 10 }
                ]
            },
            "UEFA Champions League": {
                fixtures: [
                    { home: "Real Madrid", away: "Bayern Munich", time: "Tue, 20:00", score: "VS", venue: "Santiago Bernabéu" },
                    { home: "PSG", away: "Inter Milan", time: "Wed, 20:00", score: "VS", venue: "Parc des Princes" }
                ],
                standings: [
                    { pos: 1, team: "Real Madrid", mp: 2, pts: 6 },
                    { pos: 2, team: "Bayern Munich", mp: 2, pts: 6 },
                    { pos: 3, team: "PSG", mp: 2, pts: 4 }
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
                    { pos: 1, team: "Real Madrid", mp: 6, pts: 16 },
                    { pos: 2, team: "Barcelona", mp: 6, pts: 15 }
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
            this.setupRefreshButtons();
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

    /* ---- LEAGUE "REFRESH" BUTTONS ---------------------------------------- */
    setupRefreshButtons() {
        document.querySelectorAll("[data-refresh-league]").forEach(btn => {
            btn.addEventListener("click", () => {
                const league = btn.getAttribute("data-refresh-league");
                const fixturesId = btn.getAttribute("data-refresh-fixtures");
                const standingsId = btn.getAttribute("data-refresh-standings");
                const statusId = btn.getAttribute("data-refresh-status");
                const statusEl = statusId ? document.getElementById(statusId) : null;

                if (this.isLiveDataEnabled()) {
                    this.loadLeagueDataLive(fixturesId, standingsId, league, statusId, true);
                } else {
                    if (statusEl) statusEl.textContent = "Status: Refreshing…";
                    window.setTimeout(() => {
                        this.loadLeagueData(fixturesId, standingsId, league);
                        if (statusEl) statusEl.textContent = "Status: Showing sample data";
                    }, 350);
                }
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
        const live = this.isLiveDataEnabled();

        if (page === "premier-league") {
            live
                ? this.loadLeagueDataLive("pl-fixtures-container", "pl-standings-container", "Premier League", "pl-sync-status")
                : this.loadLeagueData("pl-fixtures-container", "pl-standings-container", "Premier League");
        } else if (page === "ucl") {
            live
                ? this.loadLeagueDataLive("ucl-fixtures-container", "ucl-standings-container", "UEFA Champions League", "ucl-sync-status")
                : this.loadLeagueData("ucl-fixtures-container", "ucl-standings-container", "UEFA Champions League");
        } else if (page === "real-madrid") {
            live ? this.loadRmOverviewLive() : this.loadRmOverview();
        } else if (page === "home") {
            live ? this.loadHomeSidebarLive() : this.loadHomeSidebar();
        }
    }

    isLiveDataEnabled() {
        return Boolean(FOOTBALL_DATA_CONFIG.proxyBaseUrl && FOOTBALL_DATA_CONFIG.proxyBaseUrl.trim().length > 8);
    }

    /* ---- FOOTBALL-DATA.ORG FETCH (via your proxy) + CACHE -----------------
       Caches each response in localStorage for a few minutes so switching
       between pages, or reloading, doesn't burn through the 10-req/min
       free-tier limit. Pass forceRefresh=true (the Refresh button does
       this) to skip the cache and ask the proxy directly.
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

        const response = await fetch(`${FOOTBALL_DATA_CONFIG.proxyBaseUrl}/v4${endpoint}`);
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
        const finished = match.status === "FINISHED";
        const time = isNaN(date.getTime())
            ? "TBD"
            : date.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
        const score = (finished && match.score && match.score.fullTime && match.score.fullTime.home !== null)
            ? `${match.score.fullTime.home} - ${match.score.fullTime.away}`
            : "VS";
        return {
            home: (match.homeTeam && (match.homeTeam.shortName || match.homeTeam.name)) || "TBD",
            away: (match.awayTeam && (match.awayTeam.shortName || match.awayTeam.name)) || "TBD",
            time,
            score,
            venue: match.venue || "Venue TBC"
        };
    }

    mapStandingsRow(row) {
        return {
            pos: row.position,
            team: (row.team && (row.team.shortName || row.team.name)) || "Unknown",
            mp: row.playedGames,
            pts: row.points
        };
    }

    skeletonBlock(count) {
        return `<div class="skeleton-wrapper">${Array.from({ length: count }).map(() => '<div class="skeleton-card"></div>').join('')}</div>`;
    }

    /* ---- LIVE LOADERS ---------------------------------------- */
    async loadLeagueDataLive(fixturesId, standingsId, leagueKey, statusId, forceRefresh = false) {
        const code = LEAGUE_CODE_MAP[leagueKey];
        const fixturesEl = document.getElementById(fixturesId);
        const standingsEl = document.getElementById(standingsId);
        const statusEl = statusId ? document.getElementById(statusId) : null;

        if (fixturesEl) fixturesEl.innerHTML = this.skeletonBlock(2);
        if (standingsEl) standingsEl.innerHTML = this.skeletonBlock(4);
        if (statusEl) statusEl.textContent = "Status: Fetching from football-data.org…";

        try {
            const [matchesData, standingsData] = await Promise.all([
                this.fetchFootballData(`/competitions/${code}/matches?status=SCHEDULED`, forceRefresh),
                this.fetchFootballData(`/competitions/${code}/standings`, forceRefresh)
            ]);

            const fixtures = (matchesData.matches || []).slice(0, 5).map(m => this.mapMatch(m));
            const totalTable = (standingsData.standings || []).find(s => s.type === "TOTAL") || (standingsData.standings || [])[0] || { table: [] };
            const table = totalTable.table.map(r => this.mapStandingsRow(r));

            if (fixturesEl) {
                fixturesEl.innerHTML = fixtures.length
                    ? fixtures.map(f => this.renderMatchCard(f, leagueKey)).join('')
                    : `<div class="empty-state">No upcoming fixtures returned right now.</div>`;
            }
            if (standingsEl) standingsEl.innerHTML = this.renderStandingsTable(table, null);
            if (statusEl) statusEl.textContent = "Status: Synced with football-data.org";
        } catch (err) {
            console.warn(`Live fetch failed for ${leagueKey}, showing sample data instead:`, err);
            this.loadLeagueData(fixturesId, standingsId, leagueKey);
            if (statusEl) statusEl.textContent = "Status: Showing sample data (live fetch unavailable)";
        }
    }

    async loadRmOverviewLive(forceRefresh = false) {
        const fixturesEl = document.getElementById("rm-fixtures-container");
        const resultsEl = document.getElementById("rm-results-container");
        const standingsEl = document.getElementById("rm-standings-container");

        if (fixturesEl) fixturesEl.innerHTML = this.skeletonBlock(1);
        if (resultsEl) resultsEl.innerHTML = this.skeletonBlock(1);
        if (standingsEl) standingsEl.innerHTML = this.skeletonBlock(3);

        try {
            const teamId = FOOTBALL_DATA_CONFIG.teams.realMadrid;
            const [scheduled, finished, standings] = await Promise.all([
                this.fetchFootballData(`/teams/${teamId}/matches?status=SCHEDULED&limit=3`, forceRefresh),
                this.fetchFootballData(`/teams/${teamId}/matches?status=FINISHED&limit=3`, forceRefresh),
                this.fetchFootballData(`/competitions/${FOOTBALL_DATA_CONFIG.competitions.laLiga}/standings`, forceRefresh)
            ]);

            const fixtures = (scheduled.matches || []).map(m => this.mapMatch(m));
            const results = (finished.matches || []).slice(-3).reverse().map(m => this.mapMatch(m));
            const totalTable = (standings.standings || []).find(s => s.type === "TOTAL") || (standings.standings || [])[0] || { table: [] };
            const table = totalTable.table.map(r => this.mapStandingsRow(r));

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

    /* ---- SAMPLE-DATA LOADERS (fallback + used when no API key set) ------- */
    loadHomeSidebar() {
        const sidebar = document.getElementById("latest-match-sidebar");
        const data = this.mockData["Real Madrid"];
        if (!sidebar || !data) return;
        sidebar.innerHTML = data.fixtures.map(f => this.renderMatchCard(f, "Real Madrid")).join("");
    }

    loadLeagueData(fixturesId, standingsId, leagueKey) {
        const fixturesEl = document.getElementById(fixturesId);
        const standingsEl = document.getElementById(standingsId);
        const data = this.mockData[leagueKey];
        if (!data) return;

        if (fixturesEl) {
            fixturesEl.innerHTML = data.fixtures.length
                ? data.fixtures.map(f => this.renderMatchCard(f, leagueKey)).join('')
                : `<div class="empty-state">No fixtures scheduled right now.</div>`;
        }
        if (standingsEl) {
            standingsEl.innerHTML = this.renderStandingsTable(data.standings, leagueKey === "Real Madrid" ? "Real Madrid" : null);
        }
    }

    loadRmOverview() {
        this.loadLeagueData("rm-fixtures-container", "rm-standings-container", "Real Madrid");
        const resultsEl = document.getElementById("rm-results-container");
        const data = this.mockData["Real Madrid"];
        if (resultsEl && data) {
            resultsEl.innerHTML = data.results.map(r => this.renderMatchCard(
                { home: r.home, away: r.away, score: r.score, time: "Full-time", venue: r.venue }, "Real Madrid"
            )).join('');
        }
    }

    /* ---- RENDER HELPERS ---------------------------------------- */
    renderMatchCard(match, leagueKey) {
        const payload = encodeURIComponent(JSON.stringify({ ...match, league: leagueKey }));
        return `
            <div class="match-card" tabindex="0" role="button" data-match='${payload}'>
                <div class="match-time">${match.time || "Full-time"}</div>
                <div class="match-teams">
                    <span class="teams-name">${match.home} vs ${match.away}</span>
                    <span class="match-score">${match.score}</span>
                </div>
            </div>
        `;
    }

    renderStandingsTable(standings, highlightTeam) {
        return `
            <div class="table-wrapper">
                <table class="standings-table">
                    <thead>
                        <tr><th>Pos</th><th style="text-align:left;">Team</th><th>MP</th><th>Pts</th></tr>
                    </thead>
                    <tbody>
                        ${standings.map(s => `
                            <tr class="${s.team === highlightTeam ? 'highlight-row' : ''}">
                                <td>${s.pos}</td>
                                <td class="team-cell">${s.team}</td>
                                <td>${s.mp}</td>
                                <td><strong>${s.pts}</strong></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
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

        content.innerHTML = `
            <div class="modal-competition">${match.league || "Match Details"}</div>
            <div class="modal-fixture">${match.home} vs ${match.away}</div>
            <div class="modal-detail-row"><span>Kickoff</span><span>${match.time || "Full-time"}</span></div>
            <div class="modal-detail-row"><span>Score</span><span>${match.score}</span></div>
            ${match.venue ? `<div class="modal-detail-row"><span>Venue</span><span>${match.venue}</span></div>` : ''}
            <p class="modal-note">EDIT ME — replace this with a line or two of your own scouting notes or prediction for this fixture.</p>
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

const app = new Beyond90App();
