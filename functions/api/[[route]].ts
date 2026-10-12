/**
 * Cloudflare Pages Functions: alle Anfragen unter /api/* landen hier.
 * Die eigentliche Logik steckt in server/ (testbar ohne Cloudflare).
 */
import { handleApi, type Env } from '../../server/handler';

/** Echte Bindings – die Typprüfung stellt sicher, dass D1Database zu Env.DB passt. */
interface PagesEnv extends Env {
  DB: D1Database;
}

export const onRequest: PagesFunction<PagesEnv> = ({ request, env }) => handleApi(request, env);
