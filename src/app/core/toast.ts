import { inject, Injectable, Injector, signal } from '@angular/core';
import { PAY_PUNISHMENT_MESSAGE, PUNISHMENT_MESSAGE, Reprimand } from '../ui/reprimand';

export interface Toast {
  id: number;
  text: string;
  /** good/bad: esito di una scelta (verde o rosso tenue), es. la risposta alla partita */
  tone: 'ok' | 'error' | 'info' | 'good' | 'bad';
}

@Injectable({ providedIn: 'root' })
export class Toasts {
  readonly items = signal<Toast[]>([]);
  private readonly injector = inject(Injector);
  private seq = 0;

  show(text: string, tone: Toast['tone'] = 'ok', ms = 3200): void {
    const t: Toast = { id: ++this.seq, text, tone };
    this.items.update((l) => [...l, t]);
    setTimeout(() => this.dismiss(t.id), ms);
  }

  error(text: string): void {
    if (text === PUNISHMENT_MESSAGE || text === PAY_PUNISHMENT_MESSAGE) {
      this.injector.get(Reprimand).show();
      return;
    }
    this.show(text, 'error', 5000);
  }

  dismiss(id: number): void {
    this.items.update((l) => l.filter((t) => t.id !== id));
  }
}
