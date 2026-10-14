/** Texts: captain (all modes). */
import type { Messages } from '../de';

const captain: Messages['captain'] = {
  title: 'Captain',
  label: 'Captain',
  none: 'No captain',
  note: "The captain's position fit counts double in the team rating – a well-fitting captain lifts the team, a poorly fitting one drags it down.",
  effect: (diff) => `Effect on the team score: ${diff}`,
  missing: 'No captain chosen yet – their fit would count double.',
};

export default captain;
