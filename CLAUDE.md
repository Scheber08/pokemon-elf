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

## Offene Ideen (Stand 2026-10-13, Besitzer hat noch nicht gewählt)

1. Testspiel gegen ein Ranglisten-Team (Knopf im Team-Dialog der Rangliste)
2. Revanche im Online-Draft + „ewige Tabelle“ einer Gruppe
3. Browser-Benachrichtigung „Du bist dran“ (zusätzlich zum Gong)
4. Kleinere: Tägliche-Elf-Serie/Archiv, Spielerprofil, Link-Vorschau (OG-Tags), Routen nachladen
   (Bundle ~600 kB), PWA, ungenutzte deutsche Labels in `src/config/positions.ts` entfernen
