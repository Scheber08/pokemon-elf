/**
 * Bild-Export mit html2canvas.
 * Sprites werden vorher als Data-URL aufbereitet (Pixel-Sprites scharf hochskaliert),
 * damit der Export unabhängig von CORS-Caches und Bildglättung sauber aussieht.
 */
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { spriteKind, spriteUrls } from './sprites';
import type { SpriteSource } from '../components/Sprite';
import type { Pokemon, SpriteStyle } from '../types';

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Bild nicht ladbar: ${url}`));
    img.src = url;
  });
}

/**
 * Lädt ein Sprite (mit Fallbacks) und liefert eine Data-URL.
 * Pixel-Sprites werden mit ganzzahligem Faktor ohne Glättung vergrößert, Artwork verkleinert.
 */
export async function spriteDataUrl(p: Pokemon, style: SpriteStyle, pixelFactor = 4, artSize = 320): Promise<SpriteSource | null> {
  for (const url of spriteUrls(p, style)) {
    try {
      const img = await loadImage(url);
      const kind = spriteKind(url);
      const pixel = kind !== 'art';
      const factor = pixel ? pixelFactor : Math.min(1, artSize / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * factor);
      canvas.height = Math.round(img.naturalHeight * factor);
      const ctx = canvas.getContext('2d');
      if (!ctx) return { url, kind, scale: 1 };
      ctx.imageSmoothingEnabled = !pixel;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return { url: canvas.toDataURL('image/png'), kind, scale: factor };
    } catch {
      /* nächsten Kandidaten probieren */
    }
  }
  return null;
}

export async function spriteDataUrls(
  list: (Pokemon | null | undefined)[],
  style: SpriteStyle,
): Promise<Map<number, SpriteSource>> {
  const unique = [...new Map(list.filter((p): p is Pokemon => !!p).map((p) => [p.id, p])).values()];
  const entries = await Promise.all(unique.map(async (p) => [p.id, await spriteDataUrl(p, style)] as const));
  return new Map(entries.filter((e): e is readonly [number, SpriteSource] => !!e[1]));
}

async function waitForImages(root: HTMLElement) {
  const imgs = Array.from(root.querySelectorAll('img'));
  await Promise.all(
    imgs.map((img) =>
      img.complete && img.naturalWidth > 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          }),
    ),
  );
  if (document.fonts?.ready) await document.fonts.ready;
}

/** Rendert ein HTML-Element zu einem PNG-Blob. */
export async function nodeToPng(node: HTMLElement, options: { scale?: number; background?: string } = {}): Promise<Blob> {
  const { default: html2canvas } = await import('html2canvas');
  await waitForImages(node);
  const canvas = await html2canvas(node, {
    useCORS: true,
    backgroundColor: options.background ?? null,
    scale: options.scale ?? 1,
    logging: false,
  });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Export fehlgeschlagen'))), 'image/png'),
  );
}

/**
 * Rendert ein React-Element unsichtbar außerhalb des Viewports und exportiert es als PNG.
 * Eigene Wurzel ohne App-Kontext – Texte kommen in der aktiven Sprache (useSettings-Rückfall).
 */
export async function renderToPng(element: ReactElement, background = '#0d1b2a'): Promise<Blob> {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, { position: 'fixed', left: '-20000px', top: '0', pointerEvents: 'none' });
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(element));
    // Kurz warten, bis Layout und Bild-Handler gelaufen sind (bewusst ohne rAF – der pausiert in Hintergrund-Tabs).
    await new Promise((r) => setTimeout(r, 50));
    const target = host.firstElementChild as HTMLElement | null;
    if (!target) throw new Error('Nichts zu exportieren');
    return await nodeToPng(target, { background });
  } finally {
    root.unmount();
    host.remove();
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** Teilt Bild + Text über das Web Share API, sonst Download + Text in die Zwischenablage. */
export async function shareImage(blob: Blob, filename: string, text: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], filename, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text });
      return 'shared';
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'shared';
    }
  }
  downloadBlob(blob, filename);
  await copyText(text);
  return 'downloaded';
}
