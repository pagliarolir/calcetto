import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { diffText, fmtWhen } from '../core/format';
import { Team, TEAM_LABEL } from '../core/models';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { MatchStore } from './match-store';
import { Reprimand } from '../ui/reprimand';
import { Avatar } from '../ui/avatar';

interface Line { goals: number; assists: number; own_goals: number }
type Field = keyof Line;

@Component({
  selector: 'app-result-tab',
  imports: [FormsModule, Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.match(); as m) {
      <div class="stack-l">
        @if (!store.t()?.resultOpen) {
          <p class="empty">Il risultato si inserisce a fine partita, da {{ when(m.result_opens_at) }}.</p>
        } @else {
          <!-- Risultato -->
          <section class="section">
            @if (store.result(); as r) {
              <div class="panel stack result">
                <div class="spread">
                  <h2 class="num big">{{ text(r.diff, r.white_goals, r.black_goals) }}</h2>
                  <span class="tag" [class.turf]="r.status === 'homologated'">{{ r.status === 'homologated' ? 'Omologato' : 'Da omologare' }}</span>
                </div>
                <p class="small muted">Inserito da {{ session.name(r.entered_by) }}.
                  @if (r.status === 'homologated') { {{ homologatedBy() }} }
                </p>
                @if (r.status === 'pending') {
                  <div class="meter" role="progressbar" [attr.aria-valuenow]="agrees()" aria-valuemin="0" [attr.aria-valuemax]="quorum">
                    @for (i of quorumDots; track i) { <span [class.on]="i < agrees()"></span> }
                  </div>
                  <p class="small">{{ agrees() }} conferme su {{ quorum }} necessarie
                    @if (contests()) { , {{ contests() }} contestazioni }</p>
                }
              </div>

              @if (canReview()) {
                <div class="stack">
                  <div class="row">
                    <button class="btn primary grow" [disabled]="busy()" (click)="review(true)">Confermo</button>
                    <button class="btn grow" [disabled]="busy()" (click)="contesting.set(!contesting())">Non è così</button>
                  </div>
                  @if (contesting()) {
                    <input class="input" [(ngModel)]="note" maxlength="200" placeholder="Com'è finita secondo te?" aria-label="Motivo" />
                    <button class="btn danger" [disabled]="busy()" (click)="review(false)">Contesta il risultato</button>
                  }
                </div>
              }

              @if (store.reviews().length) {
                <ul class="list">
                  @for (rv of store.reviews(); track rv.user_id) {
                    <li class="list-item">
                      <span class="grow">{{ session.name(rv.user_id) }}
                        @if (rv.note) { <span class="small muted">: {{ rv.note }}</span> }</span>
                      <span class="tag" [class.turf]="rv.agree" [class.danger]="!rv.agree">{{ rv.agree ? 'conferma' : 'contesta' }}</span>
                    </li>
                  }
                </ul>
              }

              @if (canHomologate()) {
                <button class="btn block" [disabled]="busy()" (click)="homologate()">Omologa il risultato</button>
              }
            }

            @if (canEnter()) {
              <div class="panel stack">
                <h3>{{ store.result() ? 'Correggi il risultato' : 'Com\\'è finita?' }}</h3>
                <div class="chips">
                  <button class="chip" [attr.aria-pressed]="!exact()" (click)="exact.set(false)">Solo chi ha vinto e di quanto</button>
                  <button class="chip" [attr.aria-pressed]="exact()" (click)="exact.set(true)">Punteggio esatto</button>
                </div>
                @if (!exact()) {
                  <div class="choice three">
                    <button [attr.aria-pressed]="winner() === 'white'" (click)="winner.set('white')">Bianchi</button>
                    <button [attr.aria-pressed]="winner() === 'draw'" (click)="winner.set('draw')">Pari</button>
                    <button [attr.aria-pressed]="winner() === 'black'" (click)="winner.set('black')">Neri</button>
                  </div>
                  @if (winner() !== 'draw') {
                    <div class="spread">
                      <span>Di quanti gol</span>
                      <div class="stepper">
                        <button (click)="margin.set(margin() - 1)" [disabled]="margin() <= 1" aria-label="Uno in meno">−</button>
                        <output>{{ margin() }}</output>
                        <button (click)="margin.set(margin() + 1)" aria-label="Uno in più">+</button>
                      </div>
                    </div>
                  }
                } @else {
                  <div class="score-in">
                    <div class="stack"><span class="small muted">Bianchi</span>
                      <div class="stepper"><button (click)="wg.set(dec(wg()))" aria-label="Bianchi meno">−</button><output>{{ wg() }}</output><button (click)="wg.set(wg() + 1)" aria-label="Bianchi più">+</button></div>
                    </div>
                    <span class="num dash">–</span>
                    <div class="stack"><span class="small muted">Neri</span>
                      <div class="stepper"><button (click)="bg.set(dec(bg()))" aria-label="Neri meno">−</button><output>{{ bg() }}</output><button (click)="bg.set(bg() + 1)" aria-label="Neri più">+</button></div>
                    </div>
                  </div>
                }
                <button class="btn primary" [disabled]="busy()" (click)="submit()">Salva {{ previewText() }}</button>
              </div>
            }
          </section>

          <!-- Marcatori -->
          <section class="section">
            <header><h2>Gol e assist</h2></header>
            @if (canEditScorers()) {
              <p class="small muted">Puoi segnare i gol tuoi e degli altri. L'autogol va al giocatore che l'ha fatto e conta per la squadra avversaria.</p>
              @for (t of teams; track t) {
                <div class="panel stack">
                  <div class="spread">
                    <h3>{{ teamLabel[t] }}</h3>
                    <span class="small" [class.warn]="over(t)">{{ creditText(t) }}</span>
                  </div>
                  @for (id of players(t); track id) {
                    <div class="scorer">
                      <span class="grow ellipsis">{{ session.name(id) }}</span>
                      @for (f of fields; track f.key) {
                        <div class="cell">
                          <span class="small muted">{{ f.label }}</span>
                          <div class="stepper">
                            <button (click)="bump(id, f.key, -1)" [disabled]="val(id, f.key) === 0" [attr.aria-label]="f.label + ' meno, ' + session.name(id)">−</button>
                            <output>{{ val(id, f.key) }}</output>
                            <button (click)="bump(id, f.key, 1)" [disabled]="!canAdd(id, f.key)" [attr.aria-label]="f.label + ' più, ' + session.name(id)">+</button>
                          </div>
                        </div>
                      }
                    </div>
                  } @empty { <p class="small muted">Formazione non ancora assegnata.</p> }
                </div>
              }
              @for (i of issues(); track i) { <p class="note warn" role="alert">{{ i }}</p> }
              <button class="btn primary block" [disabled]="busy() || issues().length > 0 || !dirty()" (click)="saveScorers()">Salva gol e assist</button>
            } @else {
              @if (store.scorers().length) {
                <ul class="list">
                  @for (s of store.scorers(); track s.user_id) {
                    <li class="list-item">
                      <app-avatar [userId]="s.user_id" [team]="store.teamOf().get(s.user_id)" />
                      <span class="grow">{{ session.name(s.user_id) }}</span>
                      <span class="small">{{ summary(s.goals, s.assists, s.own_goals) }}</span>
                    </li>
                  }
                </ul>
              } @else { <p class="empty">Nessun marcatore inserito.</p> }
            }
          </section>
        }
      </div>
    }
  `,
  styles: `
    .big { font-size: var(--step-4); }
    .meter { display: flex; gap: 6px; }
    .meter span { flex: 1; height: 8px; border-radius: 4px; background: var(--surface-2); }
    .meter span.on { background: var(--turf); }
    .choice.three { grid-template-columns: 1fr 1fr 1fr; }
    .score-in { display: flex; align-items: flex-end; justify-content: center; gap: 18px; }
    .score-in .stack { align-items: center; gap: 4px; }
    .dash { font-size: var(--step-3); padding-bottom: 2px; }
    .scorer { display: flex; align-items: center; gap: 6px; padding: 6px 0; border-top: 1px solid var(--line); flex-wrap: wrap; }
    .cell { display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .cell .stepper button { width: 30px; height: 30px; font-size: 1rem; }
    .cell .stepper output { min-width: 18px; font-size: var(--step-0); }
    .warn { color: var(--danger); font-weight: 600; }
    @media (max-width: 400px) { .scorer .grow { flex-basis: 100%; } }
  `,
})
export class ResultTab {
  protected readonly store = inject(MatchStore);
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly reprimand = inject(Reprimand);

  protected readonly teams: Team[] = ['white', 'black'];
  protected readonly teamLabel = TEAM_LABEL;
  protected readonly when = fmtWhen;
  protected readonly text = diffText;
  protected readonly quorum = 5;
  protected readonly quorumDots = [0, 1, 2, 3, 4];
  protected readonly fields: { key: Field; label: string }[] = [
    { key: 'goals', label: 'Gol' },
    { key: 'assists', label: 'Assist' },
    { key: 'own_goals', label: 'Autogol' },
  ];

  protected readonly busy = signal(false);
  protected readonly contesting = signal(false);
  protected readonly exact = signal(false);
  protected readonly winner = signal<'white' | 'draw' | 'black'>('white');
  protected readonly margin = signal(1);
  protected readonly wg = signal(0);
  protected readonly bg = signal(0);
  protected readonly lines = signal(new Map<string, Line>());
  protected readonly dirty = signal(false);
  protected note = '';

  protected readonly agrees = computed(() => this.store.reviews().filter((r) => r.agree).length);
  protected readonly contests = computed(() => this.store.reviews().filter((r) => !r.agree).length);
  private readonly uid = computed(() => this.session.uid());

  protected readonly canReview = computed(() => {
    const r = this.store.result();
    return !!r && r.status === 'pending' && !this.store.t()?.locked && this.store.amParticipant()
      && r.entered_by !== this.uid() && !this.store.reviews().some((x) => x.user_id === this.uid());
  });

  protected readonly canEnter = computed(() => {
    const t = this.store.t();
    const r = this.store.result();
    if (!t) return false;
    if (t.locked) return this.session.isLeader();
    if (this.session.isStaff()) return true;
    if (!this.store.amParticipant()) return false;
    if (!r) return true;
    return r.status === 'pending' && this.contests() > this.agrees();
  });

  protected readonly canHomologate = computed(() => {
    const r = this.store.result();
    if (!r || r.status !== 'pending') return false;
    return this.session.isLeader() || (this.session.isStaff() && !!this.store.t()?.locked);
  });

  protected readonly canEditScorers = computed(() => {
    const t = this.store.t();
    if (!t?.resultOpen) return false;
    if (t.locked) return this.session.isLeader();
    return this.store.amParticipant() || this.session.isStaff();
  });

  protected readonly homologatedBy = computed(() => {
    const by = this.store.result()?.homologated_by;
    return by === 'quorum' ? 'Confermato da almeno 5 giocatori.' : by === 'leader' ? 'Omologato dal Leader.' : 'Omologato da un Premier.';
  });

  protected readonly previewText = computed(() => {
    if (this.exact()) return `${this.wg()} – ${this.bg()}`;
    if (this.winner() === 'draw') return 'pareggio';
    return `${this.winner() === 'white' ? 'Bianchi' : 'Neri'} +${this.margin()}`;
  });

  /** Gol "accreditati" a una squadra: gol dei suoi più autogol degli avversari. */
  private readonly credit = computed(() => {
    const c = { white: 0, black: 0, wGoals: 0, bGoals: 0, wAst: 0, bAst: 0 };
    for (const [id, l] of this.lines()) {
      const t = this.store.teamOf().get(id);
      if (t === 'white') { c.white += l.goals; c.black += l.own_goals; c.wGoals += l.goals; c.wAst += l.assists; }
      if (t === 'black') { c.black += l.goals; c.white += l.own_goals; c.bGoals += l.goals; c.bAst += l.assists; }
    }
    return c;
  });

  /** REQ-038: incongruenze segnalate dal vivo. */
  protected readonly issues = computed(() => {
    const r = this.store.result();
    const c = this.credit();
    const out: string[] = [];
    if (c.wAst > c.wGoals) out.push('I Bianchi hanno più assist che gol segnati dai loro giocatori.');
    if (c.bAst > c.bGoals) out.push('I Neri hanno più assist che gol segnati dai loro giocatori.');
    if (r && r.white_goals !== null && r.black_goals !== null) {
      if (c.white > r.white_goals) out.push(`Ai Bianchi risultano ${c.white} gol, ma ne hanno fatti ${r.white_goals}.`);
      if (c.black > r.black_goals!) out.push(`Ai Neri risultano ${c.black} gol, ma ne hanno fatti ${r.black_goals}.`);
    }
    return out;
  });

  constructor() {
    effect(() => {
      const map = new Map<string, Line>();
      for (const s of this.store.scorers()) map.set(s.user_id, { goals: s.goals, assists: s.assists, own_goals: s.own_goals });
      this.lines.set(map);
      this.dirty.set(false);
    });
    effect(() => {
      const r = this.store.result();
      if (!r) return;
      this.exact.set(r.white_goals !== null);
      if (r.white_goals !== null) { this.wg.set(r.white_goals); this.bg.set(r.black_goals ?? 0); }
      this.winner.set(r.diff === 0 ? 'draw' : r.diff > 0 ? 'white' : 'black');
      this.margin.set(Math.max(1, Math.abs(r.diff)));
    });
  }

  protected dec(n: number): number {
    return Math.max(0, n - 1);
  }

  protected players(t: Team): string[] {
    return this.store.team().map((b) => b.user_id).filter((id) => this.store.teamOf().get(id) === t);
  }

  protected val(id: string, f: Field): number {
    return this.lines().get(id)?.[f] ?? 0;
  }

  private goalsOf(t: Team): number | null {
    const r = this.store.result();
    if (!r || r.white_goals === null) return null;
    return t === 'white' ? r.white_goals : r.black_goals;
  }

  /** Impedisce di superare il risultato mentre si inserisce (es. 4-0: nessun gol ai Neri). */
  protected canAdd(id: string, f: Field): boolean {
    const t = this.store.teamOf().get(id);
    if (!t) return false;
    const opp: Team = t === 'white' ? 'black' : 'white';
    const c = this.credit();
    if (f === 'goals') {
      const max = this.goalsOf(t);
      return max === null || c[t] < max;
    }
    if (f === 'own_goals') {
      const max = this.goalsOf(opp);
      return max === null || c[opp] < max;
    }
    return t === 'white' ? c.wAst < c.wGoals : c.bAst < c.bGoals;
  }

  protected creditText(t: Team): string {
    const max = this.goalsOf(t);
    const got = this.credit()[t];
    return max === null ? `${got} gol assegnati` : `${got} gol assegnati su ${max}`;
  }

  protected over(t: Team): boolean {
    const max = this.goalsOf(t);
    return max !== null && this.credit()[t] > max;
  }

  protected bump(id: string, f: Field, by: number): void {
    const m = new Map(this.lines());
    const l = { ...(m.get(id) ?? { goals: 0, assists: 0, own_goals: 0 }) };
    l[f] = Math.max(0, l[f] + by);
    m.set(id, l);
    this.lines.set(m);
    this.dirty.set(true);
  }

  protected summary(g: number, a: number, og: number): string {
    return [g && `${g} gol`, a && `${a} assist`, og && `${og} autogol`].filter(Boolean).join(', ');
  }

  protected async submit(): Promise<void> {
    if (this.reprimand.guard()) return;
    await this.run(async () => {
      const id = this.store.match()!.id;
      if (this.exact()) await this.api.submitResult(id, null, this.wg(), this.bg());
      else {
        const d = this.winner() === 'draw' ? 0 : this.winner() === 'white' ? this.margin() : -this.margin();
        await this.api.submitResult(id, d, null, null);
      }
      await Promise.all([this.store.reload('results'), this.store.reload('result_reviews')]);
      this.toasts.show('Risultato salvato: gli altri riceveranno la richiesta di conferma.');
    });
  }

  protected async review(agree: boolean): Promise<void> {
    if (this.reprimand.guard()) return;
    await this.run(async () => {
      await this.api.reviewResult(this.store.match()!.id, agree, agree ? null : this.note.trim() || null);
      await Promise.all([this.store.reload('results'), this.store.reload('result_reviews')]);
      this.contesting.set(false);
      this.toasts.show(agree ? 'Conferma registrata.' : 'Contestazione inviata.');
    });
  }

  protected async homologate(): Promise<void> {
    await this.run(async () => {
      await this.api.staffHomologate(this.store.match()!.id);
      await this.store.reload('results');
      this.toasts.show('Risultato omologato.');
    });
  }

  protected async saveScorers(): Promise<void> {
    if (this.reprimand.guard()) return;
    const rows = [...this.lines()].map(([user_id, l]) => ({ user_id, ...l }));
    await this.run(async () => {
      await this.api.saveScorers(this.store.match()!.id, rows);
      await this.store.reload('scorers');
      this.toasts.show('Gol e assist salvati.');
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
