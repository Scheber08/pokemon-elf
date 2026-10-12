# Pokémon Elf – Lineup Builder

Fußball-Aufstellungen aus Pokémon: Stell eine Startelf auf, lass sie nach **Positions-Fit** bewerten
und spiel damit eine simulierte Saison mit 34 Spielen. Schaffst du **34–0**?

React 19 + Vite + TypeScript, kein Backend. Die gesamte UI ist auf Deutsch.

## Schnellstart

```bash
npm install
npm run dev        # http://localhost:5173
```

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklungsserver |
| `npm run build` | Typprüfung + Produktions-Build nach `dist/` |
| `npm run preview` | Build lokal ansehen |
| `npm test` | Unit-Tests (Vitest) |
| `npm run data` | Pokémon-Daten neu von der PokeAPI laden |

## Daten

`scripts/build-data.mjs` lädt einmalig alle 1.025 Pokémon von der [PokeAPI](https://pokeapi.co)
(`/pokemon/{id}` + `/pokemon-species/{id}`) und schreibt `public/data/pokemon.json` (~170 KB).
Die Datei ist eingecheckt – ein Neuladen ist nur nötig, wenn sich die API-Daten ändern.

Pro Pokémon: `id`, deutscher Name (`de`, aus `pokemon-species/names`), englischer Name (`en`), Typen,
die sechs Basiswerte, Größe in m, Gewicht in kg, Generation, `leg`/`myth` und ein Bitfeld `s`, welche
Sprite-Varianten existieren. Antworten werden in `scripts/.cache/` zwischengespeichert
(`npm run data -- --fresh` ignoriert den Cache).

Sprites kommen direkt aus dem PokeAPI-Sprite-Repository auf GitHub (CORS-fähig, für den Bild-Export nötig):

- **Pixel** – Gen-V-Black/White-Animationen, sonst Standard-Sprite
- **Retro** – Gen I (Rot/Blau) bzw. Gen II (Kristall), sonst Pixel
- **Artwork** – Official Artwork

## Projektstruktur

```
scripts/build-data.mjs     Daten-Build (PokeAPI → public/data/pokemon.json)
public/data/pokemon.json   Statische Pokémon-Daten
src/
  config/                  ← Stellschrauben, leicht anpassbar
    positions.ts           Positionen, Bewertungsprofile (Schlüssel/Hilft/…), Team-Gewichte, Typ-Bonus
    formations.ts          Formationen mit Feldkoordinaten in %
    scoring.ts             Normalisierung, Größen-/Gewichtsdeckel, Schwachstellen-Malus
    season.ts              Saison-Parameter, Torgefahr je Position, Vereinsnamen
    pokemonTypes.ts        Typnamen (de) und offizielle Typfarben
    regions.ts             Regionen/Generationen
  lib/
    fit.ts                 Positions-Fit 0–100 (+ eigene Gen-1-Skalierung)
    teamScore.ts           Team-Score 0–1.000
    season.ts              Spielplan, Poisson-Simulation, Tabelle, Torschützen
    formation.ts           Umverteilung beim Formationswechsel
    urlState.ts            Aufstellung ↔ kompakter URL-Parameter (?elf=…)
    exportImage.ts         html2canvas-Export, Teilen, Zwischenablage
    leaderboard/           Ranglisten-Interface: lokal (localStorage) + Supabase-Vorlage
  components/              Spielfeld (Drag & Drop), Teamblatt, Auswahl-Dialog, Ergebnis …
  pages/                   Builder, 34–0, 151/Retro, Draft, Rangliste, Scouting-Guide, Info
  state/                   Daten-, Einstellungs- und Toast-Kontext
tests/                     Unit-Tests: Fit, Team-Score, Saison, URL & Formation
```

Routen: `/` Builder · `/challenge` 34–0 · `/151` 151 Challenge & Retro 34–0 · `/draft` Fantasy-Draft ·
`/rangliste` · `/scouting` · `/ueber` · `/datenschutz`

## Bewertung in Kürze

1. **Normalisierung:** Basiswert ÷ 255, geglättet:
   `0,75 · Perzentil im Pool + 0,25 · √(Wert/255)`. Größe ist bei 2,2 m gedeckelt, Gewicht wirkt
   logarithmisch (1 kg … 400 kg, jede Verdopplung zählt gleich).
2. **Gewichtung** je Profil: Schlüssel 3, Hilft 2, Kleiner Anteil 1, Zählt nicht 0 (`config/positions.ts`).
3. **Fit** = Perzentil des gewichteten Werts im Pool (0–100), danach Typ-Bonus +3 %/+2 %/+1 %.
4. **Team-Score** = gewichteter Durchschnitt der 11 Fits × 10. Gewichte TW 1,6 · IV 1,2 · AV/WB 1,0 ·
   DM 1,1 · ZM 1,0 · OM 1,2 · LM/RM/LF/RF 1,0 · ST 1,4. Die drei schwächsten Fits zählen zusätzlich mit
   doppeltem Gewicht.
5. **Saison:** 18 Teams, Hin- und Rückrunde. Tore ~ Poisson mit
   `λ = 1,4 · exp((eigen − Gegner)/250) + 0,15 (Heim)`, leichte Streuung, λ auf 0,05–5,5 begrenzt.
   Gegner-Ratings 350–910.

Für die 151 Challenge und Retro 34–0 wird nur über die Original-151 normalisiert.
Alle Zahlen sind in `src/config/` änderbar – die Tests prüfen Eigenschaften, keine festen Werte.

## Spielmodi

- **Builder** – frei aufstellen, Drag & Drop, Bild speichern (1200×1500 PNG), Link teilen. Keine Fit-Anzeige.
- **34–0 Challenge** – pro Runde werden Region + Typ gewürfelt (je ein Reroll pro Run), max. 2 Legendäre.
- **151 Challenge** – pro Runde ein zufälliges Pokémon aus den Original-151, 5 Rerolls.
- **Retro 34–0** – Modus der 151-Seite: Typ-Würfel wie bei 34–0, aber nur Kanto, Retro-Sprites,
  Gen-1-Skalierung, eigene Rangliste.
- **Fantasy-Draft** – 2–8 Teams (Hot-Seat oder CPU), Snake-Draft über 11 Runden, danach Liga.

## Persistenz

Alles liegt im `localStorage` (Präfix `pokemon-elf:`): Aufstellung, Einstellungen, laufende Runs,
Bestwerte pro Challenge und die lokale Rangliste. Ein geteilter Link (`?elf=…`) enthält Formation,
11 IDs + Standardschütze, Region/Legendäre/Sprite-Stil und den Teamnamen – Base64url, ~36 Zeichen.

## Online-Rangliste (optional, Supabase)

Die UI spricht nur mit `LeaderboardService` (`src/lib/leaderboard/types.ts`). Ohne Konfiguration wird
die lokale Variante verwendet. Für Supabase `.env.example` nach `.env` kopieren, URL und Anon-Key
eintragen und folgende Tabelle anlegen:

```sql
create table runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users default auth.uid(),
  challenge text not null check (challenge in ('c340', 'retro340', 'c151')),
  player text not null,
  wins int not null, draws int not null, losses int not null,
  points int not null, score int not null,
  formation text not null, lineup int[] not null,
  team_name text not null default '',
  created_at timestamptz not null default now()
);
alter table runs enable row level security;
create policy "lesen" on runs for select using (true);
create policy "eigene schreiben" on runs for insert with check (auth.uid() = user_id);
create policy "eigene umbenennen" on runs for update using (auth.uid() = user_id);
```

Die Anmeldung selbst (Supabase Auth, z. B. Magic Link) ist noch nicht eingebaut: Die Vorlage in
`src/lib/leaderboard/remote.ts` erwartet das Access-Token in `sessionStorage['pokemon-elf:sb-token']`
und zeigt ohne Token „Anmelden, um auf der Rangliste zu spielen".

## Deploy

Reine statische Seite – `dist/` kann überall gehostet werden. SPA-Fallback auf `index.html` ist nötig,
damit Deep-Links wie `/scouting` funktionieren; beides ist vorkonfiguriert.

**Vercel:** Repository importieren – `vercel.json` setzt Build-Befehl, `dist` und die Rewrites.
Oder per CLI: `npx vercel --prod`.

**Netlify:** Repository verbinden – `netlify.toml` setzt Build, `dist` und den Redirect.
Oder per CLI: `npx netlify deploy --prod --dir=dist` (vorher `npm run build`).

Unterpfad (z. B. GitHub Pages unter `/pokemon-elf/`): `vite build --base=/pokemon-elf/` – Router,
Daten-URL und geteilte Links nutzen `import.meta.env.BASE_URL`.

## Rechtliches

Kostenloses Fan-Projekt. Nicht verbunden mit oder unterstützt von Nintendo, Game Freak, Creatures oder
The Pokémon Company. Pokémon-Namen und -Artwork gehören ihren jeweiligen Eigentümern.
