/* ==========================================================================
   Beyond 90 Minutes — Core JavaScript
   Handles: navigation, dark mode, article search/filter, live league data
   (football-data.org), matchday-by-matchday browsing with live polling,
   the match detail modal (with your own saved notes), and the Real
   Madrid tab switching.

   A NOTE ON THE FREE FOOTBALL-DATA.ORG TIER, so future-you isn't
   surprised: the free plan gives you fixtures, results, scores, and
   standings for PL / La Liga / UCL and a few others — but NOT lineups,
   substitutions, cards, or shot/possession stats. Those are a paid
   add-on. So the match modal below shows everything the free API can
   give us (score, half-time score, status/live minute, matchday,
   venue) plus a "My Notes" box where YOU can type a synopsis or
   prediction by hand.

   A NOTE ON "MY NOTES": these save to localStorage, which means
   they're saved in that one browser, on that one device — they are
   NOT pushed to GitHub and won't show up for someone else visiting
   the live site. Think of it as your own scratchpad. Once you're
   happy with a note, copy/paste it into the actual HTML (e.g. into
   the "add your own observations" spot on an article) so it's
   permanently visible to anyone who visits.
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

        if (fixturesEl) fixturesEl.innerHTML = this.skeletonBlock(1);
        if (resultsEl) resultsEl.innerHTML = this.skeletonBlock(1);
        if (standingsEl) standingsEl.innerHTML = this.skeletonBlock(3);

        try {
            const teamId = FOOTBALL_DATA_CONFIG.teams.realMadrid;
            const [scheduled, finished, standings] = await Promise.all([
                this.fetchFootballData(`/teams/${teamId}/matches?status=SCHEDULED&limit=5`, forceRefresh),
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
                { home: r.home, away: r.away, score: r.score, time: "Full-time", venue: r.venue }, "Real Madrid"
            )).join('');
        }
    }

    /* ---- RENDER HELPERS ---------------------------------------- */
    renderMatchCard(match, leagueKey) {
        const payload = encodeURIComponent(JSON.stringify({ ...match, league: leagueKey }));
        const timeLabel = match.isLive
            ? `<span class="live-pill">${match.statusLabel || 'LIVE'}</span>`
            : (match.statusLabel || match.time || "Full-time");
        return `
            <div class="match-card" tabindex="0" role="button" data-match='${payload}'>
                <div class="match-time">${timeLabel}</div>
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

    noteKeyFor(match) {
        if (match.id) return `b90_note_${match.id}`;
        const raw = `${match.league || ''}_${match.home}_${match.away}_${match.time}`.replace(/\s+/g, '_');
        return `b90_note_${raw}`;
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

        const noteKey = this.noteKeyFor(match);
        let savedNote = "";
        try { savedNote = localStorage.getItem(noteKey) || ""; } catch (err) { /* ignore */ }

        const statusRow = match.isLive
            ? `<div class="modal-detail-row"><span>Status</span><span class="live-pill">${match.statusLabel || 'LIVE'}</span></div>`
            : (match.statusLabel ? `<div class="modal-detail-row"><span>Status</span><span>${match.statusLabel}</span></div>` : '');

        const halftimeRow = match.halftime
            ? `<div class="modal-detail-row"><span>Half-time</span><span>${match.halftime}</span></div>` : '';

        const stageRow = (match.matchday !== undefined && match.matchday !== null)
            ? `<div class="modal-detail-row"><span>Matchday</span><span>${match.matchday}</span></div>`
            : (match.stage ? `<div class="modal-detail-row"><span>Stage</span><span>${this.formatStage(match.stage)}</span></div>` : '');

        const groupRow = match.group ? `<div class="modal-detail-row"><span>Group</span><span>${match.group}</span></div>` : '';

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
            <div class="modal-notes">
                <label for="modal-note-input">My Notes (saved on this device only)</label>
                <textarea id="modal-note-input" rows="3" placeholder="Add your own scouting notes, a prediction, or a post-match synopsis...">${this.escapeHtml(savedNote)}</textarea>
                <div class="modal-notes-row">
                    <span id="modal-note-status" class="modal-note-status"></span>
                    <button type="button" class="btn btn-primary modal-note-save" id="modal-note-save">Save Note</button>
                </div>
            </div>
        `;

        const saveBtn = content.querySelector("#modal-note-save");
        const noteStatus = content.querySelector("#modal-note-status");
        if (saveBtn) {
            saveBtn.addEventListener("click", () => {
                const val = content.querySelector("#modal-note-input").value;
                try {
                    localStorage.setItem(noteKey, val);
                    if (noteStatus) {
                        noteStatus.textContent = "Saved ✓";
                        window.setTimeout(() => { noteStatus.textContent = ""; }, 2000);
                    }
                } catch (err) {
                    if (noteStatus) noteStatus.textContent = "Couldn't save (storage unavailable)";
                }
            });
        }

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
        if (this.statusEl) this.statusEl.textContent = "Status: Fetching from football-data.org…";

        if (!this.app.isLiveDataEnabled()) {
            this.loadSample();
            return;
        }

        try {
            const [matchesData, standingsData] = await Promise.all([
                this.app.fetchFootballData(`/competitions/${this.code}/matches`, forceRefresh),
                this.app.fetchFootballData(`/competitions/${this.code}/standings`, forceRefresh)
            ]);

            this.buildPages(matchesData.matches || []);
            this.renderStandings(standingsData);
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
        if (this.statusEl) this.statusEl.textContent = "Status: Showing sample data";
    }
}

const app = new Beyond90App();
