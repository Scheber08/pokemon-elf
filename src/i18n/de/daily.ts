/** Texte: daily (Deutsch – Quelle). Die englische Fassung in ../en/daily.ts muss dieselben Schlüssel haben. */
import { fmtNumber } from '../lang';

const daily = {
  /** Wochentage, Index wie Date#getUTCDay (0 = Sonntag) */
  weekdays: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
  /** „Montag, 12.10.2026" */
  dayLong: (weekday: string, date: string) => `${weekday}, ${date}`,
  howTo:
    'Jeden Tag dieselben Würfe für alle: Region und Typ werden pro Runde gewürfelt – wie bei der 34–0 Challenge, mit höchstens 2 Legendären und je einem Reroll für Typ und Region. Du hast einen Versuch pro Tag. Gleiche Elf, gleiches Ergebnis – die Saison ist für alle identisch. Schaffst du 34–0?',
  lead: 'Jeden Tag eine neue Elf – dieselben Würfe für alle.',
  countdownLabel: 'Neue Elf in',
  netChecking: 'Verbindung wird geprüft …',
  netOnline: 'Online – dein Versuch kommt in die Tagesrangliste',
  netOffline: 'Offline – nicht gewertet. Auch offline gibt es nur einen Versuch pro Tag.',
  ranked: 'Gewertet',
  offlineUnranked: 'Offline – nicht gewertet',
  unranked: 'Nicht gewertet',
  copied: 'Ergebnis kopiert',
  copyFailed: 'Kopieren nicht möglich',
  shareTitle: (n: number) => `Tägliche Elf #${n} teilen`,
  shareButton: 'Ergebnis teilen',
  toBoard: 'Zur Tagesrangliste',
  playedTitle: 'Heute schon gespielt',
  playedText: (n: number) =>
    `Dein gewerteter Versuch für die Tägliche Elf #${n} ist verbraucht. Morgen gibt es neue Würfe – wieder für alle dieselben.`,
  /** Serie und Archiv (nur dieses Gerät) */
  streak: 'Serie',
  streakDays: (n: number) => (n === 1 ? '1 Tag' : `${n} Tage`),
  bestStreak: 'Beste Serie',
  bestDay: 'Bester Tag',
  bestDayAvg: (avg: number) => `Ø ${avg}`,
  bestDayTitle: (n: number, avg: number) => `Meiste Punkte an einem Tag (Tägliche Elf #${n}) – im Schnitt ${avg} Punkte`,
  newBest: (plus: number) => `🏅 Neuer Bestwert: heute dein bester Tag – ${plus} ${plus === 1 ? 'Punkt' : 'Punkte'} mehr als dein bisher bester`,
  played: 'Gespielt',
  streakHint: 'Spiel heute, sonst reißt deine Serie.',
  archive: 'Deine letzten Tage',
  archiveNote: 'Gespeichert auf diesem Gerät.',
  titles: (n: number, days: number) => `🏆 ${n}× Meister in ${days === 1 ? '1 gespieltem Tag' : `${days} gespielten Tagen`}`,
  bestWeekday: (day: string, avg: number, n: number) => `Dein bester Wochentag: ${day} (Ø ${avg} Pkt. aus ${n} Spielen)`,
  archiveRow: (n: number) => `#${n}`,
  archiveTrend: (diff: number) => `${diff > 0 ? '+' : '−'}${Math.abs(diff)} Punkte gegenüber dem vorherigen Tag`,
  archivePlace: (n: number) => `Platz ${n}`,
  factRank: 'Platz',
  factRecord: 'Bilanz',
  factPoints: 'Punkte',
  factScore: 'Score',
  /** Platz in der Tageswertung: „3." */
  rankValue: (n: number) => `${n}.`,
  topPercent: (n: number) => `Top ${n} %`,
  playersToday: (n: number) => `${fmtNumber(n, 0, 'de')} Spieler heute`,
  /** Anhang hinter „… Spieler heute"; der Teamname ist Nutzereingabe */
  yourTeam: (name: string) => ` · dein Team: ${name}`,
  newDailyReady: (n: number) => `Die neue Tägliche Elf #${n} ist da!`,
  playNow: 'Jetzt spielen',
  stillCountsFor: (date: string) => `Die neue Elf ist schon da – dieser Run zählt noch für den ${date}.`,
  discardConfirm: (date: string) => `Den Run vom ${date} verwerfen? Er wird dann nicht mehr gewertet.`,
  discardButton: 'Verwerfen und heutige Elf spielen',
  playOffline: 'Offline spielen (ohne Wertung – zählt als Tagesversuch)',
  oneAttempt: 'Ein Versuch pro Tag: Ein gestarteter Run lässt sich nicht abbrechen oder neu starten.',
  /** Teil-Text, Zeile 1: „Pokémon Elf · Tägliche Elf #1 (12.10.2026)" */
  shareHeader: (n: number, date: string) => `Pokémon Elf · Tägliche Elf #${n} (${date})`,
  /** Serie im Teil-Text */
  shareStreak: (n: number) => `🔥 ${n} Tage in Folge`,
  /** Teil-Text, Zeile 2: „30–2–2 · 92 Pkt · Score 812 · Platz 1" (ohne Pokal) */
  shareStats: (record: string, points: number, score: number, position: number) =>
    `${record} · ${points} Pkt · Score ${score} · Platz ${position}`,
};

export default daily;
