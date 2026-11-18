/**
 * Ritorno in primo piano: `fn` parte quando l'app torna visibile dopo essere rimasta nascosta almeno `minHiddenMs`.
 * Un'occhiata veloce a un'altra app (o alla notifica) non fa ripartire le richieste; una pausa vera sì.
 * Restituisce la funzione per smettere di ascoltare.
 */
export function onForeground(fn: () => void, minHiddenMs = 30_000): () => void {
  let hiddenAt = document.visibilityState === 'hidden' ? Date.now() : 0;
  const handler = () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt >= minHiddenMs) fn();
    hiddenAt = 0;
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}

/** true se l'app è in primo piano: i controlli periodici saltano il giro quando nessuno la guarda */
export function inForeground(): boolean {
  return document.visibilityState === 'visible';
}
