/** Texte: Kapitän (alle Modi). */
const captain = {
  title: 'Kapitän',
  label: 'Kapitän',
  none: 'Kein Kapitän',
  note: 'Die Positionspassung des Kapitäns zählt in der Teamwertung doppelt – ein gut passender Kapitän hebt das Team, ein schlecht passender zieht es runter.',
  effect: (diff: string) => `Wirkung auf den Team-Score: ${diff}`,
  managerNote: 'Die Passung des Kapitäns zählt doppelt – an jedem Spieltag, an dem er in deiner Aufstellung steht. Ein Wechsel gilt ab dem nächsten Anpfiff.',
  draftNote: 'Die Passung des Kapitäns zählt doppelt. Wählen kannst du ihn nur im Draft – danach steht die Saison fest.',
  missing: 'Noch kein Kapitän gewählt – seine Passung würde doppelt zählen.',
};

export default captain;
