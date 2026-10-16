/** Texte: common (Deutsch – Quelle). Die englische Fassung in ../en/common.ts muss dieselben Schlüssel haben. */
const common = {
  close: 'Schließen',
  /** Hinweis ohne Netz (unter dem Kopf) */
  offlineBanner: '📡 Offline – Builder, Challenges und lokaler Draft laufen weiter. Rangliste und Online-Ligen sind zurück, sobald du wieder verbunden bist.',
  retry: 'Erneut versuchen',
  formationPreview: (f: string) => `Formation ${f} als Vorschau`,
  randomName: 'Zufälliger Vereinsname',
  randomFormation: 'Zufällige Formation',
  randomFormationTitle: 'Eine andere Formation auswürfeln',
  backToTop: 'Nach oben',
  settings: 'Einstellungen',
  copyLink: 'Link kopieren',
  linkCopied: 'Link kopiert!',
  copyFailed: 'Kopieren nicht möglich',
  on: 'An',
  off: 'Aus',
  empty: 'leer',
  allRegions: 'Alle Regionen',
  allTypes: 'Alle Typen',
  /** Satzbaustein „aus …" für die Pool-Beschreibung (Builder, Draft) */
  regionPhrase: {
    all: 'aus allen 1.025 Pokémon',
    first151: 'aus den ersten 151 Pokémon',
    range: (region: string, from: number, to: number) => `aus ${region} (Nr. ${from}–${to})`,
  },
};

export default common;
