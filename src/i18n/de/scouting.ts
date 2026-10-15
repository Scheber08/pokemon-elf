/** Texte: scouting (Deutsch – Quelle). Die englische Fassung in ../en/scouting.ts muss dieselben Schlüssel haben. */
import type { TypeKey } from '../../types';

/** Positionsgewichte im Team-Score, schon im Zahlenformat der Sprache */
export interface ScoutingWeights {
  gk: string;
  cb: string;
  fb: string;
  dm: string;
  cm: string;
  am: string;
  wide: string;
  st: string;
}

const scouting = {
  title: 'Scouting-Guide',
  lead: 'Was ein Pokémon auf jeder Position gut macht. Die exakten Zahlen bleiben geheim – mit dem Auge scouten ist der halbe Spaß.',
  legendAria: 'Legende',
  /** Überschriften der Tabellengruppen (PROFILE_GROUPS) */
  groups: {
    defense: 'Abwehr & Torwart',
    midfield: 'Mittelfeld',
    attack: 'Angriff',
  },
  colPosition: 'Position',
  colTypeBonus: 'Typ-Bonus',
  /** Wasserzeichen im gespeicherten Bild */
  mark: 'Pokémon Elf · Scouting-Guide',
  saveTable: 'Tabelle speichern',
  saving: 'Speichere …',
  saveFailed: 'Tabelle konnte nicht gespeichert werden',

  howTitle: 'Wie ein Team bewertet wird',
  howWeights: (w: ScoutingWeights) =>
    `Jedes Pokémon bekommt pro Position einen Fit von 0 bis 100. Der Team-Score (0–1.000) ist der gewichtete Durchschnitt der elf Fits mal zehn. Die Gewichte: Torwart ${w.gk}, jeder Innenverteidiger ${w.cb}, Außenverteidiger und Schienenspieler ${w.fb}, Sechser ${w.dm}, Zentrales Mittelfeld ${w.cm}, Zehner ${w.am}, Außenbahn und Flügel ${w.wide}, Stürmer ${w.st}.`,
  howWeakest: (n: number) =>
    `Die Abwehrreihe zählt zusammen am meisten, der Torwart ist die wichtigste Einzelposition. Und: Die ${n} schwächsten Fits gehen zusätzlich mit doppeltem Gewicht ein. Ein Loch zieht stärker runter, als ein Star hebt.`,
  howSeason: (opponents: number, min: number, max: number) =>
    `In der Saison trifft deine Elf auf ${opponents} Gegner mit Ratings von ${min} bis ${max}. Tore fallen zufällig (Poisson), aber je größer der Abstand der Ratings, desto klarer die Sache.`,

  sizeTitle: 'Größe und Gewicht',
  sizeHeight: (cap: string) =>
    `Größe zählt nur, wo es in der Tabelle steht – vor allem im Tor und in der Innenverteidigung. Ab ${cap} m gibt es keinen Bonus mehr: Ein 14-Meter-Wailord fängt nicht mehr Bälle als ein ${cap}-Meter-Keeper.`,
  sizeWeight: (capKg: string) =>
    `Gewicht wirkt logarithmisch: Jede Verdopplung bringt gleich viel – von 25 auf 50 kg zählt so viel wie von 200 auf 400 kg. Bei etwa ${capKg} kg ist Schluss.`,

  specialTitle: 'Die Spezialwerte',
  /** Folgt auf den fett gesetzten Wertnamen (game.factorLong.spa) */
  specialSpa:
    ' steht für Passspiel und Technik – darum ist er im zentralen Mittelfeld und auf der Zehn der Schlüsselwert. Stürmer brauchen ihn für den Abschluss.',
  /** Folgt auf den fett gesetzten Wertnamen (game.factorLong.spd) */
  specialSpd:
    ' steht für Spielübersicht und Ruhe am Ball. Beim Torwart heißt das: Reflexe und Nerven – dort ist sie Schlüssel.',

  typesTitle: 'Typen',
  /** ty: Typnamen der Sprache (game.type) */
  typesText: (ty: Record<TypeKey, string>) =>
    `Jede Position hat Lieblingstypen: ${ty.rock} und ${ty.steel} in der Abwehr, ${ty.electric}, ${ty.dark} und ${ty.flying} auf den Flügeln, ${ty.fire}, ${ty.ice} und ${ty.dragon} im Sturm. Der erste gelistete Typ gibt +3 %, die weiteren +2 % bzw. +1 %. Jeder der 18 Typen hat genau zwei Lieblingspositionen – kein Typ ist bevorzugt. Das ist ein Tie-Breaker – kein Grund, einen schwachen Spieler aufzustellen.`,

  faqTitle: 'FAQ',
  faq: [
    {
      q: 'Soll mein Innenverteidiger hohe Verteidigung oder hohe KP haben?',
      a: 'Verteidigung ist beim Innenverteidiger der Schlüsselwert, KP hilft nur. Ein Pokémon mit 130 Verteidigung und mittleren KP ist fast immer die bessere Wahl als ein KP-Riese mit dünner Abwehr. Größe und Gewicht helfen zusätzlich – Kopfballduelle gewinnt man nicht mit 0,3 m.',
    },
    {
      q: 'Warum sehe ich die exakten Ratings nicht?',
      a: 'Weil Scouting mit dem Auge der halbe Spaß ist. Die Tabelle verrät, worauf es ankommt – welche Zahl am Ende herauskommt, siehst du erst nach der Saison am Team-Score.',
    },
    {
      q: 'Sind Legendäre nicht einfach immer besser?',
      a: 'Oft ja, deshalb sind in den Challenges höchstens zwei erlaubt. Aber auch Legendäre unterliegen denselben Regeln: Ein Legendäres mit niedriger Initiative bleibt ein schwacher Flügelspieler.',
    },
    {
      q: 'Bringt ein passender Typ viel?',
      a: 'Nein – der Typ-Bonus ist ein Tie-Breaker. +3 % für den ersten gelisteten Typ, +2 % bzw. +1 % für die weiteren. Zwischen zwei ähnlich starken Kandidaten kann er den Ausschlag geben, mehr nicht.',
    },
    {
      q: 'Warum ist meine Elf mit drei Stars und einem Loch so schwach?',
      a: 'Die drei schwächsten Positionen zählen zusätzlich mit doppeltem Gewicht. Ein Loch zieht stärker runter, als ein Star hebt – eine ausgeglichene Elf schlägt fast immer eine Elf mit Lücken.',
    },
    {
      q: 'Was bringt der Kapitän?',
      a: 'Seine Positionspassung zählt im Team-Score doppelt. Ein gut passender Kapitän hebt das Team, ein schlecht passender zieht es runter – nimm also einen, der auf seiner Position glänzt („Beste Wahl“ sucht ihn dir aus). Der Standardschütze kann nicht Kapitän sein. Im Online-Draft bekommt, wer keinen wählt, nach dem letzten Pick automatisch den bestpassenden – bis zum Anpfiff kannst du noch wechseln.',
    },
    {
      q: 'Was sind Shinys im Draft?',
      a: 'Jeder Pick im Draft schillert mit 2 % Chance. Ein Shiny spielt selbst besser und hebt das ganze Team im Team-Score – je schwächer das Pokémon, desto mehr: Ein Shiny-Karpador bringt bis zu +40, ein Shiny-Mewtu nur rund +4. So lohnt sich auch ein schwaches Pokémon. In der Manager-Saison kann auch ein Neuzugang vom Transfermarkt schillern. Wer lieber ohne spielt, schaltet Shinys vor dem Draft aus.',
    },
    {
      q: 'Was bringen Saisonziel und „Ich bin bereit“ in der Lobby?',
      a: 'Mit „Ich bin bereit“ sieht der Host, wer startklar ist – ändert er danach die Regeln, meldet ihr euch neu. Das Saisonziel (Meister, Top 3, obere Hälfte oder nicht auf den letzten 3) sehen alle; im Ergebnis steht, ob ihr es geschafft habt, und das erste erreichte Ziel bringt den Erfolg „Plan erfüllt“.',
    },
    {
      q: 'Wie stark spielen die CPU-Teams?',
      a: 'Das legt die CPU-Stärke fest – im Draft an einem Gerät beim Aufbau, online stellt sie der Host in der Lobby ein. „Normal“ wählt gut mit etwas Zufall, „Leicht“ greift öfter daneben, „Stark“ nimmt (fast) immer den bestpassenden Pick. Online steht eine abweichende Stärke bei den CPU-Teams in der Teamliste.',
    },
    {
      q: 'Woher kommen die Namen der Gegner?',
      a: 'Ligagegner und CPU-Teams heißen wie echte Teams aus den Online-Ranglisten (Teamname, sonst Spielername) – in den Challenge-Saisons, im Draft an einem Gerät, online und in der Manager-Saison. Deine eigenen Einträge kommen nicht vor. Ohne Verbindung spielen Fantasie-Vereine aus der Pokémon-Welt. Die Namen ändern nichts an Stärke oder Ergebnissen.',
    },
    {
      q: 'Was bedeuten ⚡, 🏅, 👑, 💔, 🐍 und 🏁 im Draft?',
      a: '⚡ im Pick-Verlauf: ein Blitz-Pick – selbst gewählt, höchstens 5 Sekunden nach dem vorigen Pick (fünf davon in einer Online-Liga bringen den Erfolg „Blitzdrafter“). 🏅: der Pick mit dem bisher besten Positions-Fit des Drafts. ★, UB und M hinter einem Namen im Pick-Verlauf: Legendäres/Mysteriöses, Ultrabestie, Mega. 👑 auf dem Board: das Team mit dem besten Ø Fit; ein farbiger Chip wie „Feuer ×4“ zeigt eine Typ-Elf, „🌈 10“ einen Typen-Regenbogen (zehn oder mehr verschiedene Typen). 💔: ein anderes Team hat ein Pokémon von deiner Wunschliste geschnappt. „🎲 Zufall“ merkt ein zufälliges passendes Pokémon vor. 🐍 heißt: Snake-Wende, du bist gleich noch einmal dran; 🏁 markiert die letzte Draft-Runde.',
    },
    {
      q: 'Gibt es Tastenkürzel im Draft?',
      a: '„/“ springt in die Pokémon-Suche, „W“ setzt das ausgewählte Pokémon auf deine Wunschliste (oder nimmt es herunter), „V“ holt einen Vorschlag, im Draft an einem Gerät nimmt „Z“ den letzten Pick zurück. Mit den Pfeiltasten geht es durchs Raster, Enter wählt ein Pokémon aus. Beim Tippen in einem Feld greifen die Kürzel nicht.',
    },
    {
      q: 'Was macht der Standardschütze?',
      a: 'Er zählt nicht zum Team-Score. In der Saison verwandelt er einen Teil der Tore aus Standards und gibt einen kleinen Bonus auf die Torerwartung – je besser Sp.-Angriff und Angriff, desto mehr.',
    },
    {
      q: 'Warum sind die Scores in der 151 Challenge anders?',
      a: 'Für Retro und die 151 Challenge wird nur über die Original-151 normalisiert. So sind Scores innerhalb jeder Challenge fair vergleichbar – ein Glurak wird an den Kanto-Pokémon gemessen, nicht an Paldea.',
    },
    {
      q: 'Wo gibt es Megas, Regionalformen und Ultrabestien?',
      a: 'Im Builder (Schalter „Formen" und „Megas", mit Mega-Limit) und im Fantasy-Draft, wo der Host sie in den Pool nimmt und pro Team begrenzen kann – Ultrabestien sind dort eine eigene Kategorie neben den Legendären. In den Challenges und der Täglichen Elf bleiben sie außen vor, damit die Ranglisten vergleichbar bleiben.',
    },
    {
      q: 'Wie werden Megas bewertet?',
      a: 'Wie jedes andere Pokémon – mit ihren eigenen Werten, Typen, Größen und Gewichten, gemessen an den 1.025 normalen Pokémon. Deshalb sind Megas so stark und im Builder bzw. Draft begrenzbar.',
    },
  ] as { q: string; a: string }[],
};

export default scouting;
