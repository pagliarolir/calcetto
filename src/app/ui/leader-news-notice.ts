import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { fmtDate } from '../core/format';
import { LeaderNews, LeaderNewsService } from '../core/leader-news';
import { Session } from '../core/session';
import { Icon } from './icon';

/**
 * Riquadro «Leader News»: all'avvio dell'app mostra le notizie del Leader non ancora lette (stesso aspetto dell'avviso
 * di aggiornamento). Resta finché non si tocca la X, che le segna come lette. Si controlla una volta per avvio
 * (e per utente: dopo un cambio di account si ricontrolla). Il testo è mostrato come testo semplice, mai come HTML.
 */
@Component({
  selector: 'app-leader-news',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (news().length) {
      <section class="notice enter-fade" role="status" aria-labelledby="ln-h">
        <div class="head">
          <app-icon name="bell" [size]="18" />
          <h2 id="ln-h" class="grow">Leader News</h2>
          <button type="button" class="close" (click)="close()" aria-label="Chiudi, l'ho letta"><app-icon name="x" [size]="16" /></button>
        </div>
        <div class="body">
          @for (n of news(); track n.id) {
            <article>
              @if (news().length > 1) { <span class="when">{{ day(n.created_at) }}</span> }
              <p>{{ n.body }}</p>
            </article>
          }
        </div>
      </section>
    }
  `,
  styles: `
    :host { display: contents; }
    .notice { pointer-events: auto; width: 100%; max-width: 520px; border-radius: var(--r-m); background: var(--ink); color: var(--bg);
      box-shadow: 0 8px 24px rgb(0 0 0 / 20%); font: 500 var(--step--1)/1.4 var(--font-body); }
    .head { display: flex; align-items: center; gap: 8px; padding: 4px 4px 0 16px; min-height: 48px; }
    h2 { margin: 0; font: 700 var(--step-0)/1.2 var(--font-display, var(--font-body)); color: inherit; }
    .grow { flex: 1; min-width: 0; }
    .close { appearance: none; border: 0; background: transparent; color: inherit; cursor: pointer; width: 44px; height: 44px;
      display: grid; place-items: center; border-radius: 999px; flex: none; }
    .close:focus-visible { outline: 2px solid var(--bg); outline-offset: 2px; }
    .body { padding: 0 16px 14px; display: flex; flex-direction: column; gap: 10px; max-height: 45dvh; overflow-y: auto; }
    article p { margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
    .when { display: block; font-size: 0.85em; opacity: 0.8; margin-bottom: 2px; }
  `,
})
export class LeaderNewsNotice {
  private readonly svc = inject(LeaderNewsService);
  private readonly session = inject(Session);
  protected readonly news = signal<LeaderNews[]>([]);
  private checkedFor: string | null = null;
  protected readonly day = fmtDate;

  constructor() {
    effect(() => {
      const uid = this.session.uid();
      untracked(() => {
        if (!uid) { this.news.set([]); this.checkedFor = null; return; }
        if (this.checkedFor === uid) return;
        this.checkedFor = uid;
        void this.svc.pending().then((list) => this.news.set(list));
      });
    });
  }

  protected close(): void {
    const last = this.news().at(-1);
    this.news.set([]);
    if (last) void this.svc.seen(last.id);
  }
}
