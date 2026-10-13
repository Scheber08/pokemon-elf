/**
 * Einstieg des Backends: Routing, CORS und Fehlerbehandlung für /api/*.
 * Wird von worker/index.ts (Cloudflare Worker) bzw. functions/api/[[route]].ts
 * (Cloudflare Pages Functions) aufgerufen und in tests/server.test.ts direkt getestet.
 */
import type { HealthResponse } from '../src/lib/api/contract';
import { draftRoute, draftsUnavailable } from './drafts';
import { finishRun, health, leaderboard, renamePlayer, startRun } from './endpoints';
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
};

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, '');
  const fixed = ROUTES[path];
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
