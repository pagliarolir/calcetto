import { ActivatedRoute, Router } from '@angular/router';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { fmtTime, fmtWeekday, fmtWhen, fromLocalInput, toLocalInput } from '../core/format';
import { changedFields, ConfigField, configOfMatch, MatchConfig } from '../core/match-config';
import { MatchConfigForm } from '../ui/match-config-form';
import { ApplyDialog } from '../ui/apply-dialog';
import { BoardRow, Choice, Match } from '../core/models';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { Figurina } from '../ui/figurina';
import { MatchStore } from './match-store';
import { Reprimand } from '../ui/reprimand';
import { Avatar } from '../ui/avatar';
import { Icon } from '../ui/icon';

interface SlotView {
  slot: number;
  row: BoardRow | null;
}

@Component({
  selector: 'app-booking-tab',
  imports: [Figurina, FormsModule, MatchConfigForm, ApplyDialog, Avatar, Icon],
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
          } @else if (store.t()?.bookingClosed && !amLeaderTitular() && store.mine()) {
            @if (store.mine()!.list === 'out') {
              <p class="note">Le prenotazioni si sono chiuse {{ when(m.bookings_close_at) }}. Per cambiare, scrivi al Leader.</p>
            } @else {
              <!-- dopo la chiusura ci si può sempre ritirare -->
              <p class="note">Le prenotazioni si sono chiuse {{ when(m.bookings_close_at) }}: per cambiare scrivi al Leader, ma puoi sempre ritirarti.</p>
              @if (monnezzaRisk()) { <p class="small warn-text">Ritirandoti ora vinci il premio «Monnezza».</p> }
              @if (store.mine()!.list === 'team' && !store.free() && store.reserves().length) {
                <p class="small muted">Al tuo posto entra la prima riserva.</p>
              }
              <button class="btn danger block" [disabled]="busy()" (click)="withdraw()">Mi ritiro</button>
            }
          } @else if (store.t()?.bookingClosed && !amLeaderTitular()) {
            <!-- non aveva risposto: può ancora mettersi tra le riserve -->
            <p class="note">Le prenotazioni si sono chiuse {{ when(m.bookings_close_at) }}: puoi ancora metterti tra le riserve.</p>
            <div class="choice" role="group" aria-label="La tua presenza">
              <button [disabled]="busy()" (click)="book('present')">Ci sono<small>come riserva</small></button>
              <button class="absent" [disabled]="busy()" (click)="book('absent')">Non ci sono</button>
            </div>
          } @else if (!canBook()) {
            <p class="note">Le prenotazioni aprono {{ when(m.bookings_open_at) }}.</p>
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

        <!-- Elenchi: una scheda alla volta, ognuna con quante persone ci sono -->
        <div class="seg lists" [class.four]="listTabs().length > 3" role="tablist" aria-label="Elenchi dei giocatori">
          @for (l of listTabs(); track l.id) {
            <button role="tab" [attr.aria-selected]="listTab() === l.id" (click)="setListTab(l.id)">
              {{ l.label }} <span class="count num">{{ l.count }}</span>
            </button>
          }
        </div>

        <section class="section list-panel" role="tabpanel" [attr.aria-label]="listLabel()">
          @switch (listTab()) {
            @case ('team') {
              @if (store.free()) {
                @if (!m.lists_confirmed_at) { <p class="small muted">Titolari e riserve li sceglie il Leader dopo la chiusura delle prenotazioni.</p> }
                <ul class="people board">
                  @for (r of byName(store.team()); track r.user_id) {
                    <li><app-figurina variant="free" [userId]="r.user_id" [mine]="r.user_id === session.uid()" [note]="r.is_leader ? 'Leader' : 'titolare'" [noteTone]="'turf'" /></li>
                  } @empty { <li class="empty">Ancora nessun titolare.</li> }
                </ul>
              } @else {
                <ol class="board">
                  @for (s of slots(); track s.slot) {
                    <li [class.enter-drop]="s.row?.user_id === session.uid()">
                      @if (s.row; as r) {
                        <app-figurina [userId]="r.user_id" [number]="s.slot" [mine]="r.user_id === session.uid()"
                                      [note]="r.is_leader ? 'Leader' : r.placed_by ? 'messo dal Leader' : null" />
                      } @else {
                        <app-figurina variant="empty" [number]="s.slot" [emptyLabel]="s.slot === 1 ? 'Leader assente' : 'Posto libero'" />
                      }
                    </li>
                  }
                </ol>
              }
            }
            @case ('pending') {
              <p class="small muted">Hanno detto che ci sono: il Leader sceglierà chi gioca.</p>
              <ul class="people board">
                @for (r of byName(store.pending()); track r.user_id) {
                  <li><app-figurina variant="free" [userId]="r.user_id" [mine]="r.user_id === session.uid()" note="disponibile" /></li>
                } @empty { <li class="empty">Nessun disponibile.</li> }
              </ul>
            }
            @case ('reserve') {
              @if (store.reserves().length) {
                <p class="small muted">{{ store.free() ? 'Senza ordine: se si libera un posto decide il Leader.' : 'Entrano in questo ordine quando si libera un posto.' }}</p>
                @if (store.free()) {
                  <ul class="people board">
                    @for (r of byName(store.reserves()); track r.user_id) {
                      <li><app-figurina variant="free" [userId]="r.user_id" [mine]="r.user_id === session.uid()" note="riserva" /></li>
                    }
                  </ul>
                } @else {
                  <ol class="board">
                    @for (r of store.reserves(); track r.user_id + ':' + r.slot) {
                      <li [class.enter-drop]="r.user_id === session.uid()">
                        <app-figurina variant="reserve" [userId]="r.user_id" [number]="r.slot" [mine]="r.user_id === session.uid()"
                                      [note]="r.reserve_reply === 'confirmed' ? 'disponibile' : r.choice === 'present' ? 'in coda' : 'se serve'"
                                      [noteTone]="r.reserve_reply === 'confirmed' ? 'turf' : 'muted'" />
                      </li>
                    }
                  </ol>
                }
              } @else { <p class="empty">Nessuna riserva, per ora.</p> }
            }
            @case ('out') {
              <ul class="people board">
                @for (r of byName(store.absents()); track r.user_id) {
                  <li><app-figurina variant="free" [userId]="r.user_id" [mine]="r.user_id === session.uid()" [note]="r.late_withdrawal ? 'forfait tardivo' : 'assente'" /></li>
                } @empty { <li class="empty">Nessun assente.</li> }
              </ul>
              @if (silent().length) {
                <div class="panel stack silent">
                  <h3>Non hanno risposto <span class="count num">{{ silent().length }}</span></h3>
                  <ul class="people board">
                    @for (id of silent(); track id) {
                      <li><app-figurina variant="free" [userId]="id" [mine]="id === session.uid()" note="nessuna risposta" /></li>
                    }
                  </ul>
                </div>
              }
            }
          }
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

            <details class="panel stack fold">
              <summary><h3>Impostazioni di questa partita</h3><app-icon name="chevron" [size]="18" class="chev" /></summary>
              <div class="stack-l">
                <p class="small muted">Ora, giocatori, colori, prenotazioni e votazioni. Dopo il salvataggio puoi applicarle anche alle partite successive già create.</p>
                <label class="field"><span>Ora della partita</span><input class="input" type="time" [(ngModel)]="mTime" /></label>
                @if (mConfig(); as c) { <app-match-config-form [config]="c" (configChange)="mConfig.set($event)" /> }
                <button class="btn small primary" [disabled]="busy()" (click)="saveMatchSettings()">Salva le impostazioni</button>
              </div>
            </details>

            <details class="panel stack fold">
              <summary><h3>Cambia la risposta di un giocatore</h3><app-icon name="chevron" [size]="18" class="chev" /></summary>
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
            </details>

            <details class="panel stack fold">
              <summary><h3>Prenotazioni</h3><app-icon name="chevron" [size]="18" class="chev" /></summary>
              @if (store.t()?.bookingOpen) {
                <p class="small muted">Aperte fino a {{ when(m.bookings_close_at) }}.</p>
                <button class="btn small" [disabled]="busy()" (click)="closeBookings()">Chiudi le prenotazioni adesso</button>
              } @else if (store.t()?.bookingClosed) {
                <p class="small muted">Chiuse {{ when(m.bookings_close_at) }}. Tu puoi comunque cambiare le risposte fino all'inizio.</p>
                <button class="btn small" [disabled]="busy()" (click)="reopenBookings()">Riapri le prenotazioni</button>
              } @else {
                <p class="small muted">Si aprono {{ when(m.bookings_open_at) }} e si chiudono {{ when(m.bookings_close_at) }}.</p>
              }
            </details>

            @if (store.free()) {
              <details class="panel stack fold">
                <summary><h3>Titolari e riserve</h3><app-icon name="chevron" [size]="18" class="chev" /></summary>
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
              </details>
            }

            <details class="panel stack fold">
              <summary><h3>Precedenza</h3><app-icon name="chevron" [size]="18" class="chev" /></summary>
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
            </details>

            <details class="panel stack fold">
              <summary><h3>Dove si gioca</h3><app-icon name="chevron" [size]="18" class="chev" /></summary>
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
            </details>

            <details class="panel stack fold">
              <summary><h3>Sposta la partita</h3><app-icon name="chevron" [size]="18" class="chev" /></summary>
              <p class="small muted">Le prenotazioni seguono la nuova data: aprono sempre 3 giorni prima a mezzogiorno. Tutti ricevono un avviso.</p>
              <input class="input" type="datetime-local" [(ngModel)]="moveAt" aria-label="Nuova data e ora" />
              <div class="row-wrap">
                <button class="btn small primary" [disabled]="!moveAt" (click)="move()">Sposta</button>
                <button class="btn small danger" (click)="cancel()">Annulla la partita</button>
              </div>
            </details>
          </section>
        }
      </div>
    }
  `,
  styles: `
    .warn-text { color: var(--danger); font-weight: 600; }
    .board { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .board { gap: 8px; }
    .board li { display: grid; min-width: 0; }
    .who { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; text-decoration: none; color: inherit; font-weight: 600; }
    .who .tag { font-weight: 600; }
    summary { cursor: pointer; font-weight: 600; min-height: 28px; }
    .pick { display: flex; flex-wrap: wrap; gap: 6px; }
    .people { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .people li { display: grid; min-width: 0; }
    .people li.empty { grid-column: 1 / -1; }
    /* schede degli elenchi */
    /* le schede si dividono sempre la riga: niente scorrimento */
    .seg.lists { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; padding: 4px; border-radius: 14px; background: var(--surface-2); }
    .seg.lists button {
      min-width: 0; appearance: none; border: 0; background: transparent; color: var(--muted); cursor: pointer; white-space: nowrap;
      min-height: 40px; padding: 0 12px; border-radius: 10px; font: 600 var(--step--1)/1 var(--font-body);
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    }
    .seg.lists button[aria-selected='true'] { background: var(--surface); color: var(--ink); box-shadow: 0 1px 3px rgb(20 32 25 / 14%); }
    .count { min-width: 22px; height: 20px; padding: 0 6px; border-radius: 10px; display: inline-grid; place-items: center; font-size: 0.72rem; font-weight: 700; background: var(--line); color: var(--ink); }
    .seg.lists button[aria-selected='true'] .count { background: var(--turf); color: var(--turf-ink); }
    /* quattro schede («sceglie il Leader»): nome piccolo e numero sotto */
    .seg.lists.four button { flex-direction: column; gap: 4px; min-height: 56px; padding: 6px 2px; font-size: 0.86rem; letter-spacing: -0.015em; }
    .seg.lists.four .count { min-width: 24px; height: 21px; font-size: 0.78rem; }
    .list-panel { margin-top: -8px; }
    .silent { margin-top: 12px; }
    .silent h3 { display: flex; align-items: center; gap: 8px; }
    .assign { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .assign li { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line); min-width: 0; }
    .seg { display: inline-flex; border-radius: 999px; box-shadow: inset 0 0 0 1px var(--line); overflow: hidden; flex: none; }
    .seg button { appearance: none; border: 0; background: transparent; color: var(--ink); font: 600 var(--step--1)/1 var(--font-body); padding: 0 12px; min-height: 36px; cursor: pointer; }
    .seg button[aria-pressed='true'] { background: var(--turf); color: var(--on-turf, #fff); }
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

  protected readonly when = fmtWhen;

  protected readonly amLeaderTitular = computed(() => this.session.me()?.titular_leader === this.session.uid());

  protected readonly canBook = computed(() => {
    const t = this.store.t();
    if (!t) return false;
    if (t.bookingOpen || this.amLeaderTitular()) return true;
    const mine = this.windows().find((w) => w.user_id === this.session.uid());
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

  /** ritirarsi da titolare quando i titolari sono già scelti fa vincere «Monnezza» */
  protected readonly monnezzaRisk = computed(() => {
    const m = this.store.match();
    const mine = this.store.mine();
    if (!m || mine?.list !== 'team') return false;
    const inLineup = m.lineup_status === 'official' && this.store.teamOf().has(mine.user_id);
    return inLineup || (m.booking_mode === 'order' && !!this.store.t()?.bookingClosed) || (m.booking_mode === 'free' && !!m.lists_confirmed_at);
  });

  protected async withdraw(): Promise<void> {
    const extra = this.monnezzaRisk() ? ' Vinci il premio «Monnezza».' : '';
    if (!confirm(`Ti ritiri da questa partita?${extra} Per tornare dovrai chiedere al Leader.`)) return;
    await this.book('absent');
  }

  protected async book(choice: Choice): Promise<void> {
    if (this.reprimand.guard()) return;
    await this.run(async () => {
      const res = await this.api.book(this.store.match()!.id, choice);
      await this.store.reload('bookings');
      // con «sceglie il Leader» i posti non sono numerati
      const n = res.slot ? ` con il numero ${res.slot}` : '';
      if (res.list === 'team') this.toasts.show(`Sei dentro${n}.`);
      else if (res.list === 'reserve') this.toasts.show(`Sei tra le riserve${n}.`);
      else if (res.list === 'pending') this.toasts.show('Sei tra i disponibili: titolari e riserve li sceglie il Leader.');
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
    this.listTab.set(id);
    void this.listRouter.navigate([], {
      relativeTo: this.listRoute, replaceUrl: true, queryParamsHandling: 'merge',
      queryParams: { elenco: id === 'team' ? null : BookingTab.LIST_PARAM[id] },
    });
  }
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
      const n = res.slot ? ` con il numero ${res.slot}` : '';
      const where = res.list === 'team' ? `in squadra${n}`
        : res.list === 'reserve' ? `tra le riserve${n}` : res.list === 'pending' ? 'tra i disponibili' : 'assente';
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
