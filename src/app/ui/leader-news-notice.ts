import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { fmtDayShort } from '../core/format';
import { LeaderNews, LeaderNewsService } from '../core/leader-news';
import { Session } from '../core/session';
import { TvNotice } from './tv-notice';
import { Avatar } from './avatar';

/**
 * Riquadro «Leader News»: all'avvio dell'app mostra le notizie del Leader non ancora lette (riquadro da telegiornale
 * `<app-tv-notice>`, come le Novità). Resta finché non si tocca la X, che le segna come lette. Si controlla una volta per avvio
 * (e per utente: dopo un cambio di account si ricontrolla). Il testo è mostrato come testo semplice, mai come HTML.
 */
@Component({
  selector: 'app-leader-news',
  imports: [TvNotice, Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (news().length) {
      <app-tv-notice heading="Leader News" closeLabel="Chiudi, l'ho letta" (done)="close()">
        @for (n of news(); track n.id) {
          <article>
            <p>{{ n.body }}</p>
            <footer class="sign">
              @if (n.created_by) { <app-avatar [userId]="n.created_by" [size]="28" /> }
              <span><b>{{ n.created_by ? session.name(n.created_by) : 'Il Leader' }}</b><span class="when">{{ ', ' + day(n.created_at) }}</span></span>
            </footer>
          </article>
        }
      </app-tv-notice>
    }
  `,
  styles: `
    :host { display: contents; }
    article { display: flex; flex-direction: column; gap: 12px; }
    article + article { border-top: 1px dashed var(--line); padding-top: 12px; }
    article p { margin: 0; font: 500 var(--step-0)/1.45 var(--font-body); white-space: pre-line; overflow-wrap: anywhere; }
    .sign { display: flex; align-items: center; gap: 8px; font-size: var(--step--1); }
    .when { color: var(--muted); font-weight: 400; }
  `,
})
export class LeaderNewsNotice {
  private readonly svc = inject(LeaderNewsService);
  protected readonly session = inject(Session);
  protected readonly news = signal<LeaderNews[]>([]);
  private checkedFor: string | null = null;
  protected readonly day = fmtDayShort;

  constructor() {
    effect(() => {
      const uid = this.session.uid();
      untracked(() => {
        if (!uid) { this.news.set([]); this.checkedFor = null; this.svc.state.set('checking'); return; }
        if (this.checkedFor === uid) return;
        this.checkedFor = uid;
        this.svc.state.set('checking');
        void this.svc.pending().then((list) => {
          this.news.set(list);
          this.svc.state.set(list.length ? 'showing' : 'done');
        });
      });
    });
  }

  protected close(): void {
    const last = this.news().at(-1);
    this.news.set([]);
    this.svc.state.set('done');
    if (last) void this.svc.seen(last.id);
  }
}
