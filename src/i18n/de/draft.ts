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
    form: 'Form',
    formTitle: 'Die letzten fünf Spiele (ältestes links)',
    formAria: (list: string) => `Form: ${list}`,
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
    /** Spielmodus nach dem Draft */
    format: 'Spielmodus',
    formatLeague: 'Liga',
    formatCup: 'KO-Turnier',
    formatManager: 'Manager-Saison',
    formatManagerNote: (teams: number) =>
      `Hinrunde mit ${teams} Teams, ein Spieltag im eingestellten Takt – davor stellt jeder seine Elf aus Kader und Bank auf (Tagesform beachten).`,
    bench: 'Bank',
    benchNote: (n: number) => `${n} Pokémon zusätzlich – werden nach der Elf gedraftet.`,
    matchdayEvery: 'Spieltag alle',
    /** Takt als kurzer Text: „10 Min.", „1 Std.", „24 Std." */
    every: (minutes: number) => (minutes < 60 ? `${minutes} Min.` : `${minutes / 60} Std.`),
    /** Dauer der ganzen Saison (Minuten) */
    matchdayNote: (minutes: number) =>
      minutes < 48 * 60 ? `Die Saison dauert etwa ${Math.max(1, Math.round(minutes / 60))} Stunden.` : `Die Saison dauert etwa ${Math.round(minutes / 1440)} Tage.`,
    cupGroups: 'Gruppenphase',
    cupGroupsNote: '4 Gruppen à 4 Teams mit Hin- und Rückspiel – die ersten zwei kommen ins Viertelfinale.',
    cupNoGroupsNote: 'Direkt los mit dem Achtelfinale.',
    formatLeagueNote: (teams: number) => `Jeder gegen jeden, Hin- und Rückrunde – ${teams} Teams, aufgefüllt mit Teams aus der Rangliste.`,
    formatCupNote: (teams: number) =>
      `${teams} Teams im KO-Baum, gesetzt nach Team-Score – ein Spiel pro Runde, bei Unentschieden Elfmeterschießen.`,
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
    league: (teams: number) => `Liga mit ${teams} Teams`,
    cup: (teams: number) => `KO-Turnier mit ${teams} Teams`,
    manager: (teams: number, every: string, bench: number) => `Manager-Saison mit ${teams} Teams, Spieltag alle ${every}, ${bench} Bankplätze`,
    cupWithGroups: (teams: number) => `KO-Turnier mit ${teams} Teams und Gruppenphase`,
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
    saveTable: 'Als Bild',
    saveTableAria: 'Tabelle als Bild speichern',
    saveBracketAria: 'Turnierbaum als Bild speichern',
    grade: 'Note',
    /** Direkte Duelle des eigenen Teams */
    duels: 'Deine Duelle',
    duelsOpponent: 'Gegner',
    duelsScores: 'Ergebnisse',
    duelsRecord: 'S–U–N',
    duelsRecordTitle: 'Siege – Unentschieden – Niederlagen gegen dieses Team',
    duelHome: 'Heimspiel',
    duelAway: 'Auswärtsspiel',
    /** Auffüllteam aus der Rangliste: Name des echten Spielers */
    fillPlayerTitle: 'Team eines Spielers aus der Rangliste (34–0 Challenge)',
    /** Tabelle nach einem wählbaren Spieltag */
    timeTravel: 'Zeitreise',
    timeTravelDay: (day: number, total: number) => `Tabelle nach dem ${day}. Spieltag (von ${total})`,
    /** Platzverlauf des eigenen Teams */
    placeChart: 'Dein Saisonverlauf',
    placeChartAria: (days: number, best: number, last: number, running = false) =>
      `Tabellenplatz über ${days} Spieltage – bester Platz ${best}, ${running ? 'aktuell' : 'am Ende'} ${last}`,
    placeChartCaption: (best: number, last: number, running = false) => `Bester Platz: ${best} · ${running ? 'aktuell' : 'am Ende'}: ${last}`,
    /** Saisonrekorde (Liga) */
    records: 'Saisonrekorde',
    recordAttack: 'Bester Angriff',
    recordDefense: 'Beste Abwehr',
    recordWin: 'Höchster Sieg',
    recordStreak: 'Längste Siegesserie',
    recordFastest: 'Schnellster Picker',
    recordFastestLine: (team: string, sec: number) => `${team} – Ø ${sec} s pro Pick`,
    recordGoals: (team: string, n: number) => `${team} – ${n} Tore`,
    recordConceded: (team: string, n: number) => `${team} – ${n === 1 ? '1 Gegentor' : `${n} Gegentore`}`,
    recordWinLine: (home: string, score: string, away: string, round: number) => `${home} ${score} ${away} (${round}. Spieltag)`,
    streak: (team: string, n: number, from: number, to: number) => `${team}, ${n} Siege am Stück (${from}.–${to}. Spieltag)`,
    /** Bester später Pick */
    steal: (pokemon: string, pick: number, team: string, pos: string) => `Schnäppchen des Drafts: ${pokemon} (Pick ${pick}) für ${team} als ${pos}`,
    signing: (pokemon: string, team: string, matchday: number, line: string) =>
      `Transfer der Saison: ${pokemon} zu ${team} (vor Spieltag ${matchday}) – danach ${line}`,
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
    avgCol: 'Ø Pl.',
    avgTitle: 'Durchschnittlicher Platz über alle Ligen',
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
    /** Außenseitersieg des Spieltags; score aus Sicht des Siegers */
    upset: (winner: string, loser: string, score: string) => `Überraschung: ${winner} schlägt ${loser} ${score}`,
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
  /** KO-Turnier (Ticker und Ergebnis) */
  // ---------------------------------------------------------------- Saison-Statistik
  stats: {
    title: 'Statistiken',
    tab: { goals: 'Tore', assists: 'Vorlagen', points: 'Scorer', teams: 'Teams' },
    shots: 'Schüsse',
    shotsTitle: 'Schüsse pro Spiel',
    onTarget: 'Aufs Tor',
    onTargetTitle: 'Schüsse aufs Tor pro Spiel',
    xgTitle: 'Erwartete Tore (in Klammern: echte Tore)',
    xgaTitle: 'Erwartete Gegentore (in Klammern: echte Gegentore)',
    possession: 'Ballbesitz',
    possessionTitle: 'Durchschnittlicher Ballbesitz',
    teamsNote: 'Sortiert nach xG-Differenz. Nur Spiele mit Statistik (neue Ligen).',
    split: (goals: number, assists: number) => `${goals} Tore, ${assists} Vorlagen`,
    short: (goals: number, assists: number) => `(${goals}+${assists})`,
    empty: 'Noch keine Einträge.',
  },

  // ---------------------------------------------------------------- 2D-Ansicht
  replay: {
    tab: '2D-Ansicht',
    reportTab: 'Bericht',
    off: 'Aus',
    setting: 'Spielwiedergabe',
    settingPitch: 'Klick aufs Ergebnis zeigt das Spiel als 2D-Ansicht von oben',
    settingReport: 'Klick aufs Ergebnis zeigt den Spielbericht (Tore, Statistik)',
    settingOff: 'Ergebnisse ohne Spielwiedergabe',
    aria: 'Spielfeld von oben mit den Spielern beider Teams und dem Ball',
    play: 'Abspielen',
    pause: 'Pause',
    again: 'Nochmal',
    seek: 'Spielminute',
    nextGoal: 'Zum nächsten Tor springen (Taste N)',
    playKey: 'Abspielen/Pause (Leertaste)',
    goalFlash: 'TOR!',
    goalMark: (minute: string, team: string) => `Tor ${minute} – ${team}`,
    nextGoalShort: '⏭ Tor',
    speed: (rate: number) => `Tempo ${rate}× – zum Wechseln klicken`,
    goal: (scorer: string, assist: string | null) => (assist ? `⚽ Tor! ${scorer} (Vorlage ${assist})` : `⚽ Tor! ${scorer}`),
    shot: (team: string) => `Abschluss ${team}`,
    note: 'Nachgestellt aus Ergebnis, Torminuten und Statistik – die Tore fallen wie im echten Spiel.',
  },

  // ---------------------------------------------------------------- Spielbericht
  report: {
    title: 'Spielbericht',
    image: 'Als Bild',
    imageAria: 'Spielbericht als Bild speichern',
    open: (home: string, away: string, score: string) => `Spielbericht ${home} gegen ${away} (${score}) öffnen`,
    goals: 'Tore',
    noGoals: 'Keine Tore.',
    /** Tor eines Teams ohne Kader (Verein) */
    goalOf: (team: string) => `Tor ${team}`,
    assist: (name: string) => `Vorlage ${name}`,
    setPiece: 'Standard',
    stats: 'Statistik',
    possession: 'Ballbesitz',
    shots: 'Schüsse',
    onTarget: 'Aufs Tor',
    xg: 'Erwartete Tore (xG)',
    noStats: 'Für dieses Spiel gibt es keine Statistik (ältere Liga).',
  },

  // ---------------------------------------------------------------- Manager-Saison: Bank
  bench: {
    label: 'Bank',
    /** Kürzel statt Positionsabzeichen */
    short: 'BK',
    empty: (n: number) => `Bank ${n}`,
    emptyAria: (n: number) => `Bankplatz ${n}, frei`,
    filledAria: (n: number, name: string) => `Bankplatz ${n}: ${name}`,
  },

  // ---------------------------------------------------------------- Manager-Saison
  manager: {
    kicker: 'Manager-Saison',
    played: (played: number, total: number) => `Spieltag ${played} von ${total} gespielt`,
    next: (n: number) => `Spieltag ${n}`,
    /** Countdown bis zum Anpfiff (ms) */
    kickoffIn: (ms: number) => {
      if (ms <= 0) return 'Anpfiff läuft …';
      const s = Math.floor(ms / 1000);
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      if (d > 0) return `Anpfiff in ${d} T. ${h} Std.`;
      if (h > 0) return `Anpfiff in ${h} Std. ${m} Min.`;
      return `Anpfiff in ${m}:${String(s % 60).padStart(2, '0')}`;
    },
    kickoffAt: (when: string) => `(${when})`,
    lineupTitle: 'Deine Aufstellung',
    formation: 'Formation',
    auto: 'Automatisch aufstellen',
    autoNote: 'Vor jedem Spieltag stellt der Server die beste Elf zur Tagesform auf – in deiner Formation.',
    manualNote: 'Deine Aufstellung gilt, bis du sie änderst – auch über mehrere Spieltage.',
    best: 'Beste Elf aufstellen',
    strength: (n: number) => `Stärke ${n}`,
    bestStrength: (n: number) => `bestmöglich ${n}`,
    strengthTitle: 'Team-Score dieser Elf samt Tagesform',
    swapHint: 'Tippe zwei Spieler an, um sie zu tauschen – auf dem Feld, mit dem Standardschützen oder mit der Bank.',
    selected: (name: string) => `${name} ausgewählt – jetzt den Tauschpartner antippen.`,
    squadTitle: 'Kader und Tagesform',
    colPokemon: 'Pokémon',
    colRole: 'Rolle',
    colFit: 'Fit',
    fitTitle: 'Fit auf seiner Position samt Tagesform (Bank: beste Position der Formation)',
    colForm: 'Form',
    formTitle: (n: number) => (n > 0 ? `Tagesform +${n}` : n < 0 ? `Tagesform ${n}` : 'Tagesform normal'),
    formNote: (fit: number) => `Jede Formstufe verschiebt den Fit um ${fit} Punkte. Die Form gilt für den nächsten Spieltag.`,
    lastResults: (n: number) => `Ergebnisse Spieltag ${n}`,
    starTitle: 'Spieler des Spieltags:',
    rivalTitle: 'Nächster Gegner',
    rivalHome: 'Heimspiel',
    rivalAway: 'Auswärtsspiel',
    rivalPlace: (n: number) => `Platz ${n}`,
    compareYou: 'Du',
    compareTitle: 'Stärke der besten Elf aus dem Kader (ohne Tagesform)',
    compareAria: (share: number) => `Stärkevergleich: ${share} % zu ${100 - share} %`,
    starLine: (goals: number, assists: number) =>
      [goals ? `${goals} ${goals === 1 ? 'Tor' : 'Tore'}` : '', assists ? `${assists} ${assists === 1 ? 'Vorlage' : 'Vorlagen'}` : '']
        .filter(Boolean)
        .join(', '),
    upcoming: (n: number) => `Spieltag ${n} – die Paarungen`,
    tableTitle: 'Tabelle',
    spectator: 'Du schaust zu – Aufstellungen stellen nur die Teams dieser Liga.',
    notifyHeading: (league: string, n: number) => `${league}: Spieltag ${n} gespielt`,
    notifyResult: (outcome: string, gf: number, ga: number, opponent: string) => `${outcome} ${gf}:${ga} gegen ${opponent}.`,
    notifyPlayed: (n: number) => `Spieltag ${n} ist gespielt.`,
    notifySoonHeading: (league: string, n: number) => `${league}: gleich Spieltag ${n}`,
    notifySoon: (min: number) => `Anpfiff in ${min} Min. – Aufstellung und Transfers noch prüfen?`,
    marketTitle: 'Transfermarkt',
    marketTip: (inn: string, out: string) => `Tipp: ${inn} holen, ${out} abgeben`,
    marketTipTake: 'Als Wunsch setzen',
    marketNote: (n: number) =>
      `Ein Tausch pro Spieltag: ein freies Pokémon gegen eins aus deinem Kader. Vergeben wird zum Anpfiff von Spieltag ${n} – wollen mehrere dasselbe, bekommt es der Tabellenschlechtere.`,
    marketOut: 'Abgeben',
    marketSearch: 'Freie Pokémon suchen',
    marketFree: (n: number) => `${n} frei`,
    marketTake: 'Holen',
    marketTakeAria: (inn: string, out: string) => `${inn} für ${out} holen`,
    marketClaim: (inn: string, out: string, n: number) => `Dein Wunsch: ${inn} für ${out} – wird zum Anpfiff von Spieltag ${n} vergeben.`,
    marketCancel: 'Zurückziehen',
    marketFit: (pos: string, fit: number) => `${pos} ${fit}`,
    marketNone: 'Kein passendes freies Pokémon.',
    transfersTitle: (n: number) => `Transfers vor Spieltag ${n}`,
    transfersAll: (n: number) => `Alle früheren Transfers der Saison (${n})`,
    transferLine: (team: string, inn: string, out: string) => `${team}: ${inn} kommt, ${out} geht`,
    tradeLine: (a: string, aGives: string, b: string, bGives: string) => `Tausch: ${a} gibt ${aGives} an ${b} für ${bGives}`,
    tradeTitle: 'Tausch mit anderen Teams',
    tradeNote:
      'Biete einem Team ein eigenes Pokémon für eins aus seinem Kader an. CPU-Teams antworten sofort (nur wenn ihre beste Elf stärker wird) und schlagen nach Spieltagen auch selbst Tausche vor, die beiden helfen. Mitspieler nehmen an oder lehnen ab. Ein Tausch gilt sofort.',
    tradeGive: 'Du gibst',
    tradeTeam: 'An Team',
    tradeGet: 'Du bekommst',
    tradeCpu: 'CPU',
    tradeSend: 'Angebot senden',
    tradeAskCpu: 'Tausch anfragen',
    offerIn: (team: string, give: string, get: string) => `${team} bietet ${give} für deinen ${get}`,
    offerOut: (team: string, give: string, get: string) => `Dein Angebot an ${team}: ${give} für ${get}`,
    tradeDone: (out: string, team: string, inn: string) => `Getauscht: ${out} an ${team}, dafür ${inn}`,
    offerCpuExpires: 'gilt bis zum Anpfiff',
    formWarning: (names: string[]) =>
      `${names.length === 1 ? `${names[0]} ist` : `${names.length} Spieler deiner Elf sind`} heute schlecht in Form${names.length > 1 ? ` (${names.join(', ')})` : ''} – vielleicht rotieren?`,
    offersOpen: (n: number) => (n === 1 ? '1 Tausch-Angebot an dich offen' : `${n} Tausch-Angebote an dich offen`),
    offerAccepted: (team: string, give: string, get: string) => `${team} hat angenommen: ${get} kommt, ${give} geht.`,
    offerDeclined: (team: string, give: string, get: string) => `Dein Angebot an ${team} (${give} für ${get}) ist vom Tisch – abgelehnt oder hinfällig.`,
    effect: (d: number) =>
      `Deine beste Elf: ${d > 0.05 ? '+' : d < -0.05 ? '−' : '±'}${Math.abs(d).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`,
    effectShort: (d: number) =>
      `${d > 0.05 ? '+' : d < -0.05 ? '−' : '±'}${Math.abs(d).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`,
    effectTitle: 'Veränderung der Stärke deiner besten Elf durch diesen Tausch (gewichtete Fit-Punkte, ohne Tagesform)',
    offerAccept: 'Annehmen',
    offerDecline: 'Ablehnen',
    offerWithdraw: 'Zurückziehen',
    notifyOfferHeading: (league: string) => `${league}: neues Tausch-Angebot`,
    sending: 'Wird gespeichert …',
  },

  cup: {
    stage: { r16: 'Achtelfinale', qf: 'Viertelfinale', sf: 'Halbfinale', final: 'Finale', group: 'Gruppenphase' },
    roundLabel: 'Runde',
    group: (letter: string) => `Gruppe ${letter}`,
    groupsTitle: 'Gruppen',
    progressText: (n: number, total: number) => `Runde ${n} von ${total}`,
    bracket: 'Turnierbaum',
    winnerLabel: 'Turniersieger: ',
    youWinner: 'Dein Team gewinnt das Turnier!',
    status: 'Turnier',
    alive: 'Noch dabei',
    next: 'Nächster Gegner',
    winner: 'Turniersieger',
    /** Ausgeschieden in einer KO-Runde (Achtel-, Viertel-, Halbfinale) */
    out: (stage: string) => `Aus im ${stage}`,
    outFinal: 'Finale verloren',
    outGroup: 'Aus in der Gruppenphase',
    pens: (home: number, away: number) => `i. E. ${home}:${away}`,
    pensTitle: 'nach Elfmeterschießen',
    finalLine: (score: string, opponent: string) => `Finale ${score} gegen ${opponent}`,
    pathTitle: 'Weg zum Titel',
    ownPathTitle: 'Deine KO-Spiele',
    pathStep: (stage: string, score: string, opponent: string) => `${stage}: ${score} gegen ${opponent}`,
    yourCup: (team: string, status: string) => `Dein Team ${team}: ${status}`,
    standings: 'Endklassement',
    tbd: 'offen',
    result: (outcome: string, gf: number, ga: number, home: boolean, opponent: string) =>
      `${outcome} ${gf}:${ga} ${home ? 'gegen' : 'bei'} ${opponent}.`,
    /** final: Finalzeile („Finale 2:1 gegen …“) oder null */
    shareLine: (code: string, champion: string, final: string | null) =>
      `Pokémon Elf – Online-Draft ${code}: ${champion} gewinnt das KO-Turnier${final ? ` (${final})` : ''}.`,
    shareOwn: (team: string, status: string) => ` Mein Team ${team}: ${status}.`,
  },
  share: {
    /** Erste Zeile ohne eigenes Team; tie = „ – punktgleich …" oder leer */
    line: (code: string, champion: string, pts: number, tie: string) =>
      `Pokémon Elf – Online-Draft ${code}: Meister ${champion} (${pts} Pkt)${tie}.`,
    own: (team: string, place: number) => ` Mein Team ${team}: Platz ${place}.`,
  },
};

export default draft;
