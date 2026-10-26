import { inject, Injectable, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { Achievements } from './achievements';
import { Session } from './session';
import { Unread } from './unread';

/**
 * «Trascina per aggiornare»: se c'è una nuova versione dell'app la installa e riavvia;
 * altrimenti ricarica profilo, giocatori, avvisi e sticker e ricrea la pagina corrente
 * (ogni pagina ricarica i suoi dati quando nasce; scheda e scelte restano, sono nell'indirizzo).
 */
@Injectable({ providedIn: 'root' })
export class Refresher {
  private readonly session = inject(Session);
  private readonly unread = inject(Unread);
  private readonly achievements = inject(Achievements);
  private readonly sw = inject(SwUpdate);
  /** cambia a ogni aggiornamento: la pagina corrente viene ricreata */
  readonly key = signal(0);
  readonly busy = signal(false);

  async refresh(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      // nuova versione? la verifica ha un limite di 3 secondi (senza rete o senza service worker attivo non risponderebbe mai)
      const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), 3000));
      const fresh = this.sw.isEnabled ? await Promise.race([this.sw.checkForUpdate().catch(() => false), timeout]) : false;
      if (fresh) {
        await this.sw.activateUpdate().catch(() => undefined);
        location.reload();
        return;
      }
      if (this.session.uid()) {
        await Promise.all([
          this.session.refresh().catch(() => undefined),
          this.unread.refresh().catch(() => undefined),
          this.achievements.load().catch(() => undefined),
        ]);
      }
      this.key.update((k) => k + 1);
    } finally {
      // l'indicatore resta visibile almeno un attimo, anche se i dati arrivano subito
      await new Promise((r) => setTimeout(r, 350));
      this.busy.set(false);
    }
  }
}
