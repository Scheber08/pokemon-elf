#!/usr/bin/env node
/**
 * Daten-Build der Formen: Megas (inkl. Proto-Formen), Regionalformen (Alola, Galar, Hisui,
 * Paldea) und sonstige wählbare Formen (Rotom-Geräte, Deoxys, Therian-Formen …) →
 * public/data/forms.json. Quelle sind die CSV-Dateien der PokeAPI auf GitHub (die API selbst
 * braucht es nicht); ob ein Sprite existiert, wird per HEAD-Anfrage geprüft.
 *
 *   npm run data:forms
 *
 * Die Formen stehen bewusst in einer eigenen Datei: pokemon.json (Basis aller Challenges,
 * der Normalisierung und gespeicherter Runs) bleibt unverändert.
 *
 * Nicht aufgenommen: reine Kampfformen (außer Megas), Gigadynamax, Totem-, Kappen- und
 * Kostüm-Pikachu, Partner-Pikachu/-Evoli, Meteno und Formen, die sich in Werten und Typen
 * nicht vom Basis-Pokémon (bzw. einer schon aufgenommenen Form) unterscheiden.
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = join(ROOT, 'public', 'data', 'forms.json');
const BASE_FILE = join(ROOT, 'public', 'data', 'pokemon.json');
const CSV = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/';
const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
/** Muss zu src/lib/sprites.ts passen */
const SPRITE = { BW_ANIMATED: 1, DEFAULT: 2, GEN1: 4, GEN2: 8, ARTWORK: 16 };
const LANG = { de: '6', en: '9' };
const STATS = { 1: 'hp', 2: 'atk', 3: 'def', 4: 'spa', 5: 'spd', 6: 'spe' };
const TYPES = [
  '', 'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
  'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy',
];
/** Regionalformen → Generation der Region */
const REGIONAL = { alola: 7, galar: 8, hisui: 8, paldea: 9 };
/** Deutsche Namen, die in den CSV-Dateien (noch) fehlen – sonst wird der Name aus der Art gebildet */
const DE_NAMES = {
  'tauros-paldea-combat-breed': 'Paldea-Tauros (Gefechtsrasse)',
  'tauros-paldea-blaze-breed': 'Paldea-Tauros (Flammenrasse)',
  'tauros-paldea-aqua-breed': 'Paldea-Tauros (Flutenrasse)',
  'wooper-paldea': 'Paldea-Felino',
  'oinkologne-female': 'Fragrunz ♀',
  'gimmighoul-roaming': 'Gierspenst (Wanderform)',
  'ursaluna-bloodmoon': 'Ursaluna (Blutmond)',
  'ogerpon-wellspring-mask': 'Ogerpon (Brunnenmaske)',
  'ogerpon-hearthflame-mask': 'Ogerpon (Ofenmaske)',
  'ogerpon-cornerstone-mask': 'Ogerpon (Fundamentmaske)',
};
const SKIP = /totem|-cap$|-starter$|power-construct|battle-bond|own-tempo|^minior-|-gmax$|eternamax|^pikachu-(rock-star|belle|pop-star|phd|libre|cosplay)$/;

async function csv(name) {
  const res = await fetch(CSV + name + '.csv');
  if (!res.ok) throw new Error(`${name}.csv: HTTP ${res.status}`);
  const [head, ...rows] = (await res.text()).trim().split('\n');
  const keys = head.split(',');
  // Die verwendeten Dateien haben keine Kommas in Feldern – bis auf Namen in Anführungszeichen
  return rows.map((line) => {
    const cells = [];
    let cur = '';
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) {
        cells.push(cur);
        cur = '';
      } else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(keys.map((k, i) => [k, (cells[i] ?? '').trim()]));
  });
}

async function exists(path) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(SPRITE_BASE + path, { method: 'HEAD' });
      return res.ok;
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
}

async function spriteFlags(id) {
  const [bw, def, art] = await Promise.all([
    exists(`versions/generation-v/black-white/animated/${id}.gif`),
    exists(`${id}.png`),
    exists(`other/official-artwork/${id}.png`),
  ]);
  return (bw ? SPRITE.BW_ANIMATED : 0) | (def ? SPRITE.DEFAULT : 0) | (art ? SPRITE.ARTWORK : 0);
}

const statKey = (p) => [p.types.join('/'), p.hp, p.atk, p.def, p.spa, p.spd, p.spe].join('|');

async function main() {
  const { readFile } = await import('node:fs/promises');
  const base = JSON.parse(await readFile(BASE_FILE, 'utf8'));
  const baseById = new Map(base.map((p) => [p.id, p]));
  const [pokemon, forms, formNames, stats, types] = await Promise.all(
    ['pokemon', 'pokemon_forms', 'pokemon_form_names', 'pokemon_stats', 'pokemon_types'].map(csv),
  );
  const statsOf = new Map();
  for (const r of stats) {
    const o = statsOf.get(r.pokemon_id) ?? {};
    o[STATS[r.stat_id]] = Number(r.base_stat);
    statsOf.set(r.pokemon_id, o);
  }
  const typesOf = new Map();
  for (const r of types.sort((a, b) => a.slot - b.slot)) {
    typesOf.set(r.pokemon_id, [...(typesOf.get(r.pokemon_id) ?? []), TYPES[Number(r.type_id)]]);
  }
  const formOf = new Map(forms.filter((f) => f.is_default === '1').map((f) => [f.pokemon_id, f]));
  const namesOf = new Map();
  for (const r of formNames) {
    const o = namesOf.get(r.pokemon_form_id) ?? {};
    if (r.local_language_id === LANG.de) o.de = r.pokemon_name;
    if (r.local_language_id === LANG.en) o.en = r.pokemon_name;
    namesOf.set(r.pokemon_form_id, o);
  }

  const seen = new Set(base.map(statKey));
  const out = [];
  for (const p of pokemon) {
    const id = Number(p.id);
    if (id < 10000) continue;
    const f = formOf.get(p.id);
    const species = baseById.get(Number(p.species_id));
    if (!f || !species || SKIP.test(p.identifier)) continue;
    const primal = f.form_identifier === 'primal';
    const mega = f.is_mega === '1' || primal;
    if (f.is_battle_only === '1' && !mega) continue;
    const regional = Object.keys(REGIONAL).find((r) => f.form_identifier.split('-').includes(r));
    const en = namesOf.get(f.id)?.en || p.identifier;
    // Mega: „Mega-Glurak X“ – der Buchstabe kommt aus dem englischen Namen
    const megaDe = () => `Mega-${species.de}${/ [XYZ]$/.test(en) ? en.slice(-2) : ''}`;
    const entry = {
      id,
      de: namesOf.get(f.id)?.de || DE_NAMES[p.identifier] || (mega && !primal ? megaDe() : en),
      en,
      types: typesOf.get(p.id),
      ...statsOf.get(p.id),
      h: Number(p.height) / 10,
      w: Number(p.weight) / 10,
      gen: regional ? REGIONAL[regional] : species.gen,
      leg: species.leg,
      myth: species.myth,
      s: 0,
      base: species.id,
      form: mega ? 'mega' : regional ? 'regional' : 'other',
    };
    const key = statKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  // Sprites prüfen (gebündelt)
  for (let i = 0; i < out.length; i += 24) {
    await Promise.all(out.slice(i, i + 24).map(async (e) => (e.s = await spriteFlags(e.id))));
  }
  const noSprite = out.filter((e) => !e.s);
  if (noSprite.length) console.warn(`  ! Ohne Sprite (weggelassen): ${noSprite.map((e) => e.en).join(', ')}`);
  const result = out.filter((e) => e.s);
  await writeFile(OUT_FILE, JSON.stringify(result));
  const count = (k) => result.filter((e) => e.form === k).length;
  console.log(
    `Fertig: ${result.length} Formen (${count('mega')} Megas, ${count('regional')} Regionalformen, ${count('other')} sonstige) → ${OUT_FILE}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
