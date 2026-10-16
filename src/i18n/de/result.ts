/** Texte: result (Deutsch – Quelle). Die englische Fassung in ../en/result.ts muss dieselben Schlüssel haben. */
const result = {
  // ---------------------------------------------------------------- Saisonbilanz (SeasonResultView)
  /** Standardname des eigenen Teams (ohne Teamnamen) */
  defaultTeamName: 'Meine Elf',
  title: 'Saisonbilanz',
  verdict: {
    perfect: 'Perfekte Saison! Kein einziger Punkt abgegeben.',
    unbeaten: 'Ungeschlagen! Nur die Remis trennen dich von der Perfektion.',
    champion: 'Meister! Die Schale geht an dein Team.',
    top4: 'Platz in der Königsklasse – starke Saison.',
    europe: 'Europapokal-Kurs. Da geht noch was.',
    midTable: 'Gesichertes Mittelfeld.',
    survived: 'Zittern bis zum Schluss – aber drin geblieben.',
    relegated: 'Abstieg. Zeit für einen Kaderumbruch.',
  },
  explainer:
    'Jedes Pokémon wird danach bewertet, wie gut es auf seine Position passt – aus Basiswerten, Größe, Gewicht und Typ. Torwart, Innenverteidiger und Stürmer zählen am meisten, und deine drei schwächsten Positionen ziehen das ganze Team runter. Die Passung deines Kapitäns zählt doppelt. Gegner reichen von 350 bis 910.',
  rankedOnline: 'Online gewertet',
  rankToday: (n: number) => `Platz ${n} heute`,
  rankAllTime: (n: number) => `Platz ${n} allzeit`,
  rejected: 'Der Server hat diesen Run nicht gewertet.',
  notRanked: 'Nicht gewertet',
  shareText: (record: string, score: number, place: number, points: number, challenge: string) =>
    `Ich bin mit meiner Pokémon-Elf ${record} gegangen – Platz ${place} mit ${points} Punkten (${challenge})! Score ${score}`,
  imageSaved: 'Bild gespeichert, Text in die Zwischenablage kopiert',
  shareFailed: 'Teilen nicht möglich',
  imageFailed: 'Bild konnte nicht erstellt werden',
  nameSavedOnline: 'Name gespeichert – auch online',
  nameSaved: 'Name gespeichert',
  nameFailed: 'Name konnte nicht gespeichert werden',
  yourTeam: 'Deine Elf',
  recordAria: (w: number, d: number, l: number) => `Bilanz ${w} Siege, ${d} Unentschieden, ${l} Niederlagen`,
  recordLegend: 'Siege – Remis – Niederlagen',
  points: 'Punkte',
  teamScore: 'Team-Score',
  place: 'Platz',
  goals: 'Tore',
  record: 'Bilanz',
  /** Tabellenplatz als Ordnungszahl: „3." */
  ordinal: (n: number) => `${n}.`,
  /** Unter den Punkten: Schnitt pro Spiel */
  perGame: (ppg: number) => `Ø ${ppg.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pro Spiel`,
  /** Unter den Toren: Tordifferenz mit Vorzeichen */
  goalDiff: (diff: number) => `Differenz ${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${Math.abs(diff)}`,
  weakSpots: 'Schwachstellen laut Scouting: ',
  venueRecords: (home: string, away: string) => `🏠 Zu Hause ${home} · ✈️ Auswärts ${away} (S–U–N)`,
  fitFacts: (avg: number, bulls: number, best: string, fit: number) =>
    `🎯 Ø Fit ${avg}${bulls ? ` · 💯 ${bulls} Volltreffer (Fit ≥ 95)` : ''} · am besten passte ${best} (${fit})`,
  clinched: (team: string, round: number, left: number, you: boolean) =>
    `🏁 ${you ? 'Du warst' : `${team} war`} schon am ${round}. Spieltag rechnerisch Meister – ${left === 1 ? '1 Spieltag' : `${left} Spieltage`} vor Schluss`,
  runWins: (n: number) => `🔥 Längste Siegesserie: ${n} Spiele`,
  runUnbeaten: (n: number) => `🛡️ Längste Serie ohne Niederlage: ${n} Spiele`,
  weakSpotsNote: ' (auf dem Feld markiert)',
  share: 'Teilen',
  saveImage: 'Bild speichern',
  newRun: 'Neuer Run',
  nameLabel: 'Dein Name auf der Rangliste',
  save: 'Speichern',
  finalTable: 'Abschlusstabelle',
  col: {
    place: 'Pl.',
    team: 'Team',
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
  },
  topScorers: 'Torschützenliste',
  captainGoals: (name: string, goals: number) =>
    goals ? `Kapitän ${name}: ${goals === 1 ? '1 Tor' : `${goals} Tore`} in der Saison` : `Kapitän ${name}: kein Tor in der Saison`,
  noGoals: 'Keine Tore – autsch.',
  details: (n: number) => `Saisondetails – alle ${n} Spiele`,
  /** Heim/Auswärts-Kürzel in der Spielliste */
  venueHome: 'H',
  venueAway: 'A',
  vsHome: 'vs.',
  vsAway: '@',
  /** Ergebnis-Kürzel (S/U/N) */
  outcomeShort: { S: 'S', U: 'U', N: 'N' } as Record<'S' | 'U' | 'N', string>,
  /** „Positionen nach Gewicht: TW 1,6 · ST 1,4 · …" – items: [Kürzel, Gewicht] */
  weights: (items: [string, string][], rest: string) =>
    `Positionen nach Gewicht: ${items.map(([pos, w]) => `${pos} ${w}`).join(' · ')} · übrige ${rest}`,

  // ---------------------------------------------------------------- Live-Ticker (SeasonTicker)
  outcome: { S: 'Sieg', U: 'Remis', N: 'Niederlage' } as Record<'S' | 'U' | 'N', string>,
  /** Vorlesetext je Spieltag */
  announceDay: (
    round: number,
    outcome: string,
    gf: number,
    ga: number,
    home: boolean,
    opponent: string,
    record: string,
    points: number,
    place: number,
  ) =>
    `${round}. Spieltag: ${outcome} ${gf}:${ga} ${home ? 'gegen' : 'bei'} ${opponent}. Bilanz ${record}, ${points} Punkte, Platz ${place}.`,
  announceEnd: (record: string, points: number, place: number) =>
    `Abpfiff! Saisonbilanz ${record}, ${points} Punkte, Platz ${place}.`,
  announceStart: 'Anpfiff! Die Saison beginnt.',
  stateEnd: 'Ende',
  statePause: 'Pause',
  stateLive: 'Live',
  ticker: 'Saison-Ticker',
  resume: 'Weiter',
  pause: 'Pause',
  speed: 'Tempo',
  skip: 'Überspringen',
  matchday: 'Spieltag',
  progressAria: 'Saisonfortschritt',
  progressText: (played: number, total: number) => `${played} von ${total} Spieltagen gespielt`,
  dotTitle: (round: number, gf: number, ga: number, home: boolean, opponent: string) =>
    `${round}. Spieltag: ${gf}:${ga} ${home ? 'gegen' : 'bei'} ${opponent}`,
  table: 'Tabelle',
  tableAfter: (round: number) => `Tabelle nach dem ${round}. Spieltag`,
  noMatchYet: 'Noch kein Spiel absolviert.',
  spaceHint: 'Leertaste: Pause / Weiter',
  strength: (n: number) => `Stärke ${n}`,
  boardRound: (round: number) => `${round}. Spieltag`,
  homeGame: 'Heimspiel',
  awayGame: 'Auswärtsspiel',
  kickoff: 'Anpfiff',
  noOwnGoal: 'Ohne eigenen Treffer',
  unchanged: ' (unverändert)',
  trend: (n: number, up: boolean) => `(${n} ${n === 1 ? 'Platz' : 'Plätze'} ${up ? 'geklettert' : 'abgerutscht'})`,
  perfectGoal: (total: number) => `Ziel: ${total}–0 – jedes Spiel gewinnen`,
  perfectAlive: (final: boolean, wins: number, round: number) =>
    `${final ? 'Perfekt' : 'Noch perfekt'}: ${wins}/${round} Siege`,
  winStreak: (n: number) => `${n} Siege in Folge`,
  unbeatenRun: (n: number) => `${n} Spiele ungeschlagen`,
  perfectBroken: (total: number, round: number) => `${total}–0 geplatzt am ${round}. Spieltag`,
  fullTime: 'Abpfiff!',
  finaleLine: (points: number, place: number) => `${points} Punkte · Platz ${place}`,
  finalePerfect: ' · Perfekte Saison!',
  finaleChampion: ' · Meister!',
  toSummary: 'Zur Saisonbilanz',
  /** Torschütze per Standard: „Glurak (Standard)" */
  setPiece: (name: string) => `${name} (Standard)`,
};

export default result;
