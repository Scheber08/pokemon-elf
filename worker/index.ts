/**
 * Cloudflare Worker (Workers + Static Assets): /api/* geht ans Backend in server/,
 * alles andere liefert Cloudflare direkt aus dist/ aus – unbekannte Pfade fallen auf
 * index.html zurück (wrangler.jsonc: not_found_handling = "single-page-application").
 * Für Cloudflare Pages gibt es alternativ functions/api/[[route]].ts (ohne Online-Draft).
 */
import { handleApi, type Env as ApiEnv } from '../server/handler';
import type { DraftRoom } from '../server/draftRoom';

/** Durable Object des Online-Drafts (wrangler.jsonc: durable_objects → DRAFTS) */
export { DraftRoom } from '../server/draftRoom';

/** Echte Bindings – die Typprüfung stellt sicher, dass sie zu server/env.ts passen. */
interface WorkerEnv extends ApiEnv {
  DB: D1Database;
  /** Ein Draft-Raum pro Liga (idFromName(code)) */
  DRAFTS: DurableObjectNamespace<DraftRoom>;
  /** Statische Dateien aus dist/ */
  ASSETS: Fetcher;
}

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return handleApi(request, env);
    // Normalerweise beantwortet Cloudflare Nicht-API-Pfade schon vor dem Worker (run_worker_first).
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<WorkerEnv>;
