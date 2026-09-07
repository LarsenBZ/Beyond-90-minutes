/* ==========================================================================
   Beyond 90 Minutes — Core JavaScript
   Handles: navigation, dark mode, article search/filter, live league data,
   round-by-round browsing with live polling, league Top Scorers lists, the
   match detail modal, Real Madrid post-match synopses, and Real Madrid tab
   switching.

   WHERE THE DATA COMES FROM:

   ESPN's public site API (site.api.espn.com) — scoreboard, standings, and
   team schedules. No API key, no rate limit, no proxy needed — your
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

   Everything else — league Top Scorers (LEAGUE_TOP_SCORERS), Real Madrid's
   Starting XI (RM_MATCH_LINEUPS), Season Stats (RM_SQUAD_STATS), and match
   reports (RM_MATCH_INFO/RM_MATCH_SYNOPSES) — is hand-kept directly in this
   file rather than fetched live. This used to be split against a second
   API, API-Football (v3.football.api-sports.io), for the season-wide stuff
   ESPN's soccer coverage doesn't reliably give — routed through a
   Cloudflare Worker proxy (cloudflare-worker.js) to keep the key server
   side. But API-Football's free plan doesn't cover the current season at
   all (confirmed by hitting it directly — every call silently fell back to
   an old season instead of failing outright), so everything it powered was
   quietly WRONG rather than just occasionally unavailable: Season Stats
   showed last year's squad, Top Scorers showed a stale season. Top Scorers
   was the last thing on the site still depending on it (as of Sep 5 2026,
   see LEAGUE_TOP_SCORERS below) — nothing in this file calls API-Football
   any more, so the Cloudflare Worker and its API key are dormant. Fine to
   leave as-is or retire the Worker entirely; your call.

   A NOTE ON HAND-KEPT DATA (Top Scorers, Starting XI, Season Stats, match
   reports): all four update the same way — find the real number/lineup
   from a source you trust (a league's own site, ESPN, LaLiga.com, etc.),
   edit the relevant constant below, commit, push. None of these
   auto-refresh; each is only ever as current as the last time someone
   edited this file. See LEAGUE_TOP_SCORERS, RM_MATCH_LINEUPS, and
   RM_SQUAD_STATS below for the exact shape each expects, and the "HOW TO
   UPDATE" comment above each one.

   A NOTE ON THE STARTING XI + SEASON STATS (Real Madrid page): both used
   to be live fetches — the XI from ESPN's summary endpoint, squad stats
   from API-Football — and both turned out to be dead ends, for the same
   free-plan reason above. ESPN's exact soccer "lineups" payload shape was
   never confirmed either. Both are hand-kept instead, same as the match
   synopses: see RM_SQUAD_STATS below and RM_MATCH_LINEUPS further down.
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

Post-Match- Mourinho leaves something clear: Mbappe is the top scorer, but as stated by Mourinho " I prefer for him to score 40 goals with titles than 60 goals without titles." Mourinho expands his win history at the Bernabeu with Real Madrid (75 wins/9 draws/6 losses in 90 games.)`,

    // Real Madrid 4-0 Malaga, La Liga Round 3, Aug 30 2026 (third straight win of Mourinho's second spell)
    "401882899": `Real Madrid Victory 4-0 against Malaga
La Liga round 3
Hope

Real Madrid started with the same 4-2-3-1 with changes in the lineup as Trent started over Dumfries, Cucurella over Dumfries, and Brahim Diaz over Arda Guler. Real Madrid first 30 minutes were the best in the 2nd Mourinho era at Madrid. Trent Alexander-Arnold played his best football in Real Madrid showing that he can start over Dumfries. With an outstanding Bellingham Real Madrid opened the score in the 19th minute with a golazo solo play. Then Bellingham would score the 2nd at the 26th minute (goal counted as own goal.) In the 30th minute Trent would assist Mbappe. Then from the 30th minute to the 80th minute not much would occur and Real Madrid would play worse. Likely due to not having the pressure to win. Arda Guler showed his hunger when he came on in the 87th minute. It took him 4 minutes to change the game quickly showing he doesn't want to be a rotating player. Arda Guler would score with an assist by Vinicius. Yan Diomande hasn't shown his talent yet and many will call his signing a failure. It's hard to not judge a young player when he was signed for 140 million euros (with add-ons.) Mourinho stated that he has a lot to show and hasn't been starting/a having more minutes due to his late arrival. Diomande does show something different with the way he moves the ball. Only time will tell if Diomande will become a star or the next Franco Mastantuono. Solid defense today even though it wasn't challenged as much. Vinicius Jr needs to do more.`,

    // Real Betis 1-0 Real Madrid, La Liga Round 4, Sep 4 2026
    "401882894": `Real Betis 1-0 Real Madrid
La Liga Round 4
The different side of the same coin

Real Madrid played with the same energy as Ancelotti's team in 24/25, Xabi Alonso's 25/26, and Álvaro Arbeloa 25/26. Meaning there is no hunger. Real Madrid creates chances because they are players with quality, but the moment you face a team that plays defensively you have to score the chances you have. Some may say that the penalty should have repeated, Real Madrid should not need a penalty in the last minute to draw. Yes, Real Betis is a great team, but the difference in squad quality is massive. These games can't be lost, not a single point. At the end of the season these points are the ones that cause the biggest difference for first place. The team played a bad first half and an even worse second half. NOTHING from the midfield. Today Bellingham was not existent in attack. Valverde nothing, there is nothing to defend for the most part so he is "just there." Camavinga is an ex-player you give him a pass and you receive a rock with the shape of a ball. Vinicius can't dribble past anyone. The pass given by Guler in the first half he should have scored it, but he was sleeping in the pitch for a second. Kylian Mbappe it doesn't matter if you score a hat-trick, a poker, it doesn't matter if you can't score the goal that gives the team the advantage. The pass by Vini which he should have shot, was still a great chance to score but no. The penalty, unlucky I guess it happens but a game where nothing happens it's hard to avoid the thought what if. Mourinho is the same as Ancelotti, Xabi Alonso, and Alvaro Arbeloa: they are scared of the big names. Why if Vini is playing bad why not sub him out. Let Espi start who has shown that he can score similarly to Gonzalo Garcia. Why buy a player for 140 million euros when he isn't going to score. Arda Guler is playing great, there was no need I'm not sure what the board was thinking. I'm sure that Diomande is still developing, but if I buy a player for 140 million I want him to do everything in the club. A signing of that amount should a star, should be in any graphic, social media posts, and every game. However, he isn't? Mourinho said some of his decisions are based on the amount of time some players had to train due to the World Cup and the time they were signed. This doesn't make sense with the right back. Why not start Trent when you are going to have the ball, yes he will likely lose the 1v1 vs  Fran Garcia, but he will be incredible in attack. Lastly, honor to Espi for signing for Real Madrid and living a dream even though he will not get minutes because the front 2 + Diomande/Arda Guler is untouchable for any coach at this point (Endrick will have even less development when he is back from injury.)`
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
    "401882919": "images/mbappe-vs-real-sociedad.webp",
    "401882899": "images/bellingham-vs-malaga.jpg",
    "401882894": "images/mbappe-vs-betis.webp"
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
    },
    // Real Madrid 4-0 Malaga, La Liga Round 3, Aug 30 2026. Five changes
    // from the Real Sociedad XI per Braulio's synopsis above (Trent,
    // Rüdiger and Cucurella all made their full debuts; Brahim Díaz started
    // over Güler). Sourced from LaLiga.com's official lineup for this match
    // since Braulio's write-up doesn't list the full XI. Bench is LaLiga's
    // full published matchday squad. Numbers checked against Real Madrid's
    // published 2026/27 squad numbers.
    "401882899": {
        formation: "4-2-3-1",
        players: [
            { name: "Courtois", number: 1, posClass: "pos-gk" },
            { name: "Cucurella", number: 17, posClass: "pos-lb" },
            { name: "Huijsen", number: 4, posClass: "pos-lcb" },
            { name: "Rüdiger", number: 22, posClass: "pos-rcb" },
            { name: "Trent", number: 12, posClass: "pos-rb" },
            { name: "Camavinga", number: 6, posClass: "pos-ldm" },
            { name: "Valverde", number: 8, posClass: "pos-rdm" },
            { name: "Bellingham", number: 5, posClass: "pos-cam" },
            { name: "Vinícius Jr", number: 7, posClass: "pos-lw" },
            { name: "Brahim Díaz", number: 21, posClass: "pos-rw" },
            { name: "Mbappé", number: 10, posClass: "pos-st" }
        ],
        bench: [
            { name: "Lunin", number: 13 },
            { name: "Konaté", number: 16 },
            { name: "Dumfries", number: 24 },
            { name: "Carreras", number: 18 },
            { name: "Güler", number: 15 },
            { name: "Bernardo Silva", number: 20 },
            { name: "Carlos Espí", number: 19 },
            { name: "Diomandé", number: 25 }
        ]
    },
    // Real Betis 1-0 Real Madrid, La Liga Matchday 4, Sep 4 2026. Sourced
    // from Real Madrid's own official lineup announcement (realmadrid.com)
    // and cross-checked against Fotmob's match center. Camavinga/Valverde
    // returned as the double pivot with Güler on the right (matches
    // Braulio's synopsis above naming both as starters). Subs used in the
    // match: Bernardo Silva for Camavinga, Trent for Dumfries, Diomandé for
    // Güler. Bench below is the full published matchday squad; numbers
    // checked against Real Madrid's published 2026/27 squad numbers.
    "401882894": {
        formation: "4-2-3-1",
        players: [
            { name: "Courtois", number: 1, posClass: "pos-gk" },
            { name: "Cucurella", number: 17, posClass: "pos-lb" },
            { name: "Huijsen", number: 4, posClass: "pos-lcb" },
            { name: "Konaté", number: 16, posClass: "pos-rcb" },
            { name: "Dumfries", number: 24, posClass: "pos-rb" },
            { name: "Camavinga", number: 6, posClass: "pos-ldm" },
            { name: "Valverde", number: 8, posClass: "pos-rdm" },
            { name: "Bellingham", number: 5, posClass: "pos-cam" },
            { name: "Vinícius Jr", number: 7, posClass: "pos-lw" },
            { name: "Güler", number: 15, posClass: "pos-rw" },
            { name: "Mbappé", number: 10, posClass: "pos-st" }
        ],
        bench: [
            { name: "Lunin", number: 13 },
            { name: "Javi Navarro", number: 31 },
            { name: "Trent", number: 12 },
            { name: "Carreras", number: 18 },
            { name: "Carlos Espí", number: 19 },
            { name: "Bernardo Silva", number: 20 },
            { name: "Brahim Díaz", number: 21 },
            { name: "Rüdiger", number: 22 },
            { name: "Diomandé", number: 25 },
            { name: "Cestero", number: 29 },
            { name: "Mario Rivas", number: 33 },
            { name: "Sergio Martínez", number: 38 }
        ]
    }
};

/* ---- REAL MADRID MATCH INFO (manually maintained, one per match) ---------
   Core match facts — score, competition, venue, kickoff, and the goal
   timeline — for every match that has a synopsis above. This is what
   powers the Match Reports archive page (match-reports.html) and the
   homepage's "Latest Match Report" card, and it renders WITHOUT any live
   ESPN fetch: the old approach (fetch Real Madrid's schedule live, then
   cross-reference it against RM_MATCH_SYNOPSES) kept coming back with
   "No match reports yet" on the live site even though the data was all
   there — same class of bug as the lineups/photos before it, so same
   fix: hand-kept and rendered directly, guaranteed to work regardless of
   network conditions in the visitor's browser.

   HOW TO ADD A NEW MATCH after writing its synopsis above:
     1. Same match ID as RM_MATCH_SYNOPSES/RM_MATCH_LINEUPS/RM_MATCH_PHOTOS.
     2. "opponent" + "isHome" (true if Real Madrid is the home team).
     3. "rmScore"/"oppScore", "matchday" (number, or omit if unknown),
        "venue", and "rawDate" as a UTC ISO kickoff time — it's formatted
        for display automatically, same as everywhere else on the site.
     4. "events" — as many goal/card entries as you want shown, oldest
        first: { minute: "40'", type: "goal"|"yellow"|"red", team:
        "rm"|"opp", player: "Name", ownGoal / penalty: true (optional) }.
   A match with no entry here just won't appear on the Match Reports page
   or the homepage report card — nothing else breaks.
   ---------------------------------------------------------------------- */
const RM_MATCH_INFO = {
    // Espanyol 1-2 Real Madrid, La Liga Matchday 2, Aug 22 2026, RCDE Stadium
    "401882912": {
        opponent: "Espanyol", isHome: false, rmScore: 2, oppScore: 1,
        matchday: 2, venue: "RCDE Stadium, Cornellà-El Prat",
        rawDate: "2026-08-22T19:30:00Z",
        events: [
            { minute: "9'", type: "goal", team: "rm", player: "Bellingham" },
            { minute: "30'", type: "goal", team: "opp", player: "Calatrava" },
            { minute: "90'", type: "goal", team: "rm", player: "Carlos Espí" }
        ]
    },
    // Real Madrid 4-1 Real Sociedad, La Liga Matchday 1 (postponed fixture,
    // played Aug 26 2026), Santiago Bernabéu
    "401882919": {
        opponent: "Real Sociedad", isHome: true, rmScore: 4, oppScore: 1,
        matchday: 1, venue: "Santiago Bernabéu Stadium, Madrid",
        rawDate: "2026-08-26T19:00:00Z",
        events: [
            { minute: "40'", type: "goal", team: "rm", player: "Mbappé" },
            { minute: "44'", type: "goal", team: "opp", player: "Sučić" },
            { minute: "60'", type: "goal", team: "rm", player: "Mbappé" },
            { minute: "68'", type: "goal", team: "rm", player: "Vinícius Jr" },
            { minute: "80'", type: "goal", team: "rm", player: "Mbappé" }
        ]
    },
    // Real Madrid 4-0 Málaga, La Liga Matchday 3, Aug 30 2026, Santiago Bernabéu
    "401882899": {
        opponent: "Málaga", isHome: true, rmScore: 4, oppScore: 0,
        matchday: 3, venue: "Santiago Bernabéu Stadium, Madrid",
        rawDate: "2026-08-30T15:00:00Z",
        events: [
            { minute: "19'", type: "goal", team: "rm", player: "Bellingham" },
            { minute: "26'", type: "goal", team: "rm", player: "A. Herrero", ownGoal: true },
            { minute: "30'", type: "goal", team: "rm", player: "Mbappé" },
            { minute: "90+1'", type: "goal", team: "rm", player: "Güler" }
        ]
    },
    // Real Betis 1-0 Real Madrid, La Liga Matchday 4, Sep 4 2026, Estadio
    // La Cartuja (Betis's temporary home while their own stadium is being
    // expanded). Mbappé had a stoppage-time penalty saved by Valles that
    // would have drawn the game level — not logged as an event below since
    // there's no "missed penalty" event type, but it's in Braulio's
    // synopsis above.
    "401882894": {
        opponent: "Real Betis", isHome: false, rmScore: 0, oppScore: 1,
        matchday: 4, venue: "Estadio La Cartuja, Seville",
        rawDate: "2026-09-04T19:00:00Z",
        events: [
            { minute: "81'", type: "goal", team: "opp", player: "Troy Parrott" }
        ]
    }
};

/* ---- REAL MADRID SQUAD STATS (manually maintained) ------------------------
   API-Football's free plan doesn't cover the current season at all (see the
   file-header note above) — every row this used to show was really the
   2024/25 squad, which is why it looked wrong rather than just
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
    { player: "Jude Bellingham", pos: "MF", goals: 2, assists: 1 }, // +1 goal vs Malaga (solo run, 19')
    { player: "Carlos Espí", pos: "FW", goals: 1, assists: 0 },
    { player: "Arda Güler", pos: "MF", goals: 1, assists: 1 }, // +1 goal vs Malaga (90+1', assist Vinícius)
    // Real Madrid 4-1 Real Sociedad, La Liga Round 1, Aug 26 2026
    { player: "Kylian Mbappé", pos: "FW", goals: 4, assists: 0 }, // +1 goal vs Malaga (30', assist Trent)
    { player: "Vinícius Jr", pos: "FW", goals: 1, assists: 1 }, // +1 assist vs Malaga, to Güler
    { player: "Fede Valverde", pos: "MF", goals: 0, assists: 1 },
    // Real Madrid 4-0 Malaga, La Liga Round 3, Aug 30 2026
    { player: "Trent Alexander-Arnold", pos: "DF", goals: 0, assists: 1 } // assist vs Malaga (30', to Mbappé)
];

/* ---- LEAGUE TOP SCORERS (manually maintained, one list per league) -------
   Same reasoning as RM_SQUAD_STATS above: API-Football's free plan doesn't
   cover the current season, so a live "top scorers" call was quietly
   showing an old season dressed up with a "(2023/24)" label rather than
   real current numbers. Hand-kept instead — keyed by the exact leagueKey
   string each CompetitionHub uses ("Premier League", "La Liga", "UEFA
   Champions League"), which loadScorers()/loadRmOverviewLive() read
   straight from this object with no fetch involved.

   HOW TO UPDATE THIS: check a source you trust (the Premier League's own
   stats page, LaLiga.com, ESPN's league stats page, etc.), replace the
   "scorers" array for that league with the new top ~10, and update "asOf"
   to the date you checked. assists are optional — leave a player's
   assists as null if your source doesn't show them; renderScorersTable
   shows "—" for that. Ties (several players on the same goal count) can
   go in any order. Save, commit, push — no other code changes needed.
   A league with an empty "scorers" array shows "note" instead (used below
   for the Champions League before its league phase has kicked off).
   ---------------------------------------------------------------------- */
const LEAGUE_TOP_SCORERS = {
    // Source: NBC Sports (Nicholas Mendola), published Sep 5 2026, 11:53am ET
    "Premier League": {
        asOf: "Sep 5, 2026 (Matchday 4)",
        scorers: [
            { player: "Bruno Fernandes", team: "Manchester United", goals: 3, assists: null },
            { player: "Alexander Isak", team: "Liverpool", goals: 3, assists: null },
            { player: "Erling Haaland", team: "Manchester City", goals: 3, assists: null },
            { player: "Jack Hinshelwood", team: "Brighton", goals: 2, assists: null },
            { player: "Rayan Cherki", team: "Manchester City", goals: 2, assists: null },
            { player: "Anthony Elanga", team: "Newcastle United", goals: 2, assists: null },
            { player: "Joao Pedro", team: "Chelsea", goals: 2, assists: null },
            { player: "Cole Palmer", team: "Chelsea", goals: 2, assists: null },
            { player: "Bukayo Saka", team: "Arsenal", goals: 2, assists: null },
            { player: "Marcus Tavernier", team: "Bournemouth", goals: 2, assists: null }
        ]
    },
    // Source: NBC Sports (Nicholas Mendola), published Sep 4 2026, 3:01pm ET
    // — reflects Real Madrid's MD4 loss at Betis, but not every MD4 game
    // (Barcelona hadn't played its round-4 fixture yet at publish time).
    "La Liga": {
        asOf: "Sep 4, 2026 (Matchday 4)",
        scorers: [
            { player: "Raphinha", team: "Barcelona", goals: 5, assists: null },
            { player: "Kylian Mbappé", team: "Real Madrid", goals: 4, assists: null },
            { player: "Fermín López", team: "Barcelona", goals: 3, assists: null },
            { player: "Yassir Zabiri", team: "Racing Santander", goals: 3, assists: null },
            { player: "Roberto Fernández", team: "Espanyol", goals: 3, assists: null },
            { player: "Alex Baena", team: "Atlético Madrid", goals: 3, assists: null },
            { player: "Pierre-Emerick Aubameyang", team: "Deportivo de La Coruña", goals: 3, assists: null },
            { player: "Sergio Camello", team: "Rayo Vallecano", goals: 3, assists: null },
            { player: "Mariano Díaz", team: "Alavés", goals: 2, assists: null },
            { player: "Rodrigo Riquelme", team: "Real Betis", goals: 2, assists: null }
        ]
    },
    // League phase doesn't kick off until Sep 8 2026 (Real Madrid host
    // Inter Milan that night) — no goals scored yet, so nothing to show.
    // Fill this in with the real top scorers once matches start.
    "UEFA Champions League": {
        asOf: null,
        scorers: [],
        note: "League phase kicks off Sep 8, 2026 — check back once matches are played."
    }
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
        // Length (Short/Long reads) ANDs with the search box — the topic
        // filter (All/Analysis/World Cup) was removed since it wasn't
        // pulling its weight with only two real categories.
        const lengthButtons = document.querySelectorAll("#length-filters .rm-nav-btn");
        const articleCards = document.querySelectorAll(".article-card");
        const emptyState = document.getElementById("articles-empty-state");

        if (!searchInput && lengthButtons.length === 0) return;

        let currentLength = "ALL";
        let searchQuery = "";

        const filterArticles = () => {
            let visibleCount = 0;
            articleCards.forEach(card => {
                const length = card.getAttribute("data-length") || "";
                const title = card.getAttribute("data-title") || "";
                const matchesLength = currentLength === "ALL" || length === currentLength;
                const matchesSearch = title.toLowerCase().includes(searchQuery.toLowerCase());
                const visible = matchesLength && matchesSearch;
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
        } else if (page === "match-reports") {
            this.loadMatchReportsArchive();
        } else if (page === "home") {
            this.loadHomeSidebarLive();
        }
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
    // daysBack/daysForward default to a rolling 30/60-day window (fine for
    // "recent results" + "upcoming fixtures" on the Overview tab and the
    // homepage sidebar, which only ever need matches near today). The
    // Match Reports archive page passes a much wider daysBack instead —
    // it needs to keep finding a match with a synopsis (see
    // RM_MATCH_SYNOPSES) for as long as that match stays in the archive,
    // not just while it's recent.
    async fetchRmMatches(forceRefresh = false, daysBack = 30, daysForward = 60) {
        const now = new Date();
        const start = new Date(now); start.setUTCDate(start.getUTCDate() - daysBack);
        const end = new Date(now); end.setUTCDate(end.getUTCDate() + daysForward);
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

            // Full finished list (not sliced to 3), oldest → newest, for the
            // goals-for/against trend chart — see renderRmGoalsTrend/
            // buildGoalsTrendSvg above.
            const allFinishedAscending = events
                .filter(e => !e.isLive && e.status === "FINISHED" && e.rawDate)
                .sort((a, b) => new Date(a.rawDate) - new Date(b.rawDate));
            this.renderRmGoalsTrend(allFinishedAscending);

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

        // Reuses the same hand-kept La Liga list as the La Liga hub page —
        // see LEAGUE_TOP_SCORERS near the top of this file.
        this.renderTopScorersInto(scorersEl, "rm-scorers-heading", "La Liga Top Scorers", "La Liga");
    }

    // Shared by every "Top Scorers" box on the site (league hubs + this RM
    // page) — looks up the hand-kept LEAGUE_TOP_SCORERS entry for
    // leagueKey, renders its table (or its "note" if there's nothing to
    // show yet, e.g. UCL before the league phase starts), and stamps the
    // heading with the "as of" date so it's never mistaken for live data.
    renderTopScorersInto(containerEl, headingId, baseLabel, leagueKey) {
        if (!containerEl) return;
        const data = LEAGUE_TOP_SCORERS[leagueKey];
        const headingEl = document.getElementById(headingId);
        if (!data) {
            containerEl.innerHTML = `<div class="empty-state">Top scorers aren't set up for this competition yet.</div>`;
            return;
        }
        containerEl.innerHTML = data.scorers.length
            ? this.renderScorersTable(data.scorers)
            : `<div class="empty-state">${data.note || "No scorer data yet."}</div>`;
        if (headingEl) headingEl.textContent = data.asOf ? `${baseLabel} (as of ${data.asOf})` : baseLabel;
    }

    // Builds full match-card-ready objects for every match that has a
    // synopsis, straight from the hand-kept RM_MATCH_INFO/RM_MATCH_SYNOPSES/
    // RM_MATCH_LINEUPS/RM_MATCH_PHOTOS registries above — no ESPN fetch
    // involved, so nothing here can go stale, rate-limit, or come back
    // empty because of a visitor's network/browser. Same output shape as
    // mapEspnEvent() so renderMatchCard()/openMatchModal() need no changes
    // to consume it. Newest first.
    buildRmMatchReports() {
        return Object.keys(RM_MATCH_SYNOPSES)
            .map(id => {
                const info = RM_MATCH_INFO[id];
                if (!info) {
                    console.warn(`RM_MATCH_SYNOPSES has an entry for match ${id} with no matching RM_MATCH_INFO — skipping it on the Match Reports page until that's added.`);
                    return null;
                }
                const rmSide = info.isHome ? "home" : "away";
                const oppSide = info.isHome ? "away" : "home";
                const events = (info.events || []).map(e => ({
                    minute: e.minute,
                    type: e.type,
                    teamSide: e.team === "rm" ? rmSide : oppSide,
                    player: e.player,
                    ownGoal: Boolean(e.ownGoal),
                    penalty: Boolean(e.penalty)
                }));
                const date = new Date(info.rawDate);
                const time = isNaN(date.getTime())
                    ? "TBD"
                    : date.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

                return {
                    id,
                    home: info.isHome ? "Real Madrid" : info.opponent,
                    away: info.isHome ? info.opponent : "Real Madrid",
                    time,
                    score: info.isHome ? `${info.rmScore} - ${info.oppScore}` : `${info.oppScore} - ${info.rmScore}`,
                    venue: info.venue,
                    status: "FINISHED",
                    isLive: false,
                    statusLabel: null,
                    events,
                    halftime: null,
                    matchday: info.matchday ?? null,
                    stage: null,
                    group: null,
                    rawDate: info.rawDate,
                    synopsis: RM_MATCH_SYNOPSES[id],
                    lineup: RM_MATCH_LINEUPS[id] || null,
                    photo: RM_MATCH_PHOTOS[id] || null
                };
            })
            .filter(Boolean)
            .sort((a, b) => new Date(b.rawDate) - new Date(a.rawDate));
    }

    // Match Reports archive page — every RM match that has a synopsis,
    // newest first, reusing the exact same renderMatchCard() + modal
    // system as the Real Madrid hub (a card here opens the same
    // synopsis/lineup/photo popup). Fully synchronous and hand-kept (see
    // buildRmMatchReports() above) — no fetch, so no loading state and
    // nothing for a slow or blocked network to break.
    loadMatchReportsArchive() {
        const el = document.getElementById("match-reports-list");
        if (!el) return;
        const reports = this.buildRmMatchReports();
        el.innerHTML = reports.length
            ? reports.map(m => this.renderMatchCard(m, "Real Madrid")).join('')
            : `<div class="empty-state">No match reports yet — they'll show up here as soon as one's written.</div>`;
    }

    // Populates the homepage's two cards. "Latest Match Report" is fully
    // hand-kept (see buildRmMatchReports() above) — same fix as the Match
    // Reports archive page, no fetch needed, so adding a new synopsis is
    // still the only thing needed to make it show up here. "Real Madrid
    // — Next Up" is the one card that genuinely needs a live fetch (an
    // unplayed fixture can't be hand-kept ahead of time), so it still
    // pulls from ESPN and falls back to sample data if that fails.
    async loadHomeSidebarLive() {
        const sidebar = document.getElementById("latest-match-sidebar");
        const reportSidebar = document.getElementById("latest-report-sidebar");
        if (reportSidebar) {
            const latestReport = this.buildRmMatchReports().slice(0, 1);
            reportSidebar.innerHTML = latestReport.length
                ? latestReport.map(m => this.renderMatchCard(m, "Real Madrid")).join('')
                : `<div class="empty-state">No match reports yet.</div>`;
        }
        if (!sidebar) return;
        try {
            const events = await this.fetchRmMatches(false, 240, 60);
            const now = new Date();
            const next = events
                .filter(e => e.status !== "FINISHED" && e.rawDate && new Date(e.rawDate) >= now)
                .sort((a, b) => new Date(a.rawDate) - new Date(b.rawDate))
                .slice(0, 1);
            sidebar.innerHTML = next.length
                ? next.map(f => this.renderMatchCard(f, "Real Madrid")).join('')
                : `<div class="empty-state">No upcoming fixture found.</div>`;
        } catch (err) {
            console.warn("ESPN homepage fetch failed for the 'Next Up' fixture, showing sample data instead:", err);
            const data = this.mockData["Real Madrid"];
            if (sidebar && data) sidebar.innerHTML = data.fixtures.map(f => this.renderMatchCard(f, "Real Madrid")).join("");
        }
    }

    /* ---- SAMPLE-DATA LOADERS (fallback on fetch failure) ------------------ */
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
            ${this.buildSquadStatsChartSvg(rows)}
            <div class="table-wrapper">
                <table class="standings-table">
                    <thead><tr><th style="text-align:left;">Player</th><th>Pos</th><th>Goals</th><th>Assists</th></tr></thead>
                    <tbody>
                        ${rows.map(r => `<tr><td class="team-cell">${this.escapeHtml(r.player)}</td><td>${r.pos}</td><td><strong>${r.goals}</strong></td><td>${r.assists}</td></tr>`).join('')}
                    </tbody>
                </table>
            </div>` : `<div class="empty-state">No goals or assists logged yet this season.</div>`;
    }

    // Horizontal grouped-bar chart (goals + assists per player), built as a
    // plain SVG string — no chart library. viewBox uses a fixed virtual
    // coordinate system (chartW below) and scales to the container via
    // CSS (width:100%), so it stays responsive without measuring the DOM.
    buildSquadStatsChartSvg(rows) {
        if (!rows || !rows.length) return '';
        const maxVal = Math.max(1, ...rows.flatMap(r => [r.goals, r.assists]));
        const chartW = 600;
        const labelW = 148;
        const valueW = 30;
        const barAreaW = chartW - labelW - valueW;
        const rowH = 44;
        const barH = 13;
        const gap = 5;
        const topPad = 8;
        const totalH = topPad * 2 + rows.length * rowH;
        const scale = v => (v / maxVal) * barAreaW;

        const rowsSvg = rows.map((r, i) => {
            const rowCenter = topPad + i * rowH + rowH / 2;
            const goalsW = Math.max(scale(r.goals), r.goals > 0 ? 2 : 0);
            const assistsW = Math.max(scale(r.assists), r.assists > 0 ? 2 : 0);
            const goalsY = rowCenter - barH - gap / 2;
            const assistsY = rowCenter + gap / 2;
            return `
                <g>
                    <text x="${labelW - 10}" y="${rowCenter + 4}" text-anchor="end" class="chart-player-label">${this.escapeHtml(r.player)}</text>
                    <rect x="${labelW}" y="${goalsY}" width="${goalsW}" height="${barH}" rx="2" class="chart-bar-goals"></rect>
                    <text x="${labelW + goalsW + 6}" y="${goalsY + barH - 2}" class="chart-value-label">${r.goals}</text>
                    <rect x="${labelW}" y="${assistsY}" width="${assistsW}" height="${barH}" rx="2" class="chart-bar-assists"></rect>
                    <text x="${labelW + assistsW + 6}" y="${assistsY + barH - 2}" class="chart-value-label">${r.assists}</text>
                </g>`;
        }).join('');

        return `
            <div class="stat-chart-wrapper">
                <div class="chart-legend">
                    <span class="legend-item"><span class="legend-swatch legend-swatch--goals"></span>Goals</span>
                    <span class="legend-item"><span class="legend-swatch legend-swatch--assists"></span>Assists</span>
                </div>
                <svg viewBox="0 0 ${chartW} ${totalH}" class="stat-bar-chart" role="img" aria-label="Goals and assists per player this season">
                    ${rowsSvg}
                </svg>
            </div>`;
    }

    // Line chart for RM's goals-for/goals-against across the finished
    // matches of the season so far (ascending, oldest to newest). Same
    // plain-SVG approach as buildSquadStatsChartSvg above — no library,
    // scales via viewBox. Needs at least 2 points to draw a line; the
    // caller (loadRmOverviewLive) shows a placeholder instead if there
    // aren't enough matches yet. X-axis labels are the opponent's name —
    // fine while the match count stays modest (a handful of league
    // games); if the season list grows long, this is the spot to revisit
    // for label rotation/thinning.
    buildGoalsTrendSvg(points) {
        if (!points || points.length < 2) return '';
        const chartW = 640;
        const chartH = 230;
        const padL = 30, padR = 16, padT = 16, padB = 44;
        const innerW = chartW - padL - padR;
        const innerH = chartH - padT - padB;
        const maxVal = Math.max(1, ...points.flatMap(p => [p.gf, p.ga]));
        const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
        const xAt = i => padL + i * stepX;
        const yAt = v => padT + innerH - (v / maxVal) * innerH;

        const linePath = key => points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(p[key]).toFixed(1)}`).join(' ');

        const gridVals = [...new Set([0, Math.round(maxVal / 2), maxVal])];
        const gridLines = gridVals.map(v => `
            <line x1="${padL}" y1="${yAt(v).toFixed(1)}" x2="${chartW - padR}" y2="${yAt(v).toFixed(1)}" class="chart-gridline"></line>
            <text x="${padL - 8}" y="${(yAt(v) + 3.5).toFixed(1)}" text-anchor="end" class="chart-axis-label">${v}</text>
        `).join('');

        const dots = key => points.map((p, i) =>
            `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(p[key]).toFixed(1)}" r="4" class="chart-dot chart-dot--${key}"><title>${this.escapeHtml(p.opponent)}: ${p[key]}</title></circle>`
        ).join('');

        const xLabels = points.map((p, i) =>
            `<text x="${xAt(i).toFixed(1)}" y="${chartH - padB + 20}" text-anchor="middle" class="chart-axis-label chart-axis-label--x">${this.escapeHtml(p.opponent)}</text>`
        ).join('');

        return `
            <div class="stat-chart-wrapper">
                <div class="chart-legend">
                    <span class="legend-item"><span class="legend-swatch legend-swatch--gf"></span>Goals For</span>
                    <span class="legend-item"><span class="legend-swatch legend-swatch--ga"></span>Goals Against</span>
                </div>
                <svg viewBox="0 0 ${chartW} ${chartH}" class="stat-trend-chart" role="img" aria-label="Goals for and against by match this season">
                    ${gridLines}
                    <path d="${linePath('gf')}" class="chart-line chart-line--gf" fill="none"></path>
                    <path d="${linePath('ga')}" class="chart-line chart-line--ga" fill="none"></path>
                    ${dots('gf')}
                    ${dots('ga')}
                    ${xLabels}
                </svg>
            </div>`;
    }

    // Builds the {opponent, gf, ga} points buildGoalsTrendSvg needs from
    // finished RM matches (ascending). match.score is always "H - A" for
    // a FINISHED match (see mapEspnEvent) — home/away determined by
    // comparing homeId to Real Madrid's own ESPN id.
    renderRmGoalsTrend(finishedAscending) {
        const el = document.getElementById("rm-goals-trend-container");
        if (!el) return;
        const rmId = String(ESPN_CONFIG.realMadridTeamId);
        const points = finishedAscending
            .filter(m => m.score && m.score.includes(' - '))
            .map(m => {
                const isHome = String(m.homeId) === rmId;
                const [s1, s2] = m.score.split(' - ').map(n => parseInt(n, 10));
                return {
                    opponent: isHome ? m.away : m.home,
                    gf: isHome ? s1 : s2,
                    ga: isHome ? s2 : s1
                };
            })
            .filter(p => Number.isFinite(p.gf) && Number.isFinite(p.ga));

        el.innerHTML = points.length >= 2
            ? this.buildGoalsTrendSvg(points)
            : `<div class="empty-state">Trend chart will appear once a few matches are in.</div>`;
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
   (ESPN), a hand-kept Top Scorers list (see LEAGUE_TOP_SCORERS), and live
   polling while a match in the visible round is in progress.
   ========================================================================== */
class CompetitionHub {
    constructor(app, config) {
        this.app = app;
        this.espnLeague = config.espnLeague;
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

    loadScorers() {
        if (!this.scorersEl) return;
        this.app.renderTopScorersInto(
            this.scorersEl,
            this.scorersEl.id.replace("-container", "-heading"),
            "Top Scorers",
            this.leagueKey
        );
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
