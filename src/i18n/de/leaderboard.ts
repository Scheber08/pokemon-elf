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
  yourRank: 'Deine Platzierung',
  playNow: 'Jetzt spielen',
  today: 'Heute',
  allTime: 'Allzeit',
  /** „Heute · 12.10.2026" */
  todayOn: (date: string) => `Heute · ${date}`,
  players: (n: number) => `${fmtNumber(n, 0, 'de')} Spieler`,
  loading: 'Lade …',
  loadError: (message: string) => `Rangliste nicht erreichbar: ${message}`,
  retry: 'Erneut versuchen',
  emptyOnline: 'Noch keine Einträge – sei der Erste!',
  localError: (message: string) => `Runs dieses Geräts nicht lesbar: ${message}`,
  emptyLocalToday: 'Heute noch keine Runs auf diesem Gerät.',
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
};

export default leaderboard;
