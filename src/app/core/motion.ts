/**
 * Animazioni con GSAP (scelta del proprietario, vedi CLAUDE.md).
 * GSAP non sta nel pacchetto iniziale: si scarica dopo l'avvio, quando l'app è libera (core/prefetch.ts),
 * e comunque alla prima animazione. Le animazioni non partono mai al primo disegno e con «riduci movimento»
 * non partono affatto: chi chiama controlla `motionOk()` prima.
 */
import type { gsap as Gsap } from 'gsap';
import type { Flip as GsapFlip } from 'gsap/Flip';

export interface Motion {
  gsap: typeof Gsap;
  Flip: typeof GsapFlip;
}

/** la curva unica dell'app (--ease in styles.scss: cubic-bezier(0.22, 1, 0.36, 1)) */
export const EASE = 'gdl';
/** uscita veloce (prima metà del giro degli strumenti) */
export const EASE_IN = 'gdl-in';

let loading: Promise<Motion> | null = null;
let ready: Motion | null = null;

export function motionOk(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: no-preference)').matches;
}

/** scarica GSAP (una volta sola) */
export function loadMotion(): Promise<Motion> {
  loading ??= Promise.all([import('gsap'), import('gsap/Flip'), import('gsap/CustomEase')]).then(([g, f, c]) => {
    g.gsap.registerPlugin(f.Flip, c.CustomEase);
    c.CustomEase.create(EASE, '0.22,1,0.36,1');
    c.CustomEase.create(EASE_IN, '0.4,0,1,1');
    g.gsap.defaults({ ease: EASE, duration: 0.32 });
    ready = { gsap: g.gsap, Flip: f.Flip };
    return ready;
  });
  return loading;
}

/** GSAP se è già pronto, altrimenti null (e intanto lo scarica): per le misure che vanno prese subito, come in Flip */
export function motionNow(): Motion | null {
  if (!ready) void loadMotion();
  return ready;
}

/**
 * «Flip» della pagina (strumenti del Leader, Confronta): il contenuto dentro `.scroll-area` gira di 90°, cambia,
 * e rientra dall'altro lato. La prospettiva sta dentro l'animazione; la barra e l'intestazione non si muovono.
 * Con «riduci movimento» cambia e basta.
 */
export async function pageFlip(el: HTMLElement | null | undefined, change: () => unknown): Promise<void> {
  const m = el && motionOk() ? await loadMotion() : null;
  if (!m || !el) { await change(); return; }
  const base = { transformPerspective: 1400, transformOrigin: '50% 30%' };
  await m.gsap.to(el, { ...base, rotationY: 90, opacity: 0.6, duration: 0.18, ease: EASE_IN });
  await change();
  await m.gsap.fromTo(el, { ...base, rotationY: -90, opacity: 0.6 },
    { ...base, rotationY: 0, opacity: 1, duration: 0.26, ease: EASE, clearProps: 'transform,opacity' });
}
