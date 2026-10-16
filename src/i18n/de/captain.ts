/** Texte: Kapitän (alle Modi). */
const captain = {
  title: 'Kapitän',
  label: 'Kapitän',
  best: 'Beste Wahl',
  bestForAll: (n: number) => (n === 1 ? 'Beste Wahl fürs Team ohne Kapitän' : `Beste Wahl für ${n} Teams ohne Kapitän`),
  fit: (n: number) => `Fit ${n}`,
  none: 'Kein Kapitän',
  note: 'Die Positionspassung des Kapitäns zählt in der Teamwertung doppelt – ein gut passender Kapitän hebt das Team, ein schlecht passender zieht es runter.',
  effect: (diff: string) => `Wirkung auf den Team-Score: ${diff}`,
  managerNote: 'Die Passung des Kapitäns zählt doppelt – an jedem Spieltag, an dem er in deiner Aufstellung steht. Ein Wechsel gilt ab dem nächsten Anpfiff.',
  draftNote: 'Die Passung des Kapitäns zählt doppelt. Wählst du keinen, bekommst du nach dem letzten Pick den bestpassenden – bis zum Anpfiff kannst du noch wechseln.',
  windowTitle: (s: number) => `Kapitän wählen – noch ${s} s bis zum Anpfiff`,
  favorite: (team: string, score: number) => `Favorit: ${team} (Team-Score ${score})`,
  yourRank: (rank: number, of: number) => `dein Team-Score: Platz ${rank} von ${of}`,
  /** Anstoß-Karte: eigener Draft in Zahlen */
  myDraft: (avg: number, best: string, fit: number) => `Dein Draft: Ø Fit ${avg} · bester Pick ${best} (Fit ${fit})`,
  windowNote: 'Seine Passung zählt doppelt. Wählst du jetzt, rechnet der Server die Saison mit deinem Kapitän.',
  localTitle: 'Kapitäne wählen',
  localNote: 'Der Draft ist durch. Jedes Team wählt jetzt seinen Kapitän – seine Passung zählt doppelt. Dann wird angepfiffen.',
  kickoff: 'Saison anpfeifen',
  kickoffNow: 'Jetzt anpfeifen (alle fertig)',
  missing: 'Noch kein Kapitän gewählt – seine Passung würde doppelt zählen.',
};

export default captain;
