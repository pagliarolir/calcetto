/**
 * Lo scorrimento non avviene sulla finestra ma nel riquadro interno dell'app shell (vedi app.ts):
 * il documento resta sempre alto quanto lo schermo, così su iPhone la barra in basso non si muove
 * quando una pagina carica e cambia altezza. Per scorrere via codice usare queste funzioni.
 */
export function appScroller(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.app-scroller');
}

export function scrollAppTo(top: 'start' | 'end', behavior: ScrollBehavior = 'smooth'): void {
  const el = appScroller();
  if (!el) return;
  el.scrollTo({ top: top === 'start' ? 0 : el.scrollHeight, behavior });
}
