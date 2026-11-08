/** Vibrazione brevissima di conferma (Android; su iPhone il browser non lo permette e non succede nulla). */
export function haptic(ms = 12): void {
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    navigator.vibrate?.(ms);
  } catch { /* non disponibile */ }
}
