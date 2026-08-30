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

   A NOTE ON THE STARTING XI + SEASON STATS (Real Madrid page): both used
   to be live fetches — the XI from ESPN's summary endpoint, squad stats
   from API-Football — and both turned out to be dead ends. API-Football's
   free plan doesn't cover the current season at all (see maxFreeSeason
   below), so Season Stats was quietly showing last year's squad. ESPN's
   exact soccer "lineups" payload shape was never confirmed either. Both
   are hand-kept instead, same as the match synopses: see RM_SQUAD_STATS
   below and RM_MATCH_LINEUPS further down.
   The Starting XI pitch has moved twice since. First, out of its own
   "Tactical Lineup" tab into one always-on "current XI" box sitting next
   to a "Last Match Report" panel — but that report panel was still
   API-Football, and API-Football's free plan structurally can't return
   fixtures for the current season at all, so it never had anything real
   to show. It's been removed outright (was loadRmMatchReport/
   renderMatchReportPanel/markRmMatchReportUnavailable, if you ever need
   to see what it looked like in git history). The XI itself moved a
   second time, from that one "current" box into RM_MATCH_LINEUPS — a
   lineup entry per match, keyed the same way as RM_MATCH_SYNOPSES — so
   each finished match's actual XI renders inside THAT match's own
   synopsis popup via buildLineupHtml(), not as one XI for the whole page.
   Player photos (optional, added once per player, then reused forever)
   live in RM_PLAYER_PHOTOS just above RM_MATCH_LINEUPS.

   A NOTE ON REAL MADRID SYNOPSES: see RM_MATCH_SYNOPSES below. Synopses
   live in this file itself, keyed by match ID, so they deploy with the
   rest of the site and are visible to every visitor. One thing changed
   with this rewrite: match IDs are now ESPN's event IDs (still just
   numbers, e.g. "645191"), not football-data.org's — if you'd already
   started adding synopses under the old ID scheme, you'll need to re-find
   the match by date on the live site and grab its new ID from the hint
   text under a finished match with no synopsis yet. RM_MATCH_PHOTOS (just
   below RM_MATCH_SYNOPSES) adds an optional single header photo per match,
   rendered at the top of that match's synopsis popup — same match-ID key,
   same "add a line, commit, push" workflow.
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
Mourinho's team won a difficult match with not a great Vini, but this game showed that Bellingham and Arda Guler can work together at least in league matches.`,

    // Real Madrid 4-1 Real Sociedad, La Liga Round 1 (postponed fixture, played Aug 26 2026 after Round 2)
    "401882919": `Real Madrid vs Real Sociedad
La Liga round 1
Mourinho

First half 1-1
Formation: 4-2-3-1
Real Madrid started the game with the same starting XI that was used against Espanyol. In the first half Real Madrid show it's worst version of the match against a dangerous Real Sociedad which looked to play with a strong defense and balls into the space. Mbappe would open the score with an amazing pass of Fede Valverde but, an error by Konate and a late track back from Carreras led to a goal by Real Sociedad's Susic.

Second half 4-1
Formation 4-2-3-1
In  this second half it became clear that in Mourinho's team the goal scorer is Mbappe. This is shown by Mbappes position when in defense compared to Vinicius. Vinicius is not anymore the player that looks for the balls in the space, now he is the one that passes the ball for Mbappe who is looking for balls in the space with his pace. Vinicius also has a much more defensive role during defense compared to Mbappe. Which can be key in Champions League games where pressure is essential. The combination of Arda Guler and Bellingham in attack is working at least against La Liga teams. Mourinho will have to decide if this approach will continue to be taken in Champions League. Arda Guler has created 12 chances (fotmob) in La Liga the most out of any player in 2 games. Arda Guler is able to make chances for Mbappe, Vinicius, and Bellingham. Bellingham continues to have a high level similar to his World Cup performance. Having a similar role to Guler except that he is able to make plays inside the ball which led to his assist to Vini. Mbappe would do his job with 3 goals scored, HAT-TRICK for Kylian Mbappe.

Post-Match- Mourinho leaves something clear: Mbappe is the top scorer, but as stated by Mourinho " I prefer for him to score 40 goals with titles than 60 goals without titles." Mourinho expands his win history at the Bernabeu with Real Madrid (75 wins/9 draws/6 losses in 90 games.)`
};

/* ---- REAL MADRID MATCH PHOTOS (manually maintained, one per match) -------
   A single header photo shown at the very top of a match's synopsis in the
   modal — the "action shot" for that write-up. Same idea as
   RM_MATCH_SYNOPSES/RM_MATCH_LINEUPS: keyed by the SAME ESPN match ID, so
   it travels with that match's popup automatically.

   HOW TO USE THIS after a match:
     1. Upload the photo directly into the images/ folder (same folder as
        kroos-modric.jpg etc — no matches/ subfolder; lowercase, hyphenated
        filename is the safest habit, since GitHub Pages is case-sensitive).
     2. Add one line below: "matchId": "images/file.webp"
     3. Save, commit, push. No other code changes needed — buildLineupHtml/
        openMatchModal render it automatically for that match's popup.
   A match with no entry here just shows no photo — nothing breaks.
   ---------------------------------------------------------------------- */
const RM_MATCH_PHOTOS = {
    "401882912": "images/espi-vs-espanyol.webp",
    "401882919": "images/mbappe-vs-real-sociedad.webp"
};

/* ---- REAL MADRID PLAYER PHOTOS (manually maintained, add once per player) ---
   Register a player's headshot ONCE here and it applies automatically to
   every lineup entry that uses that exact name — past matches and future
   ones — so adding a new match's XI below never means re-uploading a photo
   for someone you've already added.

   HOW TO USE:
     1. Upload a headshot to images/players/ (any consistent filename is
        fine — lowercase surname is the easiest habit, e.g. "mbappe.jpg").
     2. Add one line below: "Exact Name": "images/players/file.jpg" — the
        name must match the "name" field you use in RM_MATCH_LINEUPS below
        EXACTLY (same accents/capitalization), or it won't match.
     3. Save, commit, push. No other code changes needed.
   A player with no entry here just shows their number in a plain circle
   instead of a photo — nothing breaks if you haven't gotten to them yet.
   ---------------------------------------------------------------------- */
const RM_PLAYER_PHOTOS = {
    // "Mbappé": "images/players/mbappe.jpg",
};

/* ---- REAL MADRID MATCH LINEUPS (manually maintained, one per match) ------
   Same idea as RM_MATCH_SYNOPSES right above — keyed by the SAME ESPN match
   ID, so a match's Starting XI (and bench) travels with its synopsis and
   renders together with it inside that match's popup, instead of living in
   one always-on "current XI" box the way it used to.

   HOW TO UPDATE THIS after a match — send Claude the XI + bench and this
   gets filled in, or do it by hand:
     1. Find the match's ID — same one RM_MATCH_SYNOPSES uses (the
        "No synopsis added yet — match ID ######" hint under a finished
        match with no synopsis tells you this).
     2. Add an entry: "formation" (just a label), "players" (exactly 11
        starters), "bench" (as many substitutes as you want listed — an
        empty array [] is fine if you don't want a bench shown).
     3. posClass must be one of: pos-gk, pos-lb, pos-lcb, pos-rcb, pos-rb,
        pos-ldm, pos-rdm, pos-cam, pos-lw, pos-rw, pos-st — each is a fixed
        spot on the pitch, so pick whichever of the 11 reads closest to
        where that player actually lined up.
     4. Photos are separate — see RM_PLAYER_PHOTOS above.
   ---------------------------------------------------------------------- */
const RM_MATCH_LINEUPS = {
    // Espanyol 1-2 Real Madrid, La Liga Round 2, Aug 22 2026. Carreras and
    // Güler started (not the usual Cucurella/Diomandé) per Braulio's
    // synopsis above; bench below is only the 3 subs actually named in
    // that synopsis (Cucurella + Diomandé on ~64', Carlos Espí on ~80')
    // — not a full matchday squad, since the rest wasn't given. Numbers
    // checked against Real Madrid's published 2026/27 squad numbers.
    "401882912": {
        formation: "4-2-1-3",
        players: [
            { name: "Courtois", number: 1, posClass: "pos-gk" },
            { name: "Carreras", number: 18, posClass: "pos-lb" },
            { name: "Huijsen", number: 4, posClass: "pos-lcb" },
            { name: "Konaté", number: 16, posClass: "pos-rcb" },
            { name: "Dumfries", number: 24, posClass: "pos-rb" },
            { name: "Valverde", number: 8, posClass: "pos-ldm" },
            { name: "Bernardo Silva", number: 20, posClass: "pos-rdm" },
            { name: "Bellingham", number: 5, posClass: "pos-cam" },
            { name: "Vinícius Jr", number: 7, posClass: "pos-lw" },
            { name: "Güler", number: 15, posClass: "pos-rw" },
            { name: "Mbappé", number: 10, posClass: "pos-st" }
        ],
        bench: [
            { name: "Cucurella", number: 17 },
            { name: "Diomandé", number: 25 },
            { name: "Carlos Espí", number: 19 }
        ]
    },
    // Real Madrid 4-1 Real Sociedad, La Liga Round 1, Aug 26 2026. Same
    // starting XI as the Espanyol match per Braulio's synopsis above; bench
    // is the 4 subs actually used in the game (Bellingham/Camavinga and
    // Güler/Brahim Díaz both swapped at 78', Vinícius/Diomandé at 84',
    // Bernardo Silva/Carlos Espí at 86'). Numbers checked against Real
    // Madrid's published 2026/27 squad numbers.
    "401882919": {
        formation: "4-2-3-1",
        players: [
            { name: "Courtois", number: 1, posClass: "pos-gk" },
            { name: "Carreras", number: 18, posClass: "pos-lb" },
            { name: "Huijsen", number: 4, posClass: "pos-lcb" },
            { name: "Konaté", number: 16, posClass: "pos-rcb" },
            { name: "Dumfries", number: 24, posClass: "pos-rb" },
            { name: "Valverde", number: 8, posClass: "pos-ldm" },
            { name: "Bernardo Silva", number: 20, posClass: "pos-rdm" },
            { name: "Bellingham", number: 5, posClass: "pos-cam" },
            { name: "Vinícius Jr", number: 7, posClass: "pos-lw" },
            { name: "Güler", number: 15, posClass: "pos-rw" },
            { name: "Mbappé", number: 10, posClass: "pos-st" }
        ],
        bench: [
            { name: "Camavinga", number: 6 },
            { name: "Brahim Díaz", number: 21 },
            { name: "Diomandé", number: 25 },
            { name: "Carlos Espí", number: 19 }
        ]
    }
};

/* ---- REAL MADRID SQUAD STATS (manually maintained) ------------------------
   API-Football's free plan doesn't cover the current season at all (see
   API_FOOTBALL_CONFIG.maxFreeSeason below) — every row this used to show was
   really the 2024/25 squad, which is why it looked wrong rather than just
   old: several of those players aren't even on the roster anymore. ESPN
   doesn't have a real substitute either — there's no single call that
   returns a whole squad's season goals/assists the way API-Football's did;
   getting that from ESPN would mean one request per player against a stats
   endpoint whose exact shape was never confirmed. So, same as the lineup
   above: hand-kept instead of fetched.

   HOW TO UPDATE THIS after a match: add or bump a line for anyone who
   scored or assisted (cross-reference your own synopsis write-up above —
   that's usually the easiest source). New scorer? Add a new line.
   ---------------------------------------------------------------------- */
const RM_SQUAD_STATS = [
    // Espanyol 1-2 Real Madrid, La Liga Round 2, Aug 22 2026
    { player: "Jude Bellingham", pos: "MF", goals: 1, assists: 1 }, // +1 assist vs Real Sociedad
    { player: "Carlos Espí", pos: "FW", goals: 1, assists: 0 },
    { player: "Arda Güler", pos: "MF", goals: 0, assists: 1 },
    // Real Madrid 4-1 Real Sociedad, La Liga Round 1, Aug 26 2026
    { player: "Kylian Mbappé", pos: "FW", goals: 3, assists: 0 },
    { player: "Vinícius Jr", pos: "FW", goals: 1, assists: 0 },
    { player: "Fede Valverde", pos: "MF", goals: 0, assists: 1 }
];

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
        // Length (Short/Long reads) is a second, independent filter — it ANDs
        // with the topic filter and the search box rather than replacing them,
        // so "Analysis" + "Short Reads" narrows to short analysis pieces only.
        const lengthButtons = document.querySelectorAll("#length-filters .rm-nav-btn");
        const articleCards = document.querySelectorAll(".article-card");
        const emptyState = document.getElementById("articles-empty-state");

        if (!searchInput && categoryButtons.length === 0 && lengthButtons.length === 0) return;

        let currentCategory = "ALL";
        let currentLength = "ALL";
        let searchQuery = "";

        const filterArticles = () => {
            let visibleCount = 0;
            articleCards.forEach(card => {
                const category = card.getAttribute("data-category") || "";
                const length = card.getAttribute("data-length") || "";
                const title = card.getAttribute("data-title") || "";
                const matchesCategory = currentCategory === "ALL" || category === currentCategory;
                const matchesLength = currentLength === "ALL" || length === currentLength;
                const matchesSearch = title.toLowerCase().includes(searchQuery.toLowerCase());
                const visible = matchesCategory && matchesLength && matchesSearch;
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

        lengthButtons.forEach(btn => {
            btn.addEventListener("click", (e) => {
                lengthButtons.forEach(b => b.classList.remove("active"));
                e.target.classList.add("active");
                currentLength = e.target.getAttribute("data-length") || "ALL";
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
            this.renderRmSquadStats();
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
                .map(m => { m.synopsis = RM_MATCH_SYNOPSES[m.id] || null; m.lineup = RM_MATCH_LINEUPS[m.id] || null; m.photo = RM_MATCH_PHOTOS[m.id] || null; return m; });

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

    /* ---- STARTING XI + BENCH (hand-kept, see RM_MATCH_LINEUPS above) ----
       Builds the pitch (+ bench, if given) for ONE specific match's lineup
       and returns it as an HTML string, for injection straight into that
       match's modal (see openMatchModal below). No DOM query here, no
       fetch — nothing to get stuck on a stale "showing an example" message
       the way the old live-fetched version could. Returns '' (renders
       nothing) if that match has no RM_MATCH_LINEUPS entry yet.
    ------------------------------------------------------------------ */
    buildLineupHtml(lineup) {
        if (!lineup || !lineup.players || !lineup.players.length) return '';

        const playerCard = p => {
            const photo = RM_PLAYER_PHOTOS[p.name];
            const avatarStyle = photo ? ` style="background-image:url('${this.escapeHtml(photo)}')"` : '';
            const avatarInner = photo
                ? `<span class="avatar-num">${p.number}</span>`
                : `<span class="avatar-fallback-num">${p.number}</span>`;
            return `
                <div class="player-card ${p.posClass}">
                    <span class="player-avatar${photo ? '' : ' player-avatar--no-photo'}"${avatarStyle}>${avatarInner}</span>
                    <span class="player-name">${this.escapeHtml(p.name)}</span>
                </div>`;
        };

        const benchHtml = (lineup.bench && lineup.bench.length) ? `
            <div class="lineup-bench">
                <span class="section-label">Bench</span>
                <ul class="bench-list">
                    ${lineup.bench.map(b => `<li><span class="bench-num">${b.number ?? ''}</span>${this.escapeHtml(b.name)}</li>`).join('')}
                </ul>
            </div>` : '';

        return `
            <div class="lineup-block">
                <span class="modal-synopsis-label">Starting XI — ${this.escapeHtml(lineup.formation)}</span>
                <div class="pitch-container">
                    <div class="pitch">
                        <div class="pitch-line center-line"></div>
                        <div class="pitch-circle"></div>
                        ${lineup.players.map(playerCard).join('')}
                    </div>
                </div>
                ${benchHtml}
            </div>`;
    }

    // Hand-kept (see RM_SQUAD_STATS above) — no fetch, so nothing here can
    // come back capped at an old season or listing players who've since
    // left the club, the way the old API-Football version always did.
    renderRmSquadStats() {
        const el = document.getElementById("rm-squad-stats-container");
        const introEl = document.getElementById("rm-stats-intro");
        if (introEl) introEl.textContent = "Goals and assists this season, updated by hand after each match — see RM_SQUAD_STATS in script.js.";
        if (!el) return;

        const rows = [...RM_SQUAD_STATS].sort((a, b) => (b.goals - a.goals) || (b.assists - a.assists));
        el.innerHTML = rows.length ? `
            <div class="table-wrapper">
                <table class="standings-table">
                    <thead><tr><th style="text-align:left;">Player</th><th>Pos</th><th>Goals</th><th>Assists</th></tr></thead>
                    <tbody>
                        ${rows.map(r => `<tr><td class="team-cell">${this.escapeHtml(r.player)}</td><td>${r.pos}</td><td><strong>${r.goals}</strong></td><td>${r.assists}</td></tr>`).join('')}
                    </tbody>
                </table>
            </div>` : `<div class="empty-state">No goals or assists logged yet this season.</div>`;
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

        // Header photo (RM_MATCH_PHOTOS) renders above everything else in
        // the synopsis block — a single action shot for that match. Starting
        // XI (RM_MATCH_LINEUPS) renders next, then the write-up itself. Any
        // of the three can be present without the others (a match might
        // have a lineup but no write-up yet, a photo but no lineup, etc),
        // so the wrapper only appears when at least one exists.
        const lineupHtml = match.lineup ? this.buildLineupHtml(match.lineup) : '';
        const photoHtml = match.photo
            ? `<img class="modal-synopsis-photo" src="${this.escapeHtml(match.photo)}" alt="${this.escapeHtml(match.home)} vs ${this.escapeHtml(match.away)}">`
            : '';
        const synopsisRow = (match.synopsis || lineupHtml || photoHtml)
            ? `<div class="modal-synopsis">
                   ${photoHtml}
                   ${match.synopsis ? '<span class="modal-synopsis-label">Match Synopsis</span>' : ''}
                   ${lineupHtml}
                   ${match.synopsis ? `<p>${this.escapeHtml(match.synopsis)}</p>` : ''}
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
