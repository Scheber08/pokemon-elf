/** Texte: leaderboard (Deutsch – Quelle). Die englische Fassung in ../en/leaderboard.ts muss dieselben Schlüssel haben. */
import { fmtNumber } from '../lang';

const leaderboard = {
  title: 'Rangliste',
  lead: 'Pro Spieler zählt der beste Run – sortiert nach Punkten, dann Team-Score.',
  colRank: 'Platz',
  colPlayer: 'Spieler',
  colRecord: 'Bilanz',
  colPoints: 'Pkt',
  colScore: 'Score',
  freshTitle: 'In der letzten Stunde eingetragen',
  yourRank: 'Deine Platzierung',
  yourRankGap: (pts: number, top: number) => `noch ${pts} Pkt bis in die Top ${top}`,
  playNow: 'Jetzt spielen',
  today: 'Heute',
  allTime: 'Allzeit',
  week: 'Diese Woche',
  /** „Diese Woche · KW 42" */
  weekOf: (n: number) => `Diese Woche · KW ${n}`,
  weekLeft: (days: number) => (days === 1 ? 'endet heute' : `noch ${days} Tage`),
  /** „Heute · 12.10.2026" */
  todayOn: (date: string) => `Heute · ${date}`,
  topFormation: (formation: string, n: number, total: number) => `Lieblingsformation der Top ${total}: ${formation} (${n}×)`,
  players: (n: number) => `${fmtNumber(n, 0, 'de')} Spieler`,
  loading: 'Lade …',
  loadError: (message: string) => `Rangliste nicht erreichbar: ${message}`,
  retry: 'Erneut versuchen',
  emptyOnline: 'Noch keine Einträge – sei der Erste!',
  localError: (message: string) => `Runs dieses Geräts nicht lesbar: ${message}`,
  emptyLocalToday: 'Heute noch keine Runs auf diesem Gerät.',
  emptyLocalWeek: 'Diese Woche noch keine Runs auf diesem Gerät.',
  emptyLocal: 'Noch keine Runs auf diesem Gerät.',
  /** „Heute · 12.10.2026 · nur dieses Gerät …" bzw. „Allzeit · …" */
  localMeta: (period: string) => `${period} · nur dieses Gerät, auch ungewertete Runs`,
  nameSavedOnline: 'Name gespeichert – auch online aktualisiert',
  nameSavedNotOnline: 'Name gespeichert – online gerade nicht möglich',
  nameSaved: 'Name gespeichert',
  nameSaveFailed: 'Name konnte nicht gespeichert werden',
  checking: 'Verbindung zur Online-Rangliste wird geprüft …',
  serverDown: 'Server nicht erreichbar – du siehst die Runs dieses Geräts.',
  noticeOnline:
    'Online-Rangliste – gewertet werden nur Runs, die online gestartet wurden. Dein Gerät ist dein Profil, ganz ohne Anmeldung.',
  noticeLocal: 'Runs dieses Geräts – auch offline gespielte, die nicht in die Online-Rangliste kommen.',
  sourceLabel: 'Quelle',
  sourceOnline: 'Online',
  sourceLocal: 'Dieses Gerät',
  challengeTabs: 'Challenge',
  periodLabel: 'Zeitraum',
  nameLabel: 'Dein Name auf der Rangliste',
  save: 'Speichern',
  nameHintOnline: 'Gilt online für alle Runs dieses Geräts und lokal für neue Runs.',
  nameHintLocal: 'Gilt für neue Runs auf diesem Gerät.',
  /**
   * Fehler der Online-Rangliste: Server/Client melden deutsch mit festem Code –
   * auf Deutsch wird die Meldung unverändert gezeigt.
   */
  apiError: (_code: string | null, message: string) => message,
  /** Tooltip des Team-Knopfs in jeder Tabellenzeile */
  viewTeam: 'Team ansehen',
  /**
   * Zugänglicher Name des Team-Knopfs: „Team ansehen: Pallet Power von Ash". Er enthält immer den
   * sichtbaren Text (Teamname bzw. „Team ansehen") – ohne Teamnamen: „Team ansehen: Team von Ash".
   */
  viewTeamOf: (team: string, player: string) =>
    team ? `Team ansehen: ${team} von ${player}` : `Team ansehen: Team von ${player}`,
  /** Dialog mit dem Team eines Eintrags */
  entry: {
    /** Titel, wenn der Eintrag keinen Teamnamen hat */
    untitled: (player: string) => `Team von ${player}`,
    /** „34–0 Challenge · 12.10.2026" (date null: Tag unbekannt) */
    kicker: (challenge: string, date: string | null) => (date ? `${challenge} · ${date}` : challenge),
    /** „von Ash · Platz 3" */
    byline: (player: string, rank: number | null) => (rank != null ? `von ${player} · Platz ${rank}` : `von ${player}`),
    record: 'Bilanz',
    /** Vorgelesene Bilanz statt „30–2–2" */
    recordSpoken: (w: number, d: number, l: number) =>
      `${w} ${w === 1 ? 'Sieg' : 'Siege'}, ${d} Unentschieden, ${l} ${l === 1 ? 'Niederlage' : 'Niederlagen'}`,
    points: 'Punkte',
    score: 'Team-Score',
    formation: 'Formation',
    /** aria-label des Spielfelds */
    pitchAria: (team: string, formation: string) => `Aufstellung von ${team} (${formation})`,
    sheetTitle: 'Aufstellung',
    loading: 'Team wird geladen …',
    gone: 'Dieses Team ist nicht mehr in der Rangliste.',
    goneHint: 'Vermutlich gibt es inzwischen einen besseren Run – lade die Rangliste neu.',
    reloadBoard: 'Rangliste neu laden',
    loadError: (message: string) => `Team nicht erreichbar: ${message}`,
    unreadable: 'Diese Aufstellung lässt sich nicht anzeigen.',
    openInBuilder: 'Im Builder öffnen',
    openInBuilderHint: 'Ersetzt deine Aufstellung im Builder.',
    profile: 'Profil',
    profileTitle: (player: string) => `Profil von ${player}`,
    /** Testspiel: eigene Builder-Elf gegen dieses Team */
    friendly: 'Testspiel gegen deine Elf',
    friendlyAgain: 'Nochmal spielen',
    friendlyTitle: 'Testspiel',
    friendlyNeedEleven: 'Für ein Testspiel brauchst du im Builder eine volle Elf.',
    friendlyToBuilder: 'Zum Builder',
    friendlyYou: 'Deine Elf',
    friendlyPick: 'Mit:',
    friendlyCurrent: (name: string) => `${name} (aktuelle Elf)`,
    friendlyFirst: 'Hinspiel',
    friendlySecond: 'Rückspiel',
    friendlyAggregate: 'Gesamt',
    friendlyWin: 'Du gewinnst das Duell!',
    friendlyDraw: 'Unentschieden über beide Spiele.',
    friendlyLoss: 'Das Duell geht an den Gegner.',
    friendlyScore: (own: number, opp: number) => `Team-Score ${own} : ${opp}`,
    friendlyScorers: (list: string) => `Tore: ${list}`,
    friendlyOdds: (w: number, d: number, l: number) => `📈 Prognose aus 100 Testspielen: ${w} % Sieg · ${d} % Remis · ${l} % Niederlage`,
    friendlyTally: (n: number, w: number, d: number, l: number) => `📊 Bilanz aus ${n} Testspielen: ${w} S · ${d} U · ${l} N`,
    friendlyStar: (name: string, team: string, goals: number) => `⭐ Mann des Spiels: ${name} (${team}) – ${goals} Tore`,
    friendlyNote: 'Nur zum Spaß – zählt für keine Rangliste. Bewertet über alle 1.025 Pokémon.',
  },
  /** Spielerprofil (/spieler/:id) */
  profile: {
    kicker: 'Spielerprofil',
    since: (date: string) => `Dabei seit ${date}`,
    runs: (n: number) => (n === 1 ? '1 gewerteter Run' : `${n} gewertete Runs`),
    achievements: (done: number, total: number) => `🏅 ${done}/${total} Erfolge`,
    online: (titles: number, leagues: number) =>
      `🏆 ${titles} Titel in ${leagues} ${leagues === 1 ? 'Online-Liga' : 'Online-Ligen'}`,
    managerCups: (n: number) => `🥇 ${n === 1 ? '1 Pokalsieg' : `${n} Pokalsiege`}`,
    shinies: (n: number) => `✨ ${n === 1 ? '1 Shiny' : `${n} Shinys`}`,
    favourite: (challenge: string, runs: number) => `⭐ Lieblings-Challenge: ${challenge} (${runs} Runs)`,
    goalsReached: (n: number) => `🎯 ${n === 1 ? '1 Saisonziel' : `${n} Saisonziele`} erreicht`,
    captainGoals: (n: number) => `Kapitän: bis zu ${n === 1 ? '1 Tor' : `${n} Tore`} in einer Saison`,
    perChallenge: 'Bestwerte',
    runsCol: 'Runs',
    perfectTitle: (n: number) => (n === 1 ? 'Eine perfekte Saison (nur Siege)' : `${n} perfekte Saisons (nur Siege)`),
    best: 'Bester Run',
    showTeam: 'Team ansehen',
    bestRunTitle: 'Bestwert dieser Wertung',
    recentFilter: 'Letzte Runs nach Wertung filtern',
    recentAll: 'Alle',
    recentAvg: (avg: number, n: number) => `Ø ${avg} Pkt aus ${n} Runs`,
    recentTrend: (diff: number) => `${diff > 0 ? '▲ +' : '▼ −'}${Math.abs(diff)} Pkt in den letzten 3 Runs gegenüber davor`,
    recent: 'Letzte Runs',
    loading: 'Profil wird geladen …',
    gone: 'Dieses Profil ist nicht (mehr) erreichbar – der Eintrag steht nicht mehr in der Rangliste.',
    error: (message: string) => `Profil nicht erreichbar: ${message}`,
    toBoard: 'Zur Rangliste',
    share: 'Profil teilen',
    linkCopied: 'Link zum Profil kopiert',
    copyFailed: 'Kopieren nicht möglich',
    pts: (n: number) => `${n} Pkt`,
    score: (n: number) => `Score ${n}`,
    /** Aktueller Allzeit-Platz in dieser Wertung */
    place: (place: number, players: number) => `Platz ${place} von ${players}`,
    placeTitle: 'Aktueller Platz in der Allzeit-Rangliste',
  },
};

export default leaderboard;
