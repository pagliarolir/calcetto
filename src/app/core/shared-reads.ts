import { inject, Injectable } from '@angular/core';
import { Api } from './api';
import { Match, Result, StatsRow } from './models';

type MatchWithResult = Match & { results: Result | null };

/** quanto resta valida una lettura condivisa: aprire più giocatori di fila fa una chiamata sola */
const TTL = 60_000;

/**
 * Letture pesanti che servono a più pagine (classifica di sempre, ultime partite con risultato):
 * una richiesta già partita o appena arrivata si riusa invece di ripeterla.
 * Solo in memoria e per poco: «Trascina per aggiornare» e le azioni che cambiano i dati la svuotano (`invalidate`).
 */
@Injectable({ providedIn: 'root' })
export class SharedReads {
  private readonly api = inject(Api);
  private stats: { at: number; p: Promise<StatsRow[]> } | null = null;
  private matches: { at: number; limit: number; p: Promise<MatchWithResult[]> } | null = null;

  /** statistiche di sempre di tutti i giocatori (`stats_table` senza periodo) */
  allTimeStats(): Promise<StatsRow[]> {
    if (this.stats && Date.now() - this.stats.at < TTL) return this.stats.p;
    const entry = { at: Date.now(), p: this.api.stats(null, null) };
    entry.p.catch(() => { if (this.stats === entry) this.stats = null; });
    this.stats = entry;
    return entry.p;
  }

  /** ultime `limit` partite con risultato, dalla più recente: una lettura più lunga serve anche quelle più corte */
  recentMatches(limit: number): Promise<MatchWithResult[]> {
    const m = this.matches;
    if (m && m.limit >= limit && Date.now() - m.at < TTL) return m.p.then((list) => list.slice(0, limit));
    const entry = { at: Date.now(), limit, p: this.api.matches(limit) };
    entry.p.catch(() => { if (this.matches === entry) this.matches = null; });
    this.matches = entry;
    return entry.p;
  }

  invalidate(): void {
    this.stats = null;
    this.matches = null;
  }
}
