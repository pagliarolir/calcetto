import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { fmtWeekday, fmtWhen, fromLocalInput, toLocalInput } from '../core/format';
import { BoardRow, Choice } from '../core/models';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { Jersey } from '../ui/jersey';
import { MatchStore } from './match-store';

interface SlotView {
  slot: number;
  row: BoardRow | null;
}

@Component({
  selector: 'app-booking-tab',
  imports: [Jersey, FormsModule, RouterLink],
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
          } @else if (!canBook()) {
            <p class="note">Le prenotazioni aprono {{ when(m.bookings_open_at) }}. Ti arriva una notifica.</p>
          } @else {
            <div class="choice" role="group" aria-label="La tua presenza">
              <button [attr.aria-pressed]="store.mine()?.choice === 'present'" [disabled]="busy()" (click)="book('present')">
                Ci sono<small>{{ presentHint() }}</small>
              </button>
              <button [attr.aria-pressed]="store.mine()?.choice === 'reserve'" [disabled]="busy() || amLeaderTitular()"
                      (click)="book('reserve')">
                Riserva<small>se serve</small>
              </button>
              <button class="absent" [attr.aria-pressed]="store.mine()?.choice === 'absent'" [disabled]="busy()" (click)="book('absent')">
                Non ci sono<small>&nbsp;</small>
              </button>
            </div>
            @if (store.t()?.within24h && store.mine()?.list === 'team') {
              <p class="small muted">Mancano meno di 24 ore: se rinunci ora, Leader e Premier ricevono un avviso.</p>
            } @else if (!store.t()?.within24h) {
              <p class="small muted">Puoi cambiare idea liberamente fino a {{ when(changeDeadline()) }}.</p>
            }
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

        <!-- Tabellone -->
        <section class="section" aria-labelledby="team-h">
          <header>
            <h2 id="team-h">In campo</h2>
            <span class="muted small num">{{ store.team().length }}/10</span>
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

            <div class="panel stack">
              <h3>Prenota per qualcuno</h3>
              <p class="small muted">Chi metti tra i presenti entra nei 10 anche se la lista è piena: l'ultimo arrivato passa in testa alle riserve.</p>
              <select class="input" [(ngModel)]="placeUser" aria-label="Giocatore">
                <option value="">Scegli un giocatore</option>
                @for (mb of session.activeMembers(); track mb.id) { <option [value]="mb.id">{{ session.name(mb.id) }}</option> }
              </select>
              <div class="row-wrap">
                <button class="btn small primary" [disabled]="!placeUser" (click)="place('present')">Mettilo dentro</button>
                <button class="btn small" [disabled]="!placeUser" (click)="place('reserve')">Tra le riserve</button>
                <button class="btn small" [disabled]="!placeUser" (click)="place('absent')">Toglilo</button>
              </div>
            </div>

            <div class="panel stack">
              <h3>Precedenza</h3>
              <p class="small muted">Apri le prenotazioni prima degli altri a chi vuoi tu. Ricevono una notifica quando si apre la loro finestra.</p>
              <div class="pick">
                @for (mb of session.activeMembers(); track mb.id) {
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
    .pick .chip { display: inline-flex; align-items: center; }
    @media (max-width: 360px) { .board { grid-template-columns: 1fr; } }
  `,
})
export class BookingTab {
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

  protected readonly when = fmtWhen;

  protected readonly amLeaderTitular = computed(() => this.session.me()?.titular_leader === this.session.uid());

  protected readonly canBook = computed(() => {
    const t = this.store.t();
    if (!t) return false;
    if (t.bookingOpen || this.amLeaderTitular()) return true;
    const mine = this.windows().find((w) => w.user_id === this.session.uid());
    return !!mine && new Date(mine.opens_at).getTime() <= this.store.now();
  });

  protected readonly changeDeadline = computed(() =>
    new Date(new Date(this.store.match()!.starts_at).getTime() - 24 * 3600_000).toISOString(),
  );

  /** Dieci posti: 1..10 con il Leader, 2..11 se il Leader è assente (REQ-022). */
  protected readonly slots = computed<SlotView[]>(() => {
    const first = this.store.leaderIn() ? 1 : 2;
    const bySlot = new Map(this.store.team().map((r) => [r.slot!, r]));
    const out: SlotView[] = [];
    if (!this.store.leaderIn()) out.push({ slot: 1, row: null });
    for (let s = first; s < first + 10; s++) out.push({ slot: s, row: bySlot.get(s) ?? null });
    return out;
  });

  protected readonly silent = computed(() => {
    const answered = new Set(this.store.board().map((b) => b.user_id));
    return this.session.activeMembers().map((m) => m.id).filter((id) => !answered.has(id));
  });

  protected readonly myHeadline = computed(() => {
    const me = this.store.mine();
    if (!me) return `Ci sei ${fmtWeekday(this.store.match()!.starts_at)}?`;
    if (me.list === 'team') return `Sei dentro con il numero ${me.slot}`;
    if (me.list === 'reserve') return `Sei riserva numero ${me.slot}`;
    return 'Hai detto che non ci sei';
  });

  protected readonly presentHint = computed(() => {
    const free = 10 - this.store.team().length;
    if (this.store.mine()?.list === 'team') return 'sei in lista';
    return free > 0 ? (free === 1 ? 'ultimo posto' : `${free} posti liberi`) : 'vai in coda';
  });

  constructor() {
    // si riallinea solo quando cambia partita, non a ogni aggiornamento in tempo reale
    const matchKey = computed(() => {
      const m = this.store.match();
      return m ? `${m.id}|${m.starts_at}|${m.bookings_open_at}` : null;
    });
    effect(() => {
      if (!matchKey()) return;
      const m = untracked(() => this.store.match()!);
      void this.api.priorityWindows(m.id).then((w) => this.windows.set(w)).catch(() => undefined);
      this.moveAt = toLocalInput(m.starts_at);
      this.priorityAt = toLocalInput(new Date(new Date(m.bookings_open_at).getTime() - 24 * 3600_000).toISOString());
    });
  }

  protected async book(choice: Choice): Promise<void> {
    await this.run(async () => {
      const res = await this.api.book(this.store.match()!.id, choice);
      await this.store.reload('bookings');
      if (res.list === 'team') this.toasts.show(`Sei dentro con il numero ${res.slot}.`);
      else if (res.list === 'reserve') this.toasts.show(`Sei tra le riserve con il numero ${res.slot}.`);
      else this.toasts.show('Segnato come assente.');
    });
  }

  protected async reply(r: 'confirmed' | 'declined'): Promise<void> {
    await this.run(async () => {
      await this.api.reserveReply(this.store.match()!.id, r);
      await this.store.reload('bookings');
      this.toasts.show(r === 'confirmed' ? 'Grazie, lo sanno anche Leader e Premier.' : 'Ok, risulti assente. Lo sanno anche Leader e Premier.');
    });
  }

  protected async place(choice: Choice): Promise<void> {
    await this.run(async () => {
      await this.api.leaderBook(this.store.match()!.id, this.placeUser, choice);
      await this.store.reload('bookings');
      this.toasts.show(`${this.session.name(this.placeUser)} aggiornato.`);
      this.placeUser = '';
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
