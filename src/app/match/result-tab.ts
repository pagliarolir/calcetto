import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { diffText, fmtWhen } from '../core/format';
import { Team } from '../core/models';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { MatchStore } from './match-store';
import { Reprimand } from '../ui/reprimand';
import { NgTemplateOutlet } from '@angular/common';
import { Avatar } from '../ui/avatar';
import { kit } from '../core/kits';
import { Ball, Boot, KitShirt } from '../ui/match-marks';
import { Icon } from '../ui/icon';

interface Line { goals: number; assists: number; own_goals: number }
type Field = keyof Line;

@Component({
  selector: 'app-result-tab',
  imports: [FormsModule, Avatar, Ball, Boot, KitShirt, Icon, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'closeInfo()', '(document:keydown.escape)': 'closeInfo()' },
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
                <!-- «i»: chi ha inserito il risultato, omologazione, conferme -->
                <button type="button" class="info-btn" [attr.aria-expanded]="infoOpen()" aria-label="Informazioni sul risultato" (click)="toggleInfo($event)">
                  <app-icon name="info" [size]="18" />
                </button>
                @if (infoOpen()) {
                  <div class="info-pop" role="dialog" aria-label="Informazioni sul risultato" (click)="$event.stopPropagation()">
                    <p>Inserito da <strong>{{ session.name(r.entered_by) }}</strong>.</p>
                    <p>{{ r.status === 'homologated' ? homologatedBy() : 'Da omologare: lo omologa il Leader.' }}</p>
                    @if (r.status === 'pending' || store.reviews().length) {
                      <p class="muted">{{ agrees() === 1 ? '1 conferma' : agrees() + ' conferme' }}, {{ contests() === 1 ? '1 contestazione' : contests() + ' contestazioni' }}</p>
                    }
                    @if (store.reviews().length) {
                      <ul>
                        @for (rv of store.reviews(); track rv.user_id) {
                          <li><span [class]="rv.agree ? 'ok' : 'ko'">{{ rv.agree ? '✓' : '✗' }}</span> {{ session.name(rv.user_id) }}@if (rv.note) { <span class="muted">: {{ rv.note }}</span> }</li>
                        }
                      </ul>
                    }
                  </div>
                }
                <div class="scoreline">
                  <app-kit-shirt [color]="kitOf('white').color" [ink]="kitOf('white').ink" [size]="82" [tight]="true" />
                  <div class="score-mid">
                    <h2 class="num big">{{ text(r.diff, r.white_goals, r.black_goals, teamLabel()) }}</h2>
                    <span class="tag" [class.turf]="r.status === 'homologated'">{{ r.status === 'homologated' ? 'Omologato' : 'Da omologare' }}</span>
                  </div>
                  <app-kit-shirt [color]="kitOf('black').color" [ink]="kitOf('black').ink" [size]="82" [tight]="true" />
                </div>
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


              @if (canHomologate()) {
                <button class="btn block" [disabled]="busy()" (click)="homologate()">Omologa il risultato</button>
              }
            }

            <!-- risultato ancora da inserire: il riquadro sta in alto -->
            @if (canEnter() && !store.result()) {
              <div class="panel stack">
                <h3>Com'è finita?</h3>
                <ng-container *ngTemplateOutlet="entry" />
              </div>
            }
          </section>

          <!-- Formazioni con gol (pallone bianco), autogol (pallone rosso) e assist (scarpino) -->
          @if (players('white').length || players('black').length) {
            <section class="section" aria-label="Formazioni e marcatori">
              @if (canEditScorers()) {
                <p class="small muted">{{ session.isLeader() ? 'Tocca un giocatore per inserire i suoi gol, assist e autogol.' : 'Tocca il tuo nome per inserire i tuoi gol, assist e autogol.' }}</p>
              }
              <div class="rosters">
                @for (t of teams; track t) {
                  <div class="roster" [class.right]="t === 'black'">
                    <h3 class="rhead"><i class="dot" [style.background]="kitOf(t).color"></i>{{ teamLabel()[t] }}</h3>
                    <ul>
                      @for (id of rosterOf(t); track id) {
                        <li>
                          <button class="pl" [class.mine]="id === session.uid()" [class.can]="editable(id)" [disabled]="!editable(id)" (click)="openScorer(id)"
                                  [attr.aria-label]="session.name(id) + ': ' + (summary(val(id, 'goals'), val(id, 'assists'), val(id, 'own_goals')) || 'nessun gol') + (editable(id) ? '. Tocca per modificare' : '')">
                            <app-avatar [userId]="id" [team]="t" [size]="26" />
                            <span class="pname ellipsis">{{ session.name(id) }}</span>
                            <span class="marks">
                              @for (k of marks(val(id, 'goals')); track $index) { <app-ball /> }
                              @if (val(id, 'goals') > 3) { <span class="times">×{{ val(id, 'goals') }}</span> }
                              @for (k of marks(val(id, 'own_goals')); track $index) { <app-ball [own]="true" /> }
                              @if (val(id, 'own_goals') > 3) { <span class="times">×{{ val(id, 'own_goals') }}</span> }
                              @for (k of marks(val(id, 'assists')); track $index) { <app-boot /> }
                              @if (val(id, 'assists') > 3) { <span class="times">×{{ val(id, 'assists') }}</span> }
                              @if (lockedByLeader(id) && !session.isLeader()) { <app-icon name="lock" [size]="12" class="lk" /> }
                            </span>
                          </button>
                        </li>
                      }
                    </ul>
                  </div>
                }
              </div>
              <p class="legend small muted"><app-ball [size]="13" /> gol <app-ball [own]="true" [size]="13" /> autogol <app-boot [size]="13" /> assist</p>
            </section>
          }

          <!-- risultato già inserito: la correzione è una tendina chiusa sotto le formazioni -->
          @if (canEnter() && store.result()) {
            <details class="panel fold">
              <summary><span class="grow"><strong>Correggi il risultato</strong></span><app-icon name="chevron" [size]="18" /></summary>
              <div class="stack fold-body"><ng-container *ngTemplateOutlet="entry" /></div>
            </details>
          }

          <ng-template #entry>
                  <div class="score-in">
                    <div class="stack"><span class="small muted">{{ teamLabel().white }}</span>
                      <div class="stepper"><button (click)="wg.set(dec(wg()))" [attr.aria-label]="teamLabel().white + ' meno'">−</button><output>{{ wg() }}</output><button (click)="wg.set(wg() + 1)" [attr.aria-label]="teamLabel().white + ' più'">+</button></div>
                    </div>
                    <span class="num dash">–</span>
                    <div class="stack"><span class="small muted">{{ teamLabel().black }}</span>
                      <div class="stepper"><button (click)="bg.set(dec(bg()))" [attr.aria-label]="teamLabel().black + ' meno'">−</button><output>{{ bg() }}</output><button (click)="bg.set(bg() + 1)" [attr.aria-label]="teamLabel().black + ' più'">+</button></div>
                    </div>
                  </div>
                <button class="btn primary" [disabled]="busy()" (click)="submit()">Salva {{ previewText() }}</button>
          </ng-template>

          <!-- pannello per inserire i dati di un giocatore -->
          <dialog #scorerDlg class="sheet" (click)="scorerBackdrop($event)" (close)="cancelScorer()" aria-labelledby="sc-h">
            @if (editing(); as id) {
              <div class="grab" aria-hidden="true"></div>
              <div class="sc-head">
                <app-avatar [userId]="id" [team]="store.teamOf().get(id)" [size]="40" />
                <h2 id="sc-h" class="grow">{{ session.name(id) }}</h2>
              </div>
              @for (f of fields; track f.key) {
                <div class="sc-row">
                  <span class="sc-ic">
                    @if (f.key === 'goals') { <app-ball [size]="20" /> } @else if (f.key === 'own_goals') { <app-ball [own]="true" [size]="20" /> } @else { <app-boot [size]="20" /> }
                  </span>
                  <span class="grow">{{ f.label }}</span>
                  <div class="stepper">
                    <button (click)="bump(id, f.key, -1)" [disabled]="val(id, f.key) === 0" [attr.aria-label]="f.label + ' meno'">−</button>
                    <output>{{ val(id, f.key) }}</output>
                    <button (click)="bump(id, f.key, 1)" [disabled]="!canAdd(id, f.key)" [attr.aria-label]="f.label + ' più'">+</button>
                  </div>
                </div>
              }
              <p class="small muted">L'autogol conta per la squadra avversaria.</p>
              @for (i of issues(); track i) { <p class="note warn" role="alert">{{ i }}</p> }
              <div class="row">
                <button class="btn ghost grow" (click)="closeScorer()">Annulla</button>
                <button class="btn primary grow" [disabled]="busy() || issues().length > 0 || !dirty()" (click)="saveFromSheet()">Salva</button>
              </div>
            }
          </dialog>
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
    .fold summary { display: flex; align-items: center; gap: 10px; cursor: pointer; list-style: none; min-height: 40px; }
    .fold summary::-webkit-details-marker { display: none; }
    .fold summary app-icon { transform: rotate(90deg); transition: transform 200ms; }
    .fold[open] summary app-icon { transform: rotate(-90deg); }
    .fold-body { margin-top: 12px; }
    /* «i» in alto a destra nel riquadro del risultato e fumetto ancorato */
    .result { position: relative; }
    /* sull'angolo del riquadro, a cavallo del bordo: non copre maglie e punteggio */
    .info-btn { position: absolute; top: -12px; right: -8px; z-index: 3; width: 32px; height: 32px; border-radius: 50%; border: 0; cursor: pointer;
                display: grid; place-items: center; background: var(--surface); color: var(--muted); box-shadow: 0 0 0 1px var(--line), 0 2px 6px rgb(0 0 0 / 12%); }
    .info-btn[aria-expanded='true'] { color: var(--turf); box-shadow: 0 0 0 2px var(--turf), 0 2px 6px rgb(0 0 0 / 12%); }
    .info-pop {
      position: absolute; top: 28px; right: -8px; z-index: 4; width: min(270px, calc(100% - 16px)); padding: 12px 14px; border-radius: 14px;
      background: var(--surface); color: var(--ink); box-shadow: 0 10px 30px rgb(0 0 0 / 22%), 0 0 0 1px var(--line); font-size: var(--step--1);
      display: flex; flex-direction: column; gap: 6px; text-align: left;
    }
    .info-pop::before { content: ''; position: absolute; top: -6px; right: 16px; width: 12px; height: 12px; background: var(--surface); transform: rotate(45deg); box-shadow: -1px -1px 0 var(--line); }
    .info-pop p { margin: 0; }
    .info-pop ul { list-style: none; margin: 2px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
    .info-pop .ok { color: var(--turf); font-weight: 800; }
    .info-pop .ko { color: var(--danger); font-weight: 800; }
    /* punteggio centrato tra le due maglie, sempre su una riga */
    .score-mid h2, .score-mid .big { white-space: nowrap; }
    .scoreline { display: flex; align-items: center; justify-content: center; gap: 14px; }
    .score-mid { display: flex; flex-direction: column; align-items: center; gap: 6px; }
    /* formazioni complete, una colonna per squadra */
    .rosters { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .roster { min-width: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 10px 8px; }
    .rhead { display: flex; align-items: center; gap: 6px; font-size: var(--step-0); margin: 0 4px 6px; }
    .roster.right .rhead { justify-content: flex-end; }
    .dot { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 25%); flex: none; }
    .roster ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .pl { appearance: none; border: 0; background: none; color: var(--ink); font: inherit; width: 100%; min-height: 40px; padding: 4px; border-radius: 10px;
          display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 6px; align-items: center; text-align: left; cursor: default; }
    .pl app-avatar { grid-row: 1 / 3; }
    .pname { font-weight: 600; font-size: var(--step--1); min-width: 0; }
    .marks { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; min-height: 0; }
    .marks:empty { display: none; }
    .pl.can { cursor: pointer; }
    .pl.can:hover { background: var(--surface-2); }
    .pl.mine .pname { color: var(--turf); }
    .pl:disabled { opacity: 1; }
    .roster.right .pl { grid-template-columns: 1fr auto; text-align: right; }
    .roster.right .pl app-avatar { grid-column: 2; grid-row: 1 / 3; }
    .roster.right .pname, .roster.right .marks { grid-column: 1; justify-content: flex-end; }
    .times { font-size: 0.7rem; font-weight: 700; color: var(--muted); }
    .lk { color: var(--muted); margin-left: 2px; }
    .legend { display: flex; align-items: center; justify-content: center; gap: 4px; flex-wrap: wrap; }
    .legend app-ball, .legend app-boot { margin-left: 8px; }
    .legend app-ball:first-child { margin-left: 0; }
    /* pannello di inserimento */
    .sheet { position: fixed; inset: auto 0 0 0; margin: 0 auto; width: 100%; max-width: 560px; border: 0; color: var(--ink);
             background: var(--surface); border-radius: 22px 22px 0 0; padding: 8px 16px calc(16px + env(safe-area-inset-bottom, 0px)); box-shadow: 0 -10px 40px rgb(0 0 0 / 25%); }
    .sheet[open] { display: flex; flex-direction: column; gap: 12px; }
    .sheet::backdrop { background: rgb(10 20 14 / 45%); }
    .grab { width: 40px; height: 5px; border-radius: 3px; background: var(--line); align-self: center; }
    .sc-head { display: flex; align-items: center; gap: 12px; }
    .sc-row { display: flex; align-items: center; gap: 12px; min-height: 48px; border-top: 1px solid var(--line); }
    .sc-ic { width: 24px; display: grid; place-items: center; }
    .scorer { display: flex; align-items: center; gap: 6px; padding: 6px 0; border-top: 1px solid var(--line); flex-wrap: wrap; }
    .scorer.mine .grow { font-weight: 700; }
    .scorer .tag { margin-left: 6px; font-size: 0.7rem; }
    .readonly { text-align: right; }
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
  protected readonly teamLabel = computed(() => this.store.teamNames());
  protected readonly when = fmtWhen;
  protected readonly text = diffText;
  protected readonly fields: { key: Field; label: string }[] = [
    { key: 'goals', label: 'Gol' },
    { key: 'assists', label: 'Assist' },
    { key: 'own_goals', label: 'Autogol' },
  ];

  protected readonly busy = signal(false);
  protected readonly contesting = signal(false);
  protected readonly exact = signal(true);   // si inserisce solo il risultato esatto
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
    return this.session.isLeader();   // il risultato lo omologa il Leader
  });

  protected readonly canEditScorers = computed(() => {
    const t = this.store.t();
    if (!t?.resultOpen) return false;
    if (t.locked) return this.session.isLeader();
    return this.store.amParticipant() || this.session.isLeader();
  });

  /** ognuno modifica solo la propria riga (se non l'ha fissata il Leader); il Leader tutte */
  protected editable(id: string): boolean {
    if (this.session.isLeader()) return true;
    return id === this.session.uid() && !this.lockedByLeader(id);
  }

  protected lockedByLeader(id: string): boolean {
    return this.store.scorers().some((s) => s.user_id === id && s.set_by_leader);
  }

  protected readonly homologatedBy = computed(() => {
    const by = this.store.result()?.homologated_by;
    return by === 'quorum' ? 'Confermato da almeno 5 giocatori.' : by === 'leader' ? 'Omologato dal Leader.' : 'Omologato da un Premier.'   // storico;
  });

  protected readonly previewText = computed(() => {
    if (this.exact()) return `${this.wg()} – ${this.bg()}`;
    if (this.winner() === 'draw') return 'pareggio';
    return `${this.teamLabel()[this.winner() === 'white' ? 'white' : 'black']} +${this.margin()}`;
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
    const n = this.teamLabel();
    // ognuno inserisce i propri dati: gli assist si confrontano con i gol del risultato, non con quelli già inseriti
    if (r && r.white_goals !== null && r.black_goals !== null) {
      if (c.wAst > r.white_goals) out.push(`I ${n.white} hanno più assist che gol segnati.`);
      if (c.bAst > r.black_goals) out.push(`I ${n.black} hanno più assist che gol segnati.`);
      if (c.white > r.white_goals) out.push(`Ai ${n.white} risultano ${c.white} gol, ma ne hanno fatti ${r.white_goals}.`);
      if (c.black > r.black_goals!) out.push(`Ai ${n.black} risultano ${c.black} gol, ma ne hanno fatti ${r.black_goals}.`);
    }
    return out;
  });

  constructor() {
    effect(() => {
      this.store.scorers();
      untracked(() => this.fromStore());
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

  /** Impedisce di superare il risultato mentre si inserisce (es. 4-0: nessun gol alla squadra che non ha segnato). */
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
    // assist fino ai gol della squadra nel risultato (anche se i compagni non hanno ancora inserito i loro gol)
    const maxA = this.goalsOf(t);
    const ast = t === 'white' ? c.wAst : c.bAst;
    return maxA === null || ast < maxA;
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

  // ------------------------------------------------ fumetto delle informazioni («i»)
  protected readonly infoOpen = signal(false);

  protected toggleInfo(e: Event): void {
    e.stopPropagation();
    this.infoOpen.update((v) => !v);
  }

  /** un tocco fuori dal fumetto o Esc lo chiudono */
  protected closeInfo(): void {
    if (this.infoOpen()) this.infoOpen.set(false);
  }

  /** valori in modifica = quelli salvati */
  private fromStore(): void {
    const map = new Map<string, Line>();
    for (const s of this.store.scorers()) map.set(s.user_id, { goals: s.goals, assists: s.assists, own_goals: s.own_goals });
    this.lines.set(map);
    this.dirty.set(false);
  }

  // --------------------------------------------- pannello per un giocatore
  private readonly scorerDlg = viewChild<ElementRef<HTMLDialogElement>>('scorerDlg');
  protected readonly editing = signal<string | null>(null);

  protected openScorer(id: string): void {
    if (!this.editable(id)) return;
    this.fromStore();
    this.editing.set(id);
    const d = this.scorerDlg()?.nativeElement;
    if (d && !d.open) d.showModal();
  }

  protected closeScorer(): void {
    this.scorerDlg()?.nativeElement.close();
  }

  /** chiudere senza salvare annulla le modifiche */
  protected cancelScorer(): void {
    this.editing.set(null);
    this.fromStore();
  }

  protected scorerBackdrop(e: MouseEvent): void {
    if (e.target === this.scorerDlg()?.nativeElement) this.closeScorer();
  }

  /** salva e, se è andata bene, chiude il pannello */
  protected async saveFromSheet(): Promise<void> {
    if (this.reprimand.guard()) return;
    const rows = [...this.lines()].filter(([user_id]) => this.editable(user_id)).map(([user_id, l]) => ({ user_id, ...l }));
    this.busy.set(true);
    try {
      await this.api.saveScorers(this.store.match()!.id, rows);
      await this.store.reload('scorers');
      this.toasts.show('Gol e assist salvati.');
      this.closeScorer();
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** squadra con chi ha segnato in cima, poi in ordine di nome */
  protected rosterOf(t: Team): string[] {
    return [...this.players(t)].sort((a, b) =>
      this.val(b, 'goals') - this.val(a, 'goals') || this.val(b, 'assists') - this.val(a, 'assists') || this.session.name(a).localeCompare(this.session.name(b)));
  }

  /** fino a 3 segni; oltre si scrive ×n */
  protected marks(n: number): number[] {
    return n > 0 && n <= 3 ? Array.from({ length: n }, (_, i) => i) : n > 3 ? [0] : [];
  }

  protected kitOf(t: Team) {
    const m = this.store.match();
    return kit(t === 'white' ? m?.team_a_kit : m?.team_b_kit);
  }

  protected async saveScorers(): Promise<void> {
    if (this.reprimand.guard()) return;
    // si inviano solo le righe che si possono modificare (per un giocatore: la sua)
    const rows = [...this.lines()].filter(([user_id]) => this.editable(user_id)).map(([user_id, l]) => ({ user_id, ...l }));
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
