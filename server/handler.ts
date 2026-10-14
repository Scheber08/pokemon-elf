/**
 * Einstieg des Backends: Routing, CORS und Fehlerbehandlung für /api/*.
 * Wird von worker/index.ts (Cloudflare Worker) bzw. functions/api/[[route]].ts
 * (Cloudflare Pages Functions) aufgerufen und in tests/server.test.ts direkt getestet.
 */
import type { HealthResponse } from '../src/lib/api/contract';
import { buyItem, me, saveTrainer } from './achievements';
import { draftRoute, draftsUnavailable } from './drafts';
import { entryDetail, finishRun, health, leaderboard, playerProfile, renamePlayer, startRun } from './endpoints';
import type { Env } from './env';
import { ApiError, corsHeaders, errorResponse, json, preflight, withHeaders } from './http';
import { ensureSchema } from './schema';

export type { Env } from './env';

type Route = (request: Request, env: Env, url: URL) => Response | Promise<Response>;

/** Health mit Zusatzfunktionen: features nur, wenn der Online-Draft (Binding DRAFTS) verfügbar ist. */
async function healthWithFeatures(env: Env): Promise<Response> {
  const res = health();
  if (!env.DRAFTS) return res;
  const body: HealthResponse = { ...((await res.json()) as HealthResponse), features: { drafts: true } };
  return json(body);
}

const ROUTES: Record<string, { method: 'GET' | 'POST'; run: Route }> = {
  '/api/health': { method: 'GET', run: (_req, env) => healthWithFeatures(env) },
  '/api/runs/start': { method: 'POST', run: (req, env) => startRun(req, env) },
  '/api/runs/finish': { method: 'POST', run: (req, env) => finishRun(req, env) },
  '/api/leaderboard': { method: 'GET', run: (_req, env, url) => leaderboard(url, env) },
  '/api/player': { method: 'POST', run: (req, env) => renamePlayer(req, env) },
  '/api/me': { method: 'POST', run: (req, env) => me(req, env) },
  '/api/me/trainer': { method: 'POST', run: (req, env) => saveTrainer(req, env) },
  '/api/me/buy': { method: 'POST', run: (req, env) => buyItem(req, env) },
};

/** GET /api/entries/:id – die ID prüft der Endpunkt (ungültig → 400), Unterpfade gibt es nicht. */
const ENTRY_PATH_RE = /^\/api\/entries\/([^/]+)$/;
const PLAYER_PATH_RE = /^\/api\/entries\/([^/]+)\/player$/;

/** Routen mit Parameter im Pfad (außer dem Online-Draft). */
function paramRoute(path: string): { method: 'GET' | 'POST'; run: Route } | null {
  const entry = ENTRY_PATH_RE.exec(path);
  if (entry) return { method: 'GET', run: (_req, env) => entryDetail(entry[1], env) };
  const player = PLAYER_PATH_RE.exec(path);
  if (player) return { method: 'GET', run: (_req, env) => playerProfile(player[1], env) };
  return null;
}

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, '');
  const fixed = ROUTES[path] ?? paramRoute(path);
  const draft = fixed ? null : draftRoute(path);
  const target = fixed ?? draft;
  if (!target) throw new ApiError(404, 'not_found', 'Diesen API-Pfad gibt es nicht');
  // Ohne Durable-Object-Binding (z. B. Cloudflare Pages) gibt es keinen Online-Draft.
  if (draft && !env.DRAFTS) throw draftsUnavailable();
  if (request.method !== target.method) {
    throw new ApiError(405, 'method_not_allowed', `Methode ${request.method} ist hier nicht erlaubt`, {
      Allow: target.method,
    });
  }
  // Ohne (funktionierende) Datenbank meldet auch /api/health einen Fehler – die App spielt dann lokal.
  if (!env.DB) throw new Error('D1-Binding "DB" fehlt');
  await ensureSchema(env.DB);
  return target.run(request, env, url);
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(request, env.ALLOWED_ORIGINS);
  if (request.method === 'OPTIONS') return preflight(cors);
  let res: Response;
  try {
    res = await route(request, env, new URL(request.url));
  } catch (err) {
    if (err instanceof ApiError) {
      res = errorResponse(err);
    } else {
      console.error('API-Fehler', err);
      res = errorResponse(new ApiError(500, 'server_error', 'Interner Serverfehler – bitte später erneut versuchen'));
    }
  }
  // WebSocket-Upgrade (101) unverändert durchreichen – eine neu gebaute Response verlöre den Socket.
  if (res.status === 101) return res;
  return withHeaders(res, cors);
}
