import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { Session } from './session';
import { Supabase } from './supabase';

/**
 * Cartellini dei Pagamenti (migrazione 64): giallo a chi non paga il campo entro le 12 del giorno dopo la partita,
 * rosso (punizione) alla partita dopo se ha ancora un debito. `active` serve al segno accanto al nome (solo il colore,
 * niente importi); `mine` all'avviso all'apertura. Si leggono all'avvio e dopo «trascina per aggiornare».
 */
export type CardColor = 'yellow' | 'red';
export interface MyCard { id: number; color: CardColor; created_at: string; seen: boolean }

@Injectable({ providedIn: 'root' })
export class PayCards {
  private readonly sb = inject(Supabase).client;
  private readonly session = inject(Session);
  readonly active = signal<ReadonlyMap<string, CardColor>>(new Map());
  readonly mine = signal<MyCard[]>([]);

  constructor() {
    effect(() => {
      const uid = this.session.uid();
      untracked(() => (uid ? void this.load() : (this.active.set(new Map()), this.mine.set([]))));
    });
  }

  /** se la migrazione non c'è ancora le funzioni mancano: niente cartellini, nessun errore */
  async load(): Promise<void> {
    const [all, mine] = await Promise.all([this.sb.rpc('pay_cards_active'), this.sb.rpc('pay_my_cards')]);
    if (!all.error && Array.isArray(all.data)) {
      // sulla figurina si segnala solo il giallo: chi ha il rosso è in punizione e non può fare nulla se non saldare
      this.active.set(new Map((all.data as { user_id: string; color: CardColor }[]).filter((c) => c.color === 'yellow').map((c) => [c.user_id, c.color])));
    }
    if (!mine.error && Array.isArray(mine.data)) this.mine.set(mine.data as MyCard[]);
  }

  async seen(id: number): Promise<void> {
    this.mine.update((l) => l.map((c) => (c.id === id ? { ...c, seen: true } : c)));
    await this.sb.rpc('pay_card_seen', { p_id: id });
  }
}
