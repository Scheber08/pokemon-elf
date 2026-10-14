/** Texts: captain (all modes). */
import type { Messages } from '../de';

const captain: Messages['captain'] = {
  title: 'Captain',
  label: 'Captain',
  best: 'Best choice',
  none: 'No captain',
  note: "The captain's position fit counts double in the team rating – a well-fitting captain lifts the team, a poorly fitting one drags it down.",
  effect: (diff) => `Effect on the team score: ${diff}`,
  managerNote: 'The captain’s fit counts double – on every matchday they are in your lineup. A change applies from the next kickoff.',
  draftNote: 'The captain’s fit counts double. You can only choose them during the draft – after that the season is fixed.',
  windowTitle: (s) => `Choose your captain – ${s} s to kickoff`,
  windowNote: 'Their fit counts double. Choose now and the server plays the season with your captain.',
  localTitle: 'Choose captains',
  localNote: 'The draft is done. Every team now picks its captain – their fit counts double. Then it’s kickoff.',
  kickoff: 'Kick off the season',
  missing: 'No captain chosen yet – their fit would count double.',
};

export default captain;
