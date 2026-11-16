import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { fmtDayShort } from '../core/format';
import { LeaderNews, LeaderNewsService } from '../core/leader-news';
import { Session } from '../core/session';
import { Icon } from './icon';
import { Avatar } from './avatar';

/**
 * Riquadro «Leader News»: all'avvio dell'app mostra le notizie del Leader non ancora lette (stesso aspetto dell'avviso
 * di aggiornamento). Resta finché non si tocca la X, che le segna come lette. Si controlla una volta per avvio
 * (e per utente: dopo un cambio di account si ricontrolla). Il testo è mostrato come testo semplice, mai come HTML.
 */
@Component({
  selector: 'app-leader-news',
  imports: [Icon, Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (news().length) {
      <section class="news" role="status" aria-labelledby="ln-h">
        <!-- sottopancia da telegiornale: «LIVE» giallo, fascia blu con le righe, barra rossa -->
        <div class="tv" aria-hidden="false">
          <span class="live" aria-hidden="true"><span class="rec"></span>Live</span>
          <div class="banner"><h2 id="ln-h">Leader News</h2><span class="stripes" aria-hidden="true"></span></div>
          <div class="red" aria-hidden="true"></div>
        </div>
        <div class="card">
          <button type="button" class="close" (click)="close()" aria-label="Chiudi, l'ho letta"><app-icon name="x" [size]="18" /></button>
          <div class="body">
            @for (n of news(); track n.id) {
              <article>
                <p>{{ n.body }}</p>
                <footer class="sign">
                  @if (n.created_by) { <app-avatar [userId]="n.created_by" [size]="28" /> }
                  <span><b>{{ n.created_by ? session.name(n.created_by) : 'Il Leader' }}</b><span class="when">{{ ', ' + day(n.created_at) }}</span></span>
                </footer>
              </article>
            }
          </div>
          <div class="actions">
            <button type="button" class="btn small ok" (click)="close()"><app-icon name="check" [size]="16" /> Letto</button>
          </div>
        </div>
      </section>
    }
  `,
  styles: `
    :host { display: contents; }
    /* Colori fissi da telegiornale (come il sottopancia richiesto dal proprietario): valgono uguali in tutti i temi,
       con i contrasti controllati (bianco sul blu 8,6:1, nero sul giallo 15:1). Il testo della notizia usa invece i colori del tema. */
    .news { --tv-blue: #2541a8; --tv-blue-2: #1b2f80; --tv-red: #e3262f; --tv-yellow: #ffe100; --tv-ink: #111111;
      pointer-events: auto; width: 100%; max-width: 520px; display: flex; flex-direction: column; filter: drop-shadow(0 12px 26px rgb(0 0 0 / 30%)); }
    .tv { position: relative; padding-top: 14px; margin-right: 18px; }
    .live { position: absolute; z-index: 2; top: 0; left: 10px; display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px 3px 8px;
      background: var(--tv-yellow); color: var(--tv-ink); font: 900 0.95rem/1 var(--font-display, var(--font-body)); text-transform: uppercase; letter-spacing: 0.02em;
      clip-path: polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0 100%); padding-right: 16px; }
    .rec { width: 10px; height: 10px; border-radius: 50%; background: var(--tv-ink); }
    .banner { position: relative; display: flex; align-items: center; min-height: 50px; padding: 10px 92px 6px 18px;
      background: linear-gradient(180deg, var(--tv-blue), var(--tv-blue-2)); color: #fff;
      clip-path: polygon(0 0, 100% 0, calc(100% - 16px) 100%, 0 100%); }
    h2 { margin: 0; font: 900 clamp(1.35rem, 6.4vw, 1.9rem)/1 var(--font-display, var(--font-body)); text-transform: uppercase; letter-spacing: 0.01em; color: #fff; white-space: nowrap; }
    .stripes { position: absolute; top: 8px; bottom: 8px; right: 22px; width: 58px;
      background: repeating-linear-gradient(115deg, transparent 0 6px, rgb(255 255 255 / 85%) 6px 10px); }
    .red { height: 12px; width: 72%; background: var(--tv-red); clip-path: polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%); }
    .card { position: relative; margin-top: 6px; border-radius: 16px; background: var(--surface); color: var(--ink); border: 1px solid var(--line); }
    .close { position: absolute; top: 2px; right: 2px; appearance: none; border: 0; background: transparent; color: var(--ink); cursor: pointer;
      width: 44px; height: 44px; display: grid; place-items: center; border-radius: 999px; }
    .close:focus-visible, .ok:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
    .body { padding: 14px 48px 4px 16px; display: flex; flex-direction: column; gap: 14px; max-height: 42dvh; overflow-y: auto; }
    article { display: flex; flex-direction: column; gap: 10px; }
    article + article { border-top: 1px dashed var(--line); padding-top: 12px; }
    article p { margin: 0; font: 500 var(--step-0)/1.45 var(--font-body); white-space: pre-line; overflow-wrap: anywhere; }
    .sign { display: flex; align-items: center; gap: 8px; font-size: var(--step--1); }
    .when { color: var(--muted); font-weight: 400; }
    .actions { display: flex; justify-content: flex-end; padding: 4px 12px 12px; }
    .ok { gap: 6px; min-height: 44px; padding: 0 16px; background: var(--tv-blue); color: #fff; border-color: transparent; font-weight: 700; }
    @media (prefers-reduced-motion: no-preference) {
      /* entra come in tv: prima la fascia blu, poi il «LIVE», la barra rossa e il testo */
      .banner { animation: tv-wipe 420ms cubic-bezier(0.2, 0.9, 0.25, 1) both; }
      .live { animation: tv-pop 260ms 300ms ease-out both; }
      .red { animation: tv-wipe 380ms 180ms cubic-bezier(0.2, 0.9, 0.25, 1) both; }
      .card { animation: tv-up 320ms 360ms ease-out both; }
      .rec { animation: tv-blink 1.2s 700ms steps(2, start) infinite; }
      @keyframes tv-wipe { from { clip-path: polygon(0 0, 0 0, 0 100%, 0 100%); } }
      @keyframes tv-pop { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      @keyframes tv-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
      @keyframes tv-blink { 50% { opacity: 0.15; } }
    }
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
