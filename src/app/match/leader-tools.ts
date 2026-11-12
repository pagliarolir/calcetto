import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { Confirm } from '../core/confirm';
import { fmtTime, fmtWhen, fromLocalInput, toLocalInput } from '../core/format';
import { changedFields, ConfigField, configOfMatch, MatchConfig } from '../core/match-config';
import { BoardRow, Choice, Match } from '../core/models';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { ApplyDialog } from '../ui/apply-dialog';
import { Avatar } from '../ui/avatar';
import { Icon } from '../ui/icon';
import { MatchConfigForm } from '../ui/match-config-form';
import { MatchStore } from './match-store';

/**
 * Strumenti del Leader per la partita (REQ-023, REQ-024): si aprono con l'icona a destra delle schede
 * (rotta /partita/:id/strumenti, con il «flip» della pagina partita). Tutte le funzioni sono in tendine chiuse.
 */
@Component({
  selector: 'app-leader-tools',
  imports: [FormsModule, MatchConfigForm, ApplyDialog, Avatar, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.match(); as m) {
      <h2 class="lead-h" id="lead-h"><app-icon name="tools" [size]="18" /> Strumenti del Leader</h2>
      @if (!session.isLeader()) {
        <p class="empty">Gli strumenti sono riservati al Leader.</p>
      } @else if (m.status !== 'scheduled' || store.t()?.started) {
        <p class="empty">La partita è {{ m.status === 'cancelled' ? 'annullata' : 'già iniziata' }}: gli strumenti servono solo prima del calcio d'inizio.</p>
      } @else {
        <div class="tools" aria-labelledby="lead-h">

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
                <button class="btn small" [disabled]="!placeUser || busy()" (click)="place('reserve')">Riserva</button>
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
                  @for (r of available(); track r.user_id) {
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
        </div>
      }
    }
  `,
  styles: `
    /* tendine attaccate: un unico blocco con i divisori, spaziature strette */
    .tools { display: flex; flex-direction: column; gap: 0; border-radius: var(--r-m); overflow: hidden; box-shadow: 0 0 0 1px var(--line); background: var(--surface); }
    .tools > app-apply-dialog { padding: 10px 12px; }
    .tools details.fold { margin: 0; padding: 0 12px; border-radius: 0; box-shadow: none; border: 0; border-top: 1px solid var(--line); gap: 8px; background: none; animation: none; }
    .tools details.fold:first-of-type { border-top: 0; }
    .tools details.fold > summary { min-height: 48px; }
    .tools details.fold > summary > h3 { font-size: var(--step-0); }
    .tools details.fold[open] { padding-bottom: 12px; }
    .tools details.fold[open] > summary { margin-bottom: 2px; }
    .tools details.fold > :not(summary) + :not(summary) { margin-top: 8px; }
    .tools .stack-l { gap: 10px; }
    .pick { display: flex; flex-wrap: wrap; gap: 6px; }
    .pick .chip { display: inline-flex; align-items: center; }
    .assign { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .assign li { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-top: 1px solid var(--line); min-width: 0; }
    .seg { display: inline-flex; border-radius: 999px; box-shadow: inset 0 0 0 1px var(--line); overflow: hidden; flex: none; }
    .seg button { appearance: none; border: 0; background: transparent; color: var(--ink); font: 600 var(--step--1)/1 var(--font-body); padding: 0 12px; min-height: 44px; cursor: pointer; }
    .seg button[aria-pressed='true'] { background: var(--turf); color: var(--turf-ink); }
    .empty { color: var(--muted); }
    .lead-h { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font-size: var(--step-1); }
  `,
})
export class LeaderTools {
  private readonly confirmBox = inject(Confirm);
  protected readonly store = inject(MatchStore);
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
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


  /** tutti quelli che hanno detto ci sono: titolari, riserve e da scegliere */
  protected readonly available = computed(() => this.store.board()
    .filter((b) => b.list === 'team' || b.list === 'reserve' || b.list === 'pending')
    .sort((a, b) => Number(b.is_leader) - Number(a.is_leader) || this.session.name(a.user_id).localeCompare(this.session.name(b.user_id), 'it')));

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
    const title = n ? `Confermare le liste? I ${n} ancora da scegliere vanno in riserva.` : 'Confermare le liste e avvisare tutti?';
    if (!(await this.confirmBox.ask({ title: title, ok: 'Conferma le liste' }))) return;
    await this.run(async () => {
      const r = await this.api.leaderConfirmLists(this.store.match()!.id);
      await Promise.all([this.store.reload('bookings'), this.store.reload('matches')]);
      this.toasts.show(`Comunicati: ${r.team} titolari e ${r.reserve} riserve.`);
    });
  }

  protected async closeBookings(): Promise<void> {
    if (!(await this.confirmBox.ask({ title: 'Chiudere adesso le prenotazioni?', ok: 'Chiudi le prenotazioni' }))) return;
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
    if (!(await this.confirmBox.ask({ title: `Azzerare la risposta di ${name}?`, ok: 'Azzera' }))) return;
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
    if (!(await this.confirmBox.ask({ title: 'Annullare la partita?', ok: 'Annulla la partita', danger: true }))) return;
    await this.run(async () => {
      await this.api.cancelMatch(this.store.match()!.id);
      await this.store.reload('matches');
    });
  }


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

  protected readonly when = fmtWhen;

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
