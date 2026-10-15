/** Texts: shinies in the draft. */
import type { Messages } from '../de';

const shiny: Messages['shiny'] = {
  title: 'Shiny',
  picked: (name, boost) => `✨ ${name} is a shiny! Better stats and +${boost} team score for the whole team.`,
  pickedBy: (name, team, boost) => `✨ ${team} drafted a shiny: ${name} (+${boost} team score).`,
  shareOwn: (n) => ` ✨ ${n === 1 ? '1 shiny' : `${n} shinies`} in the squad.`,
  transferred: (name, boost) => `✨ Your new signing ${name} is a shiny! Better stats and +${boost} team score.`,
  count: (n) => (n === 1 ? '1 shiny in the team' : `${n} shinies in the team`),
  note: (pct) => `✨ Each pick has a ${pct}% chance to be shiny: it plays better and lifts the whole team – the weaker the Pokémon, the more.`,
};

export default shiny;
