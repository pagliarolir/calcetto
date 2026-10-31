import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { Api } from '../core/api';
import { FantaLeader, FlPoints, fmtPts, ruleSummary } from '../core/fantaleader';
import { fmtWhen } from '../core/format';
import { StatsRow } from '../core/models';
import { Session } from '../core/session';
import { Avatar } from '../ui/avatar';
import { Skeleton } from '../ui/skeleton';

/** Scheda di un giocatore del FantaLeader: quotazioni, descrizione, skill, statistiche e punti per giornata. */
@Component({
  selector: 'app-fl-player-sheet',
  imports: [Avatar, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="sheet" (click)="backdrop($event)" aria-labelledby="fls-h" (close)="userId.set(null)">
      @if (userId(); as id) {
        <div class="grab" aria-hidden="true"></div>
        <header class="head">
          <app-avatar [userId]="id" [size]="64" />
          <div class="grow">
            <h2 id="fls-h">{{ session.name(id) }}</h2>
            @if (fl.rankOf().get(id); as r) {
              <p class="small muted">{{ r.pos }}° in classifica · {{ fmt(r.total) }} punti · prossimo coefficiente ×{{ fmt(r.next_coef) }}</p>
            }
          </div>
          <button type="button" class="x" (click)="close()" aria-label="Chiudi">✕</button>
        </header>

        @if (fl.rankOf().get(id); as r) {
          <div class="prices">
            <div><span class="small muted">Quotazione iniziale</span><strong>{{ r.price_initial }}</strong></div>
            <div><span class="small muted">Quotazione attuale</span>
              <strong [class.up]="r.price_current > r.price_initial" [class.down]="r.price_current < r.price_initial">
                {{ r.price_current }}@if (r.price_current !== r.price_initial) { <small>{{ r.price_current > r.price_initial ? '▲' : '▼' }}</small> }
              </strong></div>
          </div>
        }
        @if (fl.playerOf().get(id)?.description; as d) { <p class="desc">{{ d }}</p> }

        @if (fl.skillsOf(id).length) {
          <section class="stack-s">
            <h3>Skill</h3>
            @for (s of fl.skillsOf(id); track s.id) {
              <div class="skill" [class.neg]="s.kind === 'neg'" [class.off]="!s.active">
                <span class="sign">{{ s.kind === 'pos' ? '+' : '−' }}</span>
                <div><strong>{{ s.name }}</strong>@if (!s.active) { <span class="small muted"> (non attiva)</span> }
                  <p class="small">{{ s.description }}</p></div>
              </div>
            }
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
                <div><strong>{{ s.wins }}–{{ s.draws }}–{{ s.losses }}</strong><span class="small muted">V–N–P</span></div>
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
                  <span class="grow">{{ p.matches ? day(p.matches.starts_at) : '' }} @if (!p.played) { <span class="small muted">· non ha giocato</span> }
                    @if (p.status === 'provisional') { <span class="tag">provvisorio</span> }</span>
                  @if (p.coef !== 1) { <span class="small muted">×{{ fmt(p.coef) }}</span> }
                  <strong class="num">{{ fmt(p.total) }}</strong>
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
    .sheet { position: fixed; inset: auto 0 0 0; margin: 0 auto; width: 100%; max-width: 560px; max-height: 88dvh; overflow-y: auto; border: 0; color: var(--ink);
             background: var(--surface); border-radius: 22px 22px 0 0; padding: 8px 16px calc(20px + env(safe-area-inset-bottom, 0px)); box-shadow: 0 -10px 40px rgb(0 0 0 / 25%); }
    .sheet[open] { display: flex; flex-direction: column; gap: 14px; }
    .sheet::backdrop { background: rgb(10 20 14 / 45%); }
    .grab { width: 40px; height: 5px; border-radius: 3px; background: var(--line); align-self: center; flex: none; }
    .head { display: flex; align-items: center; gap: 12px; }
    .head h2 { font-size: var(--step-1); }
    .x { border: 0; background: var(--surface-2); color: var(--muted); width: 36px; height: 36px; border-radius: 50%; cursor: pointer; flex: none; }
    .prices { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .prices div { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 12px; background: var(--surface-2); }
    .prices strong { font: 800 var(--step-2)/1 var(--font-display); }
    .prices .up { color: var(--turf); } .prices .down { color: var(--danger); }
    .prices small { font-size: 0.7em; }
    .desc { margin: 0; line-height: 1.45; font-style: italic; color: var(--muted); }
    h3 { font-size: var(--step-0); margin: 0; }
    .skill { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; border-radius: 12px; background: var(--turf-soft); }
    .skill.neg { background: color-mix(in srgb, var(--danger) 12%, transparent); }
    .skill.off { opacity: 0.6; }
    .skill p { margin: 2px 0 0; }
    .sign { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; background: var(--turf); color: var(--turf-ink); }
    .skill.neg .sign { background: var(--danger); color: #fff; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
    .grid div { display: flex; flex-direction: column; align-items: center; padding: 8px 4px; border-radius: 10px; background: var(--surface-2); text-align: center; }
    .grid strong { font: 800 var(--step-1)/1.1 var(--font-display); }
    .day { border: 1px solid var(--line); border-radius: 12px; padding: 0 12px; }
    .day summary { display: flex; align-items: center; gap: 8px; min-height: 44px; cursor: pointer; list-style: none; }
    .day summary::-webkit-details-marker { display: none; }
    .day ul { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: var(--step--1); }
    .day li { display: flex; justify-content: space-between; gap: 10px; }
    .tag { margin-left: 6px; }
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
