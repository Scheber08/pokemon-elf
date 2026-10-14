/** Texte: Kapitän (alle Modi). */
const captain = {
  title: 'Kapitän',
  label: 'Kapitän',
  best: 'Beste Wahl',
  bestForAll: (n: number) => (n === 1 ? 'Beste Wahl fürs Team ohne Kapitän' : `Beste Wahl für ${n} Teams ohne Kapitän`),
  none: 'Kein Kapitän',
  note: 'Die Positionspassung des Kapitäns zählt in der Teamwertung doppelt – ein gut passender Kapitän hebt das Team, ein schlecht passender zieht es runter.',
  effect: (diff: string) => `Wirkung auf den Team-Score: ${diff}`,
  managerNote: 'Die Passung des Kapitäns zählt doppelt – an jedem Spieltag, an dem er in deiner Aufstellung steht. Ein Wechsel gilt ab dem nächsten Anpfiff.',
  draftNote: 'Die Passung des Kapitäns zählt doppelt. Wählen kannst du ihn nur im Draft – danach steht die Saison fest.',
  windowTitle: (s: number) => `Kapitän wählen – noch ${s} s bis zum Anpfiff`,
  windowNote: 'Seine Passung zählt doppelt. Wählst du jetzt, rechnet der Server die Saison mit deinem Kapitän.',
  localTitle: 'Kapitäne wählen',
  localNote: 'Der Draft ist durch. Jedes Team wählt jetzt seinen Kapitän – seine Passung zählt doppelt. Dann wird angepfiffen.',
  kickoff: 'Saison anpfeifen',
  missing: 'Noch kein Kapitän gewählt – seine Passung würde doppelt zählen.',
};

export default captain;
