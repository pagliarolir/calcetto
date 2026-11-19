import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal, viewChild } from '@angular/core';
import { SharedReads } from '../core/shared-reads';
import { Empty } from '../ui/empty';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { FantaLeader, FlParams, fmtPts } from '../core/fantaleader';
import { fmtWhen } from '../core/format';
import { Match } from '../core/models';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { FlAdmin } from '../fantaleader/fl-admin';
import { FlPlayerSheet } from '../fantaleader/player-sheet';
import { FlTeam } from '../fantaleader/team-builder';
import { Avatar } from '../ui/avatar';
import { Skeleton } from '../ui/skeleton';
import { TopActions } from '../ui/top-actions';
import { Icon } from '../ui/icon';
import { InfoTip } from '../ui/info-tip';

type Tab = 'home' | 'squadra' | 'giocatori' | 'classifiche' | 'gestione';

@Component({
  selector: 'app-fantaleader-page',
  imports: [TopActions, FormsModule, Avatar, Skeleton, FlTeam, FlPlayerSheet, FlAdmin, Empty, Icon, InfoTip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-head">
      <div class="head-in">
        <header class="titlebar"><h1>FantaLeader</h1><app-top-actions /></header>
        <nav class="stabs" role="tablist" aria-label="FantaLeader">
          @for (t of tabs(); track t.id) {
            <button role="tab" [attr.aria-selected]="tab() === t.id" (click)="select(t.id)">{{ t.label }}</button>
          }
        </nav>
      </div>
    </div>

    <main class="scroll-area">
      <div class="page stack-l in-body">
        @if (!fl.loaded()) {
          <app-skeleton kind="lines" [rows]="6" />
        } @else {
          @switch (tab()) {
            @case ('home') {
              @let st = fl.settings()!;
              <!-- il «momento» della Home: la propria fantasquadra; lo stato del mercato è una riga sobria sotto -->
              @if (fl.myTeam(); as t) {
                <button type="button" class="hero-card" (click)="select('squadra')">
                  <span class="grow">
                    <span class="lbl">La tua fantasquadra</span>
                    <strong class="tn">{{ t.name }}</strong>
                    <span class="sub">{{ t.pos }}° posto, capitano {{ session.name(t.captain_id) }}</span>
                  </span>
                  <span class="score"><strong class="num">{{ fmt(t.total) }}</strong><small>punti</small></span>
                </button>
              } @else if (st.market_open) {
                <button class="btn primary block" (click)="select('squadra')"><app-icon name="plus" [size]="18" /> Crea la tua fantasquadra</button>
              }
              <div class="market" [class.open]="st.market_open">
                <app-icon [name]="st.market_open ? 'unlock' : 'lock'" [size]="18" />
                <span class="grow">{{ st.market_open ? 'Mercato aperto' : 'Mercato chiuso' }}@if (st.market_changed_at) { <span class="muted"> dal {{ when(st.market_changed_at) }}</span> }</span>
                <app-info-tip [lines]="st.market_open
                  ? ['Puoi creare o cambiare la tua fantasquadra: ' + st.team_size + ' giocatori, ' + st.budget + ' euroLeader e un capitano.']
                  : ['Le fantasquadre sono bloccate finché il Leader non riapre il mercato.']" />
              </div>
              @if (next(); as m) {
                <div class="market">
                  <app-icon name="calendar" [size]="18" />
                  <span class="grow">Prossima giornata <span class="muted">{{ when(m.starts_at) }}</span></span>
                  <app-info-tip [lines]="['I punti arrivano quando il risultato è omologato.', 'Diventano definitivi alla chiusura delle pagelle.']" />
                </div>
              }

              @if (fl.lastRound(); as lr) {
                <section class="section">
                  <header><h2>Ultima giornata</h2><span class="small muted">{{ day(lr.starts_at) }}</span></header>
                  <div class="last">
                    <div class="stack-s"><h3 class="sub-h">Fantasquadre</h3>
                    <ol class="list">
                      @for (t of lastTeams(); track t.team_id; let i = $index) {
                        <li class="list-item"><span class="pos num">{{ i + 1 }}</span><span class="grow ellipsis">{{ t.name }}</span><strong class="num">{{ fmt(t.last_points) }}</strong></li>
                      } @empty { <li class="list-item muted">Nessuna fantasquadra.</li> }
                    </ol></div>
                    <div class="stack-s"><h3 class="sub-h">Chi ha portato più punti</h3>
                    <ol class="list">
                      @for (r of lastPlayers().slice(0, 5); track r.user_id; let i = $index) {
                        <li><button type="button" class="list-item" (click)="sheet()?.open(r.user_id)"><span class="pos num">{{ i + 1 }}</span><app-avatar [userId]="r.user_id" [size]="28" />
                          <span class="grow ellipsis">{{ session.name(r.user_id) }}</span><strong class="num">{{ fmt(r.last_points) }}</strong></button></li>
                      }
                    </ol></div>
                  </div>
                </section>
              }

              <section class="section">
                <header><h2>Fantasquadre</h2><button class="link" (click)="select('classifiche', 'squadre')">Tutte <app-icon name="chevron" [size]="16" /></button></header>
                <ol class="list">
                  @for (t of fl.teams().slice(0, 3); track t.team_id) {
                    <li class="list-item"><span class="pos num">{{ t.pos }}</span><span class="grow two"><span class="ellipsis">{{ t.name }}</span><small class="muted">{{ session.name(t.owner_id) }}</small></span><strong class="num">{{ fmt(t.total) }}</strong></li>
                  } @empty { <li class="list-item muted">Ancora nessuna fantasquadra.</li> }
                </ol>
              </section>
              <section class="section">
                <header><h2>Giocatori</h2><button class="link" (click)="select('classifiche', 'giocatori')">Tutti <app-icon name="chevron" [size]="16" /></button></header>
                <ol class="list">
                  @for (r of fl.ranking().slice(0, 3); track r.user_id) {
                    <li><button type="button" class="list-item" (click)="sheet()?.open(r.user_id)"><span class="pos num">{{ r.pos }}</span><app-avatar [userId]="r.user_id" [size]="28" />
                      <span class="grow ellipsis">{{ session.name(r.user_id) }}</span><strong class="num">{{ fmt(r.total) }}</strong></button></li>
                  }
                </ol>
              </section>

              <details class="panel fold">
                <summary><h3>Come si fanno i punti</h3><app-icon name="chevron" [size]="18" class="chev" /></summary>
                @let pr = rules();
                <ul class="rules small">
                  <li>Presenza {{ sg(pr.presence) }}, gol {{ sg(pr.goal) }}, autogol {{ sg(pr.own_goal) }}, migliore in campo {{ sg(pr.mvp) }}, voto = media della pagella ({{ pr.vote_default }} se ci sono meno di {{ pr.vote_min_voters }} votanti), vittoria {{ sg(pr.win) }}, sconfitta {{ sg(pr.loss) }}, pareggio {{ sg(pr.draw) }}, Punti Leader della settimana.</li>
                  <li>Chi non gioca prende 0, salvo le skill che dicono altrimenti.</li>
                  <li>Coefficiente della settimana dalla classifica individuale prima della partita: {{ bands() }}.</li>
                  <li>Capitano: se gioca e vince, gli altri della fantasquadra valgono ×{{ fmt(pr.captain_bonus) }}.</li>
                  <li>Le skill di fantasquadra si sommano alla fantasquadra, non alla classifica individuale.</li>
                  <li>La quotazione attuale segue la media dei punti per giornata (le assenze contano 0) rispetto a quella di tutti, entro ±{{ fmt(pr.price_cap * 100) }}%.</li>
                  <li>Parità tra fantasquadre: punti del capitano, poi la squadra con il Leader, poi i punti dell’allenatore.</li>
                </ul>
              </details>
            }
            @case ('squadra') { <app-fl-team (openPlayer)="sheet()?.open($event)" /> }
            @case ('giocatori') {
              <div class="tools">
                <label class="search"><app-icon name="search" [size]="18" /><input class="input" type="search" [(ngModel)]="q" placeholder="Cerca un giocatore" aria-label="Cerca un giocatore" /></label>
                <select class="input" [(ngModel)]="sortBy" aria-label="Ordina per">
                  <option value="price">Quota</option><option value="initial">Quota iniziale</option><option value="pos">Posizione</option><option value="name">Nome</option>
                </select>
              </div>
              <ul class="list">
                @for (r of catalog(); track r.user_id) {
                  @let d = r.price_current - r.price_initial;
                  <li><button type="button" class="list-item" (click)="sheet()?.open(r.user_id)">
                    <app-avatar [userId]="r.user_id" [size]="40" />
                    <span class="grow two"><span class="ellipsis"><strong>{{ session.name(r.user_id) }}</strong></span>
                      <small class="muted">{{ r.pos }}° in classifica, {{ fmt(r.total) }} punti@if (fl.skillsOf(r.user_id).length; as n) {, {{ n }} skill}</small></span>
                    <span class="q" [attr.aria-label]="'Quota ' + r.price_current + (d ? ', ' + (d > 0 ? 'più ' : 'meno ') + (d > 0 ? d : -d) : '')">
                      <strong class="num">{{ r.price_current }}</strong>
                      @if (d !== 0) { <small class="num" [class.up]="d > 0" [class.down]="d < 0"><app-icon [name]="d > 0 ? 'up' : 'down'" [size]="12" />{{ d > 0 ? d : -d }}</small> }
                    </span>
                  </button></li>
                } @empty { <li class="empty"><app-empty icon="trophy" text="Nessun giocatore acquistabile: il Leader li prepara in Gestione." /></li> }
              </ul>
            }
            @case ('classifiche') {
              <div class="seg" role="tablist" aria-label="Classifiche">
                <button role="tab" [attr.aria-selected]="view() === 'squadre'" (click)="select('classifiche', 'squadre')">Fantasquadre</button>
                <button role="tab" [attr.aria-selected]="view() === 'giocatori'" (click)="select('classifiche', 'giocatori')">Giocatori</button>
              </div>
              @if (view() === 'squadre') {
                <ol class="list">
                  @for (t of fl.teams(); track t.team_id) {
                    <li class="fold-row">
                      <details>
                        <summary class="list-item">
                          <span class="pos num">{{ t.pos }}</span>
                          <span class="grow two"><span class="ellipsis"><strong>{{ t.name }}</strong></span><small class="muted">{{ session.name(t.owner_id) }}, ultima giornata {{ fmt(t.last_points) }}</small></span>
                          <strong class="num">{{ fmt(t.total) }}</strong>
                          <app-icon name="chevron" [size]="16" class="chev" />
                        </summary>
                        <div class="members">
                          @for (u of t.members; track u) {
                            <button type="button" (click)="sheet()?.open(u)"><span class="av"><app-avatar [userId]="u" [size]="36" />@if (u === t.captain_id) { <span class="cap" aria-label="Capitano">C</span> }</span>
                              <span class="small ellipsis">{{ session.name(u) }}</span></button>
                          }
                        </div>
                        @if (trend(t.team_id).length > 1) {
                          <p class="small muted trend">Giornate: @for (x of trend(t.team_id); track x.match_id; let last = $last) { {{ fmt(x.points) }}@if (!last) {, } }</p>
                        }
                      </details>
                    </li>
                  } @empty { <li class="empty"><app-empty icon="trophy" text="Ancora nessuna fantasquadra." /></li> }
                </ol>
              } @else {
                <ol class="list">
                  @for (r of fl.ranking(); track r.user_id) {
                    <li><button type="button" class="list-item" (click)="sheet()?.open(r.user_id)">
                      <span class="pos num">{{ r.pos }}</span><app-avatar [userId]="r.user_id" [size]="32" />
                      <span class="grow two"><span class="ellipsis"><strong>{{ session.name(r.user_id) }}</strong></span><small class="muted">quota {{ r.price_current }}, ultima giornata {{ fmt(r.last_points) }}</small></span>
                      @if (r.next_coef !== 1) { <span class="coef" [attr.aria-label]="'Coefficiente della prossima giornata ' + fmt(r.next_coef)">×{{ fmt(r.next_coef) }}</span> }
                      <strong class="num">{{ fmt(r.total) }}</strong>
                    </button></li>
                  }
                </ol>
                <p class="small muted foot"><app-info-tip [lines]="['Il «×» è il coefficiente della prossima giornata: moltiplica i punti di chi è più indietro.', 'I punti sono provvisori finché le pagelle sono aperte.']" /> Coefficiente e punti provvisori</p>
              }
            }
            @case ('gestione') { <app-fl-admin /> }
          }
        }
      </div>
    </main>
    <app-fl-player-sheet />
  `,
  styles: `
    :host { display: flex; flex-direction: column; flex: 1 1 0; min-height: 0; }
    /* schede su una riga, come in Classifica */
    .stabs { display: flex; flex-wrap: wrap; justify-content: space-evenly; border-bottom: 1px solid var(--line); }
    .stabs button { flex: 0 0 auto; appearance: none; background: none; border: 0; border-bottom: 3px solid transparent; cursor: pointer;
      padding: 12px 8px 8px; min-height: 44px; color: var(--muted); font: 600 var(--step--1)/1.1 var(--font-body); white-space: nowrap; }
    .stabs button[aria-selected='true'] { color: var(--ink); border-bottom-color: var(--turf); }
    .seg { display: flex; gap: 4px; padding: 4px; border-radius: 16px; background: var(--surface-2); }
    .seg button { flex: 1 0 auto; appearance: none; border: 0; background: transparent; color: var(--muted); cursor: pointer;
      min-height: 40px; padding: 0 12px; border-radius: 12px; font: 600 var(--step--1)/1 var(--font-body); white-space: nowrap; }
    .seg button[aria-selected='true'] { background: var(--surface); color: var(--ink); box-shadow: 0 1px 2px rgb(0 0 0 / 12%); }
    /* la propria fantasquadra: il «momento» della pagina, con il fondo dell'intestazione */
    .hero-card { display: flex; align-items: center; gap: 16px; width: 100%; padding: 20px; border: 0; border-radius: var(--r-l); text-align: left; cursor: pointer;
      background: var(--hero-bg); color: var(--hero-ink); }
    .hero-card .grow { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .hero-card .lbl, .hero-card .sub { font-size: var(--step--1); opacity: 0.85; }
    .hero-card .tn { font: 500 var(--step-2)/1.1 var(--font-display); overflow-wrap: anywhere; }
    .sub-h { margin: 0; font: 600 var(--step--1)/1.2 var(--font-body); color: var(--muted); }
    .hero-card .score { display: flex; flex-direction: column; align-items: center; flex: none; min-width: 72px; padding: 8px 12px; border-radius: var(--r-m);
      background: var(--chalk, #f4f7f2); color: var(--on-chalk); }
    .hero-card .score strong { font: 600 var(--step-3)/1 var(--font-display); }
    .hero-card .score small { font-size: 0.7rem; }
    .market { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 4px 0 16px; border-radius: var(--r-m); background: var(--surface-2); color: var(--ink); }
    .market > app-icon { color: var(--muted); }
    .market.open > app-icon { color: var(--turf); }
    .market .grow { min-width: 0; }
    .link { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; border: 0; background: none; color: color-mix(in srgb, var(--turf) 70%, var(--ink)); font: 600 var(--step--1)/1 var(--font-body); cursor: pointer; padding: 0; }
    .link app-icon { display: grid; }
    .section > header { align-items: center; }
    .list-item { min-height: 52px; padding: 8px 16px; gap: 12px; }
    .list strong.num { font: 600 var(--step-1)/1 var(--font-display); }
    .two { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .grow { flex: 1; }
    .ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pos { width: 20px; text-align: center; font-weight: 600; color: var(--muted); flex: none; }
    .last { display: grid; grid-template-columns: 1fr; gap: 12px; }
    @media (min-width: 560px) { .last { grid-template-columns: 1fr 1fr; } }
    .rules { margin: 0; padding-left: 1.1em; display: flex; flex-direction: column; gap: 8px; }
    .tools { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
    .search { position: relative; display: block; }
    .search app-icon { position: absolute; left: 12px; top: 50%; translate: 0 -50%; color: var(--muted); pointer-events: none; display: grid; }
    .search .input { padding-left: 40px; }
    .q { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex: none; }
    .q strong { font: 600 var(--step-1)/1 var(--font-display); }
    .q small { display: inline-flex; align-items: center; gap: 2px; font: 600 0.75rem/1 var(--font-body); }
    .up { color: color-mix(in srgb, var(--turf) 70%, var(--ink)); } .down { color: var(--danger); }
    .fold-row details > summary { list-style: none; cursor: pointer; }
    .fold-row details > summary::-webkit-details-marker { display: none; }
    .fold-row .chev { color: var(--muted); rotate: 90deg; transition: rotate 200ms var(--ease); display: grid; }
    .fold-row details[open] .chev { rotate: -90deg; }
    .fold-row:not(:last-child) { border-bottom: 1px solid var(--line); }
    .fold-row .list-item { border-bottom: 0; }
    .members { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px 8px; padding: 4px 16px 16px; }
    .members button { display: flex; flex-direction: column; align-items: center; gap: 4px; border: 0; background: none; color: inherit; cursor: pointer; min-width: 0; min-height: 44px; }
    .members .small { max-width: 100%; }
    .trend { margin: -8px 16px 12px; }
    .av { position: relative; display: inline-grid; }
    .cap { position: absolute; right: -4px; bottom: -4px; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center;
           background: var(--armband); color: var(--armband-ink); font: 600 0.7rem/1 var(--font-display); box-shadow: 0 0 0 2px var(--surface); }
    .coef { flex: none; font: 600 0.8rem/1 var(--font-body); color: var(--armband-ink); background: color-mix(in srgb, var(--armband) 40%, var(--surface)); padding: 4px 8px; border-radius: 8px; }
    .foot { display: flex; align-items: center; gap: 4px; margin: 0; }
    .empty { list-style: none; }
  `,
})
export class FantaLeaderPage implements OnInit {
  protected readonly fl = inject(FantaLeader);
  protected readonly session = inject(Session);
  private readonly shared = inject(SharedReads);
  private readonly toasts = inject(Toasts);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly sheet = viewChild(FlPlayerSheet);
  protected readonly fmt = fmtPts;
  protected readonly when = fmtWhen;
  protected readonly next = signal<Match | null>(null);
  protected q = '';
  /** la scheda Giocatori si apre ordinata per quota attuale */
  protected sortBy: 'price' | 'initial' | 'pos' | 'name' = 'price';

  protected readonly tabs = computed(() => [
    { id: 'home' as Tab, label: 'Home' }, { id: 'squadra' as Tab, label: 'Squadra' }, { id: 'giocatori' as Tab, label: 'Giocatori' },
    { id: 'classifiche' as Tab, label: 'Classifiche' },
    ...(this.session.isLeader() ? [{ id: 'gestione' as Tab, label: 'Gestione' }] : []),
  ]);
  protected readonly tab = signal<Tab>('home');
  protected readonly view = signal<'squadre' | 'giocatori'>('squadre');

  protected catalog() {
    const q = this.q.trim().toLowerCase();
    const ids = new Set(this.fl.eligible().map((p) => p.user_id));
    return this.fl.ranking()
      .filter((r) => ids.has(r.user_id) && (!q || this.session.name(r.user_id).toLowerCase().includes(q)))
      .sort((a, b) => this.sortBy === 'name' ? this.session.name(a.user_id).localeCompare(this.session.name(b.user_id))
        : this.sortBy === 'pos' ? a.pos - b.pos
        : this.sortBy === 'initial' ? b.price_initial - a.price_initial || b.price_current - a.price_current
        : b.price_current - a.price_current || b.price_initial - a.price_initial);
  }

  /** ultima giornata: fantasquadre e giocatori ordinati per i punti fatti in quella partita */
  protected lastTeams() {
    return [...this.fl.teams()].filter((t) => t.last_points !== null).sort((a, b) => (b.last_points ?? 0) - (a.last_points ?? 0));
  }
  protected lastPlayers() {
    return [...this.fl.ranking()].filter((r) => r.last_points !== null).sort((a, b) => (b.last_points ?? 0) - (a.last_points ?? 0));
  }
  protected day(iso: string): string {
    return new Date(iso).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Rome' });
  }
  /** le regole scritte con i numeri veri delle impostazioni */
  protected rules(): FlParams {
    return (this.fl.settings()?.params ?? {}) as unknown as FlParams;
  }
  protected sg(n: number | undefined): string {
    if (n === undefined || n === null) return '0';
    return (n > 0 ? '+' : n < 0 ? '−' : '') + this.fmt(Math.abs(n));
  }
  protected bands(): string {
    const b = this.rules().coef_bands ?? [];
    let from = 1;
    return b.map(([to, c]) => {
      // «dall'11°», «dall'8°», «dal 6°»
      const dal = /^(8|11|1\d?\d?$)/.test(String(from)) && (String(from).startsWith('8') || String(from) === '11' || String(from) === '1') ? "dall'" : 'dal ';
      const txt = to === null ? `${dal}${from}° ×${this.fmt(c)}` : `${from}°–${to}° ×${this.fmt(c)}`;
      if (to !== null) from = to + 1;
      return txt;
    }).join(' · ');
  }

  protected trend(teamId: string) {
    return this.fl.teamMatches().filter((x) => x.team_id === teamId).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;
    const t = qp.get('scheda') as Tab | null;
    if (t && this.tabs().some((x) => x.id === t)) this.tab.set(t);
    if (qp.get('vista') === 'giocatori') this.view.set('giocatori');
    void this.fl.load().catch((e) => this.toasts.error(errorMessage(e)));
    void this.shared.recentMatches(10).then((ms) => this.next.set(
      ms.filter((m) => m.status === 'scheduled' && m.starts_at > new Date().toISOString()).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ?? null,
    )).catch(() => undefined);
  }

  protected select(t: Tab, view?: 'squadre' | 'giocatori'): void {
    this.tab.set(t);
    if (view) this.view.set(view);
    void this.router.navigate([], {
      replaceUrl: true,
      queryParams: { scheda: t === 'home' ? null : t, vista: t === 'classifiche' && this.view() === 'giocatori' ? 'giocatori' : null },
    });
  }
}
