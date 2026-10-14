/** Texte: Shinys im Draft. */
const shiny = {
  title: 'Shiny',
  picked: (name: string, boost: number) => `✨ ${name} ist ein Shiny! Bessere Werte und +${boost} Team-Score fürs ganze Team.`,
  pickedBy: (name: string, team: string, boost: number) => `✨ ${team} hat ein Shiny gezogen: ${name} (+${boost} Team-Score).`,
  shareOwn: (n: number) => ` ✨ ${n === 1 ? '1 Shiny' : `${n} Shinys`} im Kader.`,
  transferred: (name: string, boost: number) => `✨ Dein Neuzugang ${name} ist ein Shiny! Bessere Werte und +${boost} Team-Score.`,
  note: 'Mit 2 % Chance schillert ein Pick: Er spielt besser und hebt das ganze Team – je schwächer das Pokémon, desto mehr.',
};

export default shiny;
