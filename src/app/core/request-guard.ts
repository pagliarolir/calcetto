/**
 * Freno alle chiamate ripetute verso Supabase: protegge dai conti a sorpresa e dai limiti dei piani
 * gratuiti se un errore nel codice (un effetto che si richiama, un ascolto che si riconnette senza fine)
 * facesse partire la stessa richiesta in continuazione.
 *
 * - La stessa richiesta (metodo, indirizzo e contenuto) più di SAME_MAX volte in WINDOW_MS:
 *   quella richiesta si ferma per BLOCK_MS.
 * - Più di ALL_MAX richieste di qualunque tipo in WINDOW_MS: tutte si fermano per BLOCK_MS.
 *
 * Una richiesta fermata non parte: risponde subito con un errore 429 e un messaggio in italiano.
 * L'uso normale (anche aprire la partita, trascinare per aggiornare, scrivere in chat) resta molto sotto.
 */
export const WINDOW_MS = 10_000;
export const SAME_MAX = 20;
export const ALL_MAX = 150;
export const BLOCK_MS = 60_000;
export const BLOCKED_MESSAGE = 'Troppe richieste ripetute: per sicurezza l\'app si è fermata un minuto. Riprova tra poco.';

interface State { recent: Map<string, number[]>; all: number[]; blockedKey: Map<string, number>; blockedAll: number; warned: boolean }

export function createGuardedFetch(base: typeof fetch = (...a) => fetch(...a), now: () => number = () => Date.now()): typeof fetch {
  const st: State = { recent: new Map(), all: [], blockedKey: new Map(), blockedAll: 0, warned: false };

  const blocked = (why: string): Response => {
    if (!st.warned) { st.warned = true; console.warn('[G.d.L.] richieste fermate:', why); }
    return new Response(JSON.stringify({ message: BLOCKED_MESSAGE, code: 'GDL_RATE' }), {
      status: 429, headers: { 'Content-Type': 'application/json' },
    });
  };

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const t = now();
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init?.body === 'string' ? init.body.slice(0, 500) : '';
    const key = `${method} ${url} ${body}`;

    if (t < st.blockedAll) return blocked('troppe richieste in pochi secondi');
    const until = st.blockedKey.get(key);
    if (until && t < until) return blocked(`${method} ${url.split('?')[0]}`);

    const from = t - WINDOW_MS;
    st.all = st.all.filter((x) => x > from); st.all.push(t);
    const list = (st.recent.get(key) ?? []).filter((x) => x > from); list.push(t);
    st.recent.set(key, list);
    // pulizia: niente memoria che cresce
    if (st.recent.size > 500) for (const [k, v] of st.recent) if (!v.some((x) => x > from)) st.recent.delete(k);

    if (st.all.length > ALL_MAX) { st.blockedAll = t + BLOCK_MS; return blocked('troppe richieste in pochi secondi'); }
    if (list.length > SAME_MAX) { st.blockedKey.set(key, t + BLOCK_MS); return blocked(`${method} ${url.split('?')[0]}`); }
    if (st.warned && t >= st.blockedAll && ![...st.blockedKey.values()].some((u) => t < u)) st.warned = false;
    return base(input, init);
  };
}
