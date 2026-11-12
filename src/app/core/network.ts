import { inject, Injectable, signal } from '@angular/core';
import { Refresher } from './refresher';

/** Stato della rete per la striscia «Sei offline»; al ritorno della rete la pagina ricarica i suoi dati. */
@Injectable({ providedIn: 'root' })
export class Network {
  private readonly refresher = inject(Refresher);
  readonly online = signal(navigator.onLine);
  /** «Di nuovo online», per un paio di secondi */
  readonly back = signal(false);
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    addEventListener('offline', () => {
      clearTimeout(this.timer);
      this.back.set(false);
      this.online.set(false);
    });
    addEventListener('online', () => {
      this.online.set(true);
      this.back.set(true);
      void this.refresher.refresh();
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.back.set(false), 2000);
    });
  }
}
