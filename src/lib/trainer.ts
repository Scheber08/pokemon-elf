/**
 * Trainer: ein selbst gestalteter Avatar (SVG, src/components/TrainerAvatar.tsx). Jede Eigenschaft
 * kommt aus dem Katalog – manches ist frei, der Rest kostet Münzen aus den Erfolgen
 * (src/lib/achievements.ts). Gekauft wird je Gerät (D1 trainer_items), der Look steht in trainers.
 */

export const TRAINER_SLOTS = [
  'skin',
  'face',
  'hair',
  'hairColor',
  'outfit',
  'outfitColor',
  'hat',
  'accessory',
  'background',
  'companion',
  'title',
] as const;
export type TrainerSlot = (typeof TRAINER_SLOTS)[number];

/** Aussehen: je Slot die ID eines Katalog-Eintrags */
export type TrainerLook = Record<TrainerSlot, string>;

export interface TrainerItem {
  slot: TrainerSlot;
  id: string;
  /** Münzen (0 = frei) */
  price: number;
  /** Farbe (Haut, Haare, Kleidung) bzw. Hintergrund-Grundton */
  color?: string;
  /** Saisonartikel: nur in diesem Zeitraum (MM-DD, UTC, beide einschließlich) zu kaufen; Gekauftes bleibt */
  season?: { from: string; to: string; icon: string };
}

const item = (slot: TrainerSlot, id: string, price: number, color?: string): TrainerItem => ({ slot, id, price, ...(color ? { color } : {}) });
const seasonal = (it: TrainerItem, from: string, to: string, icon: string): TrainerItem => ({ ...it, season: { from, to, icon } });
/** Halloween-Zeit */
const SPOOKY = ['10-01', '11-07', '🎃'] as const;
/** Frühling (Ostern liegt jedes Jahr darin) */
const SPRING = ['03-20', '04-30', '🐣'] as const;
/** Sommer */
const SUMMER = ['06-21', '08-31', '☀️'] as const;
/** Weihnachtszeit (über den Jahreswechsel) */
const XMAS = ['12-01', '01-06', '🎄'] as const;
/** Silvester und Neujahr */
const NEWYEAR = ['12-27', '01-10', '🎆'] as const;
/** Herbst (vor der Halloween-Zeit) */
const AUTUMN = ['09-01', '09-30', '🍂'] as const;
/** Fußball-Sommer (Zeit der großen Turniere) */
const FOOTBALL = ['06-01', '07-20', '⚽'] as const;
/** Oktoberfest */
const OKTOBERFEST = ['09-16', '10-06', '🥨'] as const;
/** Karneval / Fasching (die tollen Tage liegen jedes Jahr darin) */
const CARNIVAL = ['02-01', '03-10', '🎭'] as const;
/** Muttertag (zweiter Sonntag im Mai liegt jedes Jahr darin) */
const MOTHERSDAY = ['05-01', '05-14', '💐'] as const;
/** Schulanfang (Einschulungen in allen Bundesländern liegen darin) */
const SCHOOL = ['08-01', '09-15', '🎒'] as const;
/** Sankt Martin (Laternenumzüge rund um den 11. November) */
const MARTIN = ['11-01', '11-11', '🏮'] as const;
/** Nikolaus (6. Dezember) */
const NICHOLAS = ['12-01', '12-06', '🎅'] as const;
/** Erntedank (erster Sonntag im Oktober) */
const HARVEST = ['09-25', '10-10', '🌾'] as const;
/** Winterzauber (zwischen Neujahr und Karneval) */
const WINTER = ['01-11', '01-31', '❄️'] as const;
/** Advent (Ende November, vor Nikolaus) */
const ADVENT = ['11-20', '11-30', '🕯️'] as const;
/** Weltkindertag (20. September) */
const CHILDREN = ['09-16', '09-22', '🎈'] as const;
/** Tag der Erde (22. April) */
const EARTH = ['04-18', '04-24', '🌍'] as const;
/** Pokémon Day (27. Februar, Jahrestag der ersten Spiele) */
const POKEDAY = ['02-20', '02-27', '🎮'] as const;
/** Tag der Ozeane (8. Juni) */
const OCEANS = ['06-05', '06-11', '🌊'] as const;
/** Weltbienentag (20. Mai) */
const BEES = ['05-17', '05-23', '🐝'] as const;
/** Tag des Baumes (25. April) */
const TREES = ['04-25', '04-30', '🌳'] as const;
/** Weltlachtag (erster Sonntag im Mai liegt jedes Jahr darin) */
const LAUGHTER = ['05-01', '05-07', '😂'] as const;
/** Weltkatzentag (8. August) */
const CATS = ['08-05', '08-11', '🐱'] as const;
/** Internationaler Tag der Freundschaft (30. Juli) */
const FRIENDSHIP = ['07-27', '08-02', '🤝'] as const;
/** Valentinstag */
const VALENTINE = ['02-07', '02-14', '💘'] as const;

/** Ist ein Artikel zum Zeitpunkt `now` (ms) im Shop? Saisonartikel nur in ihrem Zeitraum (auch über den Jahreswechsel). */
export function itemOnSale(it: TrainerItem, now: number): boolean {
  if (!it.season) return true;
  const day = new Date(now).toISOString().slice(5, 10);
  const { from, to } = it.season;
  return from <= to ? day >= from && day <= to : day >= from || day <= to;
}

/**
 * Nächste Shop-Saison, die noch nicht läuft: die mit dem nächsten Startdatum nach heute (über den Jahreswechsel).
 * null, wenn es keine Saisonartikel gibt.
 */
export function nextSeason(items: readonly TrainerItem[], now: number): { from: string; icon: string } | null {
  const day = new Date(now).toISOString().slice(5, 10);
  const starts = [...new Map(items.filter((i) => i.season && !itemOnSale(i, now)).map((i) => [i.season!.icon, i.season!])).values()];
  if (!starts.length) return null;
  const ahead = (from: string) => (from > day ? 0 : 1);
  const next = starts.reduce((a, b) => (ahead(b.from) < ahead(a.from) || (ahead(b.from) === ahead(a.from) && b.from < a.from) ? b : a));
  return { from: next.from, icon: next.icon };
}

export const TRAINER_ITEMS: readonly TrainerItem[] = [
  // Haut
  item('skin', 's1', 0, '#f6d7c3'),
  item('skin', 's2', 0, '#eebd9b'),
  item('skin', 's3', 0, '#d9a07a'),
  item('skin', 's4', 0, '#b97a52'),
  item('skin', 's5', 0, '#8d5a3b'),
  item('skin', 's6', 0, '#5e3a24'),
  item('skin', 's7', 0, '#fbe3d4'),
  item('skin', 's8', 0, '#3f2717'),
  // Gesichtsausdruck
  item('face', 'smile', 0),
  item('face', 'happy', 0),
  item('face', 'determined', 0),
  item('face', 'cool', 100),
  item('face', 'wink', 100),
  item('face', 'surprised', 100),
  item('face', 'sleepy', 100),
  item('face', 'grin', 150),
  // Frisur
  item('hair', 'short', 0),
  item('hair', 'long', 0),
  item('hair', 'bald', 0),
  item('hair', 'bob', 0),
  item('hair', 'sidepart', 100),
  item('hair', 'spiky', 150),
  item('hair', 'ponytail', 150),
  item('hair', 'curly', 150),
  item('hair', 'mohawk', 200),
  item('hair', 'afro', 200),
  // Haarfarbe
  item('hairColor', 'black', 0, '#2b2420'),
  item('hairColor', 'brown', 0, '#6b4226'),
  item('hairColor', 'blonde', 0, '#e8c25a'),
  item('hairColor', 'red', 0, '#b8462a'),
  item('hairColor', 'blue', 100, '#3b6fd8'),
  item('hairColor', 'pink', 100, '#e86fb4'),
  item('hairColor', 'green', 100, '#3fa45b'),
  item('hairColor', 'orange', 100, '#e07a2e'),
  item('hairColor', 'purple', 100, '#7c4bc9'),
  item('hairColor', 'teal', 100, '#2fa39a'),
  item('hairColor', 'silver', 200, '#c9ced6'),
  item('hairColor', 'white', 200, '#eef1f4'),
  // Kleidung
  item('outfit', 'shirt', 0),
  item('outfit', 'stripes', 150),
  item('outfit', 'jersey', 200),
  item('outfit', 'hoodie', 250),
  item('outfit', 'tracksuit', 250),
  item('outfit', 'jacket', 300),
  item('outfit', 'labcoat', 350),
  item('outfit', 'suit', 400),
  // Kleidungsfarbe
  item('outfitColor', 'red', 0, '#d8342a'),
  item('outfitColor', 'blue', 0, '#2f62c9'),
  item('outfitColor', 'green', 0, '#2f9a57'),
  item('outfitColor', 'yellow', 0, '#f2c230'),
  item('outfitColor', 'purple', 100, '#7c4bc9'),
  item('outfitColor', 'orange', 100, '#e8772a'),
  item('outfitColor', 'teal', 100, '#2a9d8f'),
  item('outfitColor', 'pink', 100, '#e86fb4'),
  item('outfitColor', 'brown', 100, '#7a5236'),
  item('outfitColor', 'grey', 100, '#8a919c'),
  item('outfitColor', 'black', 150, '#26282e'),
  item('outfitColor', 'white', 150, '#eceff3'),
  item('outfitColor', 'gold', 500, '#d4a72c'),
  // Kopfbedeckung
  item('hat', 'none', 0),
  item('hat', 'cap', 0),
  item('hat', 'backcap', 100),
  item('hat', 'headband', 150),
  item('hat', 'beanie', 150),
  item('hat', 'bucket', 150),
  item('hat', 'bow', 150),
  item('hat', 'flower', 150),
  item('hat', 'pokecap', 300),
  item('hat', 'wizard', 800),
  item('hat', 'crown', 1500),
  seasonal(item('hat', 'pumpkin', 300), ...SPOOKY),
  seasonal(item('hat', 'santa', 300), ...XMAS),
  seasonal(item('hat', 'straw', 250), ...SUMMER),
  seasonal(item('hat', 'bunny', 250), ...SPRING),
  seasonal(item('hat', 'party', 250), ...NEWYEAR),
  seasonal(item('hat', 'hearts', 200), ...VALENTINE),
  seasonal(item('hat', 'leaves', 250), ...AUTUMN),
  seasonal(item('hat', 'tyrolean', 250), ...OKTOBERFEST),
  seasonal(item('hat', 'jester', 250), ...CARNIVAL),
  seasonal(item('hat', 'mortarboard', 250), ...SCHOOL),
  seasonal(item('hat', 'mitre', 300), ...NICHOLAS),
  seasonal(item('hat', 'wheat', 250), ...HARVEST),
  seasonal(item('hat', 'snowcap', 250), ...WINTER),
  seasonal(item('hat', 'advent', 300), ...ADVENT),
  seasonal(item('hat', 'propeller', 250), ...CHILDREN),
  seasonal(item('hat', 'pikaears', 300), ...POKEDAY),
  seasonal(item('hat', 'antennae', 200), ...BEES),
  seasonal(item('hat', 'birdnest', 250), ...TREES),
  seasonal(item('hat', 'catears', 200), ...CATS),
  seasonal(item('hat', 'flowercrown', 200), ...FRIENDSHIP),
  // Accessoire
  item('accessory', 'none', 0),
  item('accessory', 'freckles', 0),
  item('accessory', 'glasses', 100),
  item('accessory', 'mustache', 100),
  item('accessory', 'scarf', 150),
  item('accessory', 'bandana', 150),
  item('accessory', 'whistle', 150),
  item('accessory', 'bowtie', 150),
  item('accessory', 'headphones', 300),
  item('accessory', 'sunglasses', 200),
  item('accessory', 'eyepatch', 250),
  item('accessory', 'medal', 400),
  seasonal(item('accessory', 'facepaint', 200), ...FOOTBALL),
  seasonal(item('accessory', 'locket', 250), ...MOTHERSDAY),
  seasonal(item('accessory', 'lantern', 250), ...MARTIN),
  seasonal(item('accessory', 'sapling', 200), ...EARTH),
  seasonal(item('accessory', 'divemask', 250), ...OCEANS),
  seasonal(item('accessory', 'clownnose', 150), ...LAUGHTER),
  // Hintergrund
  item('background', 'plain', 0, '#22324a'),
  item('background', 'sky', 0, '#7ec4ef'),
  item('background', 'forest', 250, '#3d8a36'),
  item('background', 'ocean', 250, '#2a6fb8'),
  item('background', 'pitch', 300, '#2f8a3e'),
  item('background', 'sunset', 300, '#f08a4b'),
  item('background', 'stadium', 300, '#3a4152'),
  item('background', 'night', 400, '#141c3a'),
  item('background', 'lava', 400, '#7a2414'),
  item('background', 'pokeball', 500, '#d8342a'),
  item('background', 'space', 600, '#0b0b1e'),
  item('background', 'arena', 450, '#7b808c'),
  item('background', 'center', 350, '#f9cdd8'),
  item('background', 'gold', 1000, '#d4a72c'),
  // Begleiter (Pokémon-ID; Sprite wie im Rest der App)
  item('companion', 'none', 0),
  item('companion', '129', 50),
  item('companion', '54', 100),
  item('companion', '35', 100),
  item('companion', '52', 100),
  item('companion', '39', 100),
  item('companion', '1', 150),
  item('companion', '4', 150),
  item('companion', '7', 150),
  item('companion', '25', 200),
  item('companion', '133', 250),
  item('companion', '92', 200),
  item('companion', '104', 250),
  item('companion', '143', 300),
  item('companion', '147', 300),
  item('companion', '131', 400),
  item('companion', '196', 400),
  item('companion', '197', 400),
  item('companion', '700', 400),
  item('companion', '94', 400),
  item('companion', '778', 500),
  item('companion', '658', 600),
  item('companion', '445', 900),
  item('companion', '132', 150),
  item('companion', '359', 500),
  item('companion', '282', 600),
  item('companion', '571', 700),
  item('companion', '887', 1000),
  seasonal(item('companion', '711', 400), ...SPOOKY),
  seasonal(item('companion', '225', 400), ...XMAS),
  seasonal(item('companion', '278', 300), ...SUMMER),
  seasonal(item('companion', '175', 350), ...SPRING),
  seasonal(item('companion', '385', 800), ...NEWYEAR),
  seasonal(item('companion', '370', 300), ...VALENTINE),
  seasonal(item('companion', '585', 350), ...AUTUMN),
  seasonal(item('companion', '813', 400), ...FOOTBALL),
  seasonal(item('companion', '122', 350), ...CARNIVAL),
  seasonal(item('companion', '115', 450), ...MOTHERSDAY),
  seasonal(item('companion', '164', 350), ...SCHOOL),
  seasonal(item('companion', '608', 400), ...MARTIN),
  seasonal(item('companion', '216', 350), ...NICHOLAS),
  seasonal(item('companion', '840', 350), ...HARVEST),
  seasonal(item('companion', '613', 350), ...WINTER),
  seasonal(item('companion', '607', 350), ...ADVENT),
  seasonal(item('companion', '172', 350), ...CHILDREN),
  seasonal(item('companion', '389', 500), ...EARTH),
  seasonal(item('companion', '26', 450), ...POKEDAY),
  seasonal(item('companion', '226', 400), ...OCEANS),
  seasonal(item('companion', '415', 300), ...BEES),
  seasonal(item('companion', '185', 400), ...TREES),
  seasonal(item('companion', '272', 400), ...LAUGHTER),
  seasonal(item('companion', '677', 350), ...CATS),
  seasonal(item('companion', '176', 400), ...FRIENDSHIP),
  item('companion', '6', 600),
  item('companion', '149', 600),
  item('companion', '448', 600),
  item('companion', '150', 1200),
  item('companion', '151', 1200),
  item('companion', '249', 1500),
  item('companion', '384', 1500),
  // Titel (Text: t.trainer.titles[id])
  item('title', 'none', 0),
  item('title', 'rookie', 0),
  item('title', 'regular', 100),
  item('title', 'scout', 200),
  item('title', 'tactician', 200),
  item('title', 'striker', 200),
  item('title', 'wall', 200),
  item('title', 'transfer', 250),
  item('title', 'captain', 300),
  item('title', 'manager', 400),
  item('title', 'headcoach', 600),
  item('title', 'professor', 500),
  item('title', 'legend', 1000),
  item('title', 'champion', 1200),
  item('title', 'master', 1500),
];

export const DEFAULT_LOOK: TrainerLook = {
  skin: 's2',
  face: 'smile',
  hair: 'short',
  hairColor: 'brown',
  outfit: 'shirt',
  outfitColor: 'red',
  hat: 'cap',
  accessory: 'none',
  background: 'plain',
  companion: 'none',
  title: 'rookie',
};

/** Schlüssel eines Katalog-Eintrags („hat:crown") – so stehen Käufe in D1 */
export const itemKey = (slot: TrainerSlot, id: string): string => `${slot}:${id}`;

const BY_KEY = new Map(TRAINER_ITEMS.map((i) => [itemKey(i.slot, i.id), i]));

export function trainerItem(slot: TrainerSlot, id: string): TrainerItem | undefined {
  return BY_KEY.get(itemKey(slot, id));
}

export function itemByKey(key: string): TrainerItem | undefined {
  return BY_KEY.get(key);
}

export const itemsOf = (slot: TrainerSlot): TrainerItem[] => TRAINER_ITEMS.filter((i) => i.slot === slot);

/** Farbe eines Eintrags (Fallback: Standard des Slots) */
export function colorOf(slot: TrainerSlot, id: string): string {
  return trainerItem(slot, id)?.color ?? trainerItem(slot, DEFAULT_LOOK[slot])?.color ?? '#888';
}

/** Gespeicherten bzw. empfangenen Look lesen – Unbekanntes wird zum Standard (wirft nie). */
export function parseLook(raw: unknown): TrainerLook {
  const r = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_LOOK };
  for (const slot of TRAINER_SLOTS) {
    const v = r[slot];
    if (typeof v === 'string' && trainerItem(slot, v)) out[slot] = v;
  }
  return out;
}

/** Gespeicherter Look aus D1 (JSON-Text) – null ohne bzw. bei kaputtem Eintrag. */
export function lookFromJson(raw: unknown): TrainerLook | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    return parseLook(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Darf dieser Look getragen werden? Jeder Slot frei oder gekauft – sonst der erste gesperrte Schlüssel. */
export function lockedItem(look: TrainerLook, owned: ReadonlySet<string>): string | null {
  for (const slot of TRAINER_SLOTS) {
    const it = trainerItem(slot, look[slot]);
    if (!it) return itemKey(slot, look[slot]);
    if (it.price > 0 && !owned.has(itemKey(slot, it.id))) return itemKey(slot, it.id);
  }
  return null;
}
