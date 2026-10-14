/** Texts: “Manager” menu item (English). */
import type { Messages } from '../de';

const manager: Messages['manager'] = {
  kicker: 'Online with friends',
  title: 'Manager season',
  lead: 'Draft your squad including a bench and lead it through a whole season – matchday by matchday, with lineups, daily form and a transfer market.',
  howTitle: 'How it works',
  steps: [
    'Create a league, share the code – friends join, CPU teams fill free spots.',
    'Draft: the eleven first, then the bench (3 or 5 Pokémon).',
    'Season: 17 matchdays at the chosen interval (10 minutes to 24 hours), filled up to 18 teams.',
    'Before every matchday you set your eleven – or let it be picked automatically. Every Pokémon’s daily form counts.',
    'Transfer market: one swap per matchday, the bottom team picks first.',
    'Match reports with a 2D view, statistics and, at the end, achievements for your trainer.',
  ],
  createTitle: 'Create manager league',
  offline: 'The manager season needs the online server – it can’t be reached right now.',
  otherModes: 'League or knockout cup without matchdays:',
};

export default manager;
