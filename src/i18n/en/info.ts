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
      'Online draft: Ultra Beasts, Megas and forms – each with its own per-team limit',
      'Online draft: rematch with an all-time table, a wishlist for auto-picks, emoji reactions and a QR code to join',
      'Online draft: draft grades, steal of the draft, “Your head-to-heads” and each team’s top scorer in the result',
      'Leaderboard: weekly ranking, view teams, friendly against your XI and player profiles with all-time rank',
      'Daily XI: streak and archive of recent days',
      'Builder: Megas and forms, “Best XI”, sorting by positional fit, undo and redo',
      'Installable as an app (PWA) and link previews for leagues and profiles',
    ],
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
      'Your lineup, settings, best scores, runs in progress, the local leaderboard, the online leagues you take part in (code, league and team name) and the random device identifier for the online leaderboard and online leagues are stored in your browser’s localStorage. You can delete them at any time via your browser settings – your browser then counts as a new device.',
    leaderboardTitle: 'Online leaderboard',
    leaderboardIntro:
      'If you play a challenge online, the app sends your run to our server so that it can be checked and scored. The following is stored:',
    leaderboardItems: [
      'a random device ID and a hash of the device key (the key itself stays on your device),',
      'your chosen player name and team name,',
      'your runs: lineup, moves, team score, record and time,',
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
  },
};

export default info;
