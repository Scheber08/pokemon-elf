/** Texts: scouting (English). Must have exactly the keys of ../de/scouting.ts (checked by TypeScript). */
import type { Messages } from '../de';

const scouting: Messages['scouting'] = {
  title: 'Scouting guide',
  lead: 'What makes a Pokémon good in each position. The exact numbers stay secret – scouting by eye is half the fun.',
  legendAria: 'Legend',
  groups: {
    defense: 'Defence & goalkeeper',
    midfield: 'Midfield',
    attack: 'Attack',
  },
  colPosition: 'Position',
  colTypeBonus: 'Type bonus',
  mark: 'Pokémon Elf · Scouting guide',
  saveTable: 'Save table',
  saving: 'Saving …',
  saveFailed: 'Couldn’t save the table',

  howTitle: 'How a team is rated',
  howWeights: (w) =>
    `Every Pokémon gets a fit from 0 to 100 for each position. The team score (0–1,000) is the weighted average of the eleven fits times ten. The weights: goalkeeper ${w.gk}, each centre-back ${w.cb}, full-backs and wing-backs ${w.fb}, holding midfielder ${w.dm}, central midfielder ${w.cm}, playmaker ${w.am}, wide midfielders and wingers ${w.wide}, striker ${w.st}.`,
  howWeakest: (n) =>
    `Together the back line counts the most; the goalkeeper is the single most important position. And: the ${n} weakest fits also count again, at double weight. A gap drags you down more than a star lifts you up.`,
  howSeason: (opponents, min, max) =>
    `In the season your XI faces ${opponents} opponents rated from ${min} to ${max}. Goals are random (Poisson), but the bigger the gap in ratings, the clearer the outcome.`,

  sizeTitle: 'Height and weight',
  sizeHeight: (cap) =>
    `Height only counts where the table says so – above all in goal and at centre-back. Above ${cap} m there’s no further bonus: a 14-metre Wailord doesn’t catch more balls than a ${cap}-metre keeper.`,
  sizeWeight: (capKg) =>
    `Weight works logarithmically: every doubling is worth the same – going from 25 to 50 kg counts as much as from 200 to 400 kg. It tops out at about ${capKg} kg.`,

  specialTitle: 'The special stats',
  specialSpa:
    ' stands for passing and technique – that’s why it’s the key stat in central midfield and at number 10. Strikers need it for finishing.',
  specialSpd:
    ' stands for vision and composure on the ball. For a goalkeeper that means reflexes and nerve – that’s where it’s key.',

  typesTitle: 'Types',
  typesText: (ty) =>
    `Every position has favourite types: ${ty.rock} and ${ty.steel} at the back, ${ty.electric}, ${ty.dark} and ${ty.flying} on the wings, ${ty.fire}, ${ty.ice} and ${ty.dragon} up front. The first listed type gives +3%, the others +2% or +1%. Each of the 18 types has exactly two favourite positions – no type is favoured. It’s a tie-breaker – no reason to field a weak player.`,

  faqTitle: 'FAQ',
  faq: [
    {
      q: 'Should my centre-back have high Defense or high HP?',
      a: 'Defense is the key stat for a centre-back; HP only helps. A Pokémon with 130 Defense and average HP is almost always a better pick than an HP giant with a flimsy defence. Height and weight help too – you don’t win aerial duels at 0.3 m.',
    },
    {
      q: 'Why can’t I see the exact ratings?',
      a: 'Because scouting by eye is half the fun. The table tells you what matters – the number it all adds up to only shows after the season, in your team score.',
    },
    {
      q: 'Aren’t Legendaries simply always better?',
      a: 'Often, yes – that’s why the challenges allow two at most. But Legendaries follow the same rules: a Legendary with low Speed is still a weak winger.',
    },
    {
      q: 'Does a matching type make a big difference?',
      a: 'No – the type bonus is a tie-breaker. +3% for the first listed type, +2% or +1% for the others. Between two similarly strong candidates it can tip the balance, nothing more.',
    },
    {
      q: 'Why is my XI with three stars and one gap so weak?',
      a: 'The three weakest positions also count again, at double weight. A gap drags you down more than a star lifts you up – a balanced XI almost always beats one with holes.',
    },
    {
      q: 'What does the set-piece taker do?',
      a: 'He doesn’t count towards the team score. In the season he converts some of the goals from set pieces and gives a small bonus to expected goals – the better his Sp. Atk and Attack, the bigger it is.',
    },
    {
      q: 'Why are scores different in the 151 Challenge?',
      a: 'For Retro and the 151 Challenge, normalisation only uses the original 151. That keeps scores fairly comparable within each challenge – a Charizard is measured against Kanto Pokémon, not against Paldea.',
    },
    {
      q: 'Where can I use Megas, regional forms and Ultra Beasts?',
      a: 'In the builder (“Forms” and “Megas” toggles, with a Mega limit) and in the fantasy draft, where the host adds them to the pool and can limit them per team – Ultra Beasts are a category of their own there, next to legendaries. The challenges and the Daily XI leave them out so the leaderboards stay comparable.',
    },
    {
      q: 'How are Megas rated?',
      a: 'Like any other Pokémon – with their own stats, types, height and weight, measured against the 1,025 regular Pokémon. That’s why Megas are so strong and can be limited in the builder and the draft.',
    },
  ],
};

export default scouting;
