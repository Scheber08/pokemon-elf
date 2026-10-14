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

## Offene Ideen (Stand 2026-10-14)

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
(Halloween, Weihnachten, Frühling/Ostern, Sommer, Neujahr, Valentinstag), Spieler des Spieltags, Tausch-Angebote zwischen Teams in der Manager-Saison,
Trikotnummern in allen Modi,
Kapitän in allen Modi (zählt doppelt; Rangliste dafür einmalig neu gestartet), Trikotfarben, Torjubel und Vereinswappen in allen Modi, Verletzungen, Sperren und Pokal in der Manager-Saison.

1. Weitere Saisons im Shop (z. B. Fußball-Sommer, Oktoberfest) – neue Einträge mit `seasonal(...)` in `src/lib/trainer.ts`

## Daten

- `public/data/pokemon.json` (1.025, `npm run data`) ist Basis aller Challenges und der Skala – nicht ändern.
- `public/data/forms.json` (`npm run data:forms`, aus den PokeAPI-CSV auf GitHub): Megas, Regional- und
  Sonderformen mit IDs ab 10001, `base` = Art. Nur Builder und Online-Draft (`DRAFT_LIST`) nutzen sie.
