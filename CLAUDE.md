# Pokémon Elf – Arbeitsregeln für Claude

Deutsche Web-App (React 19 + Vite + TypeScript), Backend als Cloudflare Worker (`worker/index.ts` →
`server/`), D1-Datenbank `DB`, Durable Object `DraftRoom` für den Online-Draft. Überblick, Spielmodi und
Deploy stehen in der README.

## Deploy & Git

- **Jeder Push auf `main` geht live** (Cloudflare Workers Builds deployt automatisch). Der Besitzer will
  laufend pushen – direkt auf `main`, **ein Commit + Push pro Feature** („jedes Feature einzeln“, „kleine
  Happen“), nie mehrere Features in einem Commit und nie Halbfertiges.
- Vor jedem Push: `npx tsc --noEmit -p tsconfig.json`, `npx tsc --noEmit -p tsconfig.worker.json`,
  `npx vitest run`, `npm run build` – alles grün. Laufen mehrere Features parallel im Arbeitsbaum, nur die
  Dateien des Features stagen und den gestagten Stand isoliert prüfen (z. B. `git checkout-index -a
  --prefix=<tmp>/` + node_modules-Link, dort tsc/vitest/build).
- Commit-Nachrichten auf Deutsch, Betreff = Feature, Stichpunkte im Body.

## Unveränderliches / Kompatibilität

- **D1-Schema nur additiv**: `server/schema.ts` (`ensureSchema`) muss `migrations/0001_init.sql` exakt
  entsprechen (`tests/schema.test.ts`). Die Live-Datenbank existiert – keine Spalten umbenennen/löschen.
- **Laufende Online-Ligen** liegen als Zustand im Durable Object: Änderungen an `DraftSettings`/`DraftState`
  brauchen `upgradeSettings`/`upgradeState` (`src/lib/draftEngine.ts`), alte Felder werden akzeptiert und in
  Schnappschüssen gespiegelt (alte, noch offene Tabs). Durable-Object-Migrationen (`wrangler.jsonc`)
  wendet nur `wrangler deploy` von `main` an.
- Engines sind deterministisch und werden von Client **und** Server genutzt (`challengeEngine`,
  `draftEngine`, `season`, `runCompute`): kein `Math.random`/keine Uhr darin, Zufall nur aus Seeds.
  Der Liga-Seed des Online-Drafts ist geheim (nie in Schnappschüssen).
- Gespeicherte Daten (Vereinsnamen, Teamnamen, Server-Fehlermeldungen) bleiben deutsch; übersetzt wird
  erst bei der Anzeige.

## Sprachen (DE/EN)

- Alle UI-Texte in `src/i18n/de/<bereich>.ts` (Quelle) und `src/i18n/en/<bereich>.ts` (typgeprüft, gleiche
  Form). In Komponenten `useT()`, außerhalb von React `messages()`. Pokémon-, Positions-, Typ-, Regions- und
  Vereinsnamen über `t.game.*`.
- Tests laufen fest auf Deutsch (`tests/setup.ts`); neue Texte immer in beiden Sprachen.

## Tests

- Vitest, `node:sqlite`-Shim für D1 (`tests/d1shim.ts`, braucht Node ≥ 22.5), Render-Tests auf dem
  Mini-DOM (`tests/miniDom.ts`). Wegwerf-Tests (`tests/_*.test.ts`) vor dem Commit löschen.
- Lokal mit echtem Worker: `npm run dev:cf` (Port 8788). Nach `npm run build` den Dev-Server neu starten,
  sonst liefert er alte Asset-Hashes aus.

## Offene Ideen (Stand 2026-10-15)

Erledigt (siehe README): Ultrabestien/Megas/Formen, Revanche + ewige Tabelle, Benachrichtigung „Du bist
dran", Testspiel, Spielerprofil, Wochenwertung, Tägliche-Elf-Serie, OG-Tags (auch je Liga), Routen
nachladen, PWA, Wunschliste, Emoji-Reaktionen, Vorlagen und Draft-Noten im Draft, Rückgängig,
Fit-Sortierung und „Beste Elf" im Builder, Wochenwertung rückwirkend gefüllt, Schnäppchen des Drafts,
„Deine Duelle", Allzeit-Platz im Profil, Taste „/" im Draft, Noten in der lokalen Liga, QR-Code in der Lobby,
Saison auf 18 Teams mit Ranglisten-Teams aufgefüllt, KO-Turnier mit optionaler Gruppenphase, Draft-Spielmodell
(Tagesform, Torminuten), Formkurve, Saisonrekorde, Saisonverlauf, „Meine Teams" im Builder, Manager-Saison
(Bank, Spieltage im Takt, Aufstellung, Tagesform je Pokémon), Erfolge mit Münzen, eigener Trainer mit
Cosmetics-Shop (auch in Rangliste, Profil und Draft), Transfermarkt und Erinnerung vor dem Anpfiff in der
Manager-Saison, eigener Menüpunkt „Manager", Spielbericht + 2D-Wiedergabe in allen Modi (einstellbar),
Erfolge für die Manager-Saison, Hinweis „Erfolg freigeschaltet" nach Runs und Ligen, Saisonartikel im Shop
(Halloween, Weihnachten, Frühling/Ostern, Sommer, Neujahr, Valentinstag, Herbst, Fußball-Sommer, Oktoberfest, Karneval, Muttertag, Schulanfang, Sankt Martin, Nikolaus, Erntedank, Winterzauber, Advent), Spieler des Spieltags, Tausch-Angebote zwischen Teams in der Manager-Saison,
Trikotnummern in allen Modi,
Kapitän in allen Modi (zählt doppelt; Rangliste dafür einmalig neu gestartet), Trikotfarben, Torjubel und Vereinswappen in allen Modi, Verletzungen, Sperren, Pokal und Karriere (Auf-/Abstieg) und Live-Spieltag in der Manager-Saison, Shinys im Draft (an/aus/Party, auch vom Transfermarkt, Erfolg „Shiny-Sammler“), Kapitän im Vorlauf nach dem letzten
Pick (automatisch der bestpassende, „Beste Wahl“, Ersatzkapitän der CPU), „Mit CPU auffüllen“ und „🎲 Überraschung“-Vorlage in der Lobby, „🎲 Zufällige Formation“ beim eigenen Team (Erstellen und Lobby), Schnellstart-Vorlagen und Pick-Uhr (30/60/90 s, Auto-Pick) auch im lokalen Draft, Vibration bei
knapper Pick-Zeit, Shinys und Pokalsiege im Profil, Karriere-Verlauf, „Ich bin bereit“ (mit „✅ … ist bereit“) und „👋 … ist dabei“/„🚪 … nicht mehr dabei“ in der Lobby, Wunschliste mit
Taste W/„★ Wunsch n“/Vergebene entfernen/💔 bei weggeschnapptem Wunsch, sortierbare Kader-Tabelle mit Toren, Vorlagen und Scorerpunkten, 🔮 Tipp aufs eigene Spiel in der Manager-Saison (mit 🔥 Tipp-Serie), Ø Tagesform der Startelf in der Aufstellung, Teambild, Meister-Konfetti und „Ergebnis teilen“ auch im lokalen Draft, „📱 Gerät weitergeben“ im Hot-Seat, „sucht noch: …“ beim CPU-Zug und Favorit/Team-Score-Rang bei der Kapitänswahl im lokalen Draft,
alle Picks und bester Kapitän im Ergebnis, Erfolge „Spielführer“, „Blitzdrafter“, „Bollwerk“, „Torfabrik“ und „Hattrick-Held“, Ø Fit auf dem Board (👑 am besten Team, Typ-Elf-Chip, 🌈 Typen-Regenbogen ab 10 Typen), Position/Fit, „Run“, ⚡ Blitz-Pick (≤ 5 s, eigene Anzahl in der Statusleiste) 🏅 bester Fit (eigener mit Hinweis) und ★/UB/M (Legendär, Ultrabestie, Mega; auch in „Alle Picks“, dort mit 🏅 bestem Pick jeder Runde) im
Pick-Verlauf (online und lokal), offene Positionen im Wartehinweis, Pool-Größe und „⭐ Stars im Pool“ (Top 5 mit bester Position) in der Lobby und im lokalen Setup („Wo landeten die Stars?“ im Ergebnis, online und lokal), weitere Saisonrekorde (Weiße Weste ab 3 Spielen ohne Gegentor, Blitz-König ab 3 Blitz-Picks, Hattricks, Größtes Comeback, Herbstmeister,
Rückrunde, Überraschung/Enttäuschung, torreichstes Spiel, Remis-König), nächster Gegner im Ticker, Formations-Tipp,
beste Position der Bankspieler, Punkte-Hochrechnung und Torjäger des Gegners in der Manager-Saison, Elf der Saison (auch als Bild,
lokal und online), Heim-/Auswärtstabelle, Tabellen-Zonen mit Legende, Spieler des Spieltags, 🎩 Hattricks (auch Manager-Saison), 💥 Kantersieg, 🔄 Comeback (beide auch Manager-Saison) und Last-Minute-Sieg
im Ticker, Führungsserie, Favorit und „Dein Draft“ (Ø Fit, bester Pick) vor dem Anpfiff, Vorschau der nächsten Picks, Taste V/„Vorschlag“ auch lokal, Taste R für „🎲 Zufall“, „🎲 Zufall“ (online und lokal), „🐍 Doppelpick“ an der Snake-Wende (online und lokal), 🏁 in der letzten Draft-Runde (online und lokal), „★ n“ freie Legendäre im Pool-Kopf (online und lokal; online auch „UB n“/„M n“),
ausgeglichenes Heimrecht im Manager-Spielplan, lokale Liga mit Heim/Auswärts, Pick-Verlauf (alle Picks, Rückgängig, Schnäppchen), Saisonrekorden, Meisterchancen, Zeitreise, Kreuztabelle, Duellen,
Revanche und Titelsammlung, „Reihenfolge mischen“ (Lobby und lokal) und „Deine Picks“ (eigene Pick-Nummern bei fester Reihenfolge, lokal je menschlichem Team), „Beste Freie“ je offener Position (lokal und online), Restdauer und CPU-Stärke (`cpuLevel`) im Online-Draft, Bedarf des nächsten Teams und gestrichelte Board-Spalte (online und lokal), 🤖 wahrscheinlicher Pick der nächsten CPU im Online-Draft, 🔔 Rundenende mit Top-Pick im lokalen Draft, 🏆 rechnerischer Titelkampf in der Manager-Saison, 🎯 Tor-Marken eigener Spieler in der Manager-Saison, Restprogramm mit den nächsten drei Gegnern, Abstand zur Abstiegszone, Serie (`currentRun`) und Spielort-Bilanz, Formation und Kapitän des Gegners, Topspiel und Kellerduell, eigener Torjäger mit Platz in der Torjägerliste und eigene Bilanz mit 🧤 in der Manager-Saison, Serie, Abstand zur Spitze und 🧤 Spiele ohne Gegentor im Ticker, „Neuer Tabellenführer“ in Ticker und Manager-Saison, 🧤 Spiele ohne Gegentor in den Teamwerten. Ligagegner der Challenge-Saisons und CPU-Teams im lokalen Draft (auch 🎲), im Online-Draft und in der Manager-Saison mit Namen aus den Online-Ranglisten (`rankingNames`, Server: `rankingCpuNames`).

1. Weitere Saisons im Shop (z. B. Fasten-/Zuckerfest, Weltkindertag) – neue Einträge mit `seasonal(...)` in `src/lib/trainer.ts`
2. Shiny-Party-Badge in der Liste öffentlicher Lobbys (braucht Feld in der Lobby-Zeile – Schema nur additiv)

## Daten

- `public/data/pokemon.json` (1.025, `npm run data`) ist Basis aller Challenges und der Skala – nicht ändern.
- `public/data/forms.json` (`npm run data:forms`, aus den PokeAPI-CSV auf GitHub): Megas, Regional- und
  Sonderformen mit IDs ab 10001, `base` = Art. Nur Builder und Online-Draft (`DRAFT_LIST`) nutzen sie.
