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
   doppeltem Gewicht. Der **Kapitän** (optional, einer der elf) zählt mit doppeltem Positionsgewicht
   (`SCORING.team.captainWeight`) – gut passend hebt, schlecht passend senkt.
5. **Saison:** 18 Teams, Hin- und Rückrunde. Tore ~ Poisson mit
   `λ = 1,4 · exp((eigen − Gegner)/250) + 0,15 (Heim)`, leichte Streuung, λ auf 0,05–5,5 begrenzt.
   Gegner-Ratings 350–910. Das ist `CLASSIC_MODEL` (`src/lib/season.ts`) – der Server rechnet gewertete Runs
   damit nach, es bleibt unverändert.
6. **Online-Draft** (`DRAFT_MODEL`): Rating-Unterschied weich gedeckelt (`320 · tanh(Δ/320)`), `divisor` 380,
   λ höchstens 3,8, etwas mehr Streuung, dazu eine Tagesform je Team (AR(1), σ ≈ 35 Rating-Punkte, trägt über
   Spieltage) und Torminuten (1–90, selten Nachspielzeit). Beispiel 900 gegen 590: im Schnitt 2,8:0,75.

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
   Der Kapitän kommt als `captain` (Pokémon-ID) mit, der Server prüft, dass er in der Elf steht, und
   merkt ihn in `entry_captains`. Mit seiner Einführung wurde die Rangliste einmalig neu gestartet
   (`cleanup:captain-reset-v1`: alle Runs und Bestwerte gelöscht); Gekauftes blieb, Münzen kosten nur Käufe
   danach (`coinsSince`).

Kein Account nötig: Jedes Gerät hat eine zufällige ID + einen geheimen Schlüssel (der Server speichert nur
dessen SHA-256). Pro Gerät zählt der beste Run; die Tägliche Elf ist einmal pro Gerät und Tag gewertet.
Limits gegen Missbrauch (Runs pro Stunde, neue Geräte pro IP-Hash) stehen in `src/lib/api/contract.ts`.
Ist das Backend nicht erreichbar, spielt die App lokal und ungewertet weiter; scheitert nur das Absenden,
kann man erneut senden oder offline auswerten.

Endpunkte: `GET /api/health` · `POST /api/runs/start` · `POST /api/runs/finish` ·
`GET /api/leaderboard?challenge=…&period=today|week|all` · `GET /api/entries/:id` (Team) ·
`GET /api/entries/:id/player` (Profil mit aktuellem Allzeit-Platz je Wertung) · `POST /api/player` (Spielername).

## Online-Draft (Cloudflare Durable Object)

Jede Liga ist ein Durable Object `DraftRoom` (`server/draftRoom.ts`, Logik in `server/draftCore.ts` und der
reinen Engine `src/lib/draftEngine.ts`). Ablauf: `POST /api/drafts` legt die Liga an (6-stelliger Code),
alle verbinden sich per WebSocket (`/api/drafts/:code/ws`, Hibernation API) und bekommen bei jeder
Änderung den vollen Stand. Lobby: Host stellt Pool, Timer (aus/30/60/90 s), Reihenfolge und
Sichtbarkeit ein, fügt CPU-Teams hinzu und startet. Timer, CPU-Picks und Auto-Picks laufen auf dem
Server (Alarme). Ist das Team am Zug 20 s offline (ohne Timer: 3 min am Zug), darf jedes Mitglied für
es auto-picken; ein abwesender Host gibt die Rolle nach 30 s (Lobby: 5 min) ab. Nach dem letzten Pick
rechnet der Server die Saison einmal und alle sehen sie gleichzeitig im Ticker. Die Saison spielt immer mit
18 Teams (`DRAFT_LIMITS.leagueSize`, 34 Spieltage): Freie Plätze füllen Teams echter Spieler aus der
Allzeit-Rangliste der 34–0 Challenge (Teamname, Spielername, ihre Elf – `server/fill.ts`, Auswahl per
Liga-Seed in `fillTeams`), fehlen welche, Vereine. Statt der Liga geht auch ein **KO-Turnier** (`settings.format = 'cup'`,
`src/lib/cup.ts`): 16 Teams im Baum, gesetzt nach Team-Score, ein Spiel pro Runde, bei Remis Elfmeterschießen;
als „Tabelle" speichert der Server das Endklassement, dazu den Baum (`league.cup`). Optional (`cupGroups`, Standard an)
vorher eine Gruppenphase: 4 Gruppen à 4 aus Lostöpfen nach Team-Score, Hin- und Rückspiel, die ersten zwei ins
Viertelfinale (A1–B2, C1–D2, B1–A2, D1–C2).
Dritter Modus: die **Manager-Saison** (`format = 'manager'`, `src/lib/manager.ts`). Gedraftet wird zusätzlich
eine Bank (`bench`: 3 oder 5), danach läuft Phase `season`: eine Hinrunde mit 18 Teams (17 Spieltage) im Takt
`matchdayMinutes` (10 min bis 24 h); der Server spielt jeden Spieltag per Alarm zum Anpfiff. Davor stellt jedes
Team seine Elf aus dem Kader auf (Nachricht `lineup`: Formation, Positionen, Standardschütze – oder `auto`:
beste Elf zur Tagesform). Jedes Pokémon hat je Spieltag eine Tagesform von −2 bis +2 (aus dem geheimen
Liga-Seed, vorher sichtbar), die seinen Fit um 5 Punkte je Stufe verschiebt. Löschung erst 14 Tage nach dem
letzten Spieltag. **Transfermarkt**: Jedes Team kann pro Spieltag ein freies Pokémon (Pool ohne Gedraftete)
gegen eins aus dem Kader wünschen (Nachricht `transfer`, privat); zum Anpfiff vergibt der Server in
Tabellen-Reihenfolge (Letzter zuerst), CPU-Teams holen bei klarem Gewinn selbst jemanden. **Tausch zwischen Teams**:
Nachricht `offer` (eigenes Pokémon gegen eins aus einem anderen Kader, höchstens 3 offene Angebote); CPU-Teams
antworten sofort (nur wenn ihre beste Elf stärker wird, `squadStrength`) und bieten nach jedem Spieltag selbst Tausche an,
die beiden Elfen helfen (`cpuOffers`, deterministisch, verfallen zum nächsten Anpfiff); Mitspieler antworten mit
`offer-reply` (annehmen/ablehnen, Anbieter zieht zurück).
Ein Tausch gilt sofort (Kader, Aufstellungen, Protokoll mit `with`); Angebote sind nur für die beiden Teams sichtbar
und verfallen, sobald eins der Pokémon weg ist. Entscheidungshilfen in der Saison-Ansicht: nächster Gegner mit Platz,
Formkurve und Stärkevergleich der besten Elfen; bei jedem Tausch bzw. freien Pokémon die Wirkung auf die eigene beste
Elf (`squadStrength`, gewichtete Fit-Punkte ohne Tagesform) und ein Tipp für den besten Transfer. Die Manager-Saison hat
einen eigenen Menüpunkt (`/manager`, `src/pages/Manager.tsx`: Liga anlegen, beitreten, eigene Manager-Ligen);
mit Hinweisen meldet der Browser jeden gespielten Spieltag und erinnert 5 Minuten vor dem Anpfiff.
Öffentliche Lobbys: `GET /api/drafts/public`. Ligen werden nach 14 Tagen gelöscht. Vertrag und Limits:
`src/lib/api/draftContract.ts`.

Weitere Liga-Funktionen: Pool mit Legendären/Mysteriösen, Ultrabestien, Formen und Megas – je mit Limit
pro Team; Zufallsmodus mit Rerolls; Wunschliste für Auto-Picks (privat); Emoji-Reaktionen (nur verteilt,
nicht gespeichert); „Du bist dran" als Ton und Browser-Benachrichtigung; QR-Code des Liga-Links in der
Lobby; Taste „/" springt ins Suchfeld. Das Ergebnis zeigt Draft-Noten, das „Schnäppchen des Drafts"
(bester später Pick), „Deine Duelle" (Bilanz gegen jeden Gegner), Saisonrekorde, den eigenen Saisonverlauf
und die Formkurve. Der Ticker zeigt Torjäger live und die Überraschung des Spieltags; mit Hinweisen meldet der
Browser auch das Saisonende. Nach der Saison legt
`POST /api/drafts/:code/rematch` eine **Revanche** an (gleiche Teams und Einstellungen); jede Revanche
trägt die Ergebnisse ihrer Vorgänger mit – daraus die **ewige Tabelle**. Für `/draft/:code` liefert der
Worker eigene Open-Graph-Tags (Link-Vorschau mit Liganame, Host und Teams, `server/preview.ts`) – ebenso für
Spielerprofile `/spieler/:id` (Name, gewertete Runs, bester Allzeit-Platz).

**Spielwiedergabe** (alle Modi): Ein Klick aufs Ergebnis öffnet den Spielbericht (`src/components/MatchReport.tsx`,
Statistik, Torschützen mit Vorlagen) oder die 2D-Ansicht von oben (`src/lib/matchReplay.ts`,
`src/components/MatchPitch.tsx`: Formationen mit Pokémon-Sprites, Ballwege, Schüsse und die echten Tore – reine
Illustration, das Ergebnis ändert sich nicht; Tempo 1×/2×/4×, „⏭ Tor“, Leertaste/N, „TOR!“-Einblendung). In den
Einstellungen bzw. per Umschalter: 2D, Bericht oder aus. In der Manager-Saison zusätzlich der Spieler des Spieltags.

**Trikotnummern** (alle Modi, `src/lib/jerseys.ts`, `src/components/JerseyEditor.tsx`): Ohne eigene Wahl gilt
eine Vorgabe nach Position (Torwart 1, Abwehr 2–5, Sechser 6, Zehner 10, Stürmer 9 …). Jedes Team kann seinen
Pokémon Nummern von 1 bis 99 geben – je Team eindeutig (belegte Nummern tauschen), die Nummer hängt am Pokémon,
nicht an der Position. Builder: im Zustand und in „Meine Teams“; Online-Draft/Manager-Saison: Feld `jerseys` am
Team (Nachricht `jerseys`, nach dem Draft); Challenges und lokaler Draft: im Browser (`useJerseys`). Reine Optik
auf Feld, Bild, 2D-Wiedergabe und im Spielbericht (Torschützen mit Nummer) – Wertung und Rangliste kennen
keine Nummern. Der Knopf „Pokédex-Nummern“ vergibt die letzten beiden Ziffern der Pokédex-Nummer; der Teilen-Link
des Builders trägt eigene Nummern im Parameter `nr`.

**Trikotfarben** (alle Modi, `src/lib/kits.ts`, `src/components/KitPicker.tsx`): je Team eine Heim- und eine
Auswärtsfarbe aus 10 Farben. In der 2D-Ansicht spielt das Heimteam in Heimfarbe, der Gast ebenfalls – außer
beide gleich, dann in seiner Auswärtsfarbe (notfalls eine Ausweichfarbe). Gespeichert wie die Trikotnummern
(Builder-Zustand, `DraftTeam.kit` mit Nachricht `kit`, im Browser je Challenge bzw. im lokalen Draft). Dazu ein **Torjubel**
(`src/lib/cheer.ts`, bis 40 Zeichen, Nachricht `cheer`), der in der 2D-Ansicht unter „TOR!“ erscheint.

**Kapitän** (alle Modi): seine Passung zählt im Team-Score doppelt (`captainWeight`). Challenges: beim
Abschluss (Server prüft, `entry_captains`); Builder/Testspiel: im Zustand und im Teilen-Link (`k`); Online-Draft:
nur während des Drafts (Nachricht `captain`), Manager-Saison: jederzeit, zählt ab dem nächsten Anpfiff.

## Trainer & Erfolge

**Erfolge** (`/trainer`, `src/lib/achievements.ts`, `server/achievements.ts`): `POST /api/me` rechnet aus den Runs
(Anzahl, Siege, perfekte Saisons), der Tageswertung (Serie, Tagessiege), den Allzeit-Plätzen und den fertigen
Online-Ligen (`draft_results`, schreibt der Draft-Raum am Saisonende) die Erfolge des Geräts – jeder bringt Münzen.
Dafür gibt es Cosmetics für den selbst gestalteten **Trainer** (`src/lib/trainer.ts`, Pixel-Art 32 × 32 aus `src/lib/trainerPixels.ts`, als SVG in
`src/components/TrainerAvatar.tsx`): Haut, Frisur, Haarfarbe, Kleidung, Kopfbedeckung, Accessoire, Hintergrund,
Begleiter-Pokémon und Titel. `POST /api/me/buy` kauft atomar (nur wenn die Münzen nach allen Käufen reichen,
`trainer_items`), `POST /api/me/trainer` speichert den Look (`trainers`, nur Freies und Gekauftes).
**Saisonartikel** (`season` im Katalog, `itemOnSale`): nur in ihrem Zeitraum kaufbar (Halloween 1.10.–7.11.,
Weihnachten 1.12.–6.1., Frühling/Ostern 20.3.–30.4., Sommer 21.6.–31.8., Neujahr 27.12.–10.1., Valentinstag 7.–14.2.), sonst `400 not_on_sale`; Gekauftes bleibt tragbar.

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
