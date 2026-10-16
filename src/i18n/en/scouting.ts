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

  topTitle: 'Top 3 per position',
  topNote: 'The best-fitting Pokémon for each position out of all 1,025 – number = fit (0–100), ties broken by the uncapped profile score.',
  topLegends: 'Include legendary and mythical Pokémon',
  whereTitle: 'Where does … play?',
  wherePlaceholder: 'Search a Pokémon, e.g. Charizard',
  whereShow: (name) => `Where else does ${name} play?`,
  whereRank: (rank, total, position) => `🏅 No. ${rank} of ${total.toLocaleString('en-GB')} as ${position}`,
  whereRandom: 'Random',
  whereRandomTitle: 'Look up a random Pokémon',
  whereNone: 'No Pokémon found.',
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
      q: 'What does the captain do?',
      a: 'Their position fit counts double in the team score. A well-fitting captain lifts the team, a poorly fitting one drags it down – so pick one who shines in their position (“Best choice” finds them for you). The set-piece taker cannot be captain. In the online draft, anyone without a captain gets the best-fitting player after the last pick – you can still switch until kickoff.',
    },
    {
      q: 'What are shinies in the draft?',
      a: 'Every draft pick has a 2% chance to be shiny. A shiny plays better itself and lifts the whole team’s score – the weaker the Pokémon, the more: a shiny Magikarp adds up to +40, a shiny Mewtwo only about +4. So even a weak Pokémon can pay off. In the manager season, a new signing from the transfer market can be shiny too. Prefer playing without? Turn shinies off before the draft.',
    },
    {
      q: 'What do the season goal and “I’m ready” do in the lobby?',
      a: 'With “I’m ready” the host sees who is set to go – if the host changes the rules afterwards, mark yourself ready again. Everyone sees your season goal (title, top 3, top half or staying out of the bottom 3); the results show whether you made it, and your first reached goal unlocks the “Mission accomplished” achievement.',
    },
    {
      q: 'How strong are the CPU teams?',
      a: 'That is the CPU strength – in the one-device draft you set it in the setup, online the host sets it in the lobby. “Normal” picks well with a bit of chance, “Easy” misses more often, “Hard” (almost) always takes the best-fitting pick. Online, a non-default strength is shown next to the CPU teams in the team list.',
    },
    {
      q: 'Where do the opponents’ names come from?',
      a: 'League opponents and CPU teams are named after real teams from the online leaderboards (team name, otherwise player name) – in the challenge seasons, the one-device draft, online and in the manager season. Your own entries never appear. Offline, fantasy clubs from the Pokémon world play instead. The names never change strength or results.',
    },
    {
      q: 'What do ⚡, 🏅, 👑, 💔, 🐍 and 🏁 mean in the draft?',
      a: '⚡ in the pick log: a lightning pick – your own pick within 5 seconds of the previous one (five in one online league earn the “Lightning drafter” achievement). 🏅: the pick with the best positional fit of the draft so far. ★, UB and M after a name in the pick log: legendary/mythical, Ultra Beast, Mega. 👑 on the board: the team with the best average fit; a coloured chip like “Fire ×4” marks a type squad, “🌈 10” a type rainbow (ten or more different types). 💔: another team took a Pokémon from your wishlist. “🎲 Random” pre-selects a random fitting Pokémon. 🐍 means a snake turn – you pick again right after; 🏁 marks the final draft round.',
    },
    {
      q: 'What do 🏁, 🏅, 💯, 🛡️ and 🏆 mean in the challenges?',
      a: '🏁 in the status line: the final round of the run. 💯 in the round log: a direct hit – fit 95 or more at the position. 🏅 in the result: a new personal best, a higher score than your best run of this challenge so far (also on “Last run” and on profiles). 🛡️ on profiles: an unbeaten season without a defeat. 🏆 on the leaderboard: perfect seasons – wins only – among the entries shown.',
    },
    {
      q: 'Are there keyboard shortcuts in the draft?',
      a: '“/” jumps to the Pokémon search, “W” puts the selected Pokémon on your wishlist (or takes it off), “V” fetches a suggestion, “R” pre-selects a random Pokémon (🎲), and in the one-device draft “Z” takes back the last pick; “?” lists all shortcuts. Arrow keys move through the grid, Enter selects a Pokémon. While typing in a field, the shortcuts are off.',
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
