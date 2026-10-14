/**
 * Cloudflare Worker (Workers + Static Assets): /api/* geht ans Backend in server/,
 * alles andere liefert Cloudflare direkt aus dist/ aus – unbekannte Pfade fallen auf
 * index.html zurück (wrangler.jsonc: not_found_handling = "single-page-application").
 * Für Cloudflare Pages gibt es alternativ functions/api/[[route]].ts (ohne Online-Draft).
 */
import { handleApi, type Env as ApiEnv } from '../server/handler';
import {
  draftPageCode,
  draftPageMeta,
  lobbyPreview,
  profilePageId,
  profilePageMeta,
  profilePreview,
  type PageMeta,
} from '../server/preview';
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

/** Open-Graph-Tags und Titel in index.html ersetzen (HTMLRewriter streamt, ändert sonst nichts). */
function withMeta(page: Response, meta: PageMeta): Response {
  const set = (content: string) => ({
    element(el: Element) {
      el.setAttribute('content', content);
    },
  });
  return new HTMLRewriter()
    .on('meta[property="og:title"]', set(meta.title))
    .on('meta[property="og:description"]', set(meta.description))
    .on('meta[name="description"]', set(meta.description))
    .on('meta[property="og:image"]', set(meta.image))
    .on('title', {
      element(el) {
        el.setInnerContent(meta.title);
      },
    })
    .on('head', {
      element(el) {
        el.append(`<meta property="og:url" content="${meta.url.replace(/"/g, '&quot;')}" />`, { html: true });
      },
    })
    .transform(page);
}

/**
 * index.html mit eigener Vorschau (Liga: Name, Host, Teams; Profil: Name, Runs, bester Platz).
 * Scheitert die Abfrage (z. B. Tabelle noch nicht angelegt), gibt es die allgemeine Vorschau.
 */
async function pageWithMeta(request: Request, env: WorkerEnv, meta: (origin: string) => Promise<PageMeta>): Promise<Response> {
  const url = new URL(request.url);
  const page = await env.ASSETS.fetch(new Request(new URL('/', url), request));
  if (!page.ok || !page.headers.get('content-type')?.includes('text/html')) return page;
  const res = withMeta(page, await meta(url.origin));
  const headers = new Headers(res.headers);
  // Die Vorschau ändert sich mit Liga bzw. Rangliste – nicht lange zwischenspeichern
  headers.set('Cache-Control', 'public, max-age=60');
  return new Response(res.body, { status: res.status, headers });
}

async function orNull<T>(load: () => Promise<T | null>): Promise<T | null> {
  try {
    return await load();
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return handleApi(request, env);
    const code = request.method === 'GET' ? draftPageCode(pathname) : null;
    if (code) {
      return pageWithMeta(request, env, async (origin) => draftPageMeta(code, await orNull(() => lobbyPreview(env.DB, code)), origin));
    }
    const entryId = request.method === 'GET' ? profilePageId(pathname) : null;
    if (entryId) {
      return pageWithMeta(request, env, async (origin) =>
        profilePageMeta(entryId, await orNull(() => profilePreview(env.DB, entryId, Date.now())), origin),
      );
    }
    // Normalerweise beantwortet Cloudflare Nicht-API-Pfade schon vor dem Worker (run_worker_first).
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<WorkerEnv>;
