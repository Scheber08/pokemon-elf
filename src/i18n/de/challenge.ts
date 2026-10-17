/** Texte: challenge (Deutsch – Quelle). Die englische Fassung in ../en/challenge.ts muss dieselben Schlüssel haben. */
const challenge = {
  // ---------------------------------------------------------------- Seiten
  c340Lead: 'Alle 1.025 Pokémon. Schaffst du 34–0?',
  c340HowTo:
    'Jede Runde würfelt eine Region und einen Typ. Setze ein passendes Pokémon auf einen freien Platz, mit höchstens 2 Legendären. Fülle alle 11 Plätze und spiel dann eine Saison mit 34 Spielen. Schaffst du 34–0?',
  c151Lead: 'Nur die Original-151. Eigene Gen-1-Skalierung, eigene Rangliste.',
  c151HowTo:
    'Jede Runde würfelt ein zufälliges Pokémon aus den Original-151. Setze es auf einen beliebigen freien Platz, fülle alle 11 und spiel dann eine Saison mit 34 Spielen. Schaffst du 34–0?',
  retro340HowTo:
    'Retro-Look, Gen-1-Skalierung: Jede Runde würfelt einen Typ. Wähle ein passendes Pokémon aus den Original-151 und setze es auf einen freien Platz, mit höchstens 2 Legendären. Fülle alle 11 Plätze und spiel eine Saison mit 34 Spielen. Schaffst du 34–0?',
  mode: 'Modus',

  // ---------------------------------------------------------------- Setup (ChallengeParts)
  bestScore: 'Bester Score',
  bestRecord: 'Beste Bilanz',
  runs: 'Runs',
  avgScore: (n: number) => `Ø Score ${n}`,
  /** Karte „Letzter Run“: dieser Run war ein neuer Bestwert */
  lastRunBest: 'Neuer Bestwert',
  lastRun: 'Letzter Run',
  howItWorks: "So funktioniert's",
  setupAria: 'Run vorbereiten',
  formation: 'Formation',
  off: 'Aus',
  on: 'An',
  /** Pflichtfeld: Name des Spielers (Gerät) in der Online-Rangliste */
  playerName: 'Dein Name auf der Rangliste',
  playerNamePlaceholder: 'z. B. Ash',
  teamName: 'Teamname',
  /** Platzhalter im Teamnamen-Feld mit einem Beispielverein */
  teamNamePlaceholder: (club: string) => `z. B. ${club}`,
  /** Prüfung der Pflichtfelder (vor dem Start und vor der Auswertung) */
  playerNameEmpty: 'Bitte gib deinen Namen für die Rangliste ein.',
  playerNameDefault: '„Trainer" heißen hier alle – bitte wähle einen eigenen Namen.',
  playerNameInvisible: 'Dein Name braucht mindestens einen Buchstaben, eine Ziffer oder ein Emoji.',
  teamNameEmpty: 'Bitte gib deinem Team einen Namen.',
  teamNameInvisible: 'Der Teamname braucht mindestens einen Buchstaben, eine Ziffer oder ein Emoji.',
  /** Run läuft schon, aber Name/Teamname fehlen noch (z. B. Run von vor der Pflicht) */
  namesNeeded: 'Bevor die Saison startet: Gib dir und deinem Team noch einen Namen.',
  namesAria: 'Namen für die Wertung',
  starting: 'Starte …',
  start: 'Run starten',
  /** Würfelkarte während der Animation */
  rollingAria: (label: string) => `${label}: wird gewürfelt – tippen zum Überspringen`,

  // ---------------------------------------------------------------- Spielfläche (RunBoard)
  noOtherRoll: 'Kein anderer Wurf möglich',
  /** Rest-Rerolls hinter dem Button-Text */
  rerollsLeft: (left: number) => (left > 0 ? `(${left}×)` : '(verbraucht)'),
  allPlaced: 'Alle Plätze belegt',
  round: 'Runde',
  original151: 'Original 151',
  /** Statuszeile: die letzte Runde des Runs */
  lastRound: '🏁 Letzte Runde',
  bestFirst: 'Beste für mein Team zuerst',
  legends: 'Legendäre',
  rerolls: 'Neu würfeln:',
  region: 'Region',
  type: 'Typ',
  logTitle: (n: number) => `📜 Deine Runden (${n})`,
  logFit: (n: number) => `Fit ${n}`,
  logAvgFit: (n: number) => `Ø Fit ${n}`,
  logRound: (n: number) => `R${n}`,
  logReroll: { type: 'Typ', region: 'Region', pokemon: 'Pokémon' } as Record<'type' | 'region' | 'pokemon', string>,
  rerollType: (left: string) => `Typ neu würfeln ${left}`,
  rerollRegion: (left: string) => `Region neu würfeln ${left}`,
  yourPokemon: 'Dein Pokémon',
  rerollPokemon: (left: number) => `Pokémon neu würfeln (${left})`,
  /** „Klicke … um <strong>Name</strong> festzulegen." – Text vor und nach dem Namen */
  placeRolledBefore: 'Klicke auf einen freien Platz auf dem Feld, um ',
  placeRolledAfter: ' festzulegen.',
  choose: 'Wähle ein Pokémon',
  /** „<strong>Name</strong> gewählt. …" – Text nach dem Namen */
  selectedAfter: ' gewählt. Klicke auf einen freien Platz auf dem Feld, um ihn festzulegen.',
  hintType: 'Wähle ein Pokémon dieses Typs aus den Original-151.',
  hintRegionType: 'Wähle ein Pokémon, das zu Region und Typ passt. Festgelegte Spieler bleiben stehen.',
  legendLimit: (max: number) => `Schon ${max} Legendäre im Team`,
  done: 'Deine Elf steht. Zeit für die Saison!',
  seasonRunning: 'Saison läuft …',
  resend: 'Erneut senden',
  showResult: 'Ergebnis ansehen',
  finishOffline: 'Offline auswerten (ohne Wertung)',
  abortConfirm: 'Run wirklich abbrechen?',
  abort: 'Run abbrechen',
  playAria: 'Challenge-Run',
  pitchAria: (formation: string) => `Spielfeld, Formation ${formation}`,
  netChecking: 'Verbindung wird geprüft …',
  netOnline: 'Online – deine Runs kommen in die Rangliste',
  netOffline: 'Offline – Runs werden nur lokal gespeichert',
  closeNotice: 'Hinweis schließen',
  badgeRanked: 'Gewertet',
  badgeOffline: 'Offline',
  badgeRankedTitle: 'Dieser Run kommt in die Online-Rangliste',
  badgeOfflineTitle: 'Dieser Run wird nur lokal gespeichert',

  // ---------------------------------------------------------------- Start/Abschluss (useChallengeRun, runFinish)
  offlineFallback: 'Server nicht erreichbar – dieser Run läuft offline und wird nicht gewertet.',
  startFailed:
    'Keine Verbindung zum Server – dein Run wurde noch nicht gestartet. Versuch es gleich noch einmal oder spiel offline (ohne Wertung).',
  /** Server-Meldung (als Satz) + Hinweis, dass offline gespielt wird */
  offlineWithReason: (sentence: string) => `${sentence} Dieser Run läuft offline und wird nicht gewertet.`,
  startError: (msg: string) => `Run konnte nicht gestartet werden: ${msg}`,
  finishFailed:
    'Server nicht erreichbar – dein Run ist noch nicht gewertet. Sende ihn gleich noch einmal oder werte ihn offline aus (dann ohne Wertung).',
  alreadyRanked:
    'Dieser Run ist auf dem Server schon gewertet, das Ergebnis ist hier aber noch nicht angekommen. Sende ihn gleich noch einmal, um dein gewertetes Ergebnis zu laden.',
  /** 429 beim Abschluss: Server-Meldung (als Satz) + was jetzt geht */
  finishRateLimited: (sentence: string) =>
    `${sentence} Dein Run ist noch nicht gewertet – sende ihn später noch einmal oder werte ihn offline aus (dann ohne Wertung).`,
  finishError: (msg: string) => `Auswertung fehlgeschlagen: ${msg}`,
  playedOffline: 'Offline gespielt – nicht gewertet',
  /** 429 mit Offline-Auswertung: Server-Meldung + Zusatz */
  notRanked: (msg: string) => `${msg} – Run nicht gewertet`,
  unreachableNotRanked: 'Server nicht erreichbar – Run nicht gewertet',

  // ---------------------------------------------------------------- Engine-Fehler (Code → Text)
  engine: {
    finished: 'Der Run ist bereits fertig',
    /** kind: 'type' | 'region' | 'pokemon' */
    noReroll: (kind: string) => `Kein ${kind}-Reroll mehr übrig`,
    noOtherRoll: 'Kein anderer Wurf möglich',
    unknownPokemon: (id: number) => `Unbekanntes Pokémon #${id}`,
    notAllowed: (name: string) => `${name} ist in dieser Challenge nicht erlaubt`,
    inTeam: (name: string) => `${name} steht schon im Team`,
    noMatch: (name: string) => `${name} passt nicht zum Wurf`,
    slotTaken: (slot: number) => `Slot ${slot} ist nicht frei`,
    poolEmpty: 'Kein wählbares Pokémon mehr im Pool',
    unknownChallenge: (key: string) => `Unbekannte Challenge: ${key}`,
    unknownFormation: (key: string) => `Unbekannte Formation: ${key}`,
    badSeed: 'Ungültiger Seed',
    badLog: 'Ungültiges Zug-Protokoll',
    badPick: 'Ungültiger Zug',
  },
};

export default challenge;
