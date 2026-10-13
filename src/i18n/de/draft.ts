/** Texte: draft (Deutsch – Quelle). Die englische Fassung in ../en/draft.ts muss dieselben Schlüssel haben. */

/** Ergebnis aus Sicht eines Teams: S = Sieg, U = Remis, N = Niederlage */
type Outcome = 'S' | 'U' | 'N';

const draft = {
  // ---------------------------------------------------------------- Gemeinsam
  cpu: 'CPU',
  you: 'Du',
  host: 'Host',
  teams: 'Teams',
  pool: 'Pool',
  formation: 'Formation',
  on: 'An',
  off: 'Aus',
  draftBoard: 'Draft-Board',
  topScorers: 'Torjäger',
  table: 'Tabelle',
  /** „3. Spieltag" */
  matchday: (n: number) => `${n}. Spieltag`,
  /** Spielfreie Teams eines Spieltags (Namen schon verbunden) */
  byes: (names: string) => `Spielfrei: ${names}`,
  /** „12 Pkt" */
  pts: (n: number) => `${n} Pkt`,
  /** Platz als Ordnungszahl („3.") */
  placeNo: (n: number) => `${n}.`,
  outcome: { S: 'Sieg', U: 'Remis', N: 'Niederlage' } as Record<Outcome, string>,
  /** Tabellenköpfe (Kürzel + Tooltip) */
  col: {
    place: 'Pl.',
    placeTitle: 'Platz',
    team: 'Team',
    score: 'Score',
    teamScore: 'Team-Score',
    played: 'Sp',
    playedTitle: 'Spiele',
    won: 'S',
    wonTitle: 'Siege',
    drawn: 'U',
    drawnTitle: 'Unentschieden',
    lost: 'N',
    lostTitle: 'Niederlagen',
    goals: 'Tore',
    diff: 'Diff',
    diffTitle: 'Tordifferenz',
    pts: 'Pkt',
    ptsTitle: 'Punkte',
  },

  // ---------------------------------------------------------------- /draft (Modus + lokaler Hot-Seat-Draft)
  modeLabel: 'Spielmodus',
  modeOnline: 'Online-Liga',
  modeLocal: 'An einem Gerät',
  local: {
    /** Anzeige des gespeicherten Vorgabe-Namens „Mein Team" */
    myTeam: 'Mein Team',
    title: 'Fantasy-Draft',
    lead: '2–8 Teams, ein gemeinsamer Pool, Snake-Draft über 11 Runden. Danach spielt jeder gegen jeden – Hin- und Rückrunde.',
    teamCount: 'Anzahl Teams',
    teamNameAria: (no: number) => `Name Team ${no}`,
    teamFormationAria: (no: number) => `Formation Team ${no}`,
    human: 'Mensch',
    hotSeatNote: 'Menschliche Teams wählen nacheinander am selben Gerät (Hot-Seat).',
    region: 'Region',
    legendsLabel: 'Pokémon / Legendäre',
    pokemon: 'Pokémon',
    legends: 'Legendäre',
    /** from: Satzbaustein wie im Builder (common.regionPhrase): „aus Kanto (Nr. 1–151)" */
    poolDesc: (from: string, legends: boolean) => `Draft ${from}, ${legends ? 'mit Legendären' : 'ohne Legendäre'}.`,
    poolTooSmall: (size: number, teams: number, rounds: number, need: number) =>
      `Nur ${size} Pokémon im Pool – für ${teams} Teams × ${rounds} Runden braucht ihr ${need}. Wählt eine größere Region, „Alle" oder weniger Teams.`,
    start: 'Draft starten',
    leagueTitle: 'Draft-Liga',
    leagueLead: (matches: number) => `Jeder gegen jeden, Hin- und Rückrunde – ${matches} Spiele.`,
    /** Spieltag in der Spielliste („3.") */
    roundNo: (n: number) => `${n}.`,
    allMatches: 'Alle Spiele',
    squads: 'Kader',
    squadAria: (team: string) => `Kader ${team}`,
    replay: 'Liga neu ausspielen',
    newDraft: 'Neuer Draft',
    round: 'Runde',
    pick: 'Pick',
    onTheClock: 'Am Zug:',
    cpuTag: '(CPU)',
    cpuScouting: (team: string) => `${team} scoutet …`,
    pickTitle: 'Wähle ein Pokémon',
    /** Folgt auf den fett gesetzten Pokémon-Namen */
    selectedHint: ' gewählt. Klicke auf einen freien Platz auf dem Feld.',
    yourTurn: (team: string) => `${team}, du bist dran.`,
    abortConfirm: 'Draft abbrechen?',
    abort: 'Draft abbrechen',
  },

  // ---------------------------------------------------------------- Liga-Einstellungen (Online-Draft)
  settings: {
    leagueName: 'Liganame',
    optional: '(optional)',
    leagueNamePlaceholder: 'z. B. Montagsliga',
    poolTooSmall: (teams: number) => `Pool zu klein für ${teams} Teams`,
    poolNote: (size: number, capacity: number) => `${size} Pokémon, reicht für bis zu ${capacity} Teams`,
    legends: 'Legendäre',
    setPiece: 'Standardschütze',
    setPieceRound: '12. Runde',
    tooManyTeams: 'Der Pool reicht nicht für so viele Teams',
    alreadyJoined: (n: number) => `Es sind schon ${n} Teams dabei`,
    order: 'Draft-Reihenfolge',
    orderRandom: 'Zufällig',
    orderHost: 'Host legt fest',
    timer: 'Pick-Timer',
    seconds: (s: number) => `${s} s`,
    timerNote: 'Läuft die Zeit ab, wählt der Server automatisch.',
    noTimerNote: 'Ohne Zeitlimit – der Host kann für abwesende Teams wählen.',
    lobby: 'Lobby',
    private: 'Privat',
    public: 'Öffentlich',
    privateNote: 'Privat: nur wer Link oder Code hat, kann beitreten.',
    publicNote: 'Öffentlich: Die Liga steht in der Liste der öffentlichen Lobbys – jeder kann beitreten.',
    teamName: 'Teamname',
    teamNamePlaceholder: 'z. B. FC Glurak',
  },
  /** Kurzfassung der Einstellungen (Mitspieler, Lobby-Liste) */
  summary: {
    pool: (region: string) => `Pool: ${region}`,
    withLegends: 'mit Legendären',
    withoutLegends: 'ohne Legendäre',
    withSetPiece: 'mit Standardschütze',
    withoutSetPiece: 'ohne Standardschütze',
    maxTeams: (n: number) => `bis ${n} Teams`,
    orderRandom: 'Reihenfolge zufällig',
    orderHost: 'Reihenfolge vom Host',
    perPick: (s: number) => `${s} s pro Pick`,
    noTimer: 'ohne Pick-Timer',
    public: 'öffentlich',
    private: 'privat',
  },

  // ---------------------------------------------------------------- Draft-Board
  board: {
    onlineTitle: 'Online',
    offlineTitle: 'Offline',
    onlineAria: 'online',
    offlineAria: 'offline',
    recentPicks: 'Letzte Picks',
    auto: ' (auto)',
  },

  // ---------------------------------------------------------------- Ergebnis der Online-Liga
  results: {
    none: 'Für diese Liga gibt es noch kein Ergebnis.',
    copied: 'Ergebnis kopiert',
    copyFailed: 'Kopieren nicht möglich',
    kicker: (code: string) => `Online-Draft ${code}`,
    championLabel: 'Meister: ',
    heroLine: (r: { pts: number; w: number; d: number; l: number; gf: number; ga: number }, rating: number) =>
      `${r.pts} Pkt · ${r.w}–${r.d}–${r.l} · Tore ${r.gf}:${r.ga} · Team-Score ${rating}`,
    youChampion: 'Glückwunsch – dein Team ist Meister!',
    yourPlace: (team: string, place: number, pts: number) => `Dein Team ${team}: Platz ${place} · ${pts} Pkt`,
    share: 'Ergebnis teilen',
    finalTable: 'Abschlusstabelle',
    yourTeamSr: ' (dein Team)',
    noGoals: 'Keine Tore in dieser Saison.',
    setPieceOnly: 'Standardschütze',
    setPiecePart: (n: number) => `davon ${n} Standard`,
    goalsAria: (n: number) => `${n} ${n === 1 ? 'Tor' : 'Tore'}`,
    lineups: 'Aufstellungen',
    rosterMeta: (formation: string, pts: number, gf: number, ga: number) => `${formation} · ${pts} Pkt · Tore ${gf}:${ga}`,
    lineupAria: (team: string) => `Aufstellung ${team}`,
    allMatchdays: 'Alle Spieltage',
  },

  // ---------------------------------------------------------------- Saison (Vorbereitung + Ticker)
  season: {
    preparing: 'Saison wird vorbereitet …',
    newLeague: 'Neue Liga',
  },
  ticker: {
    startsSoon: 'Die gemeinsame Saison beginnt gleich.',
    fullTime: 'Abpfiff!',
    matchdayColon: (n: number) => `${n}. Spieltag:`,
    result: (outcome: string, gf: number, ga: number, home: boolean, opponent: string, place: number) =>
      `${outcome} ${gf}:${ga} ${home ? 'gegen' : 'bei'} ${opponent}, Platz ${place}.`,
    bye: (place: number) => `Dein Team ist spielfrei, Platz ${place}.`,
    championLine: (team: string, pts: number) => `Meister: ${team} mit ${pts} Punkten.`,
    leaderLine: (team: string, pts: number) => `Tabellenführer: ${team} mit ${pts} Punkten.`,
    statusEnd: 'Ende',
    statusLive: 'Live',
    statusSoon: 'Gleich',
    sharedSeason: 'Gemeinsame Saison',
    title: 'Saison-Ticker',
    toResult: 'Zum Ergebnis',
    skip: 'Überspringen',
    matchdayLabel: 'Spieltag',
    progressAria: 'Saisonfortschritt',
    progressText: (md: number, total: number) => `Spieltag ${md} von ${total}`,
    place: 'Platz',
    points: 'Punkte',
    record: 'Bilanz',
    goals: 'Tore',
    championLabel: 'Meister: ',
    youChampion: 'Dein Team ist Meister!',
    yourPlace: (place: number) => `Dein Team: Platz ${place}`,
    finalScores: 'Endstand',
    results: 'Ergebnisse',
    kickoff: 'Anpfiff',
    kickoffIn: 'Anpfiff in',
    kickoffNow: 'Anpfiff!',
    fixtures: 'Paarungen',
    tableAfter: (n: number) => `Tabelle nach dem ${n}. Spieltag`,
    note: 'Alle sehen dieselbe Saison gleichzeitig. Überspringen gilt nur für dich.',
    scoreOpen: 'noch offen',
    scoreAria: (hg: number, ag: number) => `${hg} zu ${ag}`,
    unchanged: ' (unverändert)',
    /** Trend für Screenreader, mit Klammern */
    trend: (n: number, up: boolean) => `(${n} ${n === 1 ? 'Platz' : 'Plätze'} ${up ? 'geklettert' : 'abgerutscht'})`,
  },

  // ---------------------------------------------------------------- Titelentscheidung + Teilen (leagueTimeline)
  tie: {
    /** Wie buildTable bei völligem Gleichstand entscheidet */
    tiebreakLabel: 'dem Teamnamen (alphabetisch)',
    /** Letztes Bindewort in „A, B und C" */
    and: ' und ',
    gd: (names: string, c: string, r: string) => `Punktgleich mit ${names} – entschieden nach Tordifferenz (${c} zu ${r})`,
    gf: (names: string, c: number, r: number) =>
      `Punktgleich mit ${names} bei gleicher Tordifferenz – entschieden nach Toren (${c} zu ${r})`,
    rating: (names: string, c: number, r: number) =>
      `Punktgleich mit ${names}, gleiche Tordifferenz und gleich viele Tore – entschieden nach Team-Score (${c} zu ${r})`,
    tiebreak: (names: string, label: string) =>
      `Punktgleich mit ${names}, gleiche Tordifferenz und gleich viele Tore – entschieden nach ${label}`,
    level: (names: string) => `Punktgleich mit ${names}`,
  },
  share: {
    /** Erste Zeile ohne eigenes Team; tie = „ – punktgleich …" oder leer */
    line: (code: string, champion: string, pts: number, tie: string) =>
      `Pokémon Elf – Online-Draft ${code}: Meister ${champion} (${pts} Pkt)${tie}.`,
    own: (team: string, place: number) => ` Mein Team ${team}: Platz ${place}.`,
  },
};

export default draft;
