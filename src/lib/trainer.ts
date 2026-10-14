/**
 * Trainer: ein selbst gestalteter Avatar (SVG, src/components/TrainerAvatar.tsx). Jede Eigenschaft
 * kommt aus dem Katalog – manches ist frei, der Rest kostet Münzen aus den Erfolgen
 * (src/lib/achievements.ts). Gekauft wird je Gerät (D1 trainer_items), der Look steht in trainers.
 */

export const TRAINER_SLOTS = [
  'skin',
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
}

const item = (slot: TrainerSlot, id: string, price: number, color?: string): TrainerItem => ({ slot, id, price, ...(color ? { color } : {}) });

export const TRAINER_ITEMS: readonly TrainerItem[] = [
  // Haut
  item('skin', 's1', 0, '#f6d7c3'),
  item('skin', 's2', 0, '#eebd9b'),
  item('skin', 's3', 0, '#d9a07a'),
  item('skin', 's4', 0, '#b97a52'),
  item('skin', 's5', 0, '#8d5a3b'),
  item('skin', 's6', 0, '#5e3a24'),
  // Frisur
  item('hair', 'short', 0),
  item('hair', 'long', 0),
  item('hair', 'bald', 0),
  item('hair', 'spiky', 150),
  item('hair', 'ponytail', 150),
  item('hair', 'curly', 150),
  // Haarfarbe
  item('hairColor', 'black', 0, '#2b2420'),
  item('hairColor', 'brown', 0, '#6b4226'),
  item('hairColor', 'blonde', 0, '#e8c25a'),
  item('hairColor', 'red', 0, '#b8462a'),
  item('hairColor', 'blue', 100, '#3b6fd8'),
  item('hairColor', 'pink', 100, '#e86fb4'),
  item('hairColor', 'green', 100, '#3fa45b'),
  item('hairColor', 'silver', 200, '#c9ced6'),
  // Kleidung
  item('outfit', 'shirt', 0),
  item('outfit', 'jersey', 200),
  item('outfit', 'hoodie', 250),
  item('outfit', 'jacket', 300),
  item('outfit', 'suit', 400),
  // Kleidungsfarbe
  item('outfitColor', 'red', 0, '#d8342a'),
  item('outfitColor', 'blue', 0, '#2f62c9'),
  item('outfitColor', 'green', 0, '#2f9a57'),
  item('outfitColor', 'yellow', 0, '#f2c230'),
  item('outfitColor', 'purple', 100, '#7c4bc9'),
  item('outfitColor', 'black', 150, '#26282e'),
  item('outfitColor', 'white', 150, '#eceff3'),
  item('outfitColor', 'gold', 500, '#d4a72c'),
  // Kopfbedeckung
  item('hat', 'none', 0),
  item('hat', 'cap', 0),
  item('hat', 'headband', 150),
  item('hat', 'beanie', 150),
  item('hat', 'pokecap', 300),
  item('hat', 'crown', 1500),
  // Accessoire
  item('accessory', 'none', 0),
  item('accessory', 'glasses', 100),
  item('accessory', 'scarf', 150),
  item('accessory', 'sunglasses', 200),
  item('accessory', 'medal', 400),
  // Hintergrund
  item('background', 'plain', 0, '#22324a'),
  item('background', 'sky', 0, '#7ec4ef'),
  item('background', 'pitch', 300, '#2f8a3e'),
  item('background', 'sunset', 300, '#f08a4b'),
  item('background', 'night', 400, '#141c3a'),
  item('background', 'gold', 1000, '#d4a72c'),
  // Begleiter (Pokémon-ID; Sprite wie im Rest der App)
  item('companion', 'none', 0),
  item('companion', '52', 100),
  item('companion', '39', 100),
  item('companion', '1', 150),
  item('companion', '4', 150),
  item('companion', '7', 150),
  item('companion', '25', 200),
  item('companion', '133', 250),
  item('companion', '143', 300),
  item('companion', '94', 400),
  item('companion', '6', 600),
  item('companion', '149', 600),
  item('companion', '448', 600),
  item('companion', '150', 1200),
  item('companion', '151', 1200),
  item('companion', '384', 1500),
  // Titel (Text: t.trainer.titles[id])
  item('title', 'none', 0),
  item('title', 'rookie', 0),
  item('title', 'scout', 200),
  item('title', 'tactician', 200),
  item('title', 'captain', 300),
  item('title', 'legend', 1000),
  item('title', 'master', 1500),
];

export const DEFAULT_LOOK: TrainerLook = {
  skin: 's2',
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
