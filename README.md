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
`?c=daily&p=today|week|all`) · `/spieler/:id` Spielerprofil · `/scouting` (Scouting-Guide mit „🏅 Top 3 je Position“, Legendäre per Schalter, und „🔍 Wo spielt …?“: Pokémon suchen oder in der Top-3-Liste antippen, fünf beste Positionen mit Fit und „🏅 Nr. n von 1.025“ auf der besten) · `/ueber` (mit „Was ist neu?“, DE/EN gleich lang – `tests/infoNews.test.ts`) · `/datenschutz`

## Bewertung in Kürze

1. **Normalisierung:** Basiswert ÷ 255, geglättet:
   `0,75 · Perzentil im Pool + 0,25 · √(Wert/255)`. Größe ist bei 2,2 m gedeckelt, Gewicht wirkt
   logarithmisch (1 kg … 400 kg, jede Verdopplung zählt gleich).
2. **Gewichtung** je Profil: Schlüssel 3, Hilft 2, Kleiner Anteil 1, Zählt nicht 0 (`config/positions.ts`).
3. **Fit** = Perzentil des gewichteten Werts im Pool (0–100), danach Typ-Bonus +3 %/+2 %/+1 %.
4. **Team-Score** = gewichteter Durchschnitt der 11 Fits × 10. Gewichte TW 1,6 · IV 1,2 · AV/WB 1,0 ·
   DM 1,1 · ZM 1,0 · OM 1,2 · LM/RM/LF/RF 1,0 · ST 1,4. Die drei schwächsten Fits zählen zusätzlich mit
   doppeltem Gewicht. Der **Kapitän** (optional, einer der elf) zählt mit doppeltem Positionsgewicht
   (`SCORING.team.captainWeight`) – gut passend hebt, schlecht passend senkt. Die Auswahl zeigt je Spieler seinen Fit (`CaptainPicker`).
5. **Saison:** 18 Teams, Hin- und Rückrunde. Tore ~ Poisson mit
   `λ = 1,4 · exp((eigen − Gegner)/250) + 0,15 (Heim)`, leichte Streuung, λ auf 0,05–5,5 begrenzt.
   Gegner-Ratings 350–910. Das ist `CLASSIC_MODEL` (`src/lib/season.ts`) – der Server rechnet gewertete Runs
   damit nach, es bleibt unverändert. Die Gegner heißen wie Teams aus den Online-Ranglisten
   (`src/lib/rankingNames.ts`: Allzeit-Bestenlisten 34–0 und 151, auf dem Gerät gecacht, höchstens alle 6 h neu;
   ohne Cache Vereinsnamen). Die Namen stehen im gespeicherten Run (`opponentNames`) und ändern nie Ergebnisse.
6. **Online-Draft** (`DRAFT_MODEL`): Rating-Unterschied weich gedeckelt (`320 · tanh(Δ/320)`), `divisor` 380,
   λ höchstens 3,8, etwas mehr Streuung, dazu eine Tagesform je Team (AR(1), σ ≈ 35 Rating-Punkte, trägt über
   Spieltage) und Torminuten (1–90, selten Nachspielzeit). Beispiel 900 gegen 590: im Schnitt 2,8:0,75.

Für die 151 Challenge und Retro 34–0 wird nur über die Original-151 normalisiert.
Alle Zahlen sind in `src/config/` änderbar – die Tests prüfen Eigenschaften, keine festen Werte.

## Spielmodi

- **Builder** – frei aufstellen, Drag & Drop, Bild speichern (1200×1500 PNG), Link teilen, „Als Text kopieren“ (Kopfzeile, je Position ein Spieler mit Kapitän, Link – für Chats), Rückgängig; über dem Feld Typ-Elf- und 🌈 Regenbogen-Chip wie im Draft (auch in den Challenges und im Dialog „Team ansehen“ der Rangliste, `TypeChips`), bei voller Elf dazu 📏 Ø Größe · ⚖️ Gesamtgewicht; im Teamblatt steht hinter der Nummer der Fit auf der Position (Ø der Feldspieler im Kopf neben „n/11“) (ab 95 grün, auf schmalen Handys in eigener Zeile); „Meine Teams“ (bis 5 Elfen auf dem Gerät) mit Formation, Speicherdatum, Team-Score (wie im Testspiel) und „✓ aktuell“ an der Elf, die gerade im Builder steht; auf sehr schmalen Handys (320 px) rutschen die Knöpfe unter den Namen.
  Optional Formen und Megas (mit Mega-Limit); der Auswahl-Dialog sortiert auf Wunsch nach Positions-Fit (dann mit „Fit n“ auf jeder Karte).
- **34–0 Challenge** – pro Runde werden Region + Typ gewürfelt (je ein Reroll pro Run), max. 2 Legendäre. Während des Runs zeigt „📜 Deine Runden“ je Runde Pokémon, Position, Fit (💯 ab 95) und benutzte Rerolls, Ø Fit in der Überschrift. Teilen nennt Bilanz, Platz, Punkte, Challenge und Score und verlinkt die Challenge. Im Setup aller Challenges Statistik-Karten (Bester Score, Beste Bilanz, Runs mit Ø Score ab zwei neu gezählten Runs, „Letzter Run“ mit Bilanz und „vor …“).
- **Tägliche Elf** – jeden Tag (Europe/Berlin) dieselben Würfe für alle, Regeln wie 34–0, ein Versuch pro
  Tag und Gerät. Die Saison ist für alle identisch (gleiche Elf → gleiches Ergebnis). Ergebnis als
  Emoji-Raster teilen (34 Spieltage in zwei Reihen). Serie (Tage am Stück), „Bester Tag“ (meiste Punkte, mit Ø; ist heute der beste Tag, steht „🏅 Neuer Bestwert“ mit dem Vorsprung) und Archiv auf dem Gerät (🏅 bester Tag, ▲/▼ Punkte gegenüber dem vorherigen Tag; auf dem Handy zweizeilig; darunter „🏆 n× Meister“ (Saisons auf Platz 1) und „📅 Dein bester Wochentag“ – höchster Ø unter Wochentagen mit mindestens zwei Spielen, sobald es zwei davon gibt). Schon gespielt: Platz mit „Top n %“ (ab 10 Spielern) und ▲/▼ Punkte gegenüber gestern (aus dem Archiv des Geräts).
- **151 Challenge** – pro Runde ein zufälliges Pokémon aus den Original-151, 5 Rerolls.
- **Retro 34–0** – Modus der 151-Seite: Typ-Würfel wie bei 34–0, aber nur Kanto, Retro-Sprites,
  Gen-1-Skalierung, eigene Rangliste.
- **Fantasy-Draft** – 2–8 Teams (Hot-Seat mit „📱 Gerät an … weitergeben“ beim Wechsel zwischen Menschen, oder CPU; CPU-Teams und 🎲 heißen wie Teams aus den Online-Ranglisten), Snake-Draft über 11 Runden, danach Liga mit Tabelle (Konfetti, wenn ein menschliches Team Meister wird; „Ergebnis teilen“ wie online; im Setup würfelt „🎲 CPU-Formationen würfeln“, „🎲 CPU-Namen würfeln“ die Formationen aller CPU-Teams neu; über dem Start-Knopf stehen Pool-Größe und Sonder-Pokémon wie in der Online-Lobby; „Als Text kopieren“ an den eigenen Kader-Karten (online mit Liga-Link) und „⏱️ Draft-Dauer“ nennt, wie lange der Draft gedauert hat, lokal darunter „⌀ Bedenkzeit je Pick“ je menschlichem Team – online steht sie in den Saisonrekorden); beim CPU-Zug steht, welche Positionen der CPU noch fehlen; jedes menschliche Team hat eine Merkliste („☆ Merken“ beim ausgewählten Pokémon, „★ gemerkt“ auf den Karten, nur für das Team am Zug); am Ende jeder Runde meldet „🔔 Runde n vorbei“ den Top-Pick (bester Fit); vor dem Anpfiff nennt die Kapitänswahl den Favoriten nach Team-Score und den Rang jedes menschlichen Teams; optionale Pick-Uhr (30/60/90 s) für menschliche Teams – läuft sie ab, wird automatisch gewählt; im Setup setzen Schnellstart-Vorlagen (Klassisch, Alle Regionen, Mega-Chaos, Shiny-Party, 🎲) mehrere Pool-Regeln auf einmal
  (gesamt/Heim/Auswärts), Statistik (Vorlagen, Scorer, Teamwerte mit 🧤 Spielen ohne Gegentor), Saisonrekorden (darüber „📊 Liga in Zahlen“: Spiele, Tore mit Schnitt, Remis und Zu-null-Spiele, `leagueNumbers`; „🤝 Traumduo“: Vorlage → Tor-Paar mit den meisten gemeinsamen Toren, `dreamDuo`; „🥅 Schießbude“: meiste Gegentore; „🪫 Harmloseste Offensive“: wenigste Tore; „🎯 Kaltschnäuzigste Mannschaft“: Tore je Schuss aufs Tor (ab 15, online und lokal mit Draft-Spielmodell, `sharpestTeam`); „⚖️ Schwergewicht“/„🪶 Federgewicht“: schwerster und leichtester Kader nach Gesamtgewicht, `weightExtremes`; u. a. Weiße Weste: meiste Spiele ohne Gegentor; Hattricks: Anzahl und der erste; Größtes Comeback: Sieg nach dem größten Rückstand), Meisterchancen (50 Neuausspielungen), Zeitreise, Kreuztabelle, „Deine Duelle“, Revanche (gleiche Teams, neuer Draft) und
  Titelsammlung auf dem Gerät (`draft-champions` im localStorage).
- **Online-Draft** – Liga anlegen, Code/Link teilen, gemeinsam live draften (siehe unten).
- **Rangliste** – Heute, Diese Woche (mit „noch n Tage“ bis Sonntag), Allzeit (Kopfzeile mit der Lieblingsformation der Top-Einträge, darunter Filter-Chips je Formation mit Anzahl – die Plätze bleiben die der Wertung); 🆕 an Einträgen der letzten Stunde, eigene Zeile in der Top-Liste mit „noch n Pkt bis Platz k“ (nächstbesserer Platz, Gleichstand übersprungen) und „noch n Pkt bis Platz 1“, eigene Platzierung außerhalb der Top-Liste mit „noch n Pkt bis in die Top N“; Team ansehen (Teamblatt mit Fit je Spieler, bei 151/Retro auf der Gen-1-Skala; „Als Text kopieren“ mit Builder-Link), Testspiel gegen die eigene Builder-Elf (mit 📈 Prognose aus 100 festen Seeds, Torschützen beider Seiten unter dem Teamnamen, ⭐ Mann des Spiels und 📊 Bilanz über „Nochmal spielen“),
  Spielerprofil.

Im Draft zeigt ein Hover über eine Position, welche Werte dort zählen (Schlüssel/Hilft/Kleiner Anteil,
Typ-Bonus, Gewicht im Team-Score). Die Oberfläche gibt es auf Deutsch und Englisch (Umschalter im Kopf,
`src/i18n/`; Texte je Bereich in `de/*.ts`, `en/*.ts` ist dagegen typgeprüft).

Nach jedem Challenge-Run läuft die Saison im **Live-Ticker** ab (Spieltag für Spieltag, Pause, 1×/2×/4×,
Überspringen), danach folgt die Saisonbilanz (mit „🎯 Ø Fit · 💯 Volltreffer · am besten passte …“ und „🏁 … schon am n. Spieltag rechnerisch Meister“, wenn der Titel vor dem letzten Spieltag feststand – ebenso im Ergebnis des Online- und lokalen Drafts, nicht im KO-Turnier). Auf langen Seiten erscheint nach dem Scrollen unten links „↑ Nach oben“ (`BackToTop`). Nach einem Seitenwechsel liegt der Fokus auf dem Hauptbereich (Tastatur, Screenreader); jede Seite hat genau eine Hauptüberschrift (im Builder ohne Teamnamen unsichtbar), das Draft-Board (online und lokal) eine unsichtbare h2 über den Team-Spalten. Mit „Bewegung reduzieren“ im System springen alle Scroll-Bewegungen sofort ans Ziel (`scrollBehavior` in `src/lib/motion.ts`), Animationen sind ohnehin abgeschaltet. Dialoge halten den Tastaturfokus (Tab/Shift+Tab bleiben drin, auch direkt nach dem Öffnen) und geben ihn beim Schließen an den auslösenden Knopf zurück (Kopf und Fuß ohne header/footer, damit im Portal kein zweites banner/contentinfo entsteht); in jeder Pokémon-Suche (Builder-Auswahl, Draft-Pool online und lokal, Lobby-Pool) springt ↓ ins Raster, dort Pfeile und Enter; nach „Run starten“, „Neuer Run“ und „Draft starten“ (lokal, auch Kapitänswahl und Liga) holt die neue Ansicht den Fokus zu sich (online ebenso nach dem eigenen Pick), statt ihn an den Seitenanfang fallen zu lassen (`useFocusRescue` in `src/lib/focusRescue.ts` – nur kurz nach einer Taste oder einem Klick, beim Laden bleiben Skip-Link und Menü vorne). Breite Tabellen (`.table-scroll`) und das Draft-Board (online und lokal), die seitlich überlaufen, sind per Tab erreichbar und mit den Pfeiltasten scrollbar – der Tab-Stopp entsteht nur bei Überlauf (`installScrollFocus` in `src/lib/scrollFocus.ts`, auf `body`, damit Dialoge mitzählen). Sprites neben dem ausgeschriebenen Namen (Manager-Kader, Transfermarkt) haben leeren Alt-Text (`decorative`). `aria-label` steht nur auf Elementen mit Rolle (img, group, region – Wächter `tests/ariaLabelRole.test.ts`). Text in Gelb/Grün/Rot nutzt eigene Töne je Design (`--yellow-text`, `--green-text`, `--red-text`), weiße Schrift auf den Grundfarben erreicht ebenfalls AA, hart codiertes Mittelgrün als Textfarbe ist verboten (`tests/contrast.test.ts`).

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
Sichtbarkeit ein, fügt CPU-Teams hinzu (einzeln oder „Mit CPU auffüllen“: `add-cpu` mit `fill`; Stärke `cpuLevel`
leicht/normal/stark = Zufall ±12/±4/±1 Fit-Punkte beim CPU-Pick, aus dem Liga-Seed; CPU-Teams heißen wie Teams aus der Allzeit-Rangliste 34–0, Rest Vereinsnamen) und startet. Schnellstart-Vorlagen (`src/config/draftPresets.ts`) setzen mehrere Regeln auf einmal, „🎲 Überraschung“ nimmt eine zufällige passende. Neben dem Liganamen schlägt 🎲 einen zufälligen Namen vor (Liste je Sprache, `leagueNameIdeas`). Eine kleine Feld-Vorschau zeigt die gewählte Formation als Punkte in den Positionsfarben (`FormationMini`; klein auch neben der Formation des nächsten Gegners in der Manager-Saison). Neben der Formation würfelt „🎲 Zufällige Formation“ eine andere aus. Bei fester Reihenfolge zeigt „Deine Picks“ die eigenen Pick-Nummern vorab (`pickNumbers`; lokal im Setup für jedes menschliche Team). Mitspieler melden sich mit „Ich bin bereit“
(`ready`, reine Anzeige) bereit – die anderen sehen kurz „✅ … ist bereit“; tritt jemand bei oder geht, zeigen die anderen kurz „👋 … ist dabei“ bzw. „🚪 … ist nicht mehr dabei“. Jedes Team kann ein Saisonziel setzen (`goal`: Meister, Top 3, obere Hälfte,
nicht auf den letzten 3) – das Ergebnis zeigt, ob es erreicht wurde; die Manager-Saison zeigt es mit ✓ bzw. dem Punkterückstand auf den Zielplatz. Timer, CPU-Picks und Auto-Picks laufen auf dem
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
Liga-Seed, vorher sichtbar), die seinen Fit um 5 Punkte je Stufe verschiebt (die Aufstellung zeigt die Ø Tagesform der Startelf und markiert die Schwachstelle – den Starter mit dem niedrigsten Fit – samt fitterem Bankspieler zum Einwechseln; Starter mit Saisontoren tragen „⚽ n“ auf dem Feld; bei eigener Aufstellung meldet „🔥 Topform auf der Bank“ Bankspieler mit Tagesform +2; ab dem 3. Spieltag nennt „🪑 Noch ohne Einsatz“ Bankspieler, die noch nie in der Startelf standen, ab dem 5. „🔋 Dauerbrenner“ die Spieler, die jedes Spiel von Beginn an gemacht haben); die Kader-Tabelle (mit Sprites, Shinys schillernd) sortiert nach Fit, Form, Toren, Vorlagen, Scorerpunkten oder Einsätzen („Sp.“, Spiele in der Startelf). Die Gegner-Karte nennt sein letztes Ergebnis („⏮️ Zuletzt: 2:1-Sieg gegen …“), „⚽ Angriff“/„🧱 Abwehr“ mit Ligaplatz und Schnitt pro Spiel und den „🎯 Schwachpunkt des Gegners“ (sein Starter mit dem niedrigsten Fit samt Tagesform); dort gibt man auch „🔮 Dein Tipp“ (Sieg/Remis/Niederlage) ab; die Trefferbilanz (mit „🔥 n in Folge“ ab zwei richtigen Tipps hintereinander) bleibt auf dem Gerät (`managerTips`). Löschung erst 14 Tage nach dem
letzten Spieltag. **Transfermarkt** (freie Pokémon mit Sprite, Position, Fit und Wirkung auf die beste Elf; filterbar nach Position; „📥 Deine Neuzugänge“ listet die eigenen mit ihren Toren): Jedes Team kann pro Spieltag ein freies Pokémon (Pool ohne Gedraftete)
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
Öffentliche Lobbys: `GET /api/drafts/public` (volle ausblendbar per „Nur mit freien Plätzen“; mit „🏆 KO-Turnier“/„🏟️ Manager-Saison“ und „✨ Shiny-Party“; beides steckt als Bits in der Spalte `legends` der Lobby-Zeile: 2 = Shiny-Party, 4 = KO-Turnier, 8 = Manager-Saison). Ligen werden nach 14 Tagen gelöscht. Vertrag und Limits:
`src/lib/api/draftContract.ts`.

Weitere Liga-Funktionen: Pool mit Legendären/Mysteriösen, Ultrabestien, Formen und Megas – je mit Limit
pro Team; Zufallsmodus mit Rerolls; Wunschliste für Auto-Picks (privat, 💔-Hinweis, wenn ein anderes Team einen Wunsch wegschnappt; „✨ Beste Freie übernehmen“ hängt je offener Position das passendste freie Pokémon an); „🧲 … schnappt dir … weg“, wenn ein anderes Team den besten Freien einer eigenen offenen Position nimmt und der nächstbeste mindestens 5 Fit schwächer ist (lokal als Hinweis beim nächsten Zug des menschlichen Teams); bei ausgewähltem Pokémon nennt der Hinweis seinen besten freien Platz mit Fit und den Ø Fit der eigenen Elf vorher → nachher (`fitImpact`, auch lokal) und „🧩 Typ-Elf: Feuer ×4!“, wenn der Pick eine Typ-Elf vollmacht oder vergrößert (`typeElevenGain`), bzw. „🌈 Typen-Regenbogen: 10 Typen!“, wenn er den Regenbogen erstmals vollmacht (`rainbowGain`); 🤖-Prognose, welches Pokémon eine direkt nach dir wählende CPU wohl nimmt (ohne ihren Zufall – zum Wegschnappen, auch am Handy); Emoji-Reaktionen (👏 🔥 😂 😱 👀 💀 🎉 ⚽ 🙈; nur verteilt,
nicht gespeichert); „Du bist dran" als Ton und Browser-Benachrichtigung, bei 10 s Restzeit vibriert das Handy einmal; QR-Code des Liga-Links in der
Lobby; der Host sieht neben der Dauer die Uhrzeit für Draft- und Saisonende bei sofortigem Start (🕒, nicht in der Manager-Saison) und hinter der Pool-Größe die Sonder-Pokémon („Darunter ★ 15 Legendäre, 11 Ultrabestien.“); unter den Teams fasst „🧩 Formationen: 4-3-3 ×2 · 4-4-2“ den Formations-Mix zusammen (mit Hinweis, wenn die eigene sonst keiner spielt); „📋 Einladung kopieren“ legt eine Chat-Nachricht mit Liganame, Regionen, Teams, Pick-Uhr, Code und Link in die Zwischenablage; Taste „/" springt ins Suchfeld; auf dem Board zeigt 👑 das Team mit dem besten Ø Fit, ein Typ-Chip („Feuer ×4") eine Typ-Elf ab vier Pokémon eines Typs, „🌈 n“ einen Typen-Regenbogen ab zehn verschiedenen Typen (alles auch lokal); „🎲 Zufall“ (auch lokal, Taste R; Taste „?“ zeigt alle Tastenkürzel, online und lokal) merkt ein zufälliges erlaubtes Pokémon auf seinem bestpassenden Platz vor; an der Snake-Wende meldet „🐍 Doppelpick“ (auch lokal), dass man gleich noch einmal dran ist, die letzte Runde markiert 🏁 in der Statusleiste (auch lokal); „⏳ bald weg“ markiert im Pool die stärksten Freien (bester Feld-Fit), die wohl vergeben sind, bevor man wieder dran ist (so viele wie fremde Picks dazwischen; lokal für das Team am Zug); „👀 Feld von …“ zeigt während des Drafts die Elf eines anderen Teams auf dem Spielfeld (nur Ansicht, am eigenen Zug bzw. lokal nach jedem Pick zurück; online und lokal); leere Plätze der eigenen Elf (lokal: des menschlichen Teams am Zug) tragen den besten noch freien Fit ihrer Position (grün ≥ 90, gelb ≥ 80, sonst rot); unter der Statusleiste zeigt ein schmaler Balken den Draft-Fortschritt mit den eigenen Picks als Striche (lokal die des Teams am Zug, `DraftProgress`); „✅ Deine Elf steht – Ø Fit n“ meldet die vollständige eigene Elf (lokal je menschlichem Team); „★ Erstes legendäres Pokémon des Drafts“ und „★ Das letzte legendäre Pokémon ist vergeben“ werden kurz angesagt (online und lokal); mit Legendären im Pool zeigt der Pool-Kopf „★ n“ noch freie (lokal über der Suche; ein Tipp darauf filtert das Raster auf diese Art – online auch „UB n“ und „M n“), online ebenso „UB n“ und „M n“ für Ultrabestien und Megas; im Pick-Verlauf markiert ⚡ einen Blitz-Pick (selbst gewählt, höchstens 5 s nach dem vorigen Pick – lokal für menschliche Teams über den Zeitpunkt im Verlauf `log[].at`; die eigenen zählt die Statusleiste mit „⚡ n/5“, daneben „⌀ n s“ die eigene Bedenkzeit je selbst gewähltem Pick, `pickTimes`) und 🏅 den Pick mit dem besten Positions-Fit des Drafts bisher (eigener Rekord-Pick mit kurzem Hinweis, sonst „💯 Volltreffer“ bei eigenem Fit ≥ 95 – online und lokal); ★, UB und M hinter dem Namen kennzeichnen Legendäre/Mysteriöse, Ultrabestien und Megas (auch in „Alle Picks“ im Ergebnis, online und lokal; dort markiert 🏅 zusätzlich den besten Pick jeder Runde nach Positions-Fit, `roundBestPicks`). Der lokale Draft zeigt die letzten Picks ebenfalls als Verlauf (Position, Fit, ★/UB/M, ✨, 🏅). Unter den Stars öffnet „🔍 Ganzen Pool ansehen“ das ganze Raster mit Suche und Filtern (Antippen nennt die beste Position). In der Lobby zeigt „⭐ Stars im Pool“ allen die fünf stärksten Pokémon der aktuellen Einstellungen mit ihrer besten Position (`poolStars`; ebenso im Setup des lokalen Drafts); darunter stehen die drei häufigsten Typen im Pool als Typ-Badges mit Anzahl (`poolTypes`), das größte und kleinste Pokémon im Pool („📏 Größter: Wailord (14,5 m) · 🐭 Kleinster: …“, `poolSizes`), und „⚠️ Knapp im Pool“ warnt vor Positionen mit weniger starken Kandidaten (Fit ≥ 85) als Plätzen in den Formationen aller Teams (`poolScarcity`, höchstens drei); im laufenden Draft (online und lokal) meldet „⚠️ Wird knapp: IV 9/10“ dasselbe live (starke Freie / noch offene Plätze aller Teams, nur Positionen, die man selbst noch braucht, `scarceFor`); das Ergebnis (online und lokal) zeigt unter „⭐ Wo landeten die Stars?“, welches Team sie mit welchem Pick bekam. Unter der eigenen Platzierung stehen Angriff und Abwehr mit Rang in der Liga („⚽ Angriff: 32 Tore (Platz 7) · 🧱 Abwehr: …“, `attackDefenseRanks`; lokal je menschlichem Team); außerdem vergleicht 📈/📉/🎯 den erwarteten Platz (Rang nach Team-Score, bei Gleichstand ein Bereich) mit dem Endplatz (`expectationGap`; lokal unter dem Platz jedes menschlichen Teams). Das Ergebnis nennt dem eigenen Team außerdem die „😬 Verpasste Chance“ (eigener Pick mit dem größten Fit-Abstand ≥ 10 zur besten damals freien Alternative derselben Position, ohne Legendäre/UB/Megas und nicht im Zufallsmodus, `missedChance`; im lokalen Ergebnis je menschlichem Team). Die Kader-Karten im Online-Ergebnis (und im lokalen Draft) zeigen bei gemischten Elfen den Regionen-Mix („🗺️ Kanto 5 · Johto 4 …“) , „💯 n Volltreffer“ (Feldspieler mit Positions-Fit ≥ 95) sowie „📏 Ø Größe · ⚖️ Gewicht“ der Elf. Unter der Torjägerliste nennt das Ergebnis die drei treffsichersten Pokémon-Typen der Liga (Doppeltypen zählen für beide, `goalsByType`; online und lokal). Darüber steht der „Typ des Drafts“ – der meistgedraftete Typ aller Teams mit Anzahl (nur bei eindeutigem Höchstwert, `draftTypeOf`). „🃏 Joker des Drafts“ nennt den Pick aus dem letzten Drittel mit den meisten Saisontoren (ab 3, `draftJoker`; online und lokal); „😊 Lieblingsgegner“/„😖 Angstgegner“ nennt (online, lokal und in der Saisonbilanz der Challenges – dort zusammen mit höchstem Sieg, höchster Niederlage, den längsten Serien und der Heim-/Auswärtsbilanz, `longestRuns`, `venueRecords`) die Gegner mit der besten und schlechtesten eigenen Bilanz (`favouriteFoes`), „⚽ n von m deiner Picks haben getroffen“ zählt die eigenen Picks mit Saisontor (online und lokal je menschlichem Team), „1️⃣ Erster Pick“ zieht (online und lokal) die Saisonbilanz (Tore, Vorlagen) des ersten Picks. Das Ergebnis zeigt Draft-Noten, das „Schnäppchen des Drafts"
(bester später Pick), „Deine Duelle" (Bilanz gegen jeden Gegner), Saisonrekorde, den eigenen Saisonverlauf (mit 🟢 bestem und 🔴 tiefstem Platz samt Spieltag) (mit 🟢 bestem und 🔴 tiefstem Platz samt Spieltag)
und die Formkurve; der Rekord „Blitz-König“ nennt das Team mit den meisten Blitz-Picks ⚡ (ab 3; lokal aus den Zeitpunkten im Verlauf). Der Ticker zeigt Torjäger live, die Überraschung des Spieltags, 💥 den Kantersieg (ab 4 Toren Abstand), 🔄 das Comeback (Sieg nach mindestens 2 Toren Rückstand), 🎩 Hattricks und bei den eigenen Toren 🧤 die Spiele ohne Gegentor; mit Hinweisen meldet der
Browser auch das Saisonende. Nach der Saison legt
`POST /api/drafts/:code/rematch` eine **Revanche** an (gleiche Teams und Einstellungen); jede Revanche
trägt die Ergebnisse ihrer Vorgänger mit – daraus die **ewige Tabelle**. In der Lobby einer Revanche steht der Meister der letzten Liga als „🏆 Titelverteidiger“ (Zeile über den Teams und Pokal am Team), jedes Team zeigt „zuletzt Platz n“, dazu „🔁 n. Liga dieser Gruppe“ mit dem Rekordmeister ab zwei Titeln; im Ergebnis heißt es dann „🏆 Titel verteidigt“ oder „🔄 Neuer Meister – Titelverteidiger … wird Platz n“. Für `/draft/:code` liefert der
Worker eigene Open-Graph-Tags (Link-Vorschau mit Liganame, Host und Teams, `server/preview.ts`) – ebenso für
Spielerprofile `/spieler/:id` (Name, gewertete Runs, „zuletzt aktiv vor …“ aus dem neuesten Run, bester Allzeit-Platz, „⭐ Lieblings-Challenge“ mit den meisten Runs, 🏅 an Runs unter „Letzte Runs“, die der Bestwert ihrer Wertung sind, 🛡️ an Runs ohne Niederlage; die Liste lässt sich nach Wertung filtern, darüber Ø Punkte der gezeigten Runs und ab sechs Runs der Trend der letzten drei gegenüber davor).

**Spielwiedergabe** (alle Modi): Ein Klick aufs Ergebnis öffnet den Spielbericht (`src/components/MatchReport.tsx`,
Statistik, Torschützen mit Vorlagen, Halbzeitstand aus den Torminuten, laufender Spielstand nach jedem Tor, 🏆 Siegtor, 🟰 Ausgleich, ⚽⚽ Doppelpack/🎩 Hattrick am Schützen) oder die 2D-Ansicht von oben (`src/lib/matchReplay.ts`,
`src/components/MatchPitch.tsx`: Formationen mit Pokémon-Sprites, Ballwege, Schüsse und die echten Tore – reine
Illustration, das Ergebnis ändert sich nicht; Tempo 1×/2×/4×, „⏭ Tor“, Leertaste/N, ←/→ springen 5 Minuten (Kürzel-Zeile unter den Knöpfen, auf Touch-Geräten ausgeblendet), „TOR!“-Einblendung, Halbzeit-Strich auf der Zeitleiste und „Halbzeit“ auf der Uhr). In den
Einstellungen bzw. per Umschalter: 2D, Bericht oder aus. In der Manager-Saison zusätzlich der Spieler des Spieltags, 🎯 Tor-Marken eigener Spieler (5, 10, 15 … Saisontore, `goalMilestones`), 🔥 Torserien eigener Spieler (ab drei Spielen in Folge mit Tor, `scoringRuns`), 🎩 Hattricks, 💥 der Kantersieg und 🔄 das Comeback; in der Tabelle markiert ⚔️ den nächsten Gegner; ein Tabellenausschnitt zeigt die zwei Plätze über und unter dem eigenen Team mit Punkteabstand; ein Saisonstreifen zeigt je Spieltag ein Kästchen (gespielt: Ergebnis in S/U/N-Farbe, offen: Tabellenplatz des Gegners, aktueller Spieltag umrandet); vor dem nächsten Spieltag stehen Topspiel und Kellerduell (beste bzw. schlechteste Platzsumme); der Status nennt die eigene Bilanz (S–U–N, Tore, 🧤 Spiele ohne Gegentor), ein farbiger Balken die eigenen Tore nach Mannschaftsteil (Angriff/Mittelfeld/Abwehr/Tor, `goalsByLine`) samt Wetter-Vorhersage fürs nächste Spiel (reine Deko, `weatherFor`), „📢“-Vorschau (Spitzenspiel, Favorit, Außenseiter, Augenhöhe, `matchPreview`), „🏟️ Erwartet: n Zuschauer“ vor Heimspielen (Tabellenplatz und Fan-Stimmung, ab 40.000 ausverkauft, `expectedCrowd`), „🔝 Gegen die Top 4“ (eigene Bilanz gegen die aktuellen ersten vier, ab dem 3. Spieltag) und „📣 Fan-Stimmung“ (😍/🙂/😐/😠 aus den Punkten der letzten fünf Spiele, `fanMood`; auch im Saison-Ticker des Online-Drafts), „👥 n verschiedene Torschützen“ (mit „Ligabestwert“, `distinctScorers`) und „⏱️ Stärkste Phase: 76.–90. Minute“ (Viertelstunde mit den meisten eigenen Toren, `bestGoalPhase`), „🕐 3× zur Pause geführt, 2 gewonnen“ (`halfTimeLeads`) und den eigenen Torjäger mit Platz in der Torjägerliste (und die Spitze, wenn er nicht vorn ist); ab der Saisonhälfte sagt 🏆 der rechnerische Titelkampf (`titleChance`), ob Platz 1 sicher, noch möglich oder nicht mehr erreichbar ist.

**Shinys im Draft** (`src/lib/shiny.ts`): Jeder Pick schillert mit 2 % Chance (online aus dem geheimen Liga-Seed,
lokal aus einem Zufallswert je Draft). Ein Shiny spielt besser (+10 Passung) und hebt das ganze Team um bis zu
40 Team-Score-Punkte – je schwächer das Pokémon (Summe der Basiswerte), desto mehr. Online in `DraftState.shinies`
(wandert bei Tausch mit), ✨ und Shiny-Sprite auf dem Feld, im Pick-Verlauf und als Hinweis beim eigenen Pick. In der
Manager-Saison kann auch ein Neuzugang vom Transfermarkt schillern (gleiche Chance, `ManagerTransfer.shiny`). Lobby-Einstellung
„Shinys“: Aus / An (2 %) / Party (10 %, `shinyParty`).

**Spielplan der Manager-Saison** (`managerSchedule`, `scheduleOf`): eine Hinrunde (jeder einmal gegen jeden). Neue
Saisons (`ManagerState.venues = 'balanced'`) verteilen das Heimrecht ausgeglichen (je Team 8 oder 9 Heimspiele) – der
alte Plan gab manchen Teams fast nie ein Heimspiel; laufende Saisons ohne Kennzeichen behalten ihn.

**Ausfälle in der Manager-Saison** (`src/lib/manager.ts`: `rollAbsences`, `coverAbsences`): Nach jedem Spieltag
kann sich ein eingesetztes Pokémon verletzen (3 %, 1–3 Spieltage) oder Rot sehen (1 %, 1 Spieltag gesperrt) –
deterministisch aus dem Liga-Seed, gespeichert in `ManagerState.out`. Automatische Aufstellungen und CPU-Teams
lassen Ausfälle draußen; eigene Aufstellungen bekommen zum Anpfiff den besten verfügbaren Ersatz.

**Pokal der Manager-Saison** (`ManagerState.cup`, `CUP_MATCHDAYS`): neben der Liga ein KO-Pokal mit 16 Teams
(alle gedrafteten, aufgefüllt mit den stärksten Auffüllteams, Auslosung aus dem Liga-Seed). Je eine Runde nach den
Spieltagen 4, 8, 12 und 16 – gleiche Aufstellungen und Tagesform, Remis → Elfmeterschießen, Finale neutral.
Nur in Saisons, die nach der Einführung starten. Nach jeder Runde zeigt die Pokal-Karte die schon feststehenden Paarungen der nächsten Runde (die Weitergekommenen der Reihe nach) samt „⚔️ Dein nächster Pokalgegner“; „🛤️ Dein Pokalweg“ listet die eigenen Runden mit Ergebnis aus eigener Sicht (Elfmeterschießen inklusive) und ✅/❌.

**Karriere** (`nextCareer`, `rematchTemplate(..., { career: true })`, `POST /api/drafts/:code/rematch` mit
`career: true`): Nach einer Manager-Saison „Nächste Saison“ – gleiche Teams mit ihren Kadern (inkl. Transfers) und
ihrer Optik, kein Draft: Der Host startet die Saison direkt (jedes Team stellt seine beste Elf auf). Liga-Stufe 1–3
(`DraftState.career`): Steht ein Mensch unter den ersten drei, steigt die Liga auf, stehen alle Menschen auf den
letzten drei Plätzen, ab; die Auffüllteams sind je Stufe stärker bzw. schwächer (`CAREER_TIER_SHIFT`). In der
Karriere-Lobby kann niemand neu beitreten, und nur Name, Sichtbarkeit und Takt lassen sich ändern. Die Status-Karte listet die früheren Saisons des eigenen Teams („Bisher: S1 Liga 2: Platz 2 · …“) und zählt mit „🏅 n× Platz 1“ die gewonnenen Ligen.

**Live-Spieltag** (`src/lib/liveMatchday.ts`): Der Server spielt jeden Manager-Spieltag zum Anpfiff aus; die Seite
lässt ihn danach in Echtzeit ablaufen (bis 4 Minuten bzw. 40 % des Takts) – Minute aus der Serverzeit, also für
alle gleich, Tore zu ihrer Spielminute, Tabelle live. Währenddessen kein Spieler des Spieltags und keine
Wiedergabe; Hinweise verraten das Ergebnis nicht.

**Trikotnummern** (alle Modi, `src/lib/jerseys.ts`, `src/components/JerseyEditor.tsx`): Ohne eigene Wahl gilt
eine Vorgabe nach Position (Torwart 1, Abwehr 2–5, Sechser 6, Zehner 10, Stürmer 9 …). Jedes Team kann seinen
Pokémon Nummern von 1 bis 99 geben – je Team eindeutig (belegte Nummern tauschen), die Nummer hängt am Pokémon,
nicht an der Position. Builder: im Zustand und in „Meine Teams“; Online-Draft/Manager-Saison: Feld `jerseys` am
Team (Nachricht `jerseys`, nach dem Draft); Challenges und lokaler Draft: im Browser (`useJerseys`). Reine Optik
auf Feld, Bild, 2D-Wiedergabe und im Spielbericht (Torschützen mit Nummer) – Wertung und Rangliste kennen
keine Nummern. Der Knopf „Pokédex-Nummern“ vergibt die letzten beiden Ziffern der Pokédex-Nummer, „🎲 Würfeln“ zufällige eindeutige Nummern (`randomJerseys`); der Teilen-Link
des Builders trägt eigene Nummern im Parameter `nr`.

**Trikotfarben** (alle Modi, `src/lib/kits.ts`, `src/components/KitPicker.tsx`): je Team eine Heim- und eine
Auswärtsfarbe aus 10 Farben. In der 2D-Ansicht spielt das Heimteam in Heimfarbe, der Gast ebenfalls – außer
beide gleich, dann in seiner Auswärtsfarbe (notfalls eine Ausweichfarbe). Gespeichert wie die Trikotnummern
(Builder-Zustand, `DraftTeam.kit` mit Nachricht `kit`, im Browser je Challenge bzw. im lokalen Draft). Dazu ein **Torjubel**
(`src/lib/cheer.ts`, bis 40 Zeichen, Nachricht `cheer`), der in der 2D-Ansicht unter „TOR!“ erscheint – frei getippt oder aus fünf Vorschlägen angetippt.

**Vereinswappen** (alle Modi, `src/lib/crest.ts`, `src/components/Crest.tsx` + `CrestEditor.tsx`): Form, Muster,
zwei Farben (mit „⇄ Farben tauschen“) und ein Symbol bzw. ein Pokémon aus dem eigenen Team als Wappentier. Zu sehen neben dem Teamnamen
(Builder, Bild, Saisonbilanz), in Tabellen, im Spielbericht und auf der 2D-Anzeigetafel; online als
`DraftTeam.crest` (Nachricht `crest`).

**Kapitän** (alle Modi): seine Passung zählt im Team-Score doppelt (`captainWeight`). Challenges: beim
Abschluss (Server prüft, `entry_captains`); Builder/Testspiel: im Zustand und im Teilen-Link (`k`); Online-Draft:
im Draft und im Vorlauf bis zum Anpfiff (Nachricht `captain`; der Host kann mit `kickoff` sofort anpfeifen; die Karte nennt Favorit, eigenen Rang und „Dein Draft: Ø Fit · bester Pick“), Manager-Saison: jederzeit, zählt ab dem nächsten
Anpfiff. Wer nach dem letzten Pick keinen hat (CPU oder vergessen), bekommt den bestpassenden Spieler (`cpuCaptain`).

## Trainer & Erfolge

**Erfolge** (`/trainer`, `src/lib/achievements.ts`, `server/achievements.ts`): `POST /api/me` rechnet aus den Runs
(Anzahl, Siege, perfekte Saisons), der Tageswertung (Serie, Tagessiege), den Allzeit-Plätzen und den fertigen
Online-Ligen (`draft_results`, schreibt der Draft-Raum am Saisonende) die Erfolge des Geräts – jeder bringt Münzen (Fortschrittsbalken mit dem Namen des Erfolgs für Screenreader; „Nur offene“ blendet geschaffte aus und nennt die noch offenen Münzen; „Deine Bilanz“ zeigt Runs, Tages-Serie, Tagessiege, besten Platz, Online-Ligen, Titel, Podestplätze und perfekte Saisons). Zusatzzeilen je Liga (Format shiny, captain, goal, blitz, clean, goals, hattrick, duo, streak, rout) zählen nur für ihren Erfolg, z. B. „Blitzdrafter“ (5 Blitz-Picks ⚡, `fastPickCounts`), „Bollwerk“ (10 Spiele ohne Gegentor), „Torfabrik“ (80 eigene Tore; beide zeigt die Manager-Saison ab 3 Zu-null-Spielen bzw. 30 Toren mit dem, was noch fehlt) „Hattrick-Held“ (ein eigener Hattrick) „Traumduo“ (fünf Tore derselben Vorlage-Kombination in einer Liga) , „Siegesserie“ (sieben Siege in Folge; die Manager-Saison zeigt ab drei Siegen in Folge, wie viele noch fehlen) oder „Schützenfest“ (ein Sieg mit fünf Toren Unterschied; die Manager-Saison zeigt ab 3 Toren Abstand den höchsten Sieg und was noch fehlt).
Dafür gibt es Cosmetics für den selbst gestalteten **Trainer** (`src/lib/trainer.ts`, Pixel-Art 32 × 32 aus `src/lib/trainerPixels.ts`, als SVG in
`src/components/TrainerAvatar.tsx`): Haut, Frisur, Haarfarbe, Kleidung, Kopfbedeckung, Accessoire, Hintergrund,
Begleiter-Pokémon (auf der Trainerkarte mit Namen, „mit Pikachu“) und Titel. `POST /api/me/buy` kauft atomar (nur wenn die Münzen nach allen Käufen reichen,
`trainer_items`), `POST /api/me/trainer` speichert den Look (`trainers`, nur Freies und Gekauftes).
**Saisonartikel** (`season` im Katalog, `itemOnSale`): nur in ihrem Zeitraum kaufbar (Halloween 1.10.–7.11.,
Weihnachten 1.12.–6.1., Frühling/Ostern 20.3.–30.4., Sommer 21.6.–31.8., Neujahr 27.12.–10.1., Valentinstag 7.–14.2., Herbst 1.–30.9., Fußball-Sommer 1.6.–20.7., Oktoberfest 16.9.–6.10., Karneval 1.2.–10.3., Muttertag 1.–14.5., Schulanfang 1.8.–15.9., Sankt Martin 1.–11.11., Nikolaus 1.–6.12., Erntedank 25.9.–10.10., Winterzauber 11.–31.1., Advent 20.–30.11., Weltkindertag 16.–22.9., Tag der Erde 18.–24.4., Pokémon Day 20.–27.2., Tag der Ozeane 5.–11.6., Weltbienentag 17.–23.5., Tag des Baumes 25.–30.4., Weltlachtag 1.–7.5., Weltkatzentag 5.–11.8., Tag der Freundschaft 27.7.–2.8., Welthundetag 22.–28.8., Fête de la Musique 18.–24.6., Weltumwelttag 1.–5.6.: Keimling und Unratütox, Welttag des Buches 20.–26.4.: Offenes Buch und Icognito, Weltspartag 25.–31.10.: Sparschwein und Gierspenst, Tag der Familie 15.–21.5.: Kochmütze und Famieps, Weltpinguintag 21.–27.4.: Pinguinmütze und Plinfa), sonst `400 not_on_sale`; Gekauftes bleibt tragbar. Der Shop nennt die laufenden Saisons, „⏭️ Als Nächstes im Shop“ (`nextSeason`) und den Sammelstand „🛍️ Gesammelt: n von m Artikeln“ (`shopCollection`, nur kaufbare).

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
