import changelog from '../../../public/changelog.json';

/**
 * Novità degli aggiornamenti. L'elenco sta in `public/changelog.json` (il più recente in cima, `id` che cresce di 1)
 * ed è compilato dentro l'app. Dopo un aggiornamento, alla prima apertura della nuova versione, `<app-changes-notice>`
 * mostra le voci con `id` più alto dell'ultimo visto su questo telefono (`gdl-changes-seen`); chi non ha mai visto
 * niente (prima installazione o prima versione con le Novità) vede le voci degli ultimi 30 giorni.
 */
export interface ChangeEntry { id: number; date: string; items: string[] }

const ENTRIES = changelog as ChangeEntry[];
const KEY = 'gdl-changes-seen';

/** id dell'ultima novità compresa in questa versione dell'app */
export const BUILD_CHANGE_ID: number = ENTRIES[0]?.id ?? 0;

/** novità di questa versione non ancora viste su questo telefono */
export function unseenChanges(now = Date.now()): string[] {
  let seen: number | null = null;
  try {
    const raw = localStorage.getItem(KEY);
    seen = raw === null ? null : Number(raw);
  } catch { /* storage non disponibile: si mostrano come alla prima volta */ }
  const since = now - 30 * 864e5;
  return ENTRIES.filter((e) => (seen !== null && Number.isFinite(seen) ? e.id > seen : Date.parse(e.date) >= since)).flatMap((e) => e.items);
}

export function markChangesSeen(): void {
  try { localStorage.setItem(KEY, String(BUILD_CHANGE_ID)); } catch { /* niente */ }
}

/**
 * La nuova versione ha novità da raccontare? Si legge il suo changelog senza passare dalla cache.
 * Un aggiornamento senza voci nuove (correzioni silenziose) non mostra l'avviso «Nuova versione pronta».
 */
export async function nextHasChanges(): Promise<boolean> {
  try {
    const res = await fetch(`/changelog.json?ngsw-bypass=true&t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const list = (await res.json()) as ChangeEntry[];
    return (list[0]?.id ?? 0) > BUILD_CHANGE_ID;
  } catch {
    return false;
  }
}
