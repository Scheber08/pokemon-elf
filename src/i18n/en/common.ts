/** Texts: common (English). Must have exactly the keys of ../de/common.ts (checked by TypeScript). */
import type { Messages } from '../de';

const common: Messages['common'] = {
  close: 'Close',
  retry: 'Try again',
  randomName: 'Random club name',
  randomFormation: 'Random formation',
  randomFormationTitle: 'Roll a different formation',
  settings: 'Settings',
  copyLink: 'Copy link',
  linkCopied: 'Link copied!',
  copyFailed: 'Couldn’t copy',
  on: 'On',
  off: 'Off',
  empty: 'empty',
  allRegions: 'All regions',
  allTypes: 'All types',
  regionPhrase: {
    all: 'from all 1,025 Pokémon',
    first151: 'from the first 151 Pokémon',
    range: (region, from, to) => `from ${region} (#${from}–${to})`,
  },
};

export default common;
