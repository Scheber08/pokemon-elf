/** Texts: kit colours (all modes). */
import type { Messages } from '../de';

const kit: Messages['kit'] = {
  title: 'Kit colours',
  titleCheer: 'Kit & goal cheer',
  cheer: 'Goal cheer (below “GOAL!” in the 2D view)',
  cheerPlaceholder: 'e.g. We are the Eleven!',
  home: 'Home',
  away: 'Away',
  note: 'Your team wears its home colour at home and away – unless the opponent wears the same, then it switches to the away colour. Visible in the 2D view.',
  reset: 'Default colours',
  pick: (side, color) => `${side}: ${color}`,
  colors: {
    yellow: 'Yellow',
    white: 'White',
    red: 'Red',
    blue: 'Blue',
    sky: 'Sky blue',
    black: 'Black',
    orange: 'Orange',
    purple: 'Purple',
    pink: 'Pink',
    teal: 'Teal',
  },
};

export default kit;
