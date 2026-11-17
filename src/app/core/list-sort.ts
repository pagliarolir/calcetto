import { Injectable, signal } from '@angular/core';

export interface ListSortOption { id: string; label: string }

/**
 * Ponte tra la scheda Lista (che sa ordinare i giocatori) e il pulsante dell'ordinamento accanto a «Lista»
 * nell'intestazione della partita. La scheda Lista lo attiva quando nasce e lo spegne quando sparisce;
 * l'ordinamento vale per l'elenco che si sta guardando (titolari, disponibili, riserve, assenti).
 */
@Injectable({ providedIn: 'root' })
export class ListSort {
  readonly active = signal(false);
  readonly options = signal<ListSortOption[]>([]);
  readonly current = signal('');
  pick: (id: string) => void = () => {};
}
