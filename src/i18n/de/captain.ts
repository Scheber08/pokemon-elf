/** Texte: Kapitän (alle Modi). */
const captain = {
  title: 'Kapitän',
  label: 'Kapitän',
  none: 'Kein Kapitän',
  note: 'Die Positionspassung des Kapitäns zählt in der Teamwertung doppelt – ein gut passender Kapitän hebt das Team, ein schlecht passender zieht es runter.',
  effect: (diff: string) => `Wirkung auf den Team-Score: ${diff}`,
  missing: 'Noch kein Kapitän gewählt – seine Passung würde doppelt zählen.',
};

export default captain;
