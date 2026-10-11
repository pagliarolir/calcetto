import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error' | 'info';
}

@Injectable({ providedIn: 'root' })
export class Toasts {
  readonly items = signal<Toast[]>([]);
  private seq = 0;

  show(text: string, tone: Toast['tone'] = 'ok', ms = 3200): void {
    const t: Toast = { id: ++this.seq, text, tone };
    this.items.update((l) => [...l, t]);
    setTimeout(() => this.dismiss(t.id), ms);
  }

  error(text: string): void {
    this.show(text, 'error', 5000);
  }

  dismiss(id: number): void {
    this.items.update((l) => l.filter((t) => t.id !== id));
  }
}
