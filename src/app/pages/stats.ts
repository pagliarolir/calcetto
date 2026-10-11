import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { fmtDate } from '../core/format';
import { AttendanceRow, StatsRow } from '../core/models';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';

type Period = 'last' | 'month' | 'year' | 'all' | 'custom';
type Col = { key: keyof StatsRow; label: string; title: string; fmt?: 'dec' | 'pct' | 'form'; asc?: boolean };

const COLUMNS: Col[] = [
  { key: 'points', label: 'Pt', title: 'Punti (3 vittoria, 1 pareggio)' },
  { key: 'played', label: 'PG', title: 'Partite giocate' },
  { key: 'wins', label: 'V', title: 'Vittorie' },
  { key: 'draws', label: 'N', title: 'Pareggi' },
  { key: 'losses', label: 'P', title: 'Sconfitte' },
  { key: 'points_per_game', label: 'Pt/PG', title: 'Punti per partita', fmt: 'dec' },
  { key: 'win_pct', label: '%V', title: 'Percentuale vittorie', fmt: 'pct' },
  { key: 'goals', label: 'Gol', title: 'Gol segnati' },
  { key: 'goals_per_game', label: 'Gol/PG', title: 'Gol per partita', fmt: 'dec' },
  { key: 'assists', label: 'Ast', title: 'Assist' },
  { key: 'own_goals', label: 'Aut', title: 'Autogol' },
  { key: 'team_goals_for', label: 'GF', title: 'Gol fatti dalle sue squadre' },
  { key: 'team_goals_against', label: 'GS', title: 'Gol subiti dalle sue squadre', asc: true },
  { key: 'team_goal_diff', label: 'DR', title: 'Differenza reti delle sue squadre' },
  { key: 'avg_vote', label: 'Voto', title: 'Media voto ricevuto', fmt: 'dec' },
  { key: 'best_avg_vote', label: 'Max', title: 'Miglior media in una partita', fmt: 'dec' },
  { key: 'worst_avg_vote', label: 'Min', title: 'Peggior media in una partita', fmt: 'dec' },
  { key: 'mvp_count', label: 'MVP', title: 'Volte migliore in campo' },
  { key: 'best_win_streak', label: 'Serie V', title: 'Più vittorie di fila' },
  { key: 'attendances', label: 'Pres', title: 'Presenze' },
  { key: 'late_withdrawals', label: 'Forf', title: 'Rinunce nelle 24 ore', asc: true },
  { key: 'current_form', label: 'Forma', title: 'Ultime 5 partite', fmt: 'form' },
];

interface Record { label: string; key: keyof StatsRow; suffix: string; open?: boolean; minPlayed?: number }

const RECORDS: Record[] = [
  { label: 'Più volte migliore in campo', key: 'mvp_count', suffix: 'volte' },
  { label: 'Capocannoniere', key: 'goals', suffix: 'gol' },
  { label: 'Re degli assist', key: 'assists', suffix: 'assist' },
  { label: 'Più vittorie', key: 'wins', suffix: 'vittorie' },
  { label: 'Media voto più alta', key: 'avg_vote', suffix: '', minPlayed: 3 },
  { label: 'Più vittorie di fila', key: 'best_win_streak', suffix: 'di fila' },
  { label: 'Serie di vittorie in corso', key: 'cur_win_streak', suffix: 'di fila', open: true },
  { label: 'Imbattuto più a lungo', key: 'best_unbeaten', suffix: 'partite' },
  { label: 'Imbattibilità in corso', key: 'cur_unbeaten', suffix: 'partite', open: true },
  { label: 'Più sconfitte di fila', key: 'worst_loss_streak', suffix: 'di fila' },
  { label: 'Digiuno di vittorie più lungo', key: 'worst_winless', suffix: 'partite' },
  { label: 'Digiuno in corso', key: 'cur_winless', suffix: 'partite', open: true },
  { label: 'Più sconfitte', key: 'losses', suffix: 'sconfitte' },
  { label: 'Più autogol', key: 'own_goals', suffix: 'autogol' },
  { label: 'Sempre presente', key: 'attendances', suffix: 'presenze' },
];

@Component({
  selector: 'app-stats',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page stack-l">
      <header class="stack">
        <h1>Classifica</h1>
        <div class="chips" role="group" aria-label="Periodo">
          @for (p of periods; track p.id) {
            <button class="chip" [attr.aria-pressed]="period() === p.id" (click)="period.set(p.id)">{{ p.label }}</button>
          }
        </div>
        @if (period() === 'custom') {
          <div class="row">
            <label class="field grow"><span>Dal</span><input class="input" type="date" [(ngModel)]="customFrom" (change)="reload()" /></label>
            <label class="field grow"><span>Al</span><input class="input" type="date" [(ngModel)]="customTo" (change)="reload()" /></label>
          </div>
        }
        <p class="small muted">{{ rangeText() }}. Contano solo le partite con risultato omologato.</p>
      </header>

      @if (loading()) {
        <p class="muted">Calcolo in corso…</p>
      } @else if (!played().length) {
        <p class="empty">Nessuna partita omologata in questo periodo.</p>
      } @else {
        <section class="section">
          <header><h2>Serie e record</h2></header>
          <ul class="list">
            @for (r of records(); track r.label) {
              <li class="list-item">
                <span class="grow">
                  <span class="small muted">{{ r.label }}</span>
                  @if (r.open) { <span class="tag turf">aperta</span> }<br />
                  <strong>{{ r.names }}</strong>
                </span>
                <span class="num big">{{ r.value }}</span><span class="small muted">{{ r.suffix }}</span>
              </li>
            }
          </ul>
        </section>

        <section class="section">
          <header><h2>Tabella</h2><span class="small muted">tocca una colonna per ordinare</span></header>
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th scope="col">Giocatore</th>
                  @for (c of columns; track c.key) {
                    <th scope="col" [attr.aria-sort]="sortKey() === c.key ? (sortAsc() ? 'ascending' : 'descending') : null" [title]="c.title">
                      <button (click)="sort(c)">{{ c.label }}</button>
                    </th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (r of sorted(); track r.user_id) {
                  <tr [class.me]="r.user_id === session.uid()">
                    <td><a [routerLink]="['/giocatore', r.user_id]">{{ session.name(r.user_id) }}</a></td>
                    @for (c of columns; track c.key) { <td>{{ cell(r, c) }}</td> }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="section">
          <header><h2>Registro presenze</h2></header>
          <p class="small muted">● in campo, ○ riserva, × assente, ! rinuncia nelle 24 ore</p>
          <div class="table-wrap">
            <table class="data register">
              <thead>
                <tr><th scope="col">Giocatore</th>
                  @for (m of registerMatches(); track m.id) { <th scope="col">{{ date(m.at) }}</th> }
                </tr>
              </thead>
              <tbody>
                @for (u of registerUsers(); track u) {
                  <tr [class.me]="u === session.uid()">
                    <td>{{ session.name(u) }}</td>
                    @for (m of registerMatches(); track m.id) { <td>{{ mark(u, m.id) }}</td> }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    </main>
  `,
  styles: `
    .big { font-size: var(--step-2); font-weight: 700; margin-left: 8px; }
    .list-item .small.muted:last-child { margin-left: 4px; min-width: 52px; }
    td a { text-decoration: none; font-weight: 600; }
    .register td:not(:first-child), .register th:not(:first-child) { text-align: center; }
  `,
})
export class StatsPage {
  private readonly api = inject(Api);
  protected readonly session = inject(Session);
  private readonly toasts = inject(Toasts);

  protected readonly periods: { id: Period; label: string }[] = [
    { id: 'all', label: 'Sempre' },
    { id: 'year', label: 'Quest\'anno' },
    { id: 'month', label: 'Ultimo mese' },
    { id: 'last', label: 'Ultima partita' },
    { id: 'custom', label: 'Scegli le date' },
  ];
  protected readonly columns = COLUMNS;
  protected readonly date = fmtDate;

  protected readonly period = signal<Period>('year');
  protected readonly rows = signal<StatsRow[]>([]);
  protected readonly register = signal<AttendanceRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly range = signal<{ from: string | null; to: string | null }>({ from: null, to: null });
  protected readonly sortKey = signal<keyof StatsRow>('points');
  protected readonly sortAsc = signal(false);
  protected customFrom = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
  protected customTo = new Date().toISOString().slice(0, 10);

  protected readonly played = computed(() => this.rows().filter((r) => r.played > 0));

  protected readonly sorted = computed(() => {
    const k = this.sortKey();
    const dir = this.sortAsc() ? 1 : -1;
    return [...this.rows().filter((r) => r.played > 0 || r.attendances > 0)].sort((a, b) => {
      const av = a[k] as number | null;
      const bv = b[k] as number | null;
      if (av === bv) return b.points - a.points;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av > bv ? 1 : -1) * dir;
    });
  });

  protected readonly records = computed(() =>
    RECORDS.map((r) => {
      const pool = this.played().filter((x) => x.played >= (r.minPlayed ?? 1));
      const best = Math.max(...pool.map((x) => Number(x[r.key] ?? 0)));
      if (!isFinite(best) || best <= 0) return null;
      const who = pool.filter((x) => Number(x[r.key] ?? 0) === best).map((x) => this.session.name(x.user_id));
      return {
        ...r,
        value: r.key === 'avg_vote' ? best.toFixed(2).replace('.', ',') : best,
        names: who.length > 3 ? `${who.slice(0, 3).join(', ')} e altri ${who.length - 3}` : who.join(', '),
      };
    }).filter((x): x is NonNullable<typeof x> => x !== null),
  );

  protected readonly registerMatches = computed(() => {
    const seen = new Map<string, string>();
    for (const r of this.register()) seen.set(r.match_id, r.starts_at);
    return [...seen].map(([id, at]) => ({ id, at })).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
  });

  protected readonly registerUsers = computed(() => {
    const ids = new Set(this.register().filter((r) => r.list === 'team').map((r) => r.user_id));
    return [...ids].sort((a, b) => this.session.name(a).localeCompare(this.session.name(b), 'it'));
  });

  private readonly registerIndex = computed(() => new Map(this.register().map((r) => [`${r.user_id}:${r.match_id}`, r])));

  protected readonly rangeText = computed(() => {
    const { from, to } = this.range();
    if (!from && !to) return 'Tutte le partite';
    if (this.period() === 'last' && from) return `Partita del ${fmtDate(from)}`;
    return `Dal ${from ? fmtDate(from) : 'primo giorno'} al ${to ? fmtDate(new Date(new Date(to).getTime() - 1).toISOString()) : 'oggi'}`;
  });

  constructor() {
    effect(() => {
      this.period();
      void this.reload();
    });
  }

  protected async reload(): Promise<void> {
    this.loading.set(true);
    try {
      const r = await this.computeRange();
      this.range.set(r);
      const [rows, reg] = await Promise.all([this.api.stats(r.from, r.to), this.api.attendance(r.from, r.to)]);
      this.rows.set(rows);
      this.register.set(reg);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  private async computeRange(): Promise<{ from: string | null; to: string | null }> {
    const now = new Date();
    switch (this.period()) {
      case 'all': return { from: null, to: null };
      case 'year': return { from: new Date(now.getFullYear(), 0, 1).toISOString(), to: new Date(now.getFullYear() + 1, 0, 1).toISOString() };
      case 'month': return { from: new Date(now.getTime() - 30 * 86_400_000).toISOString(), to: null };
      case 'last': {
        const m = await this.api.lastPlayedMatch();
        if (!m) return { from: now.toISOString(), to: now.toISOString() };
        return { from: m.starts_at, to: new Date(new Date(m.starts_at).getTime() + 60_000).toISOString() };
      }
      case 'custom': {
        const to = new Date(this.customTo);
        to.setDate(to.getDate() + 1);
        return { from: new Date(this.customFrom).toISOString(), to: to.toISOString() };
      }
    }
  }

  protected sort(c: Col): void {
    if (this.sortKey() === c.key) this.sortAsc.set(!this.sortAsc());
    else {
      this.sortKey.set(c.key);
      this.sortAsc.set(!!c.asc);
    }
  }

  protected cell(r: StatsRow, c: Col): string {
    const v = r[c.key];
    if (v === null || v === undefined || v === '') return '–';
    if (c.fmt === 'form') return String(v).replace(/W/g, 'V').replace(/D/g, 'N').replace(/L/g, 'P');
    if (c.fmt === 'dec') return Number(v).toFixed(2).replace('.', ',');
    if (c.fmt === 'pct') return `${Number(v).toFixed(0)}%`;
    return String(v);
  }

  protected mark(u: string, m: string): string {
    const r = this.registerIndex().get(`${u}:${m}`);
    if (!r) return '';
    if (r.late_withdrawal) return '!';
    return r.list === 'team' ? '●' : r.list === 'reserve' ? '○' : '×';
  }
}
