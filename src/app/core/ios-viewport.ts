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

  const update = () => {
    const portrait = window.innerHeight > window.innerWidth;
    const screenHeight = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    const gap = screenHeight - window.innerHeight;
    // Solo scarti plausibili per una barra di stato: con la tastiera aperta non si compensa nulla.
    const px = gap > 0 && gap <= 80 ? gap : 0;
    document.documentElement.style.setProperty('--vp-gap', `${px}px`);
  };

  update();
  addEventListener('resize', update);
  addEventListener('orientationchange', () => setTimeout(update, 300));
}
