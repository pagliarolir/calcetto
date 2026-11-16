import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { markChangesSeen, unseenChanges } from '../core/changelog';
import { LeaderNewsService } from '../core/leader-news';
import { Session } from '../core/session';
import { TvNotice } from './tv-notice';

/**
 * «Novità» all'apertura dopo un aggiornamento: è una Leader News anche questa (titolo «Leader News», etichetta «Novità»), con l'elenco di cosa
 * è cambiato. Compare una volta per versione (e per telefono), solo con l'accesso fatto e dopo le Leader News,
 * così i due riquadri non si sovrappongono.
 */
@Component({
  selector: 'app-changes-notice',
  imports: [TvNotice],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (items().length) {
      <app-tv-notice tag="Novità" heading="Leader News" (done)="close()">
        <ul>
          @for (c of items(); track $index) { <li>{{ c }}</li> }
        </ul>
      </app-tv-notice>
    }
  `,
  styles: `
    :host { display: contents; }
    ul { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 8px; font: 500 var(--step-0)/1.4 var(--font-body); }
    li::marker { color: var(--muted); }
  `,
})
export class ChangesNotice {
  private readonly session = inject(Session);
  private readonly news = inject(LeaderNewsService);
  protected readonly items = signal<string[]>([]);
  private shown = false;

  constructor() {
    effect(() => {
      if (!this.session.uid() || this.news.state() !== 'done') return;
      untracked(() => {
        if (this.shown) return;
        this.shown = true;
        const list = unseenChanges();
        if (list.length) this.items.set(list);
        else markChangesSeen();
      });
    });
  }

  protected close(): void {
    this.items.set([]);
    markChangesSeen();
  }
}
