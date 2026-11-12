import { inject, Injectable, signal } from '@angular/core';
import { Api } from './api';
import { Cache } from './cache';

/**
 * Prossima partita, ricordata sul telefono: il tasto «Partita» della barra porta direttamente lì
 * (senza passare dalla home che la cerca), e intanto si controlla in sottofondo se è cambiata.
 */
@Injectable({ providedIn: 'root' })
export class NextMatch {
  private readonly api = inject(Api);
  private readonly cache = inject(Cache);
  readonly id = signal<string | null>(null);

  /** dopo l'accesso: riprende quella salvata */
  restore(): void {
    this.id.set(this.cache.get<string | null>('next-match') ?? null);
  }

  set(id: string | null): void {
    this.id.set(id);
    this.cache.set('next-match', id, true);
  }

  async refresh(): Promise<string | null> {
    const m = await this.api.nextMatch().catch(() => undefined);
    if (m === undefined) return this.id();
    this.set(m?.id ?? null);
    return m?.id ?? null;
  }
}
