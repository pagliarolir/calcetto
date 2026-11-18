import { effect, inject, Injectable, signal } from '@angular/core';
import { onForeground } from './foreground';
import { Api } from './api';
import { Session } from './session';

/** Contatore degli avvisi non letti, aggiornato in tempo reale. */
@Injectable({ providedIn: 'root' })
export class Unread {
  private readonly api = inject(Api);
  private readonly session = inject(Session);
  readonly count = signal(0);
  private stop: (() => void) | null = null;
  private burst: ReturnType<typeof setTimeout> | undefined;

  /** avvisi arrivati con il telefono in standby: il tempo reale non li recupera, il contatore sì */
  private readonly resync = onForeground(() => { if (this.session.uid()) void this.refresh().catch(() => undefined); }, 15_000);

  constructor() {
    effect(() => {
      const uid = this.session.uid();
      const active = this.session.profile()?.active;
      this.stop?.();
      this.stop = null;
      if (uid && active) {
        void this.refresh();
        // più avvisi insieme (es. a fine partita) = una sola rilettura
        this.stop = this.api.watchNotifications(uid, () => {
          clearTimeout(this.burst);
          this.burst = setTimeout(() => {
            void this.refresh().catch(() => undefined);
            void this.session.refreshPunishment();
          }, 300);
        });
      } else {
        this.count.set(0);
      }
    });
  }

  async refresh(): Promise<void> {
    this.count.set(await this.api.unreadCount());
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (this.count() > 0) await nav.setAppBadge?.(this.count()).catch(() => undefined);
    else await nav.clearAppBadge?.().catch(() => undefined);
  }
}
