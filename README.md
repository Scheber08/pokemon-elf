# Pokémon Elf – Lineup Builder

Fußball-Aufstellungen aus Pokémon: Stell eine Startelf auf, lass sie nach **Positions-Fit** bewerten
und spiel damit eine simulierte Saison mit 34 Spielen. Schaffst du **34–0**?

React 19 + Vite + TypeScript. Optionales Backend auf **Cloudflare Workers + D1** für die
Online-Rangliste – ohne Backend läuft alles lokal weiter. Die gesamte UI ist auf Deutsch.

## Schnellstart

```bash
npm install
npm run dev        # http://localhost:5173
```

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklungsserver (ohne Backend → Runs laufen offline/ungewertet) |
| `npm run dev:cf` | Build + `wrangler dev`: Worker mit API, statischen Dateien und lokaler D1 – http://localhost:8788 |
| `npm run deploy:cf` | Build + `wrangler deploy` (ohne Git-Anbindung) |
| `npm run build` | Typprüfung (App + Worker) + Produktions-Build nach `dist/` |
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

**Formen** (`npm run data:forms`, `scripts/build-forms.mjs`): Megas inkl. Proto-Formen, Regionalformen und
Sonderformen landen in `public/data/forms.json` (IDs ab 10001, `base` = Art, `form` = mega/regional/other).
Quelle sind die CSV-Dateien der PokeAPI auf GitHub. Nur Builder und Draft nutzen sie – `pokemon.json`
(Challenges, Skala, gespeicherte Runs) bleibt unverändert. Ultrabestien sind eine feste Liste
(`src/config/categories.ts`).

Sprites kommen direkt aus dem PokeAPI-Sprite-Repository auf GitHub (CORS-fähig, für den Bild-Export nötig):

- **Pixel** – Gen-V-Black/White-Animationen, sonst Standard-Sprite
- **Retro** – Gen I (Rot/Blau) bzw. Gen II (Kristall), sonst Pixel
- **Artwork** – Official Artwork

## Projektstruktur

```
scripts/build-data.mjs     Daten-Build (PokeAPI → public/data/pokemon.json)
scripts/build-forms.mjs    Formen-Build (PokeAPI-CSV → public/data/forms.json)
public/data/               Statische Pokémon-Daten (pokemon.json, forms.json)
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
    challengeEngine.ts     Deterministische Challenge-Logik (Würfe, Rerolls, Replay) – Client + Server
    runCompute.ts          Team-Score + Saison eines fertigen Runs – Client + Server
    daily.ts               Tägliche Elf: Tag (Europe/Berlin), Seeds, Countdown
    seasonTimeline.ts      Spieltag-für-Spieltag-Verlauf für den Live-Ticker
    api/                   API-Vertrag (contract.ts) + Browser-Client (client.ts)
    runFinish.ts           Run abschließen: online einreichen oder lokal auswerten
    leaderboard/           Lokale Run-Historie (localStorage)
  components/              Spielfeld (Drag & Drop), Teamblatt, Auswahl-Dialog, Ergebnis …
  pages/                   Builder, 34–0, 151/Retro, Draft, Rangliste, Scouting-Guide, Info
  state/                   Daten-, Einstellungs- und Toast-Kontext, useChallengeRun (Run-Lebenszyklus)
server/                    Backend: Routing, Endpunkte, D1-Abfragen, Validierung, Geräte-Auth
worker/index.ts            Cloudflare Worker: /api/* → server/handler.ts, sonst statische Dateien; exportiert DraftRoom
wrangler.jsonc             Worker-Konfiguration (Assets aus dist/, SPA-Fallback, D1-Binding „DB")
functions/api/[[route]].ts Alternative für Cloudflare Pages → server/handler.ts
migrations/0001_init.sql   D1-Schema (der Server legt es auch selbst an)
tests/                     Unit-Tests: Fit, Team-Score, Saison, Engine, Server/API, Ticker, Tages-Elf …
```

Routen: `/` Builder · `/challenge` 34–0 · `/taeglich` Tägliche Elf · `/151` 151 Challenge & Retro 34–0 ·
`/draft` Fantasy-Draft (lokal + online) · `/draft/:code` Online-Liga · `/rangliste` (Deep-Link
`?c=daily&p=today|week|all`) · `/spieler/:id` Spielerprofil · `/scouting` · `/ueber` · `/datenschutz`

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

- **Builder** – frei aufstellen, Drag & Drop, Bild speichern (1200×1500 PNG), Link teilen, Rückgängig.
  Optional Formen und Megas (mit Mega-Limit); der Auswahl-Dialog sortiert auf Wunsch nach Positions-Fit.
- **34–0 Challenge** – pro Runde werden Region + Typ gewürfelt (je ein Reroll pro Run), max. 2 Legendäre.
- **Tägliche Elf** – jeden Tag (Europe/Berlin) dieselben Würfe für alle, Regeln wie 34–0, ein Versuch pro
  Tag und Gerät. Die Saison ist für alle identisch (gleiche Elf → gleiches Ergebnis). Ergebnis als
  Emoji-Raster teilen (34 Spieltage in zwei Reihen). Serie (Tage am Stück) und Archiv auf dem Gerät.
- **151 Challenge** – pro Runde ein zufälliges Pokémon aus den Original-151, 5 Rerolls.
- **Retro 34–0** – Modus der 151-Seite: Typ-Würfel wie bei 34–0, aber nur Kanto, Retro-Sprites,
  Gen-1-Skalierung, eigene Rangliste.
- **Fantasy-Draft** – 2–8 Teams (Hot-Seat oder CPU), Snake-Draft über 11 Runden, danach Liga.
- **Online-Draft** – Liga anlegen, Code/Link teilen, gemeinsam live draften (siehe unten).
- **Rangliste** – Heute, Diese Woche, Allzeit; Team ansehen, Testspiel gegen die eigene Builder-Elf,
  Spielerprofil.

Im Draft zeigt ein Hover über eine Position, welche Werte dort zählen (Schlüssel/Hilft/Kleiner Anteil,
Typ-Bonus, Gewicht im Team-Score). Die Oberfläche gibt es auf Deutsch und Englisch (Umschalter im Kopf,
`src/i18n/`; Texte je Bereich in `de/*.ts`, `en/*.ts` ist dagegen typgeprüft).

Nach jedem Challenge-Run läuft die Saison im **Live-Ticker** ab (Spieltag für Spieltag, Pause, 1×/2×/4×,
Überspringen), danach folgt die Saisonbilanz.

## Persistenz

Alles liegt im `localStorage` (Präfix `pokemon-elf:`): Aufstellung, Einstellungen, laufende Runs,
Bestwerte pro Challenge und die lokale Rangliste. Ein geteilter Link (`?elf=…`) enthält Formation,
11 IDs + Standardschütze, Region/Legendäre/Sprite-Stil und den Teamnamen – Base64url, ~36 Zeichen.

## Online-Rangliste (Cloudflare)

Gewertete Runs laufen so ab:

1. `POST /api/runs/start` – der Server vergibt Seed + Token (Tägliche Elf: Seed des Tages).
2. Der Browser spielt mit `challengeEngine` und protokolliert jeden Zug.
3. `POST /api/runs/finish` – der Server spielt das Protokoll mit **derselben Engine** nach, lehnt illegale
   Runs ab, zieht den Saison-Seed selbst (Tägliche Elf: Seed des Tages), rechnet Team-Score + Saison und
   speichert die Wertung. Der Browser simuliert mit diesem Seed dieselbe Saison.

Kein Account nötig: Jedes Gerät hat eine zufällige ID + einen geheimen Schlüssel (der Server speichert nur
dessen SHA-256). Pro Gerät zählt der beste Run; die Tägliche Elf ist einmal pro Gerät und Tag gewertet.
Limits gegen Missbrauch (Runs pro Stunde, neue Geräte pro IP-Hash) stehen in `src/lib/api/contract.ts`.
Ist das Backend nicht erreichbar, spielt die App lokal und ungewertet weiter; scheitert nur das Absenden,
kann man erneut senden oder offline auswerten.

Endpunkte: `GET /api/health` · `POST /api/runs/start` · `POST /api/runs/finish` ·
`GET /api/leaderboard?challenge=…&period=today|week|all` · `GET /api/entries/:id` (Team) ·
`GET /api/entries/:id/player` (Profil) · `POST /api/player` (Spielername).

## Online-Draft (Cloudflare Durable Object)

Jede Liga ist ein Durable Object `DraftRoom` (`server/draftRoom.ts`, Logik in `server/draftCore.ts` und der
reinen Engine `src/lib/draftEngine.ts`). Ablauf: `POST /api/drafts` legt die Liga an (6-stelliger Code),
alle verbinden sich per WebSocket (`/api/drafts/:code/ws`, Hibernation API) und bekommen bei jeder
Änderung den vollen Stand. Lobby: Host stellt Pool, Timer (aus/30/60/90 s), Reihenfolge und
Sichtbarkeit ein, fügt CPU-Teams hinzu und startet. Timer, CPU-Picks und Auto-Picks laufen auf dem
Server (Alarme). Ist das Team am Zug 20 s offline (ohne Timer: 3 min am Zug), darf jedes Mitglied für
es auto-picken; ein abwesender Host gibt die Rolle nach 30 s (Lobby: 5 min) ab. Nach dem letzten Pick
rechnet der Server die Saison einmal und alle sehen sie gleichzeitig im Ticker.
Öffentliche Lobbys: `GET /api/drafts/public`. Ligen werden nach 14 Tagen gelöscht. Vertrag und Limits:
`src/lib/api/draftContract.ts`.

Weitere Liga-Funktionen: Pool mit Legendären/Mysteriösen, Ultrabestien, Formen und Megas – je mit Limit
pro Team; Zufallsmodus mit Rerolls; Wunschliste für Auto-Picks (privat); Emoji-Reaktionen (nur verteilt,
nicht gespeichert); „Du bist dran" als Ton und Browser-Benachrichtigung. Nach der Saison legt
`POST /api/drafts/:code/rematch` eine **Revanche** an (gleiche Teams und Einstellungen); jede Revanche
trägt die Ergebnisse ihrer Vorgänger mit – daraus die **ewige Tabelle**. Für `/draft/:code` liefert der
Worker eigene Open-Graph-Tags (Link-Vorschau mit Liganame, Host und Teams, `server/preview.ts`).

## Deploy auf Cloudflare

### Workers (empfohlen)

1. *Workers & Pages → Create → Import a repository* → Repository wählen.
   Build command `npm run build`, Deploy command `npx wrangler deploy` (Standard). Der Name des
   Workers muss zu `"name"` in `wrangler.jsonc` passen (`pokemon-elf`).
2. Fertig. `wrangler.jsonc` beschreibt alles: statische Dateien aus `dist/` mit SPA-Fallback, den
   Worker für `/api/*` und das D1-Binding `DB`. Beim ersten Deploy legt Wrangler die D1-Datenbank
   `pokemon-elf` automatisch an (keine ID nötig), die Tabellen erstellt der Server beim ersten Aufruf
   (`server/schema.ts`).

Ab dann baut und deployt **jeder Push auf `main` automatisch**. Prüfen:
`https://pokemon-elf.<dein-subdomain>.workers.dev/api/health` → `{"ok":true,…}`.

Optional unter *Settings → Variables and Secrets*: `IP_SALT` (Secret; sonst legt der Server ein
zufälliges Salz in der Datenbank an) und `ALLOWED_ORIGINS` (kommagetrennt, falls die API von einer
anderen Domain genutzt wird; der Client liest dann `VITE_API_BASE` beim Build).

Ohne Git: `npx wrangler login`, dann `npm run deploy:cf`.

### Pages (Alternative)

`functions/api/[[route]].ts` funktioniert auch als Pages Function: *Workers & Pages → Create → Pages →
Connect to Git*, Build command `npm run build`, Output `dist`, danach im Projekt *Settings → Bindings →
D1 database* mit dem Namen `DB` verknüpfen (Datenbank vorher unter *Storage & Databases → D1* anlegen).
Pages ignoriert `wrangler.jsonc` (kein `pages_build_output_dir`); wer Pages als Code konfigurieren will,
nimmt `wrangler.example.toml` als Vorlage.

### Hinweise

- **Free-Plan:** 10 ms CPU pro Anfrage. Ein Abschluss kostet im Worker wenige Millisekunden; die
  Normalisierungen werden beim Start des Isolates gebaut, nicht in der Anfrage. Sollten trotzdem
  `1102`-Fehler (CPU-Limit) auftauchen, hilft der Paid-Plan.
- **Schema-Änderungen** an einer schon genutzten D1-Datenbank brauchen eine echte Migration
  (`migrations/`, `npx wrangler d1 migrations apply pokemon-elf --remote`) – `CREATE … IF NOT EXISTS`
  ändert bestehende Tabellen nicht.
- **Online-Draft (Durable Object):** Die Migration `v1` der Klasse `DraftRoom` (`wrangler.jsonc`) wendet nur
  `wrangler deploy` an, also der Deploy von `main`. Branch- bzw. PR-Builds (`wrangler versions upload`) scheitern,
  solange sie noch aussteht – Änderungen am Durable Object daher zuerst auf `main` deployen.
- **Andere Hosts (Vercel/Netlify/statisch):** `vercel.json` bzw. `netlify.toml` liegen bei. Dort gibt es
  kein Backend – Challenges laufen dann lokal und ungewertet.
- **Unterpfad** (z. B. GitHub Pages unter `/pokemon-elf/`): `vite build --base=/pokemon-elf/` – Router,
  Daten-URL und geteilte Links nutzen `import.meta.env.BASE_URL`.

## Rechtliches

Kostenloses Fan-Projekt. Nicht verbunden mit oder unterstützt von Nintendo, Game Freak, Creatures oder
The Pokémon Company. Pokémon-Namen und -Artwork gehören ihren jeweiligen Eigentümern.
