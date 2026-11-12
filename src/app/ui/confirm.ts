import { afterNextRender, ChangeDetectionStrategy, Component, effect, ElementRef, inject, Injector, viewChild } from '@angular/core';
import { Confirm } from '../core/confirm';
import { Icon } from './icon';

/** Finestra di conferma unica: domanda, «Indietro» e il verbo dell'azione (rosso se non si torna indietro). */
@Component({
  selector: 'app-confirm',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="confirm" role="alertdialog" aria-labelledby="confirm-q" (close)="closed()" (click)="backdrop($event)">
      @if (confirm.request(); as r) {
        <h2 id="confirm-q">{{ r.title }}</h2>
        <div class="acts">
          <button type="button" class="btn" autofocus (click)="confirm.answer(false)">Indietro</button>
          <button type="button" class="btn" [class.primary]="!r.danger" [class.danger-fill]="r.danger" (click)="confirm.answer(true)">@if (r.danger) {<app-icon name="alert" [size]="18" />}{{ r.ok }}</button>
        </div>
      }
    </dialog>
  `,
  styles: `
    dialog.confirm {
      border: 1px solid var(--line); border-radius: var(--r-l); padding: 22px 18px 18px; width: min(340px, calc(100vw - 32px));
      background: var(--surface); color: var(--ink); box-shadow: 0 16px 48px rgb(0 0 0 / 30%);
    }
    dialog.confirm::backdrop { background: var(--backdrop); }
    h2 { margin: 0 4px 20px; font: 600 var(--step-1) / 1.2 var(--font-display); text-wrap: balance; }
    .acts { display: flex; flex-wrap: wrap; gap: 8px; }
    .acts .btn { flex: 1 1 120px; padding: 0 14px; line-height: 1.15; gap: 6px; }
    .acts app-icon { flex: none; }
  `,
})
export class ConfirmView {
  protected readonly confirm = inject(Confirm);
  private readonly injector = inject(Injector);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    effect(() => {
      const d = this.dlg().nativeElement;
      // si apre dopo aver disegnato domanda e pulsanti, così il fuoco va su «Indietro» (autofocus)
      if (this.confirm.request()) afterNextRender({ write: () => { if (!d.open) d.showModal(); } }, { injector: this.injector });
      else if (d.open) d.close();
    });
  }

  /** Esc o chiusura dal sistema: vale come «Indietro» */
  protected closed(): void {
    if (this.confirm.request()) this.confirm.answer(false);
  }

  protected backdrop(e: MouseEvent): void {
    // solo fuori dal riquadro: un tocco sul margine interno ha lo stesso bersaglio del velo
    const d = this.dlg().nativeElement, b = d.getBoundingClientRect();
    if (e.target === d && (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom)) d.close();
  }
}
