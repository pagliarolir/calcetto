import { inject, Injectable, Injector, signal } from '@angular/core';
import { PUNISHMENT_MESSAGE, Reprimand } from '../ui/reprimand';

export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error' | 'info';
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
    if (text === PUNISHMENT_MESSAGE) {
      this.injector.get(Reprimand).show();
      return;
    }
    this.show(text, 'error', 5000);
  }

  dismiss(id: number): void {
    this.items.update((l) => l.filter((t) => t.id !== id));
  }
}
