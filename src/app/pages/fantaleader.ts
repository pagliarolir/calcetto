import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Api } from '../core/api';
import { FantaLeader, fmtPts } from '../core/fantaleader';
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

type Tab = 'home' | 'squadra' | 'giocatori' | 'classifiche' | 'gestione';

@Component({
  selector: 'app-fantaleader-page',
  imports: [FormsModule, Avatar, Skeleton, FlTeam, FlPlayerSheet, FlAdmin],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-head">
      <div class="head-in">
        <header class="spread">
          <h1>FantaLeader</h1>
          @if (fl.settings(); as st) { <span class="tag" [class.turf]="st.market_open">{{ st.market_open ? 'Mercato aperto' : 'Mercato chiuso' }}</span> }
        </header>
        <nav class="stabs" role="tablist" aria-label="FantaLeader">
          <div class="srow" role="none">
            @for (t of tabs().slice(0, 3); track t.id) {
              <button role="tab" [attr.aria-selected]="tab() === t.id" (click)="select(t.id)">{{ t.label }}</button>
            }
          </div>
          <div class="srow" role="none">
            @for (t of tabs().slice(3); track t.id) {
              <button role="tab" [attr.aria-selected]="tab() === t.id" (click)="select(t.id)">{{ t.label }}</button>
            }
          </div>
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
              <section class="panel stack-s" [class.open]="st.market_open">
                <h2>{{ st.market_open ? 'Il mercato è aperto' : 'Il mercato è chiuso' }}</h2>
                <p class="small muted">{{ st.market_open
                  ? 'Puoi creare o cambiare la tua fantasquadra: ' + st.team_size + ' giocatori, ' + st.budget + ' euroLeader, un capitano.'
                  : 'Le fantasquadre sono bloccate fino alla prossima apertura decisa dal Leader.' }}</p>
                @if (st.market_changed_at) { <p class="small muted">Dal {{ when(st.market_changed_at) }}.</p> }
              </section>

              @if (fl.myTeam(); as t) {
                <button type="button" class="panel card" (click)="select('squadra')">
                  <span class="grow"><span class="small muted">La tua fantasquadra</span><strong class="tn">{{ t.name }}</strong>
                    <span class="small muted">{{ t.pos }}° posto · ultima giornata {{ fmt(t.last_points) }} · capitano {{ session.name(t.captain_id) }}</span></span>
                  <strong class="big num">{{ fmt(t.total) }}</strong>
                </button>
              } @else if (st.market_open) {
                <button class="btn primary block" (click)="select('squadra')">Crea la tua fantasquadra</button>
              }

              @if (next(); as m) {
                <p class="note">Prossima giornata: {{ when(m.starts_at) }}. I punti arrivano quando il risultato è omologato e diventano definitivi alla chiusura delle pagelle.</p>
              }

              <section class="stack-s">
                <div class="spread"><h2>Fantasquadre</h2><button class="link" (click)="select('classifiche', 'squadre')">Classifica</button></div>
                @for (t of fl.teams().slice(0, 3); track t.team_id) {
                  <div class="mini"><span class="pos num">{{ t.pos }}</span><span class="grow"><strong>{{ t.name }}</strong> <span class="small muted">{{ session.name(t.owner_id) }}</span></span><strong class="num">{{ fmt(t.total) }}</strong></div>
                } @empty { <p class="small muted">Ancora nessuna fantasquadra.</p> }
              </section>
              <section class="stack-s">
                <div class="spread"><h2>Giocatori</h2><button class="link" (click)="select('classifiche', 'giocatori')">Classifica</button></div>
                @for (r of fl.ranking().slice(0, 3); track r.user_id) {
                  <button type="button" class="mini" (click)="sheet()?.open(r.user_id)"><span class="pos num">{{ r.pos }}</span><app-avatar [userId]="r.user_id" [size]="28" />
                    <span class="grow"><strong>{{ session.name(r.user_id) }}</strong></span><strong class="num">{{ fmt(r.total) }}</strong></button>
                }
              </section>

              <details class="panel fold">
                <summary><h2>Come si fanno i punti</h2></summary>
                <ul class="rules small">
                  <li>Presenza +1, gol +1, autogol −2, voto = media della pagella (6 se ci sono meno di 2 votanti), vittoria +3, sconfitta −2, pareggio 0, Punti Leader della settimana.</li>
                  <li>Chi non gioca prende 0, salvo le skill che dicono altrimenti.</li>
                  <li>Coefficiente della settimana dalla classifica individuale prima della partita: 1°–6° ×1,00 · 7°–12° ×1,25 · dal 13° ×1,50.</li>
                  <li>Capitano: se gioca e vince, gli altri 5 della fantasquadra valgono ×1,25.</li>
                  <li>Le skill di fantasquadra si sommano alla fantasquadra, non alla classifica individuale.</li>
                  <li>Parità tra fantasquadre: punti del capitano, poi la squadra con il Leader, poi i punti dell’allenatore.</li>
                </ul>
              </details>
            }
            @case ('squadra') { <app-fl-team (openPlayer)="sheet()?.open($event)" /> }
            @case ('giocatori') {
              <div class="tools">
                <input class="input" type="search" [(ngModel)]="q" placeholder="Cerca un giocatore" aria-label="Cerca un giocatore" />
                <select class="input" [(ngModel)]="sortBy" aria-label="Ordina per">
                  <option value="price">Quotazione</option><option value="pos">Posizione</option><option value="name">Nome</option>
                </select>
              </div>
              <ul class="cat">
                @for (r of catalog(); track r.user_id) {
                  <li><button type="button" (click)="sheet()?.open(r.user_id)">
                    <app-avatar [userId]="r.user_id" [size]="40" />
                    <span class="grow"><strong>{{ session.name(r.user_id) }}</strong>
                      <span class="small muted">{{ r.pos }}° · {{ fmt(r.total) }} punti · {{ fl.skillsOf(r.user_id).length }} skill</span></span>
                    <span class="q"><strong class="num">{{ r.price_current }}</strong>
                      @if (r.price_current !== r.price_initial) { <span class="small" [class.up]="r.price_current > r.price_initial" [class.down]="r.price_current < r.price_initial">da {{ r.price_initial }}</span> }
                      @else { <span class="small muted">Q.i.</span> }</span>
                  </button></li>
                } @empty { <li class="empty">Nessun giocatore acquistabile: il Leader li prepara in Gestione.</li> }
              </ul>
            }
            @case ('classifiche') {
              <div class="seg" role="tablist" aria-label="Classifiche">
                <button role="tab" [attr.aria-selected]="view() === 'squadre'" (click)="select('classifiche', 'squadre')">Fantasquadre</button>
                <button role="tab" [attr.aria-selected]="view() === 'giocatori'" (click)="select('classifiche', 'giocatori')">Giocatori</button>
              </div>
              @if (view() === 'squadre') {
                <ol class="rank">
                  @for (t of fl.teams(); track t.team_id) {
                    <li>
                      <details>
                        <summary>
                          <span class="pos num">{{ t.pos }}</span>
                          <span class="grow"><strong>{{ t.name }}</strong><span class="small muted">{{ session.name(t.owner_id) }} · ultima {{ fmt(t.last_points) }}</span></span>
                          <strong class="num">{{ fmt(t.total) }}</strong>
                        </summary>
                        <div class="members">
                          @for (u of t.members; track u) {
                            <button type="button" (click)="sheet()?.open(u)"><span class="av"><app-avatar [userId]="u" [size]="34" />@if (u === t.captain_id) { <span class="cap">C</span> }</span>
                              <span class="small">{{ session.name(u) }}</span></button>
                          }
                        </div>
                        <p class="small muted">Andamento: @for (x of trend(t.team_id); track x.match_id; let last = $last) { {{ fmt(x.points) }}@if (!last) { · } } @empty { nessuna giornata }</p>
                      </details>
                    </li>
                  } @empty { <li class="empty">Ancora nessuna fantasquadra.</li> }
                </ol>
              } @else {
                <p class="small muted">Coefficiente: il moltiplicatore della prossima giornata. Punti provvisori finché le pagelle sono aperte.</p>
                <ol class="rank">
                  @for (r of fl.ranking(); track r.user_id) {
                    <li><button type="button" class="row-btn" (click)="sheet()?.open(r.user_id)">
                      <span class="pos num">{{ r.pos }}</span><app-avatar [userId]="r.user_id" [size]="32" />
                      <span class="grow"><strong>{{ session.name(r.user_id) }}</strong><span class="small muted">ultima {{ fmt(r.last_points) }}@if (r.provisional) { · provvisori {{ fmt(r.provisional) }} }</span></span>
                      <span class="coef" [class.c125]="r.next_coef === 1.25" [class.c150]="r.next_coef === 1.5">×{{ fmt(r.next_coef) }}</span>
                      <strong class="num">{{ fmt(r.total) }}</strong>
                    </button></li>
                  }
                </ol>
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
    .stabs { display: flex; flex-direction: column; border-bottom: 1px solid var(--line); }
    .srow { display: flex; justify-content: space-evenly; }
    .stabs button { flex: 0 0 auto; appearance: none; background: none; border: 0; border-bottom: 3px solid transparent; cursor: pointer;
      padding: 10px 12px 8px; min-height: 42px; color: var(--muted); font: 600 var(--step--1)/1.1 var(--font-body); white-space: nowrap; }
    .stabs button[aria-selected='true'] { color: var(--ink); border-bottom-color: var(--turf); }
    /* selettore a due voci, come nelle Pagelle */
    .seg { display: flex; gap: 4px; padding: 4px; border-radius: 14px; background: var(--surface-2); }
    .seg::-webkit-scrollbar { display: none; }
    .seg button {
      flex: 1 0 auto; appearance: none; border: 0; background: transparent; color: var(--muted); cursor: pointer;
      min-height: 38px; padding: 0 12px; border-radius: 10px; font: 600 var(--step--1)/1 var(--font-body); white-space: nowrap;
    }
    .seg button[aria-selected='true'] { background: var(--surface); color: var(--ink); box-shadow: 0 1px 3px rgb(20 32 25 / 14%); }
    h2 { font-size: var(--step-0); margin: 0; }
    .panel.open { box-shadow: 0 0 0 2px var(--turf); }
    .card { display: flex; align-items: center; gap: 12px; text-align: left; cursor: pointer; border: 0; color: inherit; width: 100%; }
    .card .grow { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .tn { font: 700 var(--step-1)/1.1 var(--font-display); }
    .big { font: 800 var(--step-3)/1 var(--font-display); }
    .link { border: 0; background: none; color: var(--turf); font-weight: 600; cursor: pointer; padding: 6px 0; }
    .mini { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 12px; background: var(--surface); box-shadow: 0 0 0 1px var(--line);
            border: 0; width: 100%; text-align: left; color: inherit; cursor: pointer; }
    .pos { width: 22px; text-align: center; font-weight: 800; color: var(--muted); flex: none; }
    .rules { margin: 0; padding-left: 1.1em; display: flex; flex-direction: column; gap: 6px; }
    .tools { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
    .cat, .rank { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .cat button, .row-btn { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border-radius: 14px; border: 0; text-align: left; color: inherit; cursor: pointer;
      background: var(--surface); box-shadow: 0 0 0 1px var(--line); }
    .cat .grow, .row-btn .grow, .rank summary .grow { min-width: 0; display: flex; flex-direction: column; }
    .cat strong, .row-btn strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .q { display: flex; flex-direction: column; align-items: flex-end; flex: none; }
    .q strong { font: 800 var(--step-1)/1 var(--font-display); }
    .up { color: var(--turf); } .down { color: var(--danger); }
    .rank details { border-radius: 14px; background: var(--surface); box-shadow: 0 0 0 1px var(--line); padding: 0 10px; }
    .rank summary { display: flex; align-items: center; gap: 10px; min-height: 52px; cursor: pointer; list-style: none; }
    .rank summary::-webkit-details-marker { display: none; }
    .members { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 4px 0 8px; }
    .members button { display: flex; flex-direction: column; align-items: center; gap: 4px; border: 0; background: none; color: inherit; cursor: pointer; min-width: 0; }
    .members .small { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .av { position: relative; display: inline-grid; }
    .cap { position: absolute; right: -4px; bottom: -4px; width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center;
           background: var(--armband); color: var(--armband-ink); font: 800 0.68rem/1 var(--font-display); box-shadow: 0 0 0 2px var(--surface); }
    .coef { flex: none; font: 700 0.78rem/1 var(--font-body); padding: 4px 6px; border-radius: 8px; background: var(--surface-2); color: var(--muted); }
    .coef.c125 { background: var(--turf-soft); color: var(--turf); }
    .coef.c150 { background: color-mix(in srgb, var(--armband) 30%, transparent); color: var(--armband-ink); }
  `,
})
export class FantaLeaderPage implements OnInit {
  protected readonly fl = inject(FantaLeader);
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly sheet = viewChild(FlPlayerSheet);
  protected readonly fmt = fmtPts;
  protected readonly when = fmtWhen;
  protected readonly next = signal<Match | null>(null);
  protected q = '';
  protected sortBy: 'price' | 'pos' | 'name' = 'price';

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
        : this.sortBy === 'pos' ? a.pos - b.pos : b.price_current - a.price_current);
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
    void this.api.matches(10).then((ms) => this.next.set(
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
