/** Texte: Trikotfarben (alle Modi). */
const kit = {
  title: 'Trikotfarben',
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
