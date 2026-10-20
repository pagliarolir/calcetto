import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { fmtTime, fmtWeekday, fmtWhen, fromLocalInput, mapsUrl, toLocalInput } from '../core/format';
import { changedFields, ConfigField, configOfMatch, MatchConfig } from '../core/match-config';
import { MatchConfigForm } from '../ui/match-config-form';
import { ApplyDialog } from '../ui/apply-dialog';
import { Icon } from '../ui/icon';
import { BoardRow, Choice, Match } from '../core/models';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { Jersey } from '../ui/jersey';
import { MatchStore } from './match-store';
import { Reprimand } from '../ui/reprimand';
import { Avatar } from '../ui/avatar';

interface SlotView {
  slot: number;
  row: BoardRow | null;
}

@Component({
  selector: 'app-booking-tab',
  imports: [Jersey, FormsModule, RouterLink, Icon, MatchConfigForm, ApplyDialog, Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.match(); as m) {
      <div class="stack-l">
        <!-- La mia risposta -->
        <section class="section" aria-labelledby="me-h">
          <header><h2 id="me-h">{{ myHeadline() }}</h2></header>
          @if (m.status === 'cancelled') {
            <p class="muted">Questa partita è stata annullata.</p>
          } @else if (store.t()?.started) {
            <p class="muted">La partita è iniziata: le prenotazioni sono chiuse.</p>
          } @else if (store.t()?.bookingClosed && !amLeaderTitular()) {
            <p class="note">Le prenotazioni si sono chiuse {{ when(m.bookings_close_at) }}. Per cambiare, scrivi al Leader.</p>
          } @else if (!canBook()) {
            <p class="note">Le prenotazioni aprono {{ when(m.bookings_open_at) }}. Ti arriva una notifica.</p>
          } @else {
            <div class="choice" role="group" aria-label="La tua presenza">
              <button [attr.aria-pressed]="store.mine()?.choice === 'present'" [disabled]="busy()" (click)="book('present')">
                Ci sono<small>{{ presentHint() }}</small>
              </button>
              @if (!store.free()) {
                <button [attr.aria-pressed]="store.mine()?.choice === 'reserve'" [disabled]="busy() || amLeaderTitular()"
                        (click)="book('reserve')">
                  Riserva<small>se serve</small>
                </button>
              }
              <button class="absent" [attr.aria-pressed]="store.mine()?.choice === 'absent'" [disabled]="busy()" (click)="book('absent')">
                Non ci sono<small>&nbsp;</small>
              </button>
            </div>
            @if (store.t()?.within24h && store.mine()?.list === 'team') {
              <p class="small muted">Mancano meno di 24 ore: se rinunci ora, Leader e Premier ricevono un avviso.</p>
            } @else if (!store.t()?.within24h) {
              <p class="small muted">Puoi cambiare idea liberamente fino a {{ when(changeDeadline()) }}.</p>
            }
            <p class="small muted">Le prenotazioni si chiudono {{ when(m.bookings_close_at) }}.@if (store.free()) { Poi il Leader sceglie titolari e riserve e ti avvisa.}</p>
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

        <!-- Dove si gioca -->
        @if (venue(); as v) {
          <section class="panel venue-card" aria-labelledby="venue-h">
            <div class="row">
              <span class="pin" aria-hidden="true"><app-icon name="pin" /></span>
              <div class="grow">
                <h2 id="venue-h">{{ v.name || 'Dove si gioca' }}</h2>
                @if (v.address) { <p class="small muted">{{ v.address }}</p> }
              </div>
            </div>
            <div class="row-wrap">
              @if (v.maps) { <a class="btn small primary" [href]="v.maps" target="_blank" rel="noopener">Apri nelle mappe</a> }
              @if (v.url) { <a class="btn small" [href]="v.url" target="_blank" rel="noopener">Sito del circolo</a> }
            </div>
          </section>
        }

        <!-- Tabellone -->
        @if (store.free()) {
          <section class="section" aria-labelledby="team-h">
            <header>
              <h2 id="team-h">Titolari</h2>
              <span class="muted small num">{{ store.team().length }}/{{ store.size() }}</span>
            </header>
            @if (!m.lists_confirmed_at) { <p class="small muted">Titolari e riserve li sceglie il Leader dopo la chiusura delle prenotazioni.</p> }
            <ul class="people">
              @for (r of byName(store.team()); track r.user_id) {
                <li [class.me]="r.user_id === session.uid()">
                  <app-avatar [userId]="r.user_id" [size]="32" />
                  <a class="ellipsis" [routerLink]="['/giocatore', r.user_id]">{{ session.name(r.user_id) }}</a>
                  @if (r.is_leader) { <span class="tag armband">Leader</span> }
                </li>
              }
            </ul>
          </section>
          @if (store.reserves().length) {
            <section class="section" aria-labelledby="res-h">
              <header><h2 id="res-h">Riserve</h2><span class="muted small">senza ordine</span></header>
              <ul class="people">
                @for (r of byName(store.reserves()); track r.user_id) {
                  <li [class.me]="r.user_id === session.uid()">
                    <app-avatar [userId]="r.user_id" [size]="32" />
                    <a class="ellipsis" [routerLink]="['/giocatore', r.user_id]">{{ session.name(r.user_id) }}</a>
                  </li>
                }
              </ul>
            </section>
          }
          @if (store.pending().length) {
            <section class="section" aria-labelledby="pend-h">
              <header><h2 id="pend-h">Disponibili</h2><span class="muted small">{{ store.pending().length }}, in attesa della scelta</span></header>
              <ul class="people">
                @for (r of byName(store.pending()); track r.user_id) {
                  <li [class.me]="r.user_id === session.uid()">
                    <app-avatar [userId]="r.user_id" [size]="32" />
                    <a class="ellipsis" [routerLink]="['/giocatore', r.user_id]">{{ session.name(r.user_id) }}</a>
                  </li>
                }
              </ul>
            </section>
          }
        } @else {
        <section class="section" aria-labelledby="team-h">
          <header>
            <h2 id="team-h">In campo</h2>
            <span class="muted small num">{{ store.team().length }}/{{ store.size() }}</span>
          </header>
          <ol class="board">
            @for (s of slots(); track s.slot + ':' + (s.row?.user_id ?? '-')) {
              <li [class.me]="s.row?.user_id === session.uid()" [class.enter-drop]="s.row?.user_id === session.uid()">
                @if (s.row; as r) {
                  <app-jersey [number]="s.slot" [mine]="r.user_id === session.uid()" [captain]="r.is_leader" />
                  <a class="who" [routerLink]="['/giocatore', r.user_id]">
                    <span class="ellipsis">{{ session.name(r.user_id) }}</span>
                    @if (r.placed_by) { <span class="tag">messo dal Leader</span> }
                  </a>
                } @else {
                  <app-jersey [number]="s.slot" variant="empty" />
                  <span class="who muted">{{ s.slot === 1 ? 'Leader assente' : 'Posto libero' }}</span>
                }
              </li>
            }
          </ol>
        </section>

        @if (store.reserves().length) {
          <section class="section" aria-labelledby="res-h">
            <header><h2 id="res-h">Riserve</h2><span class="muted small">entrano in quest'ordine</span></header>
            <ol class="board">
              @for (r of store.reserves(); track r.user_id + ':' + r.slot) {
                <li [class.me]="r.user_id === session.uid()" [class.enter-drop]="r.user_id === session.uid()">
                  <app-jersey [number]="r.slot" variant="reserve" [mine]="r.user_id === session.uid()" />
                  <a class="who" [routerLink]="['/giocatore', r.user_id]">
                    <span class="ellipsis">{{ session.name(r.user_id) }}</span>
                    @if (r.choice === 'present') { <span class="tag">in coda</span> }
                    @if (r.reserve_reply === 'confirmed') { <span class="tag turf">disponibile</span> }
                  </a>
                </li>
              }
            </ol>
          </section>
        }

        }

        <section class="section">
          <details class="panel">
            <summary>Assenti ({{ store.absents().length }}) e senza risposta ({{ silent().length }})</summary>
            <div class="stack" style="margin-top: 12px">
              <p class="small"><strong>Non ci sono:</strong>
                @for (r of store.absents(); track r.user_id; let last = $last) {
                  {{ session.name(r.user_id) }}@if (r.late_withdrawal) { (forfait tardivo)}@if (!last) {, }
                } @empty { nessuno }
              </p>
              <p class="small"><strong>Non hanno risposto:</strong>
                @for (id of silent(); track id; let last = $last) { {{ session.name(id) }}@if (!last) {, } } @empty { tutti hanno risposto }
              </p>
            </div>
          </details>
        </section>

        <!-- Strumenti del Leader (REQ-023, REQ-024) -->
        @if (session.isLeader() && m.status === 'scheduled' && !store.t()?.started) {
          <section class="section" aria-labelledby="lead-h">
            <header><h2 id="lead-h">Strumenti del Leader</h2></header>

            @if (applyNext(); as a) {
              <app-apply-dialog [matches]="a.matches" [fields]="a.fields" [busy]="busy()"
                                title="Applicare anche alle partite successive?" cancelLabel="Solo a questa partita"
                                (confirm)="applyNextTo($event)" (cancel)="applyNext.set(null)" />
            }

            <details class="panel settings">
              <summary><h3>Impostazioni di questa partita</h3></summary>
              <div class="stack-l">
                <p class="small muted">Ora, giocatori, colori, prenotazioni e votazioni. Dopo il salvataggio puoi applicarle anche alle partite successive già create.</p>
                <label class="field"><span>Ora della partita</span><input class="input" type="time" [(ngModel)]="mTime" /></label>
                @if (mConfig(); as c) { <app-match-config-form [config]="c" (configChange)="mConfig.set($event)" /> }
                <button class="btn small primary" [disabled]="busy()" (click)="saveMatchSettings()">Salva le impostazioni</button>
              </div>
            </details>

            <div class="panel stack">
              <h3>Cambia la risposta di un giocatore</h3>
              <p class="small muted">In squadra entra nei 10 anche se la lista è piena: l'ultimo arrivato passa in testa alle riserve. «Azzera risposta» lo riporta tra chi non ha risposto. In ogni caso il giocatore riceve un avviso.</p>
              <select class="input" [(ngModel)]="placeUser" aria-label="Giocatore">
                <option value="">Scegli un giocatore</option>
                @for (mb of session.activeMembers(); track mb.id) {
                  <option [value]="mb.id">{{ session.name(mb.id) }}{{ mb.guest ? ', senza account' : '' }} ({{ statusOf(mb.id) }})</option>
                }
              </select>
              <div class="row-wrap">
                <button class="btn small primary" [disabled]="!placeUser || busy()" (click)="place('present')">In squadra</button>
                <button class="btn small" [disabled]="!placeUser || busy() || isTitular(placeUser)" (click)="place('reserve')">Riserva</button>
                <button class="btn small" [disabled]="!placeUser || busy()" (click)="place('absent')">Assente</button>
                <button class="btn small danger" [disabled]="!placeUser || busy() || !canReset(placeUser)" (click)="resetAnswer()">Azzera risposta</button>
              </div>
              @if (placeUser && isTitular(placeUser)) {
                <p class="small muted">Il Leader è sempre il numero 1: si può solo segnare presente o assente.</p>
              }
            </div>

            <div class="panel stack">
              <h3>Prenotazioni</h3>
              @if (store.t()?.bookingOpen) {
                <p class="small muted">Aperte fino a {{ when(m.bookings_close_at) }}.</p>
                <button class="btn small" [disabled]="busy()" (click)="closeBookings()">Chiudi le prenotazioni adesso</button>
              } @else if (store.t()?.bookingClosed) {
                <p class="small muted">Chiuse {{ when(m.bookings_close_at) }}. Tu puoi comunque cambiare le risposte fino all'inizio.</p>
                <button class="btn small" [disabled]="busy()" (click)="reopenBookings()">Riapri le prenotazioni</button>
              } @else {
                <p class="small muted">Si aprono {{ when(m.bookings_open_at) }} e si chiudono {{ when(m.bookings_close_at) }}.</p>
              }
            </div>

            @if (store.free()) {
              <div class="panel stack">
                <h3>Titolari e riserve</h3>
                <p class="small"><strong>Titolari {{ store.team().length }}/{{ store.size() }}</strong>, riserve {{ store.reserves().length }}, da scegliere {{ store.pending().length }}</p>
                @if (!m.lists_confirmed_at) {
                  <p class="small muted">Scegli tra i disponibili. Con «Conferma» chi resta da scegliere diventa riserva, le prenotazioni si chiudono e tutti ricevono un avviso.</p>
                } @else {
                  <p class="small muted">Comunicati {{ when(m.lists_confirmed_at) }}: ogni cambio ora avvisa solo l'interessato.</p>
                }
                <ul class="assign">
                  @for (r of byName(available()); track r.user_id) {
                    <li>
                      <app-avatar [userId]="r.user_id" [size]="28" />
                      <span class="grow ellipsis">{{ session.name(r.user_id) }}</span>
                      @if (r.is_leader) {
                        <span class="tag armband">Leader</span>
                      } @else {
                        <div class="seg" role="group" [attr.aria-label]="'Posizione di ' + session.name(r.user_id)">
                          <button [attr.aria-pressed]="r.list === 'team'" [disabled]="busy()" (click)="assign(r, 'team')">Titolare</button>
                          <button [attr.aria-pressed]="r.list === 'reserve'" [disabled]="busy()" (click)="assign(r, 'reserve')">Riserva</button>
                        </div>
                      }
                    </li>
                  } @empty { <li class="small muted">Ancora nessun disponibile.</li> }
                </ul>
                @if (!m.lists_confirmed_at) {
                  <button class="btn small primary" [disabled]="busy() || available().length <= 1" (click)="confirmLists()">Conferma e avvisa i giocatori</button>
                }
              </div>
            }

            <div class="panel stack">
              <h3>Precedenza</h3>
              <p class="small muted">Apri le prenotazioni prima degli altri a chi vuoi tu. Ricevono una notifica quando si apre la loro finestra. I giocatori senza account li metti in lista tu, qui sopra.</p>
              <div class="pick">
                @for (mb of session.accountMembers(); track mb.id) {
                  <label class="chip" [attr.aria-pressed]="priorityPick().has(mb.id)">
                    <input type="checkbox" class="sr-only" [checked]="priorityPick().has(mb.id)" (change)="togglePriority(mb.id)" />
                    {{ session.name(mb.id) }}
                  </label>
                }
              </div>
              <label class="field"><span>Possono prenotarsi da</span>
                <input class="input" type="datetime-local" [(ngModel)]="priorityAt" />
              </label>
              <button class="btn small primary" [disabled]="!priorityPick().size || !priorityAt" (click)="savePriority()">Apri la finestra</button>
              @if (windows().length) {
                <ul class="list">
                  @for (w of windows(); track w.user_id) {
                    <li class="list-item">
                      <span class="grow">{{ session.name(w.user_id) }} <span class="muted small">da {{ when(w.opens_at) }}</span></span>
                      <button class="btn small ghost" (click)="clearWindow(w.user_id)">Togli</button>
                    </li>
                  }
                </ul>
              }
            </div>

            <div class="panel stack">
              <h3>Dove si gioca</h3>
              <p class="small muted">Nome, indirizzo e sito del circolo compaiono nella partita, con il collegamento alle mappe. Se cambi il campo di una partita già in programma, chi è in lista riceve un avviso.</p>
              <label class="field"><span>Campo o circolo</span>
                <input class="input" [(ngModel)]="venueName" maxlength="80" placeholder="Es. Centro Sportivo Aurora" />
              </label>
              <label class="field"><span>Indirizzo</span>
                <input class="input" [(ngModel)]="venueAddress" maxlength="200" autocomplete="street-address" placeholder="Via, numero, città" />
              </label>
              <label class="field"><span>Sito del circolo (facoltativo)</span>
                <input class="input" type="url" inputmode="url" autocapitalize="off" [(ngModel)]="venueUrl" maxlength="300" placeholder="www.circolo.it" />
              </label>
              <label class="switch">
                <span>Usalo anche per le prossime partite</span>
                <input type="checkbox" [(ngModel)]="venueAsDefault" />
              </label>
              <button class="btn small primary" [disabled]="busy()" (click)="saveVenue()">Salva il campo</button>
            </div>

            <div class="panel stack">
              <h3>Sposta la partita</h3>
              <p class="small muted">Le prenotazioni seguono la nuova data: aprono sempre 3 giorni prima a mezzogiorno. Tutti ricevono un avviso.</p>
              <input class="input" type="datetime-local" [(ngModel)]="moveAt" aria-label="Nuova data e ora" />
              <div class="row-wrap">
                <button class="btn small primary" [disabled]="!moveAt" (click)="move()">Sposta</button>
                <button class="btn small danger" (click)="cancel()">Annulla la partita</button>
              </div>
            </div>
          </section>
        }
      </div>
    }
  `,
  styles: `
    .board { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .board li {
      display: flex; align-items: center; gap: 8px; min-height: 56px; padding: 6px 10px 6px 6px;
      border-radius: var(--r-m); background: var(--surface); border: 1px solid var(--line);
    }
    .board li.me { border-color: var(--turf); box-shadow: inset 0 0 0 1px var(--turf); }
    .who { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; text-decoration: none; color: inherit; font-weight: 600; }
    .who .tag { font-weight: 600; }
    summary { cursor: pointer; font-weight: 600; min-height: 28px; }
    .pick { display: flex; flex-wrap: wrap; gap: 6px; }
    .venue-card { display: flex; flex-direction: column; gap: 12px; }
    .people { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .people li { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 8px 10px; border-radius: 12px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--line); }
    .people li.me { box-shadow: inset 0 0 0 2px var(--turf); }
    .people a { color: inherit; text-decoration: none; font-weight: 600; min-width: 0; }
    .assign { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .assign li { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line); min-width: 0; }
    .seg { display: inline-flex; border-radius: 999px; box-shadow: inset 0 0 0 1px var(--line); overflow: hidden; flex: none; }
    .seg button { appearance: none; border: 0; background: transparent; color: var(--ink); font: 600 var(--step--1)/1 var(--font-body); padding: 0 12px; min-height: 36px; cursor: pointer; }
    .seg button[aria-pressed='true'] { background: var(--turf); color: var(--on-turf, #fff); }
    .settings summary { cursor: pointer; list-style: none; display: flex; align-items: center; justify-content: space-between; min-height: 32px; }
    .settings summary::after { content: '+'; font: 600 1.4rem/1 var(--font-display); color: var(--muted); }
    .settings[open] summary::after { content: '−'; }
    .settings[open] summary { margin-bottom: 12px; }
    .venue-card h2 { font-size: var(--step-1); }
    .pin { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; flex: none; background: var(--turf-soft); color: var(--turf); }
    .pick .chip { display: inline-flex; align-items: center; }
    @media (max-width: 360px) { .board { grid-template-columns: 1fr; } }
  `,
})
export class BookingTab {
  protected readonly store = inject(MatchStore);
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly reprimand = inject(Reprimand);

  protected readonly busy = signal(false);
  protected readonly windows = signal<{ user_id: string; opens_at: string }[]>([]);
  protected readonly priorityPick = signal(new Set<string>());
  protected placeUser = '';
  protected priorityAt = '';
  protected moveAt = '';
  protected venueName = '';
  protected venueAddress = '';
  protected venueUrl = '';
  protected venueAsDefault = true;

  /** Riquadro "Dove si gioca": compare solo se c'è almeno un dato. */
  protected readonly mConfig = signal<MatchConfig | null>(null);
  protected mTime = '';
  protected readonly applyNext = signal<{ matches: Match[]; fields: ConfigField[]; config: MatchConfig; time: string } | null>(null);

  protected readonly venue = computed(() => {
    const m = this.store.match();
    if (!m || !(m.venue_name || m.venue_address || m.venue_url)) return null;
    return { name: m.venue_name, address: m.venue_address, url: m.venue_url, maps: mapsUrl(m.venue_name, m.venue_address) };
  });

  protected readonly when = fmtWhen;

  protected readonly amLeaderTitular = computed(() => this.session.me()?.titular_leader === this.session.uid());

  protected readonly canBook = computed(() => {
    const t = this.store.t();
    if (!t) return false;
    if (t.bookingOpen || this.amLeaderTitular()) return true;
    const mine = this.windows().find((w) => w.user_id === this.session.uid());
    return !!mine && new Date(mine.opens_at).getTime() <= this.store.now() && !t.bookingClosed;
  });

  protected readonly changeDeadline = computed(() =>
    new Date(new Date(this.store.match()!.starts_at).getTime() - 24 * 3600_000).toISOString(),
  );

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
    if (this.store.free()) {
      if (me.list === 'team') return 'Sei titolare';
      if (me.list === 'reserve') return 'Sei tra le riserve';
      if (me.list === 'pending') return 'Sei disponibile';
    }
    if (me.list === 'team') return `Sei dentro con il numero ${me.slot}`;
    if (me.list === 'reserve') return `Sei riserva numero ${me.slot}`;
    return 'Hai detto che non ci sei';
  });

  protected readonly presentHint = computed(() => {
    if (this.store.free()) return this.store.mine()?.choice === 'present' ? 'sei disponibile' : 'sceglie il Leader';
    const free = this.store.size() - this.store.team().length;
    if (this.store.mine()?.list === 'team') return 'sei in lista';
    return free > 0 ? (free === 1 ? 'ultimo posto' : `${free} posti liberi`) : 'vai in coda';
  });

  constructor() {
    // si riallinea solo quando cambia partita, non a ogni aggiornamento in tempo reale
    const matchKey = computed(() => {
      const m = this.store.match();
      return m ? `${m.id}|${m.starts_at}|${m.bookings_open_at}|${JSON.stringify(configOfMatch(m))}` : null;
    });
    effect(() => {
      if (!matchKey()) return;
      const m = untracked(() => this.store.match()!);
      void this.api.priorityWindows(m.id).then((w) => this.windows.set(w)).catch(() => undefined);
      this.moveAt = toLocalInput(m.starts_at);
      this.mConfig.set(configOfMatch(m));
      this.mTime = fmtTime(m.starts_at);
      this.venueName = m.venue_name ?? '';
      this.venueAddress = m.venue_address ?? '';
      this.venueUrl = m.venue_url ?? '';
      this.priorityAt = toLocalInput(new Date(new Date(m.bookings_open_at).getTime() - 24 * 3600_000).toISOString());
    });
  }

  protected async book(choice: Choice): Promise<void> {
    if (this.reprimand.guard()) return;
    await this.run(async () => {
      const res = await this.api.book(this.store.match()!.id, choice);
      await this.store.reload('bookings');
      if (res.list === 'team') this.toasts.show(`Sei dentro con il numero ${res.slot}.`);
      else if (res.list === 'reserve') this.toasts.show(`Sei tra le riserve con il numero ${res.slot}.`);
      else this.toasts.show('Segnato come assente.');
    });
  }

  protected async reply(r: 'confirmed' | 'declined'): Promise<void> {
    if (this.reprimand.guard()) return;
    await this.run(async () => {
      await this.api.reserveReply(this.store.match()!.id, r);
      await this.store.reload('bookings');
      this.toasts.show(r === 'confirmed' ? 'Grazie, lo sanno anche Leader e Premier.' : 'Ok, risulti assente. Lo sanno anche Leader e Premier.');
    });
  }

  /** Risposta attuale di un giocatore, mostrata accanto al nome nel menu del Leader. */
  protected statusOf(userId: string): string {
    const b = this.store.board().find((r) => r.user_id === userId);
    if (!b) return 'non ha risposto';
    if (b.list === 'pending') return 'disponibile';
    if (this.store.free()) return b.list === 'team' ? 'titolare' : b.list === 'reserve' ? 'riserva' : 'assente';
    if (b.list === 'team') return `in squadra, n. ${b.slot}`;
    if (b.list === 'reserve') return `riserva n. ${b.slot}`;
    return 'assente';
  }

  protected isTitular(userId: string): boolean {
    return userId === this.session.me()?.titular_leader;
  }

  protected canReset(userId: string): boolean {
    return !this.isTitular(userId) && this.store.board().some((r) => r.user_id === userId);
  }

  /** giocatori in ordine alfabetico, con il Leader per primo (modalità "sceglie il Leader": nessun ordine) */
  protected byName(rows: BoardRow[]): BoardRow[] {
    return [...rows].sort((a, b) => Number(b.is_leader) - Number(a.is_leader)
      || this.session.name(a.user_id).localeCompare(this.session.name(b.user_id), 'it'));
  }

  /** tutti quelli che hanno detto ci sono: titolari, riserve e da scegliere */
  protected readonly available = computed(() => this.store.board().filter((b) => b.list === 'team' || b.list === 'reserve' || b.list === 'pending'));

  protected async assign(r: BoardRow, list: 'team' | 'reserve'): Promise<void> {
    const m = this.store.match()!;
    // toccare di nuovo la scelta attuale la annulla (solo prima della conferma)
    const target = r.list === list && !m.lists_confirmed_at ? 'pending' : list;
    if (target === r.list) return;
    await this.run(async () => {
      await this.api.leaderAssign(m.id, r.user_id, target);
      await this.store.reload('bookings');
    });
  }

  protected async confirmLists(): Promise<void> {
    const n = this.store.pending().length;
    const extra = n ? ` I ${n} ancora da scegliere diventeranno riserve.` : '';
    if (!confirm(`Confermare titolari e riserve e avvisare tutti? Le prenotazioni si chiudono.${extra}`)) return;
    await this.run(async () => {
      const r = await this.api.leaderConfirmLists(this.store.match()!.id);
      await Promise.all([this.store.reload('bookings'), this.store.reload('matches')]);
      this.toasts.show(`Comunicati: ${r.team} titolari e ${r.reserve} riserve.`);
    });
  }

  protected async closeBookings(): Promise<void> {
    if (!confirm('Chiudere adesso le prenotazioni? I giocatori non potranno più cambiare la risposta.')) return;
    await this.run(async () => {
      await this.api.closeBookings(this.store.match()!.id);
      await this.store.reload('matches');
      this.toasts.show('Prenotazioni chiuse.');
    });
  }

  protected async reopenBookings(): Promise<void> {
    await this.run(async () => {
      await this.api.reopenBookings(this.store.match()!.id);
      await this.store.reload('matches');
      this.toasts.show('Prenotazioni riaperte.');
    });
  }

  protected async place(choice: Choice): Promise<void> {
    const id = this.placeUser;
    await this.run(async () => {
      const res = await this.api.leaderBook(this.store.match()!.id, id, choice);
      await this.store.reload('bookings');
      const where = res.list === 'team' ? `in squadra con il numero ${res.slot}`
        : res.list === 'reserve' ? `riserva numero ${res.slot}` : 'assente';
      this.toasts.show(`${this.session.name(id)}: ${where}.`);
    });
  }

  protected async resetAnswer(): Promise<void> {
    const id = this.placeUser;
    const name = this.session.name(id);
    if (!confirm(`Azzerare la risposta di ${name}? Tornerà tra chi non ha risposto e riceverà un avviso per rispondere di nuovo.`)) return;
    await this.run(async () => {
      const res = await this.api.leaderResetBooking(this.store.match()!.id, id);
      await this.store.reload('bookings');
      const extra = res.promoted ? ` Entra ${this.session.name(res.promoted)} dalle riserve.` : '';
      this.toasts.show(`${name}: risposta azzerata.${extra}`);
    });
  }

  protected togglePriority(id: string): void {
    this.priorityPick.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  protected async savePriority(): Promise<void> {
    await this.run(async () => {
      const id = this.store.match()!.id;
      await this.api.setPriorityWindow(id, [...this.priorityPick()], fromLocalInput(this.priorityAt));
      this.windows.set(await this.api.priorityWindows(id));
      this.priorityPick.set(new Set());
      this.toasts.show('Finestra di precedenza aperta.');
    });
  }

  protected async clearWindow(userId: string): Promise<void> {
    await this.run(async () => {
      const id = this.store.match()!.id;
      await this.api.clearPriorityWindow(id, userId);
      this.windows.set(await this.api.priorityWindows(id));
    });
  }

  /** Salva le impostazioni di questa partita e propone di applicarle alle successive. */
  protected async saveMatchSettings(): Promise<void> {
    const m = this.store.match()!;
    const cfg = this.mConfig()!;
    const fields = changedFields(configOfMatch(m), cfg, fmtTime(m.starts_at), this.mTime);
    if (!fields.length) return this.toasts.show('Nessuna modifica da salvare.', 'info');
    await this.run(async () => {
      await this.api.updateMatchesConfig([m.id], cfg, fields, fields.includes('time') ? this.mTime : null);
      await Promise.all([this.store.reload('matches'), this.store.reload('bookings'), this.store.reload('lineup')]);
      this.toasts.show('Impostazioni della partita salvate.');
      const next = (await this.api.upcomingMatches()).filter((x) => x.id !== m.id && x.starts_at > m.starts_at);
      if (next.length) this.applyNext.set({ matches: next, fields, config: cfg, time: this.mTime });
    });
  }

  protected async applyNextTo(ids: string[]): Promise<void> {
    const a = this.applyNext()!;
    await this.run(async () => {
      const n = await this.api.updateMatchesConfig(ids, a.config, a.fields, a.fields.includes('time') ? a.time : null);
      this.toasts.show(n === 1 ? 'Applicate anche a 1 partita successiva.' : `Applicate anche a ${n} partite successive.`);
      this.applyNext.set(null);
    });
  }

  protected async saveVenue(): Promise<void> {
    await this.run(async () => {
      await this.api.setMatchVenue(this.store.match()!.id, this.venueName, this.venueAddress, this.venueUrl, this.venueAsDefault);
      await this.store.reload('matches');
      const m = this.store.match()!;
      this.venueUrl = m.venue_url ?? '';
      this.toasts.show(this.venueAsDefault ? 'Campo salvato, anche per le prossime partite.' : 'Campo salvato per questa partita.');
    });
  }

  protected async move(): Promise<void> {
    await this.run(async () => {
      await this.api.moveMatch(this.store.match()!.id, fromLocalInput(this.moveAt));
      await this.store.reload('matches');
      this.toasts.show('Partita spostata, tutti avvisati.');
    });
  }

  protected async cancel(): Promise<void> {
    if (!confirm('Annullare la partita? Chi si era prenotato riceve un avviso.')) return;
    await this.run(async () => {
      await this.api.cancelMatch(this.store.match()!.id);
      await this.store.reload('matches');
    });
  }

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
