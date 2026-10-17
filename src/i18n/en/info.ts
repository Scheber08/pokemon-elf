/** Texts: info (English). Must have exactly the keys of ../de/info.ts (checked by TypeScript). */
import type { Messages } from '../de';

const info: Messages['info'] = {
  about: {
    title: 'About & contact',
    intro:
      ' is a free fan project: build a starting XI out of Pokémon, have it rated by positional fit and play a simulated season with it. The idea is inspired by lineup games – just with football instead of American football.',
    dataPre: 'The Pokémon data (names, types, base stats, height, weight) comes from the free ',
    dataLink: 'PokeAPI',
    dataPost: ', the sprites from the PokeAPI sprite archive.',
    guidePre: 'How teams are rated is explained in the ',
    guideLink: 'Scouting guide',
    guidePost: '.',
    newsTitle: 'What’s new?',
    news: [
      'New: “Early riser” achievement for 30 days of the Daily XI, average fit of the starting XI in the manager squad table, a legend for the qualifying places in the knockout tournament, print view without buttons and with full tables, an “International Kissing Day” season in the shop; plus table zones, cup winners, shinies and best runs for screen readers',
      'New: shared places in top-scorer and scorer lists, the 2D replay remembers its speed, type chips on the squads before kick-off, a “Total” row in the manager squad table, the “Draft legend” achievement for 50 online leagues and a “Tea Day” season in the shop',
      'New: conversion rate in the match report, 🆕 on fresh public lobbies, “n more types for a rainbow” in the builder, achievements for 25 wins in the Retro and 151 challenges and “Honorary president” for 500 runs, a “World UFO Day” season in the shop',
      'New: ✏️ rename in “My teams”, “Hide players in the XI” in the builder’s picker, formation preview in the challenge setup and per team in the single-device draft, goal difference in the manager table (wide view), a more readable type roll card and a “World Water Day” season in the shop',
      'New: “Fill the gaps” in the builder (fills only empty spots, your players stay), 🕑 “Since your last pick” in the online and single-device draft, “Show more” and full names in the manager transfer market, full club names in the final table on narrow phones and a “Pi Day” season in the shop',
      'New: “Best for my team first” now also in the single-device draft and in the challenges (with position and fit on the cards), “Show taken” in the single-device draft, 🥇 lead over 2nd place on the leaderboard, “top n %” next to the all-time rank in profiles, light or dark design on your first visit to match your device and a “Coffee Day” season in the shop',
      'New: ▲/▼ against your average in the challenge result and the Daily XI, win rate against the forecast in friendlies, 💯 direct-hit candidates per position in the scouting guide, the “Fortnight pass” achievement and a “World Health Day” season in the shop',
      'New: 🏆 on perfect seasons in profiles and on the leaderboard, 🔝 strongest fit on the team sheet, ⚽ goals per matchday in the season ticker, 🏅 “best day yet” in the Daily XI share text, all keyboard shortcuts on the About page; the privacy page now also covers trainers and shop purchases',
      'New: “Copy as text” in the manager line-up, 🎯 next goal in the shop, 🔔 end of round now also in the online draft, 🤖 CPU forecast and captain effect also in the single-device draft, “Rolling …” on online rerolls, 🏅 new personal best in the share text, challenge symbols in the FAQ; thousands separators in English counts',
      'New: “Currently here” and ±fit in the picker, 🏅 new personal best in the challenge result, 🏁 final round in the run, 🔥 record streak in the Daily XI, 🏆 perfect seasons on the leaderboard, 💥 biggest win in friendlies, 🎲 random in “Where does … play?”, “n to go” on nearly finished achievements, a notice when “My teams” is full, “Moon Day” season',
      'New: 🔻 weakest fit on the team sheet, 🏆 strongest XI under “My teams”, average points per game and goal difference in the result, goal tally in friendlies, weekday in the weekly ranking, “Affordable (n)” in the shop, ✅ completed achievement categories, “Chocolate Day” season, offline notice and a print view',
      'New: match report with the running score, 🏆 winner, 🟰 equaliser, brace and hat-trick; 2D replay with ←/→ (±5 minutes); gap to the next place on the leaderboard',
      'New: Daily XI with ▲/▼ against yesterday, “Last run” with “… ago”, 🛡️ for unbeaten runs on profiles, rank at the best position in “Where does … play?”, “World Penguin Day” season in the shop; plus many keyboard and screen-reader improvements',
      'New: scouting guide with “Top 3 per position” and “Where does … play?”, fit per player on the team sheet (builder and “View team”) and in the challenge round log, filter the leaderboard by formation',
      'New: 🏁 “title sewn up on matchday n” (challenges and draft), friendlies with a forecast and scorers on both sides, manager cup run, average and trend on profiles, best weekday and new personal best in the Daily XI',
      'New: half-time score in the match report and the 2D replay, “Most clinical side” season record, 🆕 on the leaderboard and your points gap to the top list',
      'Challenges: “Last run” before you start, favourite opponent and bogey team, streaks and home/away record in the season summary',
      'Daily XI: “top n%” next to your position and an archive with 🏅 and ▲/▼; shop with your collection count and new seasons; profile marks personal-best runs with 🏅',
      'New: team of the season (also as an image), home and away tables, player of the matchday and late winners in the ticker, coloured table zones',
      'Manager season: home games now evenly distributed in the fixture list (new seasons), stars for player of the matchday in the squad',
      'Online draft: average fit per team on the board, position and fit in the pick feed with a “run” alert, open positions in the waiting hint',
      'Season result: half-season champions, best team of the second half, surprise/disappointment, highest-scoring game and your biggest win/defeat',
      'Manager season: formation tip, best position for bench players, points projection and the next opponent’s most dangerous scorer',
      'New: shinies in the draft – 2% chance per pick (or 10% as “shiny party”), the weaker the Pokémon, the bigger the team bonus',
      'New: captain in every mode – their fit counts double, “Best choice” finds them, automatic in the online draft and changeable until kickoff',
      'New: jersey numbers, kit colours, goal celebrations and club crests for your team',
      'Manager season: injuries and suspensions, cup, career with promotion and relegation, live matchday, goals and assists per Pokémon',
      'Online draft: wishlist with key W, “Fill with CPU”, all picks in the results and a vibration when pick time runs low',
      'New: “Manager” menu item and match replays (2D/report) in every mode – configurable or off',
      'New: design your own trainer – coins from achievements buy caps, jerseys, backgrounds and companion Pokémon',
      'Online draft: manager season – draft a bench, set your eleven before every matchday, daily form per Pokémon, transfer market',
      'Builder: “My teams” – save and load up to five XIs',
      'Online draft: form guide, season records, your season chart, upset of the matchday, live top scorers and an end-of-season notification',
      'Online draft: the league always has 18 teams – filled up with teams of real players from the leaderboard',
      'Online draft: knockout cup as a format, optionally with a group stage',
      'Online draft: more realistic season with form swings and goal minutes in the ticker',
      'Online draft: Ultra Beasts, Megas and forms – each with its own per-team limit',
      'Online draft: rematch with an all-time table, a wishlist for auto-picks, emoji reactions and a QR code to join',
      'Online draft: draft grades, steal of the draft, “Your head-to-heads” and each team’s top scorer in the result',
      'Leaderboard: weekly ranking, view teams, friendly against your XI and player profiles with all-time rank',
      'Daily XI: streak and archive of recent days',
      'Builder: Megas and forms, “Best XI”, sorting by positional fit, undo and redo',
      'Installable as an app (PWA) and link previews for leagues and profiles',
    ],
    keysTitle: '⌨️ Keyboard shortcuts',
    keysBuilder: 'Builder',
    keysDraft: 'Online draft',
    keysLocal: 'Single-device draft',
    keysReplay: 'Match replay',
    contactTitle: 'Contact',
    contact:
      'Feedback, bugs or ideas? Ideally as an issue in the project’s repository, or by email to the address given in the operator’s legal notice (Impressum).',
    disclaimer:
      'Not affiliated with or endorsed by Nintendo, Game Freak, Creatures or The Pokémon Company. Pokémon names and artwork belong to their respective owners.',
  },
  privacy: {
    title: 'Privacy',
    intro:
      'In short: this app works without an account and sets no tracking cookies. Only for the online leaderboard and online leagues does the server store the bare minimum – more on that below.',
    localTitle: 'Local storage',
    local:
      'Your lineup, “My teams”, settings, best scores, runs in progress, your Daily XI history, the local leaderboard, kits, goal celebrations and crests, the 2D replay speed, your manager-season predictions, cached team names from the online leaderboard (for league opponents), the online leagues you take part in (code, league and team name) and the random device identifier for the online leaderboard and online leagues are stored in your browser’s localStorage. You can delete them at any time via your browser settings – your browser then counts as a new device.',
    usage: (entries, kb) => `On this device right now: ${entries} ${entries === 1 ? 'entry' : 'entries'}, about ${kb} KB.`,
    leaderboardTitle: 'Online leaderboard',
    leaderboardIntro:
      'If you play a challenge online, the app sends your run to our server so that it can be checked and scored. The following is stored:',
    leaderboardItems: [
      'a random device ID and a hash of the device key (the key itself stays on your device),',
      'your chosen player name and team name,',
      'your runs: lineup, moves, team score, record and time,',
      'your trainer (appearance) and the items bought in the shop with their price – the server works out coins and achievements from these and from your runs and leagues,',
      'to prevent abuse (limiting new devices per internet connection), a hash of your IP address when the device first registers – for IPv6, only of its network prefix (/64). The hash is salted with a secret random value, is only needed for one hour and is then deleted on the next server access; the IP address itself is never stored.',
    ],
    leaderboardStorage:
      'The data is held in a Cloudflare D1 database. Player name, team name and results are publicly visible in the leaderboard. There are no accounts, no email addresses and no tracking cookies. Runs played offline never leave your device.',
    leaguesTitle: 'Online leagues (Fantasy Draft)',
    leagues:
      'If you create or join an online league, the server stores the following for that league: the settings and the optional league name, the team names and formations, all picks with their time, and the random device ID that links your team to your device (as with the leaderboard, with only the hash of the device key). Anyone who has a league’s link or code can see the team names and picks; public lobbies appear in the lobby list with the league name, the name of the host team and the number of teams. Leagues are deleted automatically 14 days after they are created.',
    leaguesAbuse:
      'To prevent abuse, the server counts new leagues per internet connection: for this, when a league is created it stores a salted hash of your IP address (IPv6: network prefix /64) together with the current hour; once that hour has passed, the hash is deleted the next time a league is created or the lobby list is requested. While you are connected to a league, its server instance also knows your IP address (for the connection limits) – it is tied only to the open connection, is never written to a database and is gone as soon as you disconnect.',
    externalTitle: 'External content',
    externalPre: 'Pokémon images are loaded from ',
    externalPost:
      ' (PokeAPI sprites, GitHub), fonts from Google Fonts. As with any image request, your IP address is transmitted to these services in the process.',
    sharedTitle: 'Shared links',
    shared:
      '“Copy link” encodes the formation, Pokémon numbers, settings and the optional team name in the URL. Nothing is stored on a server.',
  },
  notFound: {
    title: 'Offside!',
    text: 'This page doesn’t exist.',
    back: 'Back to the Builder',
    or: 'Or jump straight to:',
  },
};

export default info;
