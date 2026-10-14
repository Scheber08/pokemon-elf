/** Texts: club crest (all modes). */
import type { Messages } from '../de';

const crest: Messages['crest'] = {
  title: 'Crest',
  preview: 'Your crest',
  shape: 'Shape',
  pattern: 'Pattern',
  primary: 'Main colour',
  secondary: 'Second colour',
  symbol: 'Symbol / mascot',
  reset: 'No custom crest',
  random: 'Random crest',
  mascot: (name) => `Mascot: ${name}`,
  shapes: { shield: 'Shield', round: 'Round', square: 'Square', diamond: 'Diamond' },
  patterns: { plain: 'Plain', stripes: 'Stripes', halves: 'Halves', hoop: 'Hoop', diagonal: 'Diagonal' },
  icons: { ball: 'Poké Ball', star: 'Star', bolt: 'Bolt', flame: 'Flame', drop: 'Drop', leaf: 'Leaf', crown: 'Crown' },
};

export default crest;
