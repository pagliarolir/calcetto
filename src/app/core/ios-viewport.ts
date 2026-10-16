/**
 * App installata su iPhone con barra di stato "black-translucent" (serve a mostrare il verde
 * dietro l'orologio): WebKit accorcia l'area utile dell'altezza della barra di stato ma la
 * disegna dal bordo superiore, quindi ciò che è fissato in basso resta sollevato e lascia una
 * fascia vuota (bug WebKit 236445).
 *
 * Misuriamo lo scarto tra schermo e area utile e lo esponiamo come --vp-gap, usato dalla barra
 * di navigazione e dagli altri elementi in basso. Se Apple corregge il bug lo scarto diventa 0
 * e la correzione si spegne da sola.
 */
export function watchIosViewportGap(): void {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone =
    matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (!ios || !standalone) return;

  let current = -1;
  let frame = 0;
  const update = () => {
    const portrait = window.innerHeight > window.innerWidth;
    const screenHeight = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    const gap = Math.round(screenHeight - window.innerHeight);
    // Si accettano solo scarti plausibili per una barra di stato (0-80 punti). Valori diversi,
    // come con la tastiera aperta, sono momentanei: si tiene l'ultimo valore buono, così la
    // barra non si muove.
    if (gap < 0 || gap > 80 || gap === current) return;
    current = gap;
    document.documentElement.style.setProperty('--vp-gap', `${gap}px`);
  };
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  };

  update();
  addEventListener('resize', schedule);
  addEventListener('orientationchange', () => setTimeout(schedule, 300));
}
