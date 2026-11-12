import { ActivatedRoute, Router } from '@angular/router';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { formOf, overallOf, Ratings } from '../core/ratings';
import { Empty } from '../ui/empty';
import { haptic } from '../core/haptics';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { fmtWeekday, fmtWhen } from '../core/format';
import { BoardRow, Choice, Team } from '../core/models';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { Figurina } from '../ui/figurina';
import { MatchStore } from './match-store';
import { Reprimand } from '../ui/reprimand';
import { Icon } from '../ui/icon';
import { FitText } from '../ui/fit-text';
import { Confirm } from '../core/confirm';

interface SlotView {
  slot: number;
  row: BoardRow | null;
}

type SortMode = 'alpha' | 'ovr' | 'form' | 'insert' | 'team';

@Component({
  selector: 'app-booking-tab',
  imports: [Figurina, FormsModule, Icon, FitText, Empty],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.match(); as m) {
      <div class="stack">
        <!-- La mia risposta -->
        <section class="section" aria-labelledby="me-h">
          <header class="tab-head">
            <h2 id="me-h" appFitText>{{ myHeadline() }}</h2>
            @if (infoLines().length) {
              <button type="button" class="info-i" aria-label="Come funzionano le prenotazioni" [attr.aria-expanded]="infoOpen()" (click)="infoOpen.set(!infoOpen())">
                <app-icon name="info" [size]="20" />
              </button>
              @if (infoOpen()) {
                <div class="pop-shield" aria-hidden="true" (click)="infoOpen.set(false)"></div>
                <div class="info-pop panel" role="note"><ul>@for (l of infoLines(); track $index) { <li>{{ l }}</li> }</ul></div>
              }
            }
            <!-- ordinamento delle liste -->
            <span class="sortw">
              <button type="button" class="sort-b" aria-label="Ordina i giocatori" [attr.aria-expanded]="sortOpen()" (click)="sortOpen.set(!sortOpen())"><app-icon name="sort" [size]="18" /></button>
              @if (sortOpen()) {
                <div class="pop-shield" aria-hidden="true" (click)="sortOpen.set(false)"></div>
                <div class="sort-menu panel" role="menu">
                  @for (o of sortOptions(); track o.id) {
                    <button type="button" role="menuitemradio" [attr.aria-checked]="effSort() === o.id" (click)="setSort(o.id)">
                      <span class="grow">{{ o.label }}</span>@if (effSort() === o.id) { <app-icon name="check" [size]="16" /> }
                    </button>
                  }
                </div>
              }
            </span>
            @if (statusPill(); as sp) { <span class="spill" [class]="'spill ' + sp.cls" role="status">{{ sp.label }}</span> }
          </header>
          @if (m.status === 'cancelled') {
            <p class="muted">Questa partita è stata annullata.</p>
          } @else if (store.t()?.started) {
            <p class="muted">La partita è iniziata: le prenotazioni sono chiuse.</p>
          } @else if (store.t()?.bookingClosed && !amLeaderTitular() && store.mine()) {
            @if (store.mine()!.list === 'out') {
            } @else {
            }
          } @else if (store.t()?.bookingClosed && !amLeaderTitular()) {
            <!-- non aveva risposto: può ancora mettersi tra le riserve -->
            <div class="choice" role="group" aria-label="La tua presenza">
              <button (click)="book('present')">Ci sono</button>
              <button class="absent" (click)="book('absent')">Assente</button>
            </div>
          } @else if (!canBook()) {
          } @else {
            <div class="choice" role="group" aria-label="La tua presenza">
              <button [attr.aria-pressed]="store.mine()?.choice === 'present'" (click)="book('present')">
                Ci sono
              </button>
              @if (!store.free()) {
                <button [attr.aria-pressed]="store.mine()?.choice === 'reserve'" (click)="book('reserve')">
                  Riserva
                </button>
              }
              <button class="absent" [attr.aria-pressed]="store.mine()?.choice === 'absent'" (click)="book('absent')">
                Assente
              </button>
            </div>
          }
          @if (m.status === 'scheduled' && !store.t()?.started) {
            @if (store.mine()?.list === 'reserve' && store.t()?.within24h) {
              <div class="panel stack">
                <p><strong>Sei di riserva.</strong> Facci sapere entro 12 ore dalla partita se sarai disponibile.</p>
                <div class="row">
                  <button class="btn small primary" [disabled]="store.mine()?.reserve_reply === 'confirmed'" (click)="reply('confirmed')">
                    {{ store.mine()?.reserve_reply === 'confirmed' ? 'Disponibile' : 'Sono disponibile' }}
                  </button>
                  <button class="btn small" (click)="reply('declined')">Non posso</button>
                </div>
              </div>
            }
          }
        </section>

        <!-- Elenchi: una scheda alla volta, ognuna con quante persone ci sono -->
        <div class="ui-tabs lists" [class.four]="listTabs().length > 3" role="tablist" aria-label="Elenchi dei giocatori">
          @for (l of listTabs(); track l.id) {
            <button role="tab" [attr.aria-selected]="listTab() === l.id" (click)="setListTab(l.id)">
              <span class="tl">{{ l.label }}</span> <span class="ui-count num">{{ l.count }}</span>
            </button>
          }
        </div>

        <section class="section list-panel" data-no-pull role="tabpanel" [attr.aria-label]="listLabel()">
          @switch (listTab()) {
            @case ('team') {
              @if (store.free()) {
                <ul class="people board">
                  @for (r of byName(store.team()); track r.user_id) {
                    <li [style.view-transition-name]="vt(r.user_id)"><app-figurina variant="free" [class.arriving]="!!r.provisional" [userId]="r.user_id" [mine]="r.user_id === session.uid()" [team]="kitOf(r.user_id)" [teamLabel]="kitLabel(r.user_id)" />@if (canWithdraw(r.user_id)) { <button type="button" class="wd" (click)="askWithdraw()" aria-label="Ritirati da questa partita"><app-icon name="x" [size]="11" /></button> }</li>
                  } @empty { <li class="empty"><app-empty icon="user" text="Ancora nessun titolare." /></li> }
                </ul>
              } @else {
                <ol class="board">
                  @for (s of sortedSlots(); track s.slot) {
                    <li [class.enter-drop]="!!s.row && dropFor() === s.row.user_id" [style.view-transition-name]="s.row ? vt(s.row.user_id) : null">
                      @if (s.row; as r) {
                        <app-figurina [class.arriving]="!!r.provisional" [userId]="r.user_id" [number]="s.slot" [mine]="r.user_id === session.uid()"
                                      [team]="kitOf(r.user_id)" [teamLabel]="kitLabel(r.user_id)" />
                        @if (canWithdraw(r.user_id)) { <button type="button" class="wd" (click)="askWithdraw()" aria-label="Ritirati da questa partita"><app-icon name="x" [size]="11" /></button> }
                      } @else {
                        <app-figurina variant="empty" [number]="s.slot" [emptyLabel]="s.slot === 1 ? 'Leader assente' : 'Posto libero'" />
                      }
                    </li>
                  }
                </ol>
              }
            }
            @case ('pending') {
              <ul class="people board">
                @for (r of byName(store.pending()); track r.user_id) {
                  <li [style.view-transition-name]="vt(r.user_id)"><app-figurina variant="free" [class.arriving]="!!r.provisional" [userId]="r.user_id" [mine]="r.user_id === session.uid()" note="disponibile" /></li>
                } @empty { <li class="empty"><app-empty icon="user" text="Nessun disponibile." /></li> }
              </ul>
            }
            @case ('reserve') {
              @if (store.reserves().length) {
                @if (store.free()) {
                  <ul class="people board">
                    @for (r of byName(store.reserves()); track r.user_id) {
                      <li [style.view-transition-name]="vt(r.user_id)"><app-figurina variant="free" [class.arriving]="!!r.provisional" [userId]="r.user_id" [mine]="r.user_id === session.uid()" note="riserva" />@if (canWithdraw(r.user_id)) { <button type="button" class="wd" (click)="askWithdraw()" aria-label="Ritirati da questa partita"><app-icon name="x" [size]="11" /></button> }</li>
                    }
                  </ul>
                } @else {
                  <ol class="board">
                    @for (r of byName(store.reserves()); track r.user_id + ':' + r.slot) {
                      <li [class.enter-drop]="dropFor() === r.user_id" [style.view-transition-name]="vt(r.user_id)">
                        <app-figurina variant="reserve" [userId]="r.user_id" [number]="r.slot" [mine]="r.user_id === session.uid()"
                                     
                                      />
                        @if (canWithdraw(r.user_id)) { <button type="button" class="wd" (click)="askWithdraw()" aria-label="Ritirati da questa partita"><app-icon name="x" [size]="11" /></button> }
                      </li>
                    }
                  </ol>
                }
              } @else { <p class="empty">Nessuna riserva, per ora.</p> }
            }
            @case ('out') {
              <ul class="people board">
                @for (r of byName(store.absents()); track r.user_id) {
                  <li [style.view-transition-name]="vt(r.user_id)"><app-figurina variant="free" [class.arriving]="!!r.provisional" [userId]="r.user_id" [mine]="r.user_id === session.uid()" /></li>
                } @empty { <li class="empty"><app-empty icon="user" text="Nessun assente." /></li> }
              </ul>
              @if (silent().length) {
                <div class="panel stack silent">
                  <h3>Non hanno risposto <span class="count num">{{ silent().length }}</span></h3>
                  <ul class="people board">
                    @for (id of silent(); track id) {
                      <li><app-figurina variant="free" [userId]="id" [mine]="id === session.uid()" /></li>
                    }
                  </ul>
                </div>
              }
            }
          }
        </section>

      </div>
    }
  `,
  styles: `
    /* risposta appena data, in attesa del server */
    app-figurina.arriving { opacity: 0.55; transition: opacity 200ms; }
    .sortw { margin-left: auto; position: relative; flex: none; }
    .sort-b { width: 32px; height: 32px; border: 0; border-radius: 50%; background: none; color: var(--muted); display: grid; place-items: center; cursor: pointer; }
    .sort-b[aria-expanded='true'] { color: var(--turf); background: var(--turf-soft); }
    .sort-menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 6; min-width: 240px; padding: 6px; display: flex; flex-direction: column; gap: 2px; box-shadow: 0 12px 30px rgb(0 0 0 / 22%); }
    .sort-menu button { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 10px; border: 0; border-radius: var(--r-s); background: none; color: var(--ink); font: 600 var(--step--1)/1.2 var(--font-body); text-align: left; cursor: pointer; }
    .sort-menu button[aria-checked='true'] { color: var(--turf); }
    .spill { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 14px;
             font: 700 0.72rem/1 var(--font-body); white-space: nowrap; }
    .spill::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
    .spill.open { background: var(--turf-soft); color: var(--turf); }
    .spill.soon { background: color-mix(in srgb, var(--armband) 28%, var(--surface)); color: var(--ink); }
    .spill.soon::before { background: var(--armband); }
    .spill.closed { background: var(--surface-2); color: var(--muted); }
    .spill.live { background: var(--danger-soft); color: var(--danger); }
    /* «i» vicina al titolo: cerchio piccolo, area di tocco comunque comoda */
    .info-i { width: 32px; height: 32px; margin-left: 0; flex: none; border: 0; border-radius: 50%; background: none; color: var(--muted); display: grid; place-items: center; cursor: pointer; }
    .info-i[aria-expanded='true'] { color: var(--turf); background: var(--turf-soft); }
    .pop-shield { position: fixed; inset: 0; z-index: 5; }
    .info-pop { position: absolute; right: 0; top: calc(100% + 4px); z-index: 6; width: min(300px, 86vw); padding: 12px 14px; font-size: var(--step--1); box-shadow: 0 12px 30px rgb(0 0 0 / 22%); }
    .info-pop ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; }
    /* le schede restano a portata di dito mentre si scorre l'elenco */
    /* meno spazio tra la propria risposta e le schede */
    .ui-tabs.lists { position: sticky; top: 0; z-index: 4; background: var(--bg); margin-top: -8px; }
    /* scorre solo l'elenco dei giocatori: l'altezza è quella che resta sotto le schede (fitList) */
    .list-panel { padding: 10px 6px 8px 0; margin-right: -6px; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; }
    .board { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .board { gap: 8px; }
    .board li { display: grid; min-width: 0; position: relative; }
    /* titolari: card alte come quelle degli assenti (niente riempimento dello spazio: se avanza, resta vuoto) */
    /* X rossa per ritirarsi, nell'angolo della propria figurina */
    /* pallino del ritiro piccolo; l'area di tocco resta comoda grazie al margine invisibile */
    .wd::after { content: ''; position: absolute; inset: -9px; }
    .wd { position: absolute; top: -4px; right: -4px; z-index: 2; width: 18px; height: 18px; padding: 0; border-radius: 50%; border: 0; cursor: pointer;
          display: grid; place-items: center; background: var(--danger); color: var(--danger-ink); box-shadow: 0 0 0 2px var(--bg), 0 2px 5px rgb(0 0 0 / 25%); }
    .who { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; text-decoration: none; color: inherit; font-weight: 600; }
    .who .tag { font-weight: 600; }
    summary { cursor: pointer; font-weight: 600; min-height: 28px; }
    .people { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .people li { display: grid; min-width: 0; position: relative; }
    .people li.empty { grid-column: 1 / -1; }
    /* schede degli elenchi */
    /* le schede si dividono sempre la riga: niente scorrimento */
    /* leggibile in tutti i temi: in Figurina e Alto contrasto i bordi hanno il colore del testo */
    .count { min-width: 22px; height: 20px; padding: 0 6px; border-radius: 10px; display: inline-grid; place-items: center; font-size: 0.72rem; font-weight: 700; background: var(--surface); color: var(--ink); box-shadow: 0 0 0 1px var(--line); }
    /* quattro schede («sceglie il Leader»): nome piccolo e numero sotto */
    .list-panel { margin-top: -8px; }
    .silent { margin-top: 12px; }
    .silent h3 { display: flex; align-items: center; gap: 8px; }
    @media (max-width: 360px) { .board { grid-template-columns: 1fr; } }
  `,
})
export class BookingTab {
  private readonly confirmBox = inject(Confirm);
  protected readonly store = inject(MatchStore);
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly reprimand = inject(Reprimand);

  protected readonly busy = signal(false);
  protected readonly when = fmtWhen;

  protected readonly amLeaderTitular = computed(() => this.session.me()?.titular_leader === this.session.uid());

  protected readonly canBook = computed(() => {
    const t = this.store.t();
    if (!t) return false;
    if (t.bookingOpen || this.amLeaderTitular()) return true;
    const mine = this.store.windows().find((w) => w.user_id === this.session.uid());
    return !!mine && new Date(mine.opens_at).getTime() <= this.store.now() && !t.bookingClosed;
  });

  /** Posti in lista (10 per il 5 contro 5, 12 per il 6 contro 6, ...): dall'1 con il Leader, dal 2 se il Leader è assente (REQ-022). */
  protected readonly slots = computed<SlotView[]>(() => {
    const first = this.store.leaderIn() ? 1 : 2;
    const bySlot = new Map(this.store.team().map((r) => [r.slot!, r]));
    const out: SlotView[] = [];
    if (!this.store.leaderIn()) out.push({ slot: 1, row: null });
    for (let s = first; s < first + this.store.size(); s++) out.push({ slot: s, row: bySlot.get(s) ?? null });
    return out;
  });

  protected readonly silent = computed(() => {
    const answered = new Set(this.store.board().map((b) => b.user_id));
    // chi non ha un account non può rispondere: lo gestisce il Leader
    return this.session.accountMembers().map((m) => m.id).filter((id) => !answered.has(id));
  });

  protected readonly myHeadline = computed(() => {
    const me = this.store.mine();
    if (!me) return `Ci sei ${fmtWeekday(this.store.match()!.starts_at)}?`;
    // titolo breve; il numero di posto si vede sulla propria figurina
    if (me.list === 'team') return 'Sei titolare';
    if (me.list === 'reserve') return 'Sei riserva';
    if (me.list === 'pending') return 'Ci sei';
    return 'Non ci sei';
  });

  protected readonly presentHint = computed(() => {
    if (this.store.free()) return this.store.mine()?.choice === 'present' ? 'sei disponibile' : 'sceglie il Leader';
    const free = this.store.size() - this.store.team().length;
    if (this.store.mine()?.list === 'team') return 'sei in lista';
    return free > 0 ? (free === 1 ? 'ultimo posto' : `${free} posti liberi`) : 'vai in coda';
  });

  constructor() {
    afterNextRender(() => {
      const host = this.hostEl.nativeElement as HTMLElement;
      this.fitObs = new ResizeObserver(() => this.fitList());
      this.fitObs.observe(host);
      const sc = host.closest('.scroll-area'); if (sc) this.fitObs.observe(sc);
      this.fitList();
    });
    inject(DestroyRef).onDestroy(() => { this.fitObs?.disconnect(); if (this.pagePad) this.pagePad.style.paddingBottom = ''; });
  }

  // ------------------------------------------------ ritiro dopo la chiusura: X rossa sulla propria figurina
  /** la X compare sulla propria figurina (titolare o riserva) dopo la chiusura e prima dell'inizio */
  protected canWithdraw(userId: string): boolean {
    const mine = this.store.mine();
    return userId === this.session.uid() && !!this.store.t()?.bookingClosed && !this.store.t()?.started
      && this.store.match()?.status === 'scheduled' && !this.amLeaderTitular() && (mine?.list === 'team' || mine?.list === 'reserve');
  }

  protected async askWithdraw(): Promise<void> {
    if (await this.confirmBox.ask({ title: 'Sicuro di volerti ritirare?', ok: 'Mi ritiro', danger: true })) await this.book('absent', true);
  }

  /** la propria figurina «cade» al suo posto solo subito dopo essersi prenotati, non a ogni apertura della pagina */
  protected readonly dropFor = signal<string | null>(null);

  protected async book(choice: Choice, confirmed = false): Promise<void> {
    if (this.reprimand.guard() || this.busy()) return;
    // titolare che rinuncia a meno di 24 ore: prima un avviso (Leader e Premier vengono avvisati)
    if (!confirmed && choice !== 'present' && this.store.mine()?.list === 'team' && this.store.t()?.within24h) {
      const ok = await this.confirmBox.ask({
        title: 'Mancano meno di 24 ore: se rinunci ora, Leader e Premier ricevono un avviso.',
        ok: choice === 'reserve' ? 'Passo tra le riserve' : 'Rinuncio', danger: true,
      });
      if (!ok) return;
    }
    // risposta immediata: la scelta si vede subito, il posto vero lo decide il server; se rifiuta si torna a prima
    const before = this.store.board();
    const guess = this.guessBoard(before, choice);
    haptic();
    if (guess) {
      this.store.board.set(guess);
      this.dropFor.set(this.session.uid());
      setTimeout(() => this.dropFor.set(null), 900);
    }
    await this.run(async () => {
      let res;
      try {
        res = await this.api.book(this.store.match()!.id, choice);
      } catch (e) {
        if (this.store.board() === guess) this.store.board.set(before);
        else await this.store.reload('bookings');
        throw e;
      }
      await this.store.reload('bookings');
      // con «sceglie il Leader» i posti non sono numerati
      const n = res.slot ? ` con il numero ${res.slot}` : '';
      if (res.list === 'team') this.toasts.show(`Sei dentro${n}.`);
      else if (res.list === 'reserve') this.toasts.show(`Sei tra le riserve${n}.`);
      else if (res.list === 'pending') this.toasts.show('Sei tra i disponibili: titolari e riserve li sceglie il Leader.');
      else this.toasts.show('Segnato come assente.');
    });
  }

  /** dove finirà probabilmente il giocatore (null = non si indovina: si aspetta il server) */
  private guessBoard(board: BoardRow[], choice: Choice): BoardRow[] | null {
    const uid = this.session.uid(), m = this.store.match();
    if (!uid || !m || this.amLeaderTitular()) return null;
    const mine = board.find((b) => b.user_id === uid);
    if (mine?.choice === choice) return null;
    let list: BoardRow['list'], slot: number | null = null;
    if (choice === 'absent') list = 'out';
    else if (this.store.free()) list = 'pending';
    else if (choice === 'present' && mine?.list === 'team') return null;
    else if (choice === 'present' && this.store.team().length < this.store.size()) {
      list = 'team';
      slot = this.slots().find((s) => !s.row && s.slot !== 1)?.slot ?? null;
    } else {
      list = 'reserve';
      slot = this.store.reserves().filter((r) => r.user_id !== uid).length + 1;
    }
    const row: BoardRow = {
      match_id: m.id, user_id: uid, choice, list, slot, placed_by: null, late_withdrawal: false, reserve_reply: null,
      updated_at: new Date().toISOString(), is_leader: false, ...(mine ? { is_leader: mine.is_leader } : {}), provisional: true,
    };
    return [...board.filter((b) => b.user_id !== uid), row];
  }

  protected async reply(r: 'confirmed' | 'declined'): Promise<void> {
    if (this.reprimand.guard()) return;
    await this.run(async () => {
      await this.api.reserveReply(this.store.match()!.id, r);
      await this.store.reload('bookings');
      this.toasts.show(r === 'confirmed' ? 'Grazie, lo sanno anche Leader e Premier.' : 'Ok, risulti assente. Lo sanno anche Leader e Premier.');
    });
  }

  /** giocatori in ordine alfabetico, con il Leader per primo (modalità "sceglie il Leader": nessun ordine) */
  // ------------------------------------------------ ordinamento delle liste
  private readonly ratings = inject(Ratings);
  /** ordinamento scelto: resta lo stesso cambiando pagina o partita (nell'indirizzo e sul telefono) */
  protected readonly sortMode = signal<SortMode>(BookingTab.savedSort());
  private static readonly SORT_KEY = 'gdl-lista-ordine';
  private static readonly SORTS: SortMode[] = ['alpha', 'ovr', 'form', 'insert', 'team'];
  private static savedSort(): SortMode {
    try {
      const q = new URLSearchParams(location.search).get('ordine') ?? localStorage.getItem(BookingTab.SORT_KEY);
      return BookingTab.SORTS.includes(q as SortMode) ? (q as SortMode) : 'alpha';
    } catch {
      return 'alpha';
    }
  }
  protected readonly sortOpen = signal(false);
  /** modi disponibili per la lista che si sta guardando */
  protected readonly sortOptions = computed(() => {
    const out: { id: 'alpha' | 'ovr' | 'form' | 'insert' | 'team'; label: string }[] = [
      { id: 'alpha', label: 'Alfabetico' }, { id: 'ovr', label: 'Valutazione' }, { id: 'form', label: 'Stato di forma' },
    ];
    if (this.listTab() !== 'team') out.push({ id: 'insert', label: 'Ordine di inserimento' });
    else if (this.store.teamOf().size) out.push({ id: 'team', label: 'Formazione' });
    return out;
  });
  /** squadra del titolare, solo con le formazioni ufficiali (prima non si colora nulla) */
  protected kitOf(id: string): Team | null {
    return this.store.match()?.lineup_status === 'official' ? this.store.teamOf().get(id) ?? null : null;
  }
  protected kitLabel(id: string): string | null {
    const t = this.kitOf(id);
    return t ? `squadra ${this.store.teamNames()[t]}` : null;
  }

  /** nome di transizione di una figurina (per farla scivolare quando cambia l'ordine) */
  protected vt(id: string): string { return 'f-' + id; }
  /** cambia ordine con una transizione: le figurine scivolano nella nuova posizione */
  protected setSort(id: SortMode): void {
    this.sortOpen.set(false);
    try { localStorage.setItem(BookingTab.SORT_KEY, id); } catch { /* resta solo per questa visita */ }
    void this.listRouter.navigate([], { relativeTo: this.listRoute, replaceUrl: true, queryParamsHandling: 'merge', queryParams: { ordine: id === 'alpha' ? null : id } });
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (doc.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) doc.startViewTransition(() => this.sortMode.set(id));
    else this.sortMode.set(id);
  }
  protected readonly effSort = computed(() => (this.sortOptions().some((o) => o.id === this.sortMode()) ? this.sortMode() : 'alpha'));
  /** ordina una lista secondo il modo scelto (predefinito: alfabetico) */
  protected byName<T extends { user_id: string }>(rows: T[]): T[] {
    const name = (x: T) => this.session.name(x.user_id);
    const alpha = (a: T, b: T) => name(a).localeCompare(name(b), 'it');
    const card = (x: T) => this.ratings.cards().get(x.user_id);
    const mode = this.effSort();
    if (mode === 'ovr') return [...rows].sort((a, b) => (overallOf(card(b)) ?? -1) - (overallOf(card(a)) ?? -1) || alpha(a, b));
    if (mode === 'form') return [...rows].sort((a, b) => formOf(card(b)) - formOf(card(a)) || alpha(a, b));
    if (mode === 'insert') {
      const at = (x: T) => { const r = x as unknown as { sort_key?: string | number; updated_at?: string }; return String(r.sort_key ?? r.updated_at ?? ''); };
      return [...rows].sort((a, b) => at(a).localeCompare(at(b)) || alpha(a, b));
    }
    if (mode === 'team') {
      // bianchi e neri alternati: nella griglia a due colonne i bianchi stanno a sinistra, i neri a destra
      const t = this.store.teamOf();
      const w = rows.filter((x) => t.get(x.user_id) === 'white').sort(alpha), k = rows.filter((x) => t.get(x.user_id) === 'black').sort(alpha);
      const rest = rows.filter((x) => !t.has(x.user_id)).sort(alpha);
      const out: T[] = [];
      for (let i = 0; i < Math.max(w.length, k.length); i++) { if (w[i]) out.push(w[i]); if (k[i]) out.push(k[i]); }
      return [...out, ...rest];
    }
    return [...rows].sort(alpha);
  }
  /** titolari con i posti numerati: si ordinano gli occupati, i posti liberi restano in fondo */
  protected readonly sortedSlots = computed(() => {
    const full = this.slots().filter((s) => s.row), empty = this.slots().filter((s) => !s.row);
    const order = this.byName(full.map((s) => ({ user_id: s.row!.user_id, s })));
    return [...order.map((x) => x.s), ...empty];
  });

  /** scheda degli elenchi aperta: titolari, disponibili, riserve, assenti */
  // la sotto-scheda è nell'indirizzo (?elenco=assenti): tornando indietro da una scheda giocatore si riapre la stessa
  private readonly listRoute = inject(ActivatedRoute);
  private readonly listRouter = inject(Router);
  private static readonly LIST_PARAM = { team: 'titolari', pending: 'disponibili', reserve: 'riserve', out: 'assenti' } as const;
  protected readonly listTab = signal<'team' | 'pending' | 'reserve' | 'out'>(
    ((): 'team' | 'pending' | 'reserve' | 'out' => {
      const q = this.listRoute.snapshot.queryParamMap.get('elenco');
      const hit = Object.entries(BookingTab.LIST_PARAM).find(([, v]) => v === q);
      return (hit?.[0] as 'team' | 'pending' | 'reserve' | 'out') ?? 'team';
    })(),
  );

  protected setListTab(id: 'team' | 'pending' | 'reserve' | 'out'): void {
    // la pagina resta dov'è: si ricorda lo scorrimento e l'elenco tiene almeno lo spazio di prima
    const host = this.hostEl.nativeElement as HTMLElement;
    const sc = host.closest('.scroll-area') as HTMLElement | null;
    const y = sc?.scrollTop ?? 0;
    const panel = host.querySelector('.list-panel') as HTMLElement | null;
    if (panel) panel.style.minHeight = `${panel.offsetHeight}px`;
    this.listTab.set(id);
    const keep = () => { if (sc) sc.scrollTop = y; };
    void this.listRouter.navigate([], {
      relativeTo: this.listRoute, replaceUrl: true, queryParamsHandling: 'merge',
      queryParams: { elenco: id === 'team' ? null : BookingTab.LIST_PARAM[id] },
    }).then(() => {
      requestAnimationFrame(keep);
      // l'altezza di prima serve solo durante il cambio: poi si toglie (niente vuoto sotto l'ultimo giocatore)
      setTimeout(() => { keep(); if (panel) panel.style.minHeight = ''; }, 60);
    });
  }

  /** stato delle prenotazioni in una pillola accanto al titolo (colore + testo, senza orari) */
  protected readonly statusPill = computed(() => {
    const m = this.store.match(), t = this.store.t();
    if (!m || m.status !== 'scheduled' || !t) return null;
    if (t.started) return { label: 'Partita in corso', cls: 'live' };
    if (t.bookingOpen) return { label: 'Prenotazioni aperte', cls: 'open' };
    if (t.bookingClosed) return { label: 'Prenotazioni chiuse', cls: 'closed' };
    return { label: 'Prenotazioni in arrivo', cls: 'soon' };
  });

  // ------------------------------------------------ solo l'elenco dei giocatori scorre
  private fitObs?: ResizeObserver;
  private pagePad?: HTMLElement;
  /** l'elenco occupa lo spazio che resta sotto le schede (almeno 240 px: su schermi bassissimi scorre anche la pagina) */
  protected fitList(): void {
    const host = this.hostEl.nativeElement as HTMLElement;
    const sc = host.closest('.scroll-area') as HTMLElement | null;
    const panel = host.querySelector('.list-panel') as HTMLElement | null;
    if (!sc || !panel) return;
    const top = panel.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    // si toglie anche il margine inferiore della pagina, così la pagina non scorre
    // l'elenco arriva fino alla barra in basso: il margine inferiore della pagina si riduce (e si ripristina uscendo)
    const page = panel.closest('.page') as HTMLElement | null;
    if (page && page.style.paddingBottom !== '4px') { this.pagePad = page; page.style.paddingBottom = '4px'; }
    const avail = Math.max(240, Math.floor(sc.clientHeight - top - 6));
    panel.style.maxHeight = `${avail}px`;
    panel.style.setProperty('--avail', `${avail}px`);
  }

  /** informazioni sulle prenotazioni, nel fumetto della «i» accanto al titolo */
  protected readonly infoOpen = signal(false);
  private readonly hostEl = inject(ElementRef);
  protected readonly infoLines = computed(() => {
    const m = this.store.match();
    if (!m || m.status !== 'scheduled' || this.store.t()?.started) return [];
    const t = this.store.t();
    const out: string[] = [];
    if (t?.bookingOpen) out.push(`Le prenotazioni si chiudono ${this.when(m.bookings_close_at)}.`);
    else if (t?.bookingClosed) out.push(`Le prenotazioni si sono chiuse ${this.when(m.bookings_close_at)}. Se non avevi risposto puoi ancora metterti tra le riserve.`);
    else out.push(`Le prenotazioni aprono ${this.when(m.bookings_open_at)}.`);
    if (this.store.free()) {
      if (!m.lists_confirmed_at) out.push('Titolari e riserve li sceglie il Leader dopo la chiusura delle prenotazioni, e ti avvisa.');
      out.push('Disponibili: hanno detto che ci sono, il Leader sceglierà chi gioca.');
      out.push('Riserve: senza ordine, se si libera un posto decide il Leader.');
    } else {
      out.push('Riserve: entrano in ordine quando si libera un posto.');
    }
    return out;
  });
  protected readonly listTabs = computed(() => {
    const out: { id: 'team' | 'pending' | 'reserve' | 'out'; label: string; count: string }[] = [
      { id: 'team', label: 'Titolari', count: `${this.store.team().length}/${this.store.size()}` },
    ];
    if (this.store.free()) out.push({ id: 'pending', label: 'Disponibili', count: String(this.store.pending().length) });
    out.push({ id: 'reserve', label: 'Riserve', count: String(this.store.reserves().length) });
    out.push({ id: 'out', label: 'Assenti', count: String(this.store.absents().length + this.silent().length) });
    return out;
  });
  protected readonly listLabel = computed(() => this.listTabs().find((l) => l.id === this.listTab())?.label ?? '');

  private async run(fn: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await fn();
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
