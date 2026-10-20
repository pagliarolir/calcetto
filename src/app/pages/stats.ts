import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { kit } from '../core/kits';
import { Api } from '../core/api';
import { fmtDate, fmtWhen } from '../core/format';
import { AttendanceRow, KitStatsRow, LeaderPointsEntry, LeaderPointsRow, PairRow, StatsRow } from '../core/models';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { Avatar } from '../ui/avatar';

type Period = 'last' | 'month' | 'year' | 'all' | 'custom';
type Tab = 'classifica' | 'record' | 'presenze' | 'squadre' | 'coppie' | 'punti';
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
  imports: [FormsModule, RouterLink, Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page stack-l">
      <header class="stack">
        <h1>Classifica</h1>
        @if (tab() !== 'punti') {
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
        @if (statsSince(); as d) { <p class="note">Classifica azzerata {{ whenFull(d) }}: contano solo le partite successive.</p> }
        } @else {
        <p class="small muted">I punti Leader non dipendono dalle partite: valgono sempre.</p>
        }
      </header>

      <nav class="stabs" role="tablist" aria-label="Statistiche">
        @for (t of tabs; track t.id) {
          <button role="tab" [id]="'tab-' + t.id" [attr.aria-selected]="tab() === t.id" [attr.aria-controls]="'panel-' + t.id"
                  [attr.tabindex]="tab() === t.id ? 0 : -1" (click)="selectTab(t.id)" (keydown)="tabKey($event)">{{ t.label }}</button>
        }
      </nav>

      <div class="tabpanel" role="tabpanel" [id]="'panel-' + tab()" [attr.aria-labelledby]="'tab-' + tab()">
      @if (tab() === 'punti') {
        <!-- ======================================================= Punti Leader -->
        @if (session.isLeader()) {
          <section class="panel stack award" aria-labelledby="award-h">
            <h2 id="award-h">Assegna punti Leader</h2>
            <label class="field"><span>Giocatore</span>
              <select class="input" [(ngModel)]="lpUser">
                <option value="">Scegli un giocatore</option>
                @for (mb of session.activeMembers(); track mb.id) { <option [value]="mb.id">{{ session.name(mb.id) }}</option> }
              </select>
            </label>
            <div class="row-wrap" role="group" aria-label="Punti rapidi">
              @for (q of quick; track q) {
                <button class="chip" [class.neg]="q < 0" [attr.aria-pressed]="lpPoints === q" (click)="lpPoints = q">{{ signed(q) }}</button>
              }
            </div>
            <div class="pair">
              <label class="field"><span>Punti (da -99 a +99)</span>
                <input class="input" type="number" inputmode="numeric" min="-99" max="99" step="1" [(ngModel)]="lpPoints" />
              </label>
              <label class="field"><span>Motivazione</span>
                <input class="input" [(ngModel)]="lpReason" maxlength="200" placeholder="Es. ha portato i palloni" />
              </label>
            </div>
            <button class="btn primary" [disabled]="busy() || !canAward()" (click)="award()">
              {{ lpPoints > 0 ? 'Assegna ' + signed(lpPoints) : lpPoints < 0 ? 'Togli ' + (-lpPoints) : 'Assegna' }}{{ lpUser ? ' a ' + session.name(lpUser) : '' }}
            </button>
          </section>
        }

        <section class="section" aria-labelledby="lp-h">
          <header><h2 id="lp-h">Classifica punti Leader</h2></header>
          @if (lpTable().length) {
            <ol class="lp-rank">
              @for (r of lpTable(); track r.user_id; let i = $index) {
                <li [class.me]="r.user_id === session.uid()" [class.top]="i < 3 && r.total > 0">
                  <span class="pos num">{{ i + 1 }}</span>
                  <app-avatar [userId]="r.user_id" [size]="34" />
                  <span class="grow"><a [routerLink]="['/giocatore', r.user_id]">{{ session.name(r.user_id) }}</a><br />
                    <span class="small muted">{{ r.awards === 1 ? '1 assegnazione' : r.awards + ' assegnazioni' }}</span></span>
                  <span class="pts num" [class.neg]="r.total < 0">{{ signed(r.total) }}</span>
                </li>
              }
            </ol>
          } @else { <p class="empty">Ancora nessun punto Leader.</p> }
        </section>

        @if (lpHistory().length) {
          <section class="section" aria-labelledby="lph-h">
            <header><h2 id="lph-h">Storico</h2></header>
            <ul class="lp-hist">
              @for (e of lpHistory(); track e.id) {
                <li>
                  <span class="pts num" [class.neg]="e.points < 0">{{ signed(e.points) }}</span>
                  <span class="grow">
                    <strong>{{ session.name(e.user_id) }}</strong>: {{ e.reason }}<br />
                    <span class="small muted">{{ e.created_by ? session.name(e.created_by) + ', ' : '' }}{{ whenFull(e.created_at) }}</span>
                  </span>
                  @if (session.isLeader()) {
                    <button class="icon-btn" [disabled]="busy()" (click)="undoPoints(e)" [attr.aria-label]="'Annulla ' + signed(e.points) + ' a ' + session.name(e.user_id)">✕</button>
                  }
                </li>
              }
            </ul>
          </section>
        }
      } @else if (loading()) {
        <p class="muted">Calcolo in corso…</p>
      } @else if (!played().length) {
        <p class="empty">Nessuna partita omologata in questo periodo.</p>
      } @else {
        @switch (tab()) {
          @case ('classifica') {
        <section class="section">
          <header><h2>Classifica</h2><span class="small muted">tocca una colonna per ordinare</span></header>
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
                    <td><a class="who" [routerLink]="['/giocatore', r.user_id]"><app-avatar [userId]="r.user_id" [size]="26" />{{ session.name(r.user_id) }}</a></td>
                    @for (c of columns; track c.key) { <td>{{ cell(r, c) }}</td> }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

          }
          @case ('record') {
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

          }
          @case ('presenze') {
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
                    <td><span class="who"><app-avatar [userId]="u" [size]="22" />{{ session.name(u) }}</span></td>
                    @for (m of registerMatches(); track m.id) { <td>{{ mark(u, m.id) }}</td> }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
          }
          @case ('squadre') {
            <!-- ======================================================= Squadre -->
            <section class="section" aria-labelledby="kit-h">
              <header><h2 id="kit-h">Vittorie per colore</h2></header>
              <div class="table-wrap">
                <table class="data">
                  <thead><tr><th scope="col">Squadra</th><th scope="col">PG</th><th scope="col">V</th><th scope="col">N</th><th scope="col">P</th><th scope="col">%V</th></tr></thead>
                  <tbody>
                    @for (k of kitRows(); track k.kit) {
                      <tr><td><span class="who"><i class="dot" [style.background]="kitOf(k.kit).color"></i>{{ kitOf(k.kit).name }}</span></td>
                        <td>{{ k.played }}</td><td>{{ k.wins }}</td><td>{{ k.draws }}</td><td>{{ k.losses }}</td><td>{{ pct(k.wins, k.played) }}</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            </section>
            <section class="section" aria-labelledby="pkit-h">
              <header><h2 id="pkit-h">Con quale colore vince</h2></header>
              <label class="field"><span>Giocatore</span>
                <select class="input" [ngModel]="focus()" (ngModelChange)="focus.set($event)">
                  @for (r of played(); track r.user_id) { <option [value]="r.user_id">{{ session.name(r.user_id) }}</option> }
                </select>
              </label>
              <ul class="bars">
                @for (k of focusKits(); track k.kit) {
                  <li>
                    <span class="who"><i class="dot" [style.background]="kitOf(k.kit).color"></i>{{ kitOf(k.kit).name }}</span>
                    <span class="bar" aria-hidden="true"><i [style.width.%]="share(k.wins, k.played)"></i></span>
                    <span class="small"><strong>{{ pct(k.wins, k.played) }}</strong> {{ k.wins }}V {{ k.draws }}N {{ k.losses }}P</span>
                  </li>
                } @empty { <li class="small muted">Nessuna partita in questo periodo.</li> }
              </ul>
            </section>
          }
          @case ('coppie') {
            <!-- ======================================================= Coppie -->
            <section class="section" aria-labelledby="aff-h">
              <header><h2 id="aff-h">Affinità</h2></header>
              <label class="field"><span>Giocatore</span>
                <select class="input" [ngModel]="focus()" (ngModelChange)="focus.set($event)">
                  @for (r of played(); track r.user_id) { <option [value]="r.user_id">{{ session.name(r.user_id) }}</option> }
                </select>
              </label>
              @if (bestMate(); as b) {
                <p class="note">Con <strong>{{ session.name(b.other) }}</strong> vince il {{ pct(b.wins, b.games) }} delle partite giocate insieme ({{ b.wins }} su {{ b.games }}).</p>
              }
              <h3>Da compagni</h3>
              <ul class="bars">
                @for (x of mates(); track x.other) {
                  <li>
                    <span class="who"><app-avatar [userId]="x.other" [size]="24" />{{ session.name(x.other) }}</span>
                    <span class="bar" aria-hidden="true"><i [style.width.%]="share(x.wins, x.games)"></i></span>
                    <span class="small"><strong>{{ pct(x.wins, x.games) }}</strong> {{ x.wins }} su {{ x.games }}</span>
                  </li>
                } @empty { <li class="small muted">Nessuna partita insieme in questo periodo.</li> }
              </ul>
              <h3>Da avversari</h3>
              <ul class="bars">
                @for (x of rivals(); track x.other) {
                  <li>
                    <span class="who"><app-avatar [userId]="x.other" [size]="24" />{{ session.name(x.other) }}</span>
                    <span class="bar rival" aria-hidden="true"><i [style.width.%]="share(x.wins, x.games)"></i></span>
                    <span class="small"><strong>{{ x.wins }}-{{ x.draws }}-{{ x.losses }}</strong> in {{ x.games }}</span>
                  </li>
                } @empty { <li class="small muted">Nessuna sfida in questo periodo.</li> }
              </ul>
              <p class="small muted">Barre: percentuale di vittorie. Da avversari: vittorie, pareggi e sconfitte di {{ session.name(focus()) }}.</p>
            </section>

            <section class="section" aria-labelledby="tog-h">
              <header><h2 id="tog-h">Coppie più affiatate</h2><span class="small muted">più partite da compagni</span></header>
              <ol class="pairs">
                @for (x of topTogether(); track x.a_id + x.b_id) {
                  <li><span class="duo"><app-avatar [userId]="x.a_id" [size]="24" /><app-avatar [userId]="x.b_id" [size]="24" /></span>
                    <span class="grow">{{ session.name(x.a_id) }} e {{ session.name(x.b_id) }}</span>
                    <span class="small"><strong>{{ x.together }}</strong> insieme, {{ pct(x.together_wins, x.together) }} vinte</span></li>
                }
              </ol>
            </section>
            <section class="section" aria-labelledby="riv-h">
              <header><h2 id="riv-h">Grandi rivalità</h2><span class="small muted">più partite da avversari</span></header>
              <ol class="pairs">
                @for (x of topAgainst(); track x.a_id + x.b_id) {
                  <li><span class="duo"><app-avatar [userId]="x.a_id" [size]="24" /><app-avatar [userId]="x.b_id" [size]="24" /></span>
                    <span class="grow">{{ session.name(x.a_id) }} contro {{ session.name(x.b_id) }}</span>
                    <span class="small"><strong>{{ x.against }}</strong> sfide, {{ x.a_wins }}-{{ x.against_draws }}-{{ x.b_wins }}</span></li>
                }
              </ol>
            </section>
          }
        }
      }
      </div>
    </main>
  `,
  styles: `
    .big { font-size: var(--step-2); font-weight: 700; margin-left: 8px; }
    .list-item .small.muted:last-child { margin-left: 4px; min-width: 52px; }
    td a { text-decoration: none; font-weight: 600; }
    .who { display: inline-flex; align-items: center; gap: 8px; }
    .register td:not(:first-child), .register th:not(:first-child) { text-align: center; }
    .stabs { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; border-bottom: 1px solid var(--line); margin-top: -8px; }
    .stabs::-webkit-scrollbar { display: none; }
    .stabs button { appearance: none; background: none; border: 0; border-bottom: 3px solid transparent; padding: 10px 12px; min-height: 44px;
      font: 600 var(--step-0)/1 var(--font-body); color: var(--muted); white-space: nowrap; cursor: pointer; }
    .stabs button[aria-selected='true'] { color: var(--ink); border-bottom-color: var(--turf); }
    .tabpanel { display: flex; flex-direction: column; gap: var(--space-l, 24px); }
    .pair { display: grid; grid-template-columns: 1fr 1.6fr; gap: 8px; }
    .chip.neg[aria-pressed='true'] { background: var(--danger); border-color: var(--danger); }
    .award { border: 2px solid var(--armband); }
    .lp-rank, .lp-hist, .bars, .pairs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .lp-rank li, .lp-hist li, .pairs li { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line); min-width: 0; }
    .lp-rank li.me { background: var(--turf-soft); border-radius: 12px; padding-left: 8px; padding-right: 8px; }
    .lp-rank a { color: inherit; text-decoration: none; font-weight: 600; }
    .pos { width: 22px; text-align: center; color: var(--muted); font-weight: 700; }
    .lp-rank li.top .pos { color: var(--armband-ink, var(--ink)); background: var(--armband); border-radius: 50%; height: 22px; line-height: 22px; font-size: 0.8rem; }
    .pts { font: 700 var(--step-1)/1 var(--font-display); color: var(--turf); min-width: 48px; text-align: right; }
    .pts.neg { color: var(--danger); }
    .lp-hist .pts { min-width: 44px; text-align: left; font-size: var(--step-0); }
    .bars li { display: grid; grid-template-columns: minmax(0, 1.1fr) 1fr auto; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line); }
    .bar { height: 8px; border-radius: 999px; background: var(--surface-2, rgb(0 0 0 / 8%)); overflow: hidden; }
    .bar i { display: block; height: 100%; background: var(--turf); border-radius: inherit; }
    .bar.rival i { background: var(--armband); }
    .dot { display: inline-block; width: 14px; height: 14px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 25%); flex: none; }
    .duo { display: inline-flex; }
    .duo app-avatar + app-avatar { margin-left: -8px; box-shadow: 0 0 0 2px var(--bg); }
    h3 { font: 600 var(--step-1)/1.2 var(--font-display); margin: 8px 0 0; }
  `,
})
export class StatsPage {
  private readonly api = inject(Api);
  protected readonly session = inject(Session);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);

  protected readonly periods: { id: Period; label: string }[] = [
    { id: 'all', label: 'Sempre' },
    { id: 'year', label: 'Quest\'anno' },
    { id: 'month', label: 'Ultimo mese' },
    { id: 'last', label: 'Ultima partita' },
    { id: 'custom', label: 'Scegli le date' },
  ];
  protected readonly columns = COLUMNS;
  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'classifica', label: 'Classifica' },
    { id: 'record', label: 'Record' },
    { id: 'presenze', label: 'Presenze' },
    { id: 'squadre', label: 'Squadre' },
    { id: 'coppie', label: 'Coppie' },
    { id: 'punti', label: 'Punti Leader' },
  ];
  protected readonly tab = signal<Tab>('classifica');
  protected readonly busy = signal(false);
  protected readonly quick = [-10, -5, -1, 1, 5, 10];
  protected lpUser = '';
  protected lpPoints = 5;
  protected lpReason = '';
  protected readonly lpTable = signal<LeaderPointsRow[]>([]);
  protected readonly lpHistory = signal<LeaderPointsEntry[]>([]);
  protected readonly kitRows = signal<KitStatsRow[]>([]);
  protected readonly playerKits = signal<KitStatsRow[]>([]);
  protected readonly pairs = signal<PairRow[]>([]);
  /** giocatore di riferimento per Squadre e Coppie (all'inizio chi guarda) */
  protected readonly focus = signal<string>('');
  protected readonly kitOf = kit;
  protected readonly date = fmtDate;
  protected readonly whenFull = fmtWhen;
  protected readonly statsSince = signal<string | null>(null);

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
    const q = inject(ActivatedRoute).snapshot.queryParamMap.get('scheda') as Tab | null;
    if (q && this.tabs.some((t) => t.id === q)) this.tab.set(q);
    this.focus.set(this.session.uid() ?? '');
    effect(() => {
      this.period();
      void this.reload();
    });
    void this.loadPoints();
  }

  // ------------------------------------------------------------------ schede
  protected selectTab(t: Tab): void {
    this.tab.set(t);
    void this.router.navigate([], { queryParams: { scheda: t === 'classifica' ? null : t }, replaceUrl: true });
  }

  /** frecce sinistra e destra per passare da una scheda all'altra (tastiera) */
  protected tabKey(e: KeyboardEvent): void {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = this.tabs.findIndex((t) => t.id === this.tab());
    const next = this.tabs[(i + (e.key === 'ArrowRight' ? 1 : this.tabs.length - 1)) % this.tabs.length].id;
    this.selectTab(next);
    document.getElementById('tab-' + next)?.focus();
  }

  // ------------------------------------------------------------------ squadre e coppie
  protected pct(n: number, d: number): string {
    return d ? `${Math.round((100 * n) / d)}%` : '–';
  }

  protected share(n: number, d: number): number {
    return d ? (100 * n) / d : 0;
  }

  protected readonly focusKits = computed(() =>
    this.playerKits().filter((k) => k.user_id === this.focus()).sort((a, b) => this.share(b.wins, b.played) - this.share(a.wins, a.played) || b.played - a.played));

  /** compagni del giocatore scelto, dal più vincente */
  protected readonly mates = computed(() => {
    const me = this.focus();
    return this.pairs()
      .filter((p) => (p.a_id === me || p.b_id === me) && p.together > 0)
      .map((p) => ({ other: p.a_id === me ? p.b_id : p.a_id, games: p.together, wins: p.together_wins, draws: p.together_draws }))
      .sort((a, b) => this.share(b.wins, b.games) - this.share(a.wins, a.games) || b.games - a.games);
  });

  /** avversari del giocatore scelto, dal più battuto */
  protected readonly rivals = computed(() => {
    const me = this.focus();
    return this.pairs()
      .filter((p) => (p.a_id === me || p.b_id === me) && p.against > 0)
      .map((p) => {
        const mine = p.a_id === me;
        return { other: mine ? p.b_id : p.a_id, games: p.against, wins: mine ? p.a_wins : p.b_wins, losses: mine ? p.b_wins : p.a_wins, draws: p.against_draws };
      })
      .sort((a, b) => this.share(b.wins, b.games) - this.share(a.wins, a.games) || b.games - a.games);
  });

  /** il compagno con cui vince di più (almeno 3 partite insieme, per non premiare il caso) */
  protected readonly bestMate = computed(() => this.mates().find((m) => m.games >= 3 && m.wins > 0) ?? null);

  protected readonly topTogether = computed(() =>
    [...this.pairs()].filter((p) => p.together > 0).sort((a, b) => b.together - a.together || b.together_wins - a.together_wins).slice(0, 10));

  protected readonly topAgainst = computed(() =>
    [...this.pairs()].filter((p) => p.against > 0).sort((a, b) => b.against - a.against).slice(0, 10));

  // ------------------------------------------------------------------ punti Leader
  protected signed(n: number): string {
    return n > 0 ? `+${n}` : String(n);
  }

  protected canAward(): boolean {
    const n = Number(this.lpPoints);
    return !!this.lpUser && Number.isInteger(n) && n !== 0 && n >= -99 && n <= 99 && !!this.lpReason.trim();
  }

  private async loadPoints(): Promise<void> {
    try {
      const [t, h] = await Promise.all([this.api.leaderPointsTable(), this.api.leaderPointsHistory()]);
      this.lpTable.set(t);
      this.lpHistory.set(h);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }

  protected async award(): Promise<void> {
    const n = Number(this.lpPoints);
    const name = this.session.name(this.lpUser);
    this.busy.set(true);
    try {
      await this.api.awardLeaderPoints(this.lpUser, n, this.lpReason.trim());
      this.toasts.show(`${this.signed(n)} punti Leader a ${name}.`);
      this.lpReason = '';
      await this.loadPoints();
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async undoPoints(e: LeaderPointsEntry): Promise<void> {
    if (!confirm(`Annullare ${this.signed(e.points)} a ${this.session.name(e.user_id)} («${e.reason}»)?`)) return;
    this.busy.set(true);
    try {
      await this.api.deleteLeaderPoints(e.id);
      this.toasts.show('Assegnazione annullata.');
      await this.loadPoints();
    } catch (err) {
      this.toasts.error(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async reload(): Promise<void> {
    this.loading.set(true);
    try {
      const r = await this.computeRange();
      this.range.set(r);
      const [rows, reg, kits, pkits, pairs] = await Promise.all([
        this.api.stats(r.from, r.to), this.api.attendance(r.from, r.to),
        this.api.teamKitStats(r.from, r.to), this.api.playerKitStats(r.from, r.to), this.api.pairStats(r.from, r.to),
      ]);
      this.rows.set(rows);
      this.kitRows.set(kits);
      this.playerKits.set(pkits);
      this.pairs.set(pairs);
      // se chi guarda non ha giocato nel periodo, si parte dal primo della classifica
      if (!rows.some((x) => x.user_id === this.focus() && x.played > 0)) {
        const first = rows.find((x) => x.played > 0);
        if (first) this.focus.set(first.user_id);
      }
      void this.api.statsResetInfo(null).then((i) => this.statsSince.set(i.global)).catch(() => undefined);
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
