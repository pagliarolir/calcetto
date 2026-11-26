import { inject, Injectable, Injector } from '@angular/core';
import { Api } from './api';
import { Cache } from './cache';
import { Ratings } from './ratings';
import { FANTA_ENABLED, FantaLeader } from './fantaleader';
import { Payments } from './payments';
import { Session } from './session';
import { loadMotion, motionOk } from './motion';

/**
 * Precaricamento: dopo l'avvio, quando l'app è libera, scarica i dati delle altre sezioni
 * (Classifica dell'anno, Punti Leader, valori dei giocatori, Avvisi, Conti, FantaLeader) così che aprirle sia immediato.
 * Non sostituisce il caricamento delle pagine: lo anticipa e riempie la cache (core/cache.ts).
 */
@Injectable({ providedIn: 'root' })
export class Prefetch {
  private readonly api = inject(Api);
  private readonly cache = inject(Cache);
  /** i valori si creano solo a sessione pronta, così riprendono quelli salvati dell'utente giusto */
  private readonly injector = inject(Injector);
  private readonly session = inject(Session);
  private done = false;

  /** una volta per avvio, qualche istante dopo il primo disegno */
  schedule(): void {
    if (this.done) return;
    this.done = true;
    const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1500));
    setTimeout(() => idle(() => void this.run()), 1200);
  }

  private async run(): Promise<void> {
    // GSAP per le animazioni (core/motion.ts): pronto prima del primo tocco, fuori dal pacchetto iniziale
    if (motionOk()) void loadMotion();
    await this.session.whenReady();
    if (!this.session.uid()) return;
    const y = new Date().getFullYear();
    const range = { from: new Date(y, 0, 1).toISOString(), to: new Date(y + 1, 0, 1).toISOString() };
    await Promise.all([
      this.api.statsBundle(range.from, range.to).then((b) => {
        // la pagina potrebbe averli già presi più freschi: si scrive solo se mancano
        if (!this.cache.get('stats:year')) this.cache.set('stats:year', { range, b }, true);
      }),
      Promise.all([this.api.leaderPointsTable(), this.api.leaderPointsHistory()]).then(([t, h]) => {
        if (!this.cache.get('leader-points')) this.cache.set('leader-points', { t, h }, true);
      }),
      this.injector.get(Ratings).load(this.session.activeMembers().map((m) => m.id)),
      this.api.notifications().then((list) => {
        if (!this.cache.get('notifications')) this.cache.set('notifications', list, true);
      }),
      // Conti: solo in memoria nel servizio (ci sono IBAN di altri), mai nella cache sul telefono
      (async () => {
        const pay = this.injector.get(Payments);
        if (await pay.checkVisible() && !pay.data()) await pay.load();
      })(),
      // FantaLeader solo per chi lo vede (anteprima): i dati restano nel suo servizio
      (async () => {
        const fl = this.injector.get(FantaLeader);
        if (FANTA_ENABLED && await fl.checkVisible()) await fl.load();
      })(),
    ].map((p) => p.catch(() => undefined)));
  }
}
