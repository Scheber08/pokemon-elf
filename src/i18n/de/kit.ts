/** Texte: Trikotfarben (alle Modi). */
const kit = {
  title: 'Trikotfarben',
  titleCheer: 'Trikot & Torjubel',
  cheer: 'Torjubel (unter „TOR!“ in der 2D-Ansicht)',
  cheerPlaceholder: 'z. B. Wir sind die Elf!',
  cheerIdeasLabel: 'Vorschläge für den Torjubel',
  cheerIdeas: ['Auf geht’s!', 'Wir sind die Elf!', 'Pika-Pika-Tor!', 'Volltreffer!', 'Was für ein Ding!'],
  home: 'Heim',
  away: 'Auswärts',
  note: 'Zu Hause spielt dein Team in der Heimfarbe, auswärts auch – außer der Gegner trägt dieselbe, dann in der Auswärtsfarbe. Zu sehen in der 2D-Ansicht.',
  reset: 'Standardfarben',
  pick: (side: string, color: string) => `${side}: ${color}`,
  colors: {
    yellow: 'Gelb',
    white: 'Weiß',
    red: 'Rot',
    blue: 'Blau',
    sky: 'Himmelblau',
    black: 'Schwarz',
    orange: 'Orange',
    purple: 'Lila',
    pink: 'Pink',
    teal: 'Türkis',
  } as Record<string, string>,
};

export default kit;
