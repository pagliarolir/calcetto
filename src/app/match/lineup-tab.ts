import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { fmtWhen } from '../core/format';
import { FIELD_SLOTS, Team, TEAM_LABEL } from '../core/models';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { MatchStore } from './match-store';
import { Avatar } from '../ui/avatar';

interface Spot { team: Team; slot: number; x: number; y: number; label: string }
interface Place { team: Team; slot: number | null }

/** Coordinate sul campo (percentuali): i Bianchi in alto, i Neri in basso. */
const LAYOUT: Record<number, { x: number; y: number }> = {
  1: { x: 50, y: 8 },
  2: { x: 50, y: 22 },
  3: { x: 20, y: 33 },
  4: { x: 80, y: 33 },
  5: { x: 50, y: 42 },
};

@Component({
  selector: 'app-lineup-tab',
  imports: [FormsModule, Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.match(); as m) {
      <div class="stack-l">
        @if (editing()) {
          <section class="stack">
            <div class="spread">
              <h2>{{ statusTitle() }}</h2>
              <button class="btn small" (click)="shuffle()">Sorteggia</button>
            </div>
            <p class="small muted">{{ selected() ? 'Ora tocca una posizione in campo.' : 'Tocca un giocatore, poi la sua posizione. Tocca chi è già in campo per spostarlo o scambiarlo.' }}</p>
          </section>
        } @else {
          <section class="stack">
            <h2>{{ statusTitle() }}</h2>
            @if (myTeam(); as t) {
              <p class="mine" [class.black]="t === 'black'">Giochi con i {{ teamLabel[t] }}</p>
            }
          </section>
        }

        @if (visible()) {
          <div class="pitch" role="group" aria-label="Campo da calcio a 5">
            <div class="lines" aria-hidden="true"></div>
            @for (s of spots; track s.team + s.slot) {
              @let who = occupant(s);
              <button class="spot" [class.black]="s.team === 'black'" [class.filled]="!!who"
                      [class.sel]="!!who && who === selected()"
                      [style.left.%]="s.x" [style.top.%]="s.y" [disabled]="!editing()"
                      [attr.aria-label]="teamLabel[s.team] + ', ' + s.label + ': ' + (who ? session.name(who) : 'vuoto')"
                      (click)="tapSpot(s)">
                @if (who) {
                  <app-avatar class="pitch-photo" [userId]="who" [size]="46" [team]="s.team" />
                } @else {
                  <span class="disc">{{ editing() ? '+' : '' }}</span>
                }
                <span class="name">{{ who ? session.name(who) : s.label }}</span>
              </button>
            }
          </div>

          @if (editing()) {
            <section class="section">
              <header><h3>Da sistemare</h3><span class="small muted">{{ bench().length }}</span></header>
              <div class="row-wrap">
                @for (id of bench(); track id) {
                  <button class="chip" [attr.aria-pressed]="selected() === id" (click)="select(id)">{{ session.name(id) }}</button>
                } @empty { <p class="small muted">Tutti in campo.</p> }
              </div>
              @if (selected() && placeOf(selected()!)) {
                <button class="btn small ghost" (click)="bench1()">Togli {{ session.name(selected()!) }} dal campo</button>
              }
            </section>

            <div class="stack">
              @if (session.isStaff()) {
                <button class="btn primary block" [disabled]="busy()" (click)="save(true)">
                  {{ m.lineup_status === 'official' ? 'Salva e avvisa i giocatori' : 'Pubblica le formazioni' }}
                </button>
                @if (m.lineup_status !== 'official') {
                  <button class="btn block" [disabled]="busy()" (click)="save(false)">Salva come bozza</button>
                }
              } @else {
                <button class="btn primary block" [disabled]="busy()" (click)="save(true)">Invia per l'approvazione</button>
                <button class="btn block" [disabled]="busy()" (click)="save(false)">Salva bozza</button>
              }
            </div>
          } @else if (m.lineup_status === 'official') {
            <div class="teams">
              @for (t of teams; track t) {
                <div class="panel">
                  <h3>{{ teamLabel[t] }}</h3>
                  <ul>
                    @for (l of byTeam(t); track l.user_id) {
                      <li>{{ session.name(l.user_id) }} <span class="muted small">{{ slotLabel(l.field_slot) }}</span></li>
                    }
                  </ul>
                </div>
              }
            </div>
          }
        } @else {
          <p class="empty">
            @if (!store.t()?.lineupOpen) { Le squadre si fanno da {{ when(m.lineup_opens_at) }}. }
            @else if (m.lineup_status === 'pending') { Le formazioni sono in attesa di approvazione. }
            @else { Le squadre non sono ancora state fatte. Riceverai un avviso. }
          </p>
        }

        @if (session.isStaff() && m.lineup_status === 'pending') {
          <section class="panel stack">
            <h3>Proposta di {{ session.name(m.lineup_proposed_by) }}</h3>
            <p class="small muted">Le formazioni diventano pubbliche solo dopo l'approvazione di Leader o Premier.</p>
            <div class="row">
              <button class="btn primary" [disabled]="busy()" (click)="review(true)">Approva e pubblica</button>
              <button class="btn" [disabled]="busy()" (click)="review(false)">Rimanda indietro</button>
            </div>
          </section>
        }

        @if (session.isLeader() && !m.locked) {
          <section class="panel stack">
            <h3>Chi fa le squadre</h3>
            <p class="small muted">Di norma Leader e Premier. Puoi affidarle a un giocatore solo per questa partita: la sua proposta andrà approvata.</p>
            <select class="input" [ngModel]="m.lineup_delegate ?? ''" (ngModelChange)="setDelegate($event)" aria-label="Delegato">
              <option value="">Solo Leader e Premier</option>
              @for (mb of session.activeMembers(); track mb.id) { <option [value]="mb.id">{{ session.name(mb.id) }}</option> }
            </select>
          </section>
        }
      </div>
    }
  `,
  styles: `
    .mine { display: inline-flex; align-self: flex-start; padding: 10px 16px; border-radius: 999px; font: 700 var(--step-1)/1 var(--font-display);
      background: var(--kit-white); color: var(--kit-white-ink); box-shadow: inset 0 0 0 1.5px var(--line); }
    .mine.black { background: var(--kit-black); color: var(--kit-black-ink); box-shadow: none; }
    .pitch {
      position: relative; aspect-ratio: 3 / 4.4; width: 100%; border-radius: var(--r-m); overflow: hidden;
      background: repeating-linear-gradient(180deg, #24774c 0 10%, #1f6b45 10% 20%);
    }
    .lines { position: absolute; inset: 10px; border: 2px solid rgb(255 255 255 / 75%); border-radius: 4px; }
    .lines::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; border-top: 2px solid rgb(255 255 255 / 75%); }
    .lines::after { content: ''; position: absolute; left: 50%; top: 50%; width: 22%; aspect-ratio: 1; transform: translate(-50%, -50%);
      border: 2px solid rgb(255 255 255 / 75%); border-radius: 50%; }
    .pitch::before, .pitch::after { content: ''; position: absolute; left: 32%; right: 32%; height: 9%; border: 2px solid rgb(255 255 255 / 75%); z-index: 0; }
    .pitch::before { top: 10px; border-top: 0; border-radius: 0 0 50% 50%; }
    .pitch::after { bottom: 10px; border-bottom: 0; border-radius: 50% 50% 0 0; }
    .spot {
      position: absolute; z-index: 1; transform: translate(-50%, -50%);
      appearance: none; border: 0; background: none; padding: 0; cursor: pointer;
      display: flex; flex-direction: column; align-items: center; gap: 3px; width: 76px; color: #fff;
    }
    .spot:disabled { cursor: default; }
    .disc {
      width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center;
      font: 700 1rem/1 var(--font-display);
      background: rgb(255 255 255 / 18%); border: 2px dashed rgb(255 255 255 / 70%); color: #fff;
      transition: transform 200ms var(--ease-spring);
    }
    .spot.filled .disc { background: var(--kit-white); color: var(--kit-white-ink); border: 2px solid #fff; box-shadow: 0 3px 8px rgb(0 0 0 / 30%); }
    .spot.black.filled .disc { background: var(--kit-black); color: var(--kit-black-ink); border-color: #000; }
    .spot.sel .disc { transform: scale(1.15); box-shadow: 0 0 0 4px var(--armband); }
    /* giocatore in campo: foto (o iniziali) con l'anello del colore della squadra */
    .pitch-photo { transition: transform 200ms var(--ease-spring); font-weight: 700; }
    .pitch-photo.white { background: var(--kit-white); color: var(--kit-white-ink); box-shadow: 0 0 0 2.5px #fff, 0 3px 8px rgb(0 0 0 / 35%); }
    .pitch-photo.black { background: var(--kit-black); color: var(--kit-black-ink); box-shadow: 0 0 0 2.5px #000, 0 3px 8px rgb(0 0 0 / 35%); }
    .spot.sel .pitch-photo { transform: scale(1.15); box-shadow: 0 0 0 4px var(--armband), 0 3px 8px rgb(0 0 0 / 35%); }
    .name { font-size: 0.72rem; font-weight: 600; max-width: 76px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      text-shadow: 0 1px 2px rgb(0 0 0 / 60%); }
    .teams { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .teams ul { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  `,
})
export class LineupTab {
  protected readonly store = inject(MatchStore);
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);

  protected readonly teams: Team[] = ['white', 'black'];
  protected readonly teamLabel = TEAM_LABEL;
  protected readonly when = fmtWhen;
  protected readonly spots: Spot[] = this.teams.flatMap((team) =>
    FIELD_SLOTS.map(({ slot, label }) => ({
      team, slot, label,
      x: LAYOUT[slot].x,
      y: team === 'white' ? LAYOUT[slot].y : 100 - LAYOUT[slot].y,
    })),
  );

  protected readonly draft = signal(new Map<string, Place>());
  protected readonly selected = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly editing = computed(() => {
    const m = this.store.match();
    const t = this.store.t();
    if (!m || !t || !t.lineupOpen || !this.store.canEditLineup()) return false;
    if (t.locked && !this.session.isLeader()) return false;
    if (!this.session.isStaff() && m.lineup_status !== 'draft') return false;
    return true;
  });

  protected readonly visible = computed(() =>
    this.editing() || this.store.match()?.lineup_status === 'official' || (this.session.isStaff() && this.store.lineup().length > 0),
  );

  protected readonly statusTitle = computed(() => {
    const s = this.store.match()?.lineup_status;
    if (s === 'official') return 'Formazioni ufficiali';
    if (s === 'pending') return 'Proposta in attesa';
    return this.editing() ? 'Fai le squadre' : 'Squadre';
  });

  protected readonly myTeam = computed(() =>
    this.store.match()?.lineup_status === 'official' ? this.store.teamOf().get(this.session.uid() ?? '') ?? null : null,
  );

  protected readonly bench = computed(() => {
    const d = this.draft();
    return this.store.team().map((b) => b.user_id).filter((id) => !d.get(id)?.slot);
  });

  constructor() {
    // la bozza riparte da quanto salvato ogni volta che il server cambia
    effect(() => {
      const players = new Set(this.store.team().map((b) => b.user_id));
      this.draft.set(new Map(this.store.lineup().filter((l) => players.has(l.user_id)).map((l) => [l.user_id, { team: l.team, slot: l.field_slot }])));
    });
  }

  protected occupant(s: Spot): string | null {
    for (const [id, p] of this.draft()) if (p.team === s.team && p.slot === s.slot) return id;
    return null;
  }

  protected placeOf(id: string): Place | undefined {
    return this.draft().get(id);
  }

  protected byTeam(t: Team) {
    return this.store.lineup().filter((l) => l.team === t).sort((a, b) => (a.field_slot ?? 9) - (b.field_slot ?? 9));
  }

  protected slotLabel(slot: number | null): string {
    return FIELD_SLOTS.find((f) => f.slot === slot)?.label ?? '';
  }

  protected select(id: string): void {
    this.selected.set(this.selected() === id ? null : id);
  }

  protected tapSpot(s: Spot): void {
    const sel = this.selected();
    const who = this.occupant(s);
    if (!sel) {
      if (who) this.selected.set(who);
      return;
    }
    const d = new Map(this.draft());
    const from = d.get(sel);
    if (who && who !== sel) {
      // scambio: chi era lì prende il posto (o la panchina) del selezionato
      if (from?.slot) d.set(who, { ...from });
      else d.delete(who);
    }
    d.set(sel, { team: s.team, slot: s.slot });
    this.draft.set(d);
    this.selected.set(null);
  }

  protected bench1(): void {
    const id = this.selected();
    if (!id) return;
    const d = new Map(this.draft());
    d.delete(id);
    this.draft.set(d);
    this.selected.set(null);
  }

  protected shuffle(): void {
    const ids = this.store.team().map((b) => b.user_id).sort(() => Math.random() - 0.5);
    const d = new Map<string, Place>();
    ids.forEach((id, i) => d.set(id, { team: i % 2 === 0 ? 'white' : 'black', slot: i < 10 ? Math.floor(i / 2) + 1 : null }));
    this.draft.set(d);
    this.selected.set(null);
  }

  protected async save(publish: boolean): Promise<void> {
    const entries = [...this.draft()].map(([user_id, p]) => ({ user_id, team: p.team, field_slot: p.slot }));
    if (publish && this.bench().length && !confirm(`${this.bench().length} giocatori non hanno un posto in campo. Procedo lo stesso?`)) return;
    await this.run(async () => {
      const status = await this.api.saveLineup(this.store.match()!.id, entries, publish);
      await Promise.all([this.store.reload('matches'), this.store.reload('lineup')]);
      this.toasts.show(status === 'official' ? 'Formazioni pubblicate: i giocatori sono stati avvisati.'
        : status === 'pending' ? 'Proposta inviata a Leader e Premier.' : 'Bozza salvata.');
    });
  }

  protected async review(approve: boolean): Promise<void> {
    await this.run(async () => {
      await this.api.reviewLineup(this.store.match()!.id, approve);
      await Promise.all([this.store.reload('matches'), this.store.reload('lineup')]);
      this.toasts.show(approve ? 'Formazioni pubblicate.' : 'Proposta rimandata indietro.');
    });
  }

  protected async setDelegate(id: string): Promise<void> {
    await this.run(async () => {
      await this.api.setLineupDelegate(this.store.match()!.id, id || null);
      await this.store.reload('matches');
      this.toasts.show(id ? `Squadre affidate a ${this.session.name(id)}.` : 'Squadre di nuovo a Leader e Premier.');
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
