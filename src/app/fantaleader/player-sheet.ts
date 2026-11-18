import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { Icon } from '../ui/icon';
import { Api } from '../core/api';
import { FantaLeader, FlPoints, fmtPts, ruleSummary } from '../core/fantaleader';
import { fmtWhen } from '../core/format';
import { StatsRow } from '../core/models';
import { Session } from '../core/session';
import { Avatar } from '../ui/avatar';
import { Skeleton } from '../ui/skeleton';
import { Sheet } from '../ui/sheet';

/** Scheda di un giocatore del FantaLeader: quotazioni, descrizione, skill, statistiche e punti per giornata. */
@Component({
  selector: 'app-fl-player-sheet',
  imports: [Sheet, Avatar, Skeleton, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="sheet" (click)="backdrop($event)" aria-labelledby="fls-h" (close)="userId.set(null)">
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

        @if (fl.skillsOf(id).length) {
          <section class="stack-s">
            <h3>Skill</h3>
            <ul class="skills">
              @for (s of fl.skillsOf(id); track s.id) {
                <li [class.neg]="s.kind === 'neg'" [class.off]="!s.active">
                  <span class="sign" [attr.aria-label]="s.kind === 'pos' ? 'Bonus' : 'Malus'"><app-icon [name]="s.kind === 'pos' ? 'plus' : 'minus'" [size]="14" /></span>
                  <div><strong>{{ s.name }}</strong>@if (!s.active) { <span class="small muted"> (non attiva)</span> }
                    <p class="small muted">{{ s.description }}</p></div>
                </li>
              }
            </ul>
          </section>
        } @else {
          <p class="small muted">Nessuna skill assegnata.</p>
        }

        @if (!loaded()) {
          <app-skeleton kind="lines" [rows]="3" />
        } @else {
          <section class="stack-s">
            <h3>Statistiche</h3>
            @if (stats(); as s) {
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
          </section>

          <section class="stack-s">
            <h3>Punti FantaLeader per giornata</h3>
            @for (p of points(); track p.match_id) {
              <details class="day">
                <summary>
                  <span class="grow">{{ p.matches ? day(p.matches.starts_at) : '' }} @if (!p.played) { <span class="small muted">(non ha giocato)</span> }
                    @if (p.status === 'provisional') { <span class="tag">provvisorio</span> }</span>
                  @if (p.coef !== 1) { <span class="small muted">×{{ fmt(p.coef) }}</span> }
                  <strong class="num">{{ fmt(p.total) }}</strong>
                  <app-icon name="chevron" [size]="16" class="chev" />
                </summary>
                <ul>
                  @for (b of p.breakdown; track $index) { <li><span>{{ b.label }}</span><span class="num">{{ fmt(b.value) }}</span></li> }
                  @if (p.zeroed) { <li><span>Totale azzerato da una skill</span><span class="num">0</span></li> }
                  @if (p.coef !== 1) { <li><span>Coefficiente della settimana</span><span class="num">×{{ fmt(p.coef) }}</span></li> }
                  @for (f of p.fanta; track $index) { <li class="muted"><span>{{ f.label }} (alla fantasquadra, {{ f.to === 'all' ? 'a tutti' : 'agli altri' }})</span><span class="num">{{ fmt(f.amount) }}</span></li> }
                </ul>
              </details>
            } @empty {
              <p class="small muted">Ancora nessuna giornata calcolata.</p>
            }
          </section>
        }
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
    h3 { font-size: var(--step-0); margin: 0; }
    /* skill: elenco sobrio, il segno + o − dice se è un bonus o un malus */
    .skills { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: var(--r-m); }
    .skills li { display: flex; gap: 12px; align-items: flex-start; padding: 12px 16px; }
    .skills li + li { border-top: 1px solid var(--line); }
    .skills li.off { opacity: 0.6; }
    .skills p { margin: 4px 0 0; }
    .sign { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--turf-soft); color: color-mix(in srgb, var(--turf) 70%, var(--ink)); }
    .neg .sign { background: var(--danger-soft); color: var(--danger); }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .grid div { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 4px; border-radius: 12px; background: var(--surface-2); text-align: center; }
    .grid strong { font: 600 var(--step-1)/1.1 var(--font-display); }
    .grid .small { font-size: 0.7rem; line-height: 1.2; }
    .day { border: 1px solid var(--line); border-radius: 12px; padding: 0 12px; }
    .day summary { display: flex; align-items: center; gap: 8px; min-height: 48px; cursor: pointer; list-style: none; }
    .day summary::-webkit-details-marker { display: none; }
    .day .chev { color: var(--muted); rotate: 90deg; transition: rotate 200ms var(--ease); display: grid; }
    .day[open] .chev { rotate: -90deg; }
    .day ul { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: var(--step--1); }
    .day li { display: flex; justify-content: space-between; gap: 12px; }
    .tag { margin-left: 8px; }
  `,
})
export class FlPlayerSheet {
  protected readonly fl = inject(FantaLeader);
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');
  protected readonly userId = signal<string | null>(null);
  protected readonly loaded = signal(false);
  protected readonly points = signal<FlPoints[]>([]);
  protected readonly stats = signal<StatsRow | null>(null);
  protected readonly fmt = fmtPts;
  protected readonly rule = ruleSummary;

  async open(userId: string): Promise<void> {
    this.userId.set(userId);
    this.loaded.set(false);
    queueMicrotask(() => { const d = this.dlg()?.nativeElement; if (d && !d.open) d.showModal(); });
    const [pts, rows] = await Promise.all([this.fl.pointsOf(userId).catch(() => []), this.api.stats(null, null).catch(() => [])]);
    if (this.userId() !== userId) return;
    this.points.set(pts);
    this.stats.set(rows.find((r) => r.user_id === userId) ?? null);
    this.loaded.set(true);
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
}
