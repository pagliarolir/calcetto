import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { SharedReads } from '../core/shared-reads';
import { Icon } from '../ui/icon';
import { FantaLeader, FlPoints, fmtPts, ruleSummary } from '../core/fantaleader';
import { fmtDayLong, fmtWhen } from '../core/format';
import { StatsRow } from '../core/models';
import { Session } from '../core/session';
import { Avatar } from '../ui/avatar';
import { Skeleton } from '../ui/skeleton';
import { Sheet } from '../ui/sheet';

/** Scheda di un giocatore del FantaLeader: quotazioni e descrizione in alto; skill, statistiche e punti per giornata
 *  in tre schede scelte dalla barra in fondo al foglio (decisione del proprietario, variante «barra in basso»). */
@Component({
  selector: 'app-fl-player-sheet',
  imports: [Sheet, Avatar, Skeleton, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="sheet tabbed" (click)="backdrop($event)" aria-labelledby="fls-h" (close)="userId.set(null)">
      <div class="grab" aria-hidden="true"></div>
      <button type="button" class="x-close" (click)="dlg.close()" aria-label="Chiudi"><span><app-icon name="x" [size]="16" /></span></button>
      @if (userId(); as id) {
        <header class="head">
          <app-avatar [userId]="id" [size]="64" />
          <div class="grow">
            <h2 id="fls-h">{{ session.name(id) }}</h2>
            @if (fl.rankOf().get(id); as r) {
              <p class="small muted">{{ r.pos }}° in classifica, {{ fmt(r.total) }} punti@if (r.next_coef !== 1) {, prossima giornata ×{{ fmt(r.next_coef) }}}</p>
            }
          </div>
        </header>

        @if (fl.rankOf().get(id); as r) {
          <div class="prices">
            <div><span class="small muted">Quota iniziale</span><strong class="num">{{ r.price_initial }}</strong></div>
            <div><span class="small muted">Quota attuale</span>
              <strong class="num" [class.up]="r.price_current > r.price_initial" [class.down]="r.price_current < r.price_initial">
                {{ r.price_current }}@if (r.price_current !== r.price_initial) { <app-icon [name]="r.price_current > r.price_initial ? 'up' : 'down'" [size]="16" /> }
              </strong></div>
          </div>
        }
        @if (fl.playerOf().get(id)?.description; as d) { <p class="desc">{{ d }}</p> }

        <!-- le tre schede stanno una sopra l'altra nella stessa cella: l'area è alta quanto la più alta, niente salti -->
        <div class="panel-area" role="tabpanel" [attr.aria-labelledby]="'fls-tab-' + tab()">
          <div class="pane" [class.on]="tab() === 'skill'" [attr.aria-hidden]="tab() !== 'skill'" [attr.inert]="tab() !== 'skill' ? '' : null">
            @if (fl.skillsOf(id).length) {
              <ul class="skills">
                @for (s of fl.skillsOf(id); track s.id) {
                  <li [class.neg]="s.kind === 'neg'" [class.off]="!s.active">
                    <span class="sign" [attr.aria-label]="s.kind === 'pos' ? 'Bonus' : 'Malus'"><app-icon [name]="s.kind === 'pos' ? 'plus' : 'minus'" [size]="14" /></span>
                    <div><strong>{{ s.name }}</strong>@if (!s.active) { <span class="small"> (non attiva)</span> }
                      <p class="small">{{ s.description }}</p></div>
                  </li>
                }
              </ul>
            } @else {
              <p class="small muted">Nessuna skill assegnata.</p>
            }
          </div>
          <div class="pane" [class.on]="tab() === 'stats'" [attr.aria-hidden]="tab() !== 'stats'" [attr.inert]="tab() !== 'stats' ? '' : null">
            @if (!loaded()) {
              <app-skeleton kind="lines" [rows]="2" />
            } @else if (stats(); as s) {
              <div class="grid">
                <div><strong>{{ s.played }}</strong><span class="small muted">partite</span></div>
                <div><strong>{{ s.wins }}-{{ s.draws }}-{{ s.losses }}</strong><span class="small muted">vinte, pari, perse</span></div>
                <div><strong>{{ s.goals }}</strong><span class="small muted">gol</span></div>
                <div><strong>{{ s.avg_vote !== null ? fmt(+s.avg_vote) : 'n.d.' }}</strong><span class="small muted">media voto</span></div>
              </div>
              @if (s.avg_vote === null) { <p class="small muted">Media voto non disponibile: servono più votanti.</p> }
            } @else {
              <p class="small muted">Statistiche non disponibili: nessuna partita omologata.</p>
            }
          </div>
          <div class="pane" [class.on]="tab() === 'points'" [attr.aria-hidden]="tab() !== 'points'" [attr.inert]="tab() !== 'points' ? '' : null">
            @if (!loaded()) {
              <app-skeleton kind="lines" [rows]="3" />
            } @else {
              <!-- elenco delle giornate e, accanto, il dettaglio: si scorre di lato toccando una giornata -->
              <div class="slider" [class.detail]="!!pick()">
                <div class="slide" [attr.inert]="pick() ? '' : null">
                  <ul class="days">
                    @for (p of points(); track p.match_id) {
                      <li><button type="button" class="day" (click)="pick.set(p)">
                        <span class="grow two"><span>{{ p.matches ? day(p.matches.starts_at) : '' }}</span>
                          @if (!p.played || p.status === 'provisional') { <small class="muted">{{ !p.played ? 'Non ha giocato' : 'Provvisorio' }}</small> }</span>
                        <strong class="num">{{ fmt(p.total) }}</strong>
                        <app-icon name="chevron" [size]="16" class="chev" />
                      </button></li>
                    } @empty {
                      <li class="small muted">Ancora nessuna giornata calcolata.</li>
                    }
                  </ul>
                </div>
                <div class="slide" [attr.inert]="pick() ? null : ''">
                  @if (pick(); as p) {
                    <article class="pd">
                      <header class="pd-head">
                        <button type="button" class="pd-back" (click)="pick.set(null)" aria-label="Torna alle giornate"><app-icon name="back" [size]="20" /></button>
                        <div class="grow">
                          <h3>{{ p.matches ? dayLong(p.matches.starts_at) : 'Giornata' }}</h3>
                          <span class="small muted">{{ outcome(p) }}</span>
                        </div>
                        <div class="pd-tot"><strong class="num">{{ fmt(p.total) }}</strong><small>punti</small></div>
                      </header>
                      @if (p.breakdown.length) {
                        <ul class="pd-rows">
                          @for (b of p.breakdown; track $index) {
                            <li><span>{{ b.label }}</span><span class="num" [class.plus]="b.value > 0" [class.minus]="b.value < 0">{{ sg(b.value) }}</span></li>
                          }
                        </ul>
                      }
                      @if (p.zeroed || p.coef !== 1) {
                        <ul class="pd-rows sum">
                          <li><span>Parziale</span><span class="num">{{ fmt(p.pre) }}</span></li>
                          @if (p.zeroed) { <li><span>Azzerato da una skill</span><span class="num">0</span></li> }
                          @if (p.coef !== 1) { <li><span>Coefficiente della settimana</span><span class="num">×{{ fmt(p.coef) }}</span></li> }
                        </ul>
                      }
                      @if (p.fanta.length) {
                        <h4>Alla sua fantasquadra</h4>
                        <ul class="pd-rows">
                          @for (f of p.fanta; track $index) {
                            <li><span>{{ f.label }} <small class="muted">({{ f.to === 'all' ? 'a tutti' : 'agli altri' }})</small></span><span class="num" [class.plus]="f.amount > 0" [class.minus]="f.amount < 0">{{ sg(f.amount) }}</span></li>
                          }
                        </ul>
                      }
                    </article>
                  }
                </div>
              </div>
            }
          </div>
        </div>

        <nav class="sheet-tabs" role="tablist" aria-label="Sezioni della scheda">
          @for (t of tabs; track t.key) {
            <button type="button" role="tab" [id]="'fls-tab-' + t.key" [attr.aria-selected]="tab() === t.key" (click)="setTab(t.key)">
              <span class="ico"><app-icon [name]="t.icon" [size]="20" /></span>
              <span>{{ t.label }}</span>
            </button>
          }
        </nav>
      }
    </dialog>
  `,
  styles: `
    .head { display: flex; align-items: center; gap: 16px; padding-right: 48px; }
    .head h2 { font-size: var(--step-1); }
    .prices { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .prices div { display: flex; flex-direction: column; gap: 4px; padding: 12px 16px; border-radius: var(--r-m); background: var(--surface-2); }
    .prices strong { display: inline-flex; align-items: center; gap: 4px; font: 600 var(--step-2)/1 var(--font-display); }
    .prices .up { color: color-mix(in srgb, var(--turf) 70%, var(--ink)); } .prices .down { color: var(--danger); }
    .desc { margin: 0; line-height: 1.45; font-style: italic; color: var(--muted); }
    /* foglio con la barra delle schede in fondo: la barra resta attaccata al bordo basso mentre il contenuto scorre */
    dialog.sheet.tabbed { padding-bottom: 0; }
    .panel-area { display: grid; flex: 1 0 auto; min-height: 200px; align-content: start; }
    .pane { grid-area: 1 / 1; display: flex; flex-direction: column; gap: 12px; min-width: 0; visibility: hidden; }
    .pane.on { visibility: visible; }
    /* barra delle schede come quella dell'app: icone grigie, la scelta in verde con la capsula */
    .sheet-tabs {
      position: sticky; bottom: 0; z-index: 2; flex: none; display: flex; margin: 0 -16px;
      padding-bottom: env(safe-area-inset-bottom, 0px); background: var(--surface); border-top: 1px solid var(--line);
    }
    .sheet-tabs button {
      flex: 1; padding: 8px 4px 4px; border: 0; background: none; cursor: pointer;
      display: flex; flex-direction: column; align-items: center; gap: 2px;
      color: var(--muted); font: 600 0.72rem/1.2 var(--font-body);
      user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
    }
    .sheet-tabs .ico { display: grid; place-items: center; width: 52px; height: 30px; border-radius: 999px; transition: background 180ms var(--ease); }
    .sheet-tabs button[aria-selected='true'] { color: var(--turf); }
    .sheet-tabs button[aria-selected='true'] .ico { background: var(--turf-soft); }
    .sheet-tabs button:focus-visible { outline: none; }
    .sheet-tabs button:focus-visible .ico { box-shadow: 0 0 0 3px var(--focus); }
    /* skill: bonus in verde, malus in rosso, ognuna nel suo riquadro sfumato */
    .skills { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .skills li {
      display: flex; gap: 12px; align-items: flex-start; padding: 12px 16px; border-radius: var(--r-m); color: var(--ink);
      background: linear-gradient(135deg, color-mix(in srgb, var(--turf) 22%, var(--surface)), color-mix(in srgb, var(--turf) 6%, var(--surface)));
      border: 1px solid color-mix(in srgb, var(--turf) 30%, var(--surface));
    }
    .skills li.neg {
      background: linear-gradient(135deg, color-mix(in srgb, var(--danger) 20%, var(--surface)), color-mix(in srgb, var(--danger) 5%, var(--surface)));
      border-color: color-mix(in srgb, var(--danger) 30%, var(--surface));
    }
    .skills li.off { opacity: 0.6; }
    .skills p { margin: 4px 0 0; color: var(--ink); opacity: 0.85; }
    .sign { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--turf); color: var(--turf-ink); }
    .neg .sign { background: var(--danger); color: var(--danger-ink); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .grid div { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 12px 8px; border-radius: 12px; background: var(--surface-2); text-align: center; }
    .grid strong { font: 600 var(--step-1)/1.1 var(--font-display); }
    .grid .small { line-height: 1.2; }
    /* punti: elenco e dettaglio affiancati, si passa dall'uno all'altro scorrendo di lato */
    .slider { display: grid; grid-template-columns: 100% 100%; overflow: hidden; margin: -4px; padding: 4px; }
    .slide { min-width: 0; transition: translate 320ms var(--ease); }
    .slider.detail .slide { translate: calc(-100% - 8px) 0; }
    .slide + .slide { margin-left: 8px; }
    @media (prefers-reduced-motion: reduce) { .slide { transition: none; } }
    .days { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .day { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 8px; min-height: 52px; padding: 4px 12px;
           border: 1px solid var(--line); border-radius: 12px; background: var(--surface); cursor: pointer; }
    .day:focus-visible { outline: 2px solid var(--turf); outline-offset: 2px; }
    .day .two { display: flex; flex-direction: column; gap: 2px; }
    .day .chev { color: var(--muted); display: grid; }
    .pd { display: flex; flex-direction: column; gap: 12px; padding: 12px 16px 16px; border-radius: var(--r-m); background: var(--surface-2); }
    .pd-head { display: flex; align-items: center; gap: 8px; }
    .pd-head h3 { margin: 0; font-size: var(--step-0); }
    .pd-back { flex: none; width: 44px; height: 44px; margin-left: -12px; border: 0; border-radius: 50%; background: none; color: var(--ink); display: grid; place-items: center; cursor: pointer; }
    .pd-tot { display: flex; flex-direction: column; align-items: flex-end; }
    .pd-tot strong { font: 600 var(--step-2)/1 var(--font-display); }
    .pd-tot small { color: var(--muted); }
    .pd h4 { margin: 0; font-size: var(--step--1); color: var(--muted); font-weight: 500; }
    .pd-rows { list-style: none; margin: 0; padding: 0; border-radius: 12px; background: var(--surface); }
    .pd-rows li { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 40px; padding: 4px 12px; font-size: var(--step--1); }
    .pd-rows li + li { border-top: 1px solid var(--line); }
    .pd-rows .num { font-weight: 600; }
    .pd-rows .plus { color: color-mix(in srgb, var(--turf) 70%, var(--ink)); }
    .pd-rows .minus { color: var(--danger); }
  `,
})
export class FlPlayerSheet {
  protected readonly fl = inject(FantaLeader);
  protected readonly session = inject(Session);
  private readonly shared = inject(SharedReads);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');
  protected readonly userId = signal<string | null>(null);
  protected readonly tabs = [
    { key: 'skill', label: 'Skill', icon: 'sparkle' },
    { key: 'stats', label: 'Statistiche', icon: 'stats' },
    { key: 'points', label: 'Punti', icon: 'list' },
  ] as const;
  protected readonly tab = signal<'skill' | 'stats' | 'points'>('skill');
  protected readonly loaded = signal(false);
  /** giornata aperta nel dettaglio dei Punti */
  protected readonly pick = signal<FlPoints | null>(null);
  protected readonly points = signal<FlPoints[]>([]);
  protected readonly stats = signal<StatsRow | null>(null);
  private readonly seen = new Map<string, { points: FlPoints[]; stats: StatsRow | null }>();
  protected readonly fmt = fmtPts;
  protected readonly rule = ruleSummary;

  async open(userId: string): Promise<void> {
    this.userId.set(userId);
    this.tab.set('skill');
    this.pick.set(null);
    // un giocatore già aperto si rivede subito, poi i dati si aggiornano (solo in memoria, finché l'app è aperta)
    const seen = this.seen.get(userId);
    this.points.set(seen?.points ?? []);
    this.stats.set(seen?.stats ?? null);
    this.loaded.set(!!seen);
    queueMicrotask(() => { const d = this.dlg()?.nativeElement; if (d && !d.open) d.showModal(); });
    const [pts, rows] = await Promise.all([this.fl.pointsOf(userId).catch(() => null), this.shared.allTimeStats().catch(() => null)]);
    if (this.userId() !== userId) return;
    if (pts) this.points.set(pts);
    if (rows) this.stats.set(rows.find((r) => r.user_id === userId) ?? null);
    this.loaded.set(true);
    if (pts && rows) this.seen.set(userId, { points: this.points(), stats: this.stats() });
  }

  protected close(): void {
    this.dlg()?.nativeElement.close();
  }

  protected backdrop(e: MouseEvent): void {
    if (e.target === this.dlg()?.nativeElement) this.close();
  }

  protected day(iso: string): string {
    return fmtWhen(iso);
  }

  protected dayLong(iso: string): string {
    const d = fmtDayLong(iso);
    return d.charAt(0).toUpperCase() + d.slice(1);
  }

  protected setTab(k: 'skill' | 'stats' | 'points'): void {
    this.tab.set(k);
    this.pick.set(null);
  }

  protected sg(n: number): string {
    return (n > 0 ? '+' : '') + this.fmt(n);
  }

  protected outcome(p: FlPoints): string {
    if (!p.played) return 'Non ha giocato';
    const res = p.won ? 'Ha giocato e vinto' : 'Ha giocato';
    return p.status === 'provisional' ? res + ', punti provvisori' : res;
  }
}
