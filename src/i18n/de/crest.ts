/** Texte: Vereinswappen (alle Modi). */
const crest = {
  title: 'Wappen',
  preview: 'Dein Wappen',
  shape: 'Form',
  pattern: 'Muster',
  primary: 'Grundfarbe',
  secondary: 'Zweite Farbe',
  symbol: 'Symbol / Wappentier',
  reset: 'Kein eigenes Wappen',
  random: 'Zufallswappen',
  swap: 'Farben tauschen',
  swapTitle: 'Grundfarbe und zweite Farbe tauschen',
  mascot: (name: string) => `Wappentier: ${name}`,
  shapes: { shield: 'Schild', round: 'Rund', square: 'Eckig', diamond: 'Raute' } as Record<string, string>,
  patterns: { plain: 'Einfarbig', stripes: 'Streifen', halves: 'Geteilt', hoop: 'Querband', diagonal: 'Schräg' } as Record<string, string>,
  icons: { ball: 'Pokéball', star: 'Stern', bolt: 'Blitz', flame: 'Flamme', drop: 'Tropfen', leaf: 'Blatt', crown: 'Krone' } as Record<string, string>,
};

export default crest;
