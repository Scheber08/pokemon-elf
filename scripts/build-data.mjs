#!/usr/bin/env node
/**
 * Daten-Build: lädt alle 1.025 Pokémon einmalig von der PokeAPI und schreibt
 * eine kompakte, statische Datei nach public/data/pokemon.json.
 *
 *   npm run data            # lädt fehlende Einträge (Cache in scripts/.cache)
 *   npm run data -- --fresh # ignoriert den Cache
 *
 * Pro Pokémon gespeichert: id, deutscher + englischer Name, Typen, 6 Basiswerte,
 * Größe (m), Gewicht (kg), Generation, is_legendary, is_mythical und ein
 * Bitfeld, welche Sprite-Varianten existieren.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, 'scripts', '.cache');
const OUT_FILE = join(ROOT, 'public', 'data', 'pokemon.json');
const API = 'https://pokeapi.co/api/v2';
const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
const TOTAL = 1025;
const CONCURRENCY = 16;
const FRESH = process.argv.includes('--fresh');

/** Bitfeld der Sprite-Verfügbarkeit – muss zu src/lib/sprites.ts passen. */
const SPRITE = { BW_ANIMATED: 1, DEFAULT: 2, GEN1: 4, GEN2: 8, ARTWORK: 16 };

const GEN_BY_NAME = {
  'generation-i': 1, 'generation-ii': 2, 'generation-iii': 3, 'generation-iv': 4,
  'generation-v': 5, 'generation-vi': 6, 'generation-vii': 7, 'generation-viii': 8,
  'generation-ix': 9,
};

async function fetchJson(url, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'pokemon-elf-data-build' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= tries) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 400 * attempt * attempt));
    }
  }
}

function spritePath(url) {
  return url && url.startsWith(SPRITE_BASE) ? url.slice(SPRITE_BASE.length) : null;
}

function spriteFlags(id, sprites) {
  const v = sprites.versions ?? {};
  let flags = 0;
  const checks = [
    [SPRITE.BW_ANIMATED, v['generation-v']?.['black-white']?.animated?.front_default,
      `versions/generation-v/black-white/animated/${id}.gif`],
    [SPRITE.DEFAULT, sprites.front_default, `${id}.png`],
    [SPRITE.GEN1, v['generation-i']?.['red-blue']?.front_transparent,
      `versions/generation-i/red-blue/transparent/${id}.png`],
    [SPRITE.GEN2, v['generation-ii']?.crystal?.front_transparent,
      `versions/generation-ii/crystal/transparent/${id}.png`],
    [SPRITE.ARTWORK, sprites.other?.['official-artwork']?.front_default,
      `other/official-artwork/${id}.png`],
  ];
  for (const [bit, url, expected] of checks) {
    if (!url) continue;
    const path = spritePath(url);
    if (path !== expected) {
      console.warn(`  ! #${id}: unerwarteter Sprite-Pfad ${url} (erwartet ${expected})`);
      continue;
    }
    flags |= bit;
  }
  return flags;
}

async function loadOne(id) {
  const cacheFile = join(CACHE_DIR, `${id}.json`);
  if (!FRESH && existsSync(cacheFile)) {
    return JSON.parse(await readFile(cacheFile, 'utf8'));
  }
  const [p, s] = await Promise.all([
    fetchJson(`${API}/pokemon/${id}`),
    fetchJson(`${API}/pokemon-species/${id}`),
  ]);
  const stat = (name) => p.stats.find((x) => x.stat.name === name)?.base_stat ?? 0;
  const nameIn = (lang) => s.names.find((n) => n.language.name === lang)?.name;
  const entry = {
    id,
    de: nameIn('de') ?? nameIn('en') ?? p.name,
    en: nameIn('en') ?? p.name,
    types: [...p.types].sort((a, b) => a.slot - b.slot).map((t) => t.type.name),
    hp: stat('hp'),
    atk: stat('attack'),
    def: stat('defense'),
    spa: stat('special-attack'),
    spd: stat('special-defense'),
    spe: stat('speed'),
    h: p.height / 10,
    w: p.weight / 10,
    gen: GEN_BY_NAME[s.generation?.name] ?? 0,
    leg: s.is_legendary ? 1 : 0,
    myth: s.is_mythical ? 1 : 0,
    s: spriteFlags(id, p.sprites),
  };
  await writeFile(cacheFile, JSON.stringify(entry));
  return entry;
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(dirname(OUT_FILE), { recursive: true });

  const ids = Array.from({ length: TOTAL }, (_, i) => i + 1);
  const results = new Array(TOTAL);
  let next = 0;
  let done = 0;
  const started = Date.now();

  async function worker() {
    while (next < ids.length) {
      const idx = next++;
      results[idx] = await loadOne(ids[idx]);
      done++;
      if (done % 50 === 0 || done === TOTAL) {
        const sec = ((Date.now() - started) / 1000).toFixed(1);
        process.stdout.write(`  ${done}/${TOTAL} Pokémon geladen (${sec}s)\n`);
      }
    }
  }

  console.log(`Lade ${TOTAL} Pokémon von ${API} …`);
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const missingGen = results.filter((r) => !r.gen);
  if (missingGen.length) console.warn(`  ! Ohne Generation: ${missingGen.map((r) => r.id).join(', ')}`);

  await writeFile(OUT_FILE, JSON.stringify(results));
  const kb = (JSON.stringify(results).length / 1024).toFixed(0);
  const legends = results.filter((r) => r.leg || r.myth).length;
  console.log(`Fertig: ${results.length} Pokémon (${legends} legendär/mysteriös) → ${OUT_FILE} (${kb} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
