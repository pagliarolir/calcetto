import { lenisFor } from './smooth-scroll';
/**
 * Lo scorrimento non avviene sulla finestra ma nel riquadro interno dell'app shell (vedi app.ts):
 * il documento resta sempre alto quanto lo schermo, così su iPhone la barra in basso non si muove
 * quando una pagina carica e cambia altezza. Per scorrere via codice usare queste funzioni.
 */
export function appScroller(): HTMLElement | null {
  // nelle pagine con la parte alta fissa scorre il contenitore centrale, non tutto il riquadro
  return document.querySelector<HTMLElement>('.app-scroller .scroll-area') ?? document.querySelector<HTMLElement>('.app-scroller');
}

export function scrollAppTo(top: 'start' | 'end', behavior: ScrollBehavior = 'smooth'): void {
  const el = appScroller();
  if (!el) return;
  // con mouse o trackpad scorre Lenis (core/smooth-scroll.ts): stessa curva dello scorrimento con la rotella
  const lenis = lenisFor(el);
  if (lenis) { lenis.scrollTo(top === 'start' ? 0 : el.scrollHeight, { immediate: behavior !== 'smooth', duration: 0.6 }); return; }
  el.scrollTo({ top: top === 'start' ? 0 : el.scrollHeight, behavior });
}
