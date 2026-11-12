import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  /** la domanda, unica riga di testo della finestra */
  title: string;
  /** verbo del pulsante di conferma («Elimina», «Chiudi le prenotazioni»…) */
  ok: string;
  /** azione che non si può annullare: pulsante rosso */
  danger?: boolean;
}

/** Finestra di conferma unica dell'app (`<app-confirm>` nel guscio): `if (!(await confirm.ask({...}))) return;` */
@Injectable({ providedIn: 'root' })
export class Confirm {
  readonly request = signal<ConfirmOptions | null>(null);
  private resolve?: (ok: boolean) => void;

  ask(o: ConfirmOptions): Promise<boolean> {
    this.resolve?.(false);
    return new Promise((r) => {
      this.resolve = r;
      this.request.set(o);
    });
  }

  answer(ok: boolean): void {
    const r = this.resolve;
    this.resolve = undefined;
    this.request.set(null);
    r?.(ok);
  }
}
