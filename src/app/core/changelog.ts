import changelog from '../../../public/changelog.json';

/**
 * Novità degli aggiornamenti. L'elenco sta in `public/changelog.json` (il più recente in cima, `id` che cresce di 1):
 * l'app conosce l'`id` della propria versione (letto al momento della compilazione) e, quando ne arriva una nuova,
 * scarica il file della nuova versione e mostra le voci con `id` più alto.
 */
export interface ChangeEntry { id: number; date: string; items: string[] }

/** id dell'ultima novità compresa in questa versione dell'app */
export const BUILD_CHANGE_ID: number = (changelog as ChangeEntry[])[0]?.id ?? 0;

/** novità arrivate dopo questa versione (dal file della nuova, scaricato senza passare dalla cache) */
export async function newChanges(): Promise<string[]> {
  try {
    const res = await fetch(`/changelog.json?ngsw-bypass=true&t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const list = (await res.json()) as ChangeEntry[];
    return list.filter((e) => e.id > BUILD_CHANGE_ID).flatMap((e) => e.items);
  } catch {
    return [];
  }
}
