/**
 * Cloudflare Worker (Workers + Static Assets): /api/* geht ans Backend in server/,
 * alles andere liefert Cloudflare direkt aus dist/ aus – unbekannte Pfade fallen auf
 * index.html zurück (wrangler.jsonc: not_found_handling = "single-page-application").
 * Für Cloudflare Pages gibt es alternativ functions/api/[[route]].ts.
 */
import { handleApi, type Env as ApiEnv } from '../server/handler';

interface WorkerEnv extends ApiEnv {
  DB: D1Database;
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
