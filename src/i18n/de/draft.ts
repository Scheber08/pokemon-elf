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
    /** Überschrift der Gruppe mit Teams, Reihenfolge, Zufallsmodus und Timer */
    groupDraft: 'Draft',
    /** Generationen (Mehrfachauswahl, Chips mit Regionsnamen) */
    gens: 'Generationen',
    allGens: 'Alle',
    allGensTitle: 'Alle Generationen',
    genTitle: (gen: number) => `Generation ${gen}`,
    minOneGen: 'Mindestens eine Generation',
    /** Typen (Mehrfachauswahl) */
    types: 'Typen',
    allTypes: 'Alle',
    allTypesTitle: 'Alle Typen',
    noTypes: 'Keine',
    noTypesTitle: 'Neue Auswahl – Typen antippen, dann übernehmen',
    minOneType: 'Mindestens ein Typ',
    typesNote: 'Ein Pokémon braucht mindestens einen der gewählten Typen.',
    pickTypes: 'Tippe die gewünschten Typen an und übernimm sie – bis dahin bleibt die bisherige Auswahl.',
    /** Neue Typ-Auswahl nach „Keine" (noch nicht übernommen) */
    typesDraft: (size: number, capacity: number) => `Neue Auswahl: ${size} Pokémon, reicht für bis zu ${capacity} Teams`,
    applyTypes: 'Übernehmen',
    cancelTypes: 'Abbrechen',
    legendary: 'Legendäre',
    mythical: 'Mysteriöse',
    maxLegends: 'Legendäre pro Team',
    unlimited: 'Unbegrenzt',
    maxLegendsNote: 'Legendäre und Mysteriöse zusammen – der Standardschütze zählt mit.',
    maxLegendsOff: 'Nur mit Legendären oder Mysteriösen im Pool.',
    ultraBeasts: 'Ultrabestien',
    maxUltraBeasts: 'Ultrabestien pro Team',
    maxUltraBeastsNote: 'Eigene Kategorie, unabhängig von den Legendären – der Standardschütze zählt mit.',
    maxUltraBeastsOff: 'Nur mit Ultrabestien im Pool.',
    forms: 'Formen',
    formsNote: 'Regionalformen (Alola, Galar, Hisui, Paldea) und Sonderformen wie Rotom oder Tiergeist-Formen – jede ist ein eigenes Pokémon im Pool.',
    megas: 'Megas',
    maxMegas: 'Megas pro Team',
    maxMegasNote: 'Inklusive Proto-Kyogre und -Groudon. Legendäre Megas gibt es nur mit Legendären und zählen für beide Limits.',
    maxMegasOff: 'Nur mit Megas im Pool.',
    /** Zufallsmodus (wie die 34–0-Challenge) */
    roll: 'Zufallsmodus',
    rollPick: 'Pro Pick',
    rollRound: 'Pro Runde',
    rollOffNote: 'Freie Wahl aus dem ganzen Pool.',
    rollPickNote: 'Jeder Pick bekommt einen eigenen Wurf aus Generation und Typ – gewählt wird ein passendes Pokémon.',
    rollRoundNote: 'Ein Wurf pro Runde für alle Teams. Hat er für ein Team nichts Passendes mehr, würfelt es für diesen Pick neu.',
    rerollsType: 'Typ-Rerolls',
    rerollsRegion: 'Regions-Rerolls',
    rerollsNote: 'Pro Team und Draft. Ein Reroll ändert nur den Wurf des eigenen Picks.',
    /** Reroll-Art ohne Alternative im Pool (nur eine Generation bzw. ein Typ) */
    rerollsTypeOff: 'Typ-Rerolls gibt es nur mit mehreren Typen.',
    rerollsRegionOff: 'Regions-Rerolls gibt es nur mit mehreren Generationen.',
    snake: 'Snake-Draft',
    snakeNote: 'Jede zweite Runde rückwärts.',
    fixedNote: 'Jede Runde dieselbe Reihenfolge.',
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
    /** Mehr als drei Generationen (aber nicht alle) */
    gensCount: (n: number) => `${n} Generationen`,
    /** Typen (nicht alle): Namen bzw. Anzahl */
    types: (list: string) => `Typen: ${list}`,
    typesCount: (n: number, total: number) => `${n} von ${total} Typen`,
    legendsBoth: 'mit Legendären und Mysteriösen',
    legendaryOnly: 'mit Legendären, ohne Mysteriöse',
    mythicalOnly: 'mit Mysteriösen, ohne Legendäre',
    withoutLegends: 'ohne Legendäre und Mysteriöse',
    maxLegends: (n: number) => (n === 1 ? 'höchstens ein Legendäres pro Team' : `höchstens ${n} Legendäre pro Team`),
    withoutUltraBeasts: 'ohne Ultrabestien',
    withForms: 'mit Formen',
    withMegas: 'mit Megas',
    maxMegas: (n: number) => (n === 1 ? 'höchstens ein Mega pro Team' : `höchstens ${n} Megas pro Team`),
    maxUltraBeasts: (n: number) => (n === 1 ? 'höchstens eine Ultrabestie pro Team' : `höchstens ${n} Ultrabestien pro Team`),
    rollPick: 'Zufallsmodus: pro Pick',
    rollRound: 'Zufallsmodus: pro Runde',
    rerolls: (type: number, region: number) => `Rerolls: ${type}× Typ, ${region}× Region`,
    /** Nur eine Reroll-Art nutzbar (die andere hat im Pool keine Alternative bzw. steht auf 0) */
    rerollsTypeOnly: (n: number) => `Rerolls: ${n}× Typ`,
    rerollsRegionOnly: (n: number) => `Rerolls: ${n}× Region`,
    noRerolls: 'ohne Rerolls',
    snake: 'Snake-Draft',
    fixedOrder: 'jede Runde gleiche Reihenfolge',
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
    /** Legendäre im Team bei einem Limit („★ 1/2") – Tooltip */
    legendsTitle: (n: number, max: number) =>
      `${n} von höchstens ${max === 1 ? 'einem Legendären/Mysteriösen' : `${max} Legendären/Mysteriösen`}`,
    /** Ultrabestien im Team bei einem Limit („UB 1/2") – Tooltip */
    ultraBeastsTitle: (n: number, max: number) => `${n} von höchstens ${max === 1 ? 'einer Ultrabestie' : `${max} Ultrabestien`}`,
    /** Megas im Team bei einem Limit („M 1/2") – Tooltip */
    megasTitle: (n: number, max: number) => `${n} von höchstens ${max === 1 ? 'einem Mega' : `${max} Megas`}`,
    /** Wurf, unter dem ein Pick fiel (Verlauf) */
    rollTitle: (region: string, type: string) => `Wurf: ${region} + ${type}`,
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
    saveOwnImage: 'Meine Elf als Bild',
    grade: 'Note',
    /** Bester später Pick */
    /** Direkte Duelle des eigenen Teams */
    duels: 'Deine Duelle',
    duelsOpponent: 'Gegner',
    duelsScores: 'Ergebnisse',
    duelsRecord: 'S–U–N',
    duelsRecordTitle: 'Siege – Unentschieden – Niederlagen gegen dieses Team',
    duelHome: 'Heimspiel',
    duelAway: 'Auswärtsspiel',
    steal: (pokemon: string, pick: number, team: string, pos: string) => `Schnäppchen des Drafts: ${pokemon} (Pick ${pick}) für ${team} als ${pos}`,
    gradeTitle: 'Draft-Note nach Team-Score – relativ zu den anderen Teams dieser Liga (A+ bis D)',
    finalTable: 'Abschlusstabelle',
    yourTeamSr: ' (dein Team)',
    noGoals: 'Keine Tore in dieser Saison.',
    setPieceOnly: 'Standardschütze',
    setPiecePart: (n: number) => `davon ${n} Standard`,
    goalsAria: (n: number) => `${n} ${n === 1 ? 'Tor' : 'Tore'}`,
    lineups: 'Aufstellungen',
    /** Bester Torschütze eines Teams (Kader-Karte) */
    teamTopScorer: (pokemon: string, goals: number) => `⚽ Bester Torschütze: ${pokemon} (${goals === 1 ? '1 Tor' : `${goals} Tore`})`,
    rosterMeta: (formation: string, pts: number, gf: number, ga: number) => `${formation} · ${pts} Pkt · Tore ${gf}:${ga}`,
    lineupAria: (team: string) => `Aufstellung ${team}`,
    allMatchdays: 'Alle Spieltage',
  },

  // ---------------------------------------------------------------- Saison (Vorbereitung + Ticker)
  season: {
    preparing: 'Saison wird vorbereitet …',
    newLeague: 'Neue Liga',
    rematch: 'Revanche',
    rematchBusy: 'Revanche wird angelegt …',
    rematchTitle: 'Neue Liga mit denselben Teams und Einstellungen – alle sind sofort wieder dabei',
    toRematch: 'Zur Revanche',
    rematchFailed: 'Die Revanche konnte nicht angelegt werden',
  },
  /** Ewige Tabelle einer Gruppe (Revanchen) */
  eternal: {
    title: 'Ewige Tabelle',
    leagues: (n: number) => (n === 1 ? '1 Liga' : `${n} Ligen`),
    note: 'Alle Ligen dieser Gruppe zusammengezählt – jede Revanche kommt dazu.',
    soFar: 'Bisher in dieser Gruppe',
    leaguesCol: 'L',
    leaguesTitle: 'Ligen',
    titlesCol: '★',
    titlesTitle: 'Meistertitel',
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
