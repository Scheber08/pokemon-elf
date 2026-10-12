/**
 * HTTP-Helfer: JSON-Antworten, API-Fehler und CORS.
 */
import type { ApiErrorBody, ApiErrorCode } from '../src/lib/api/contract';

/** Fehler, der als ApiErrorBody mit passendem Status beim Client ankommt. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (message: string) => new ApiError(400, 'bad_request', message);

const BASE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS, ...headers } });
}

export function errorResponse(err: ApiError): Response {
  const body: ApiErrorBody = { error: err.code, message: err.message };
  return json(body, err.status, err.headers);
}

/** Erlaubte Origins aus ALLOWED_ORIGINS („https://a.de, https://b.de"). */
function allowedOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * CORS-Header für diese Anfrage. Ohne ALLOWED_ORIGINS gilt nur same-origin
 * (keine Header); sonst bekommt ein eingetragener Origin seine Freigabe.
 */
export function corsHeaders(request: Request, rawAllowed: string | undefined): Record<string, string> {
  const allowed = allowedOrigins(rawAllowed);
  if (!allowed.length) return {};
  const origin = request.headers.get('Origin');
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

/** Antwort auf einen CORS-Preflight (OPTIONS). */
export function preflight(cors: Record<string, string>): Response {
  const headers: Record<string, string> = { ...cors, Allow: 'GET, POST, OPTIONS', 'Cache-Control': 'no-store' };
  if (cors['Access-Control-Allow-Origin']) {
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return new Response(null, { status: 204, headers });
}

/** Hängt zusätzliche Header an eine fertige Antwort. */
export function withHeaders(res: Response, headers: Record<string, string>): Response {
  if (!Object.keys(headers).length) return res;
  const merged = new Headers(res.headers);
  for (const [k, v] of Object.entries(headers)) merged.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: merged });
}
