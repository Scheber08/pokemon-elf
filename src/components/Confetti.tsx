import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const COLORS = ['#ffcb05', '#e3350d', '#ffffff', '#3d7dca', '#43a047'];

/** Konfetti-Regen (Canvas) – wird bei 34–0 ausgelöst. Respektiert „reduzierte Bewegung". */
export function Confetti({ duration = 4500 }: { duration?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = ref.current;
    // Ohne Canvas-Unterstützung (z. B. Test-DOM) still nichts zeichnen
    const ctx = typeof canvas?.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
    };
    resize();
    window.addEventListener('resize', resize);

    const pieces = Array.from({ length: 180 }, () => ({
      x: Math.random() * window.innerWidth,
      y: -20 - Math.random() * window.innerHeight * 0.6,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      vx: -1.5 + Math.random() * 3,
      vy: 2 + Math.random() * 3.5,
      rot: Math.random() * Math.PI,
      vr: -0.15 + Math.random() * 0.3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = now - start;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.globalAlpha = t > duration - 800 ? Math.max(0, (duration - t) / 800) : 1;
      for (const p of pieces) {
        p.x += p.vx + Math.sin((t + p.y) / 400);
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot)));
        ctx.restore();
      }
      if (t < duration) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [duration]);

  return createPortal(<canvas ref={ref} className="confetti" aria-hidden="true" />, document.body);
}
