import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { Api } from '../core/api';
import { fmtWhen } from '../core/format';
import { MvpVote, PlayerVote, Team, VoteSummary } from '../core/models';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { MatchStore } from './match-store';
import { Reprimand } from '../ui/reprimand';
import { Avatar } from '../ui/avatar';
import { VoteSlider } from '../ui/vote-slider';
import { Icon } from '../ui/icon';
import { kit } from '../core/kits';

@Component({
  selector: 'app-votes-tab',
  imports: [Avatar, VoteSlider, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.match(); as m) {
      @if (store.t()?.votesBefore) {
        <p class="empty">Le pagelle si aprono {{ when(m.votes_opens_at) }}.</p>
      } @else {
        <div class="stack-l">
          <!-- sotto-schede: niente pagine infinite da scorrere -->
          <div class="seg" role="tablist" aria-label="Pagelle">
            @for (p of panes(); track p.id) {
              <button role="tab" [attr.aria-selected]="pane() === p.id" [disabled]="p.disabled" (click)="pane.set(p.id)">
                {{ p.label }}@if (p.id === 'vota' && !p.disabled) { <span class="pip" aria-hidden="true"></span> }
              </button>
            }
          </div>

          @switch (pane()) {
            <!-- ================================================================ VOTA -->
            @case ('vota') {
              <section class="stack" aria-label="Vota">
                <p class="small muted">Trascina il cursore di lato per dare il voto: chi non tocchi prende <strong>6</strong>. Scorrendo la pagina i voti non cambiano. La stella sceglie il migliore in campo di ogni squadra. I voti restano segreti e, una volta confermati, non si cambiano più.</p>
                <button class="mvp-card" (click)="openMvp()" [attr.aria-label]="mvpPick() ? 'Migliore in campo: ' + session.name(mvpPick()!) + '. Tocca per cambiare' : 'Scegli il migliore in campo'">
                  <span class="mvp-star" aria-hidden="true">★</span>
                  @if (mvpPick(); as id) {
                    <app-avatar [userId]="id" [team]="team(id)" [size]="40" />
                    <span class="grow"><span class="small muted">Migliore in campo</span><br /><strong>{{ session.name(id) }}</strong></span>
                  } @else {
                    <span class="grow"><strong>Migliore in campo</strong><br /><span class="small muted">Tocca per sceglierlo (facoltativo)</span></span>
                  }
                  <app-icon name="chevron" [size]="18" />
                </button>

                @for (g of groups(); track g.key) {
                  <div class="group">
                    <h3 class="ghead"><i class="dot" [style.background]="g.color"></i>{{ g.label }}</h3>
                    <ul class="rows">
                      @for (id of g.ids; track id) {
                        <li class="voting">
                          <div class="line">
                            <app-avatar [userId]="id" [team]="team(id)" [size]="38" />
                            <span class="grow ellipsis name">{{ session.name(id) }}</span>
                            <span [class]="'rate static ' + tone(score(id))" [class.touched]="scores().has(id)" aria-hidden="true">{{ fmt(score(id)) }}</span>
                          </div>
                          <app-vote-slider [value]="score(id)" (valueChange)="setScore(id, $event)" [label]="'Voto a ' + session.name(id)" />
                        </li>
                      }
                    </ul>
                  </div>
                }
                <div class="confirm panel">
                  <p class="small">{{ toVote().length }} voti, media {{ fmt(myAvg()) }}@if (mvpPick(); as id) {, migliore: {{ session.name(id) }}}</p>
                  @if (needsMvp() && !mvpPick()) { <p class="small warn-text">Scegli il migliore in campo per confermare.</p> }
                  <button class="btn primary block" [disabled]="busy() || !toVote().length || (needsMvp() && !mvpPick())" (click)="submit()">Conferma i voti</button>
                </div>
              </section>
            }

            <!-- ================================================================ MEDIE -->
            @case ('medie') {
              <section class="stack" aria-label="Medie">
                @if (summary(); as s) {
                  @if (s.voters && s.players) {
                    @if (s.mvp_hidden) {
                      <p class="small muted">★ Il migliore in campo si scopre quando avranno votato {{ s.mvp_threshold }} giocatori: per ora {{ s.voters }}.</p>
                    }
                    @if (s.avgs_hidden) {
                      <p class="empty">Le medie compaiono quando avranno votato almeno {{ s.avg_threshold }} giocatori: per ora {{ s.voters }}.</p>
                    } @else {
                    <p class="small muted">{{ s.voters === 1 ? '1 ha votato' : s.voters + ' hanno votato' }}: le medie si aggiornano a ogni voto.</p>
                    <ol class="rows ranked">
                      @for (p of s.players; track p.user_id; let i = $index) {
                        <li>
                          <span class="pos num">{{ i + 1 }}</span>
                          <span class="av" [class.is-mvp]="p.is_mvp && p.mvp_votes > 0">
                            <app-avatar [userId]="p.user_id" [team]="team(p.user_id)" [size]="38" />
                            @if (p.is_mvp && p.mvp_votes > 0) {
                              <span class="mvp-dot" [attr.aria-label]="'Migliore in campo, ' + p.mvp_votes + (p.mvp_votes === 1 ? ' voto' : ' voti')">★ {{ p.mvp_votes }}</span>
                            }
                          </span>
                          <span class="grow ellipsis name">{{ session.name(p.user_id) }}
                          </span>
                          <span [class]="'rate static ' + tone(p.avg)">{{ p.avg !== null ? p.avg.toFixed(2).replace('.', ',') : '–' }}</span>
                        </li>
                      }
                    </ol>
                    }
                  } @else {
                    <p class="empty">Ancora nessuno ha votato.</p>
                  }
                }
              </section>
            }

            <!-- ================================================================ I MIEI VOTI -->
            @case ('miei') {
              <section class="stack" aria-label="I miei voti">
                <p class="small muted">I voti che hai dato. Sono definitivi e li vedi solo tu (e il Leader).</p>
                <ul class="rows">
                  @for (v of myGiven(); track v.id) {
                    <li>
                      <app-avatar [userId]="v.id" [team]="team(v.id)" [size]="38" />
                      <span class="grow ellipsis name">{{ session.name(v.id) }}
                        @if (v.mvp) { <span class="mvp">★ il tuo migliore</span> }
                      </span>
                      <span [class]="'rate static ' + tone(v.score)">{{ fmt(v.score) }}</span>
                    </li>
                  }
                </ul>
              </section>
            }

            <!-- ================================================================ PER VOTANTE -->
            @case ('tutti') {
              <section class="stack" aria-label="Voti per votante">
                @for (v of voters(); track v) {
                  <details class="panel voter">
                    <summary>
                      <app-avatar [userId]="v" [size]="30" />
                      <span class="grow ellipsis name">{{ session.name(v) }}</span>
                      <span class="small muted">{{ mvpLine(v) }}</span>
                    </summary>
                    <ul class="rows tight">
                      @for (pv of votesBy(v); track pv.target_id) {
                        <li><span class="grow ellipsis">{{ session.name(pv.target_id) }}</span><span [class]="'rate static small ' + tone(pv.score)">{{ fmt(pv.score) }}</span></li>
                      }
                    </ul>
                  </details>
                } @empty { <p class="empty">Nessun voto ancora.</p> }

                @if (session.isLeader() && canGrant()) {
                  <div class="panel stack">
                    <h3>Mostra i voti a qualcuno</h3>
                    <p class="small muted">Potranno vedere tutti i voti di questa partita fino a 24 ore prima della prossima.</p>
                    <div class="row-wrap">
                      @for (id of participantsWithAccount(); track id) {
                        <button class="chip" [attr.aria-pressed]="grantPick().has(id)" (click)="toggleGrant(id)">{{ session.name(id) }}</button>
                      }
                    </div>
                    <button class="btn small primary" [disabled]="!grantPick().size || busy()" (click)="grant()">Mostra i voti</button>
                  </div>
                }
              </section>
            }
          }

          @if (store.t()?.votesClosed && !done() && (store.amParticipant() || session.isLeader())) {
            <p class="note">Le votazioni sono chiuse.</p>
          }
        </div>

        <dialog #mvpDialog class="sheet" (click)="mvpBackdrop($event)" aria-label="Scegli il migliore in campo">
          <div class="grab" aria-hidden="true"></div>
          <h2 class="sheet-title">★ Migliore in campo</h2>
          @for (g of groups(); track g.key) {
            <h3 class="ghead"><i class="dot" [style.background]="g.color"></i>{{ g.label }}</h3>
            <div class="pick-grid">
              @for (id of g.ids; track id) {
                <button class="pick-p" [attr.aria-pressed]="mvpPick() === id" (click)="chooseMvp(id)">
                  <app-avatar [userId]="id" [team]="team(id)" [size]="44" />
                  <span class="ellipsis">{{ session.name(id) }}</span>
                </button>
              }
            </div>
          }
          <div class="row-wrap">
            <button class="btn small ghost" (click)="chooseMvp(null)">Nessuno</button>
            <button class="btn small" (click)="closeMvp()">Chiudi</button>
          </div>
        </dialog>
      }
    }
  `,
  styles: `
    /* sotto-schede */
    .seg { display: flex; gap: 4px; padding: 4px; border-radius: 14px; background: var(--surface-2); overflow-x: auto; scrollbar-width: none; }
    .seg::-webkit-scrollbar { display: none; }
    .seg button {
      flex: 1 0 auto; appearance: none; border: 0; background: transparent; color: var(--muted); cursor: pointer;
      min-height: 38px; padding: 0 12px; border-radius: 10px; font: 600 var(--step--1)/1 var(--font-body); white-space: nowrap;
    }
    .seg button[aria-selected='true'] { background: var(--surface); color: var(--ink); box-shadow: 0 1px 3px rgb(20 32 25 / 14%); }
    .pip { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--armband); margin-left: 6px; vertical-align: middle; }

    /* righe */
    .group { display: flex; flex-direction: column; gap: 6px; }
    .ghead { display: flex; align-items: center; gap: 8px; font-size: var(--step-1); }
    .dot { width: 14px; height: 14px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 25%); flex: none; }
    .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
    .rows li { display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 12px; min-height: 58px; border-top: 1px solid var(--line); min-width: 0; }
    .rows li:first-child { border-top: 0; }
    .rows li.voting { flex-direction: column; align-items: stretch; gap: 0; padding-bottom: 2px; }
    .line { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .rows.tight { border: 0; border-radius: 0; margin-top: 8px; }
    .rows.tight li { min-height: 40px; padding: 4px 0; }
    .name { font-weight: 600; }
    .pos { width: 20px; text-align: center; color: var(--muted); font-weight: 700; }
    .mvp { display: inline-block; margin-left: 6px; font-size: 0.72rem; font-weight: 700; color: var(--armband-ink); background: var(--armband); padding: 1px 7px; border-radius: 999px; vertical-align: middle; }

    /* il voto: distintivo colorato come nelle pagelle */
    .rate {
      flex: none; min-width: 52px; height: 40px; padding: 0 8px; border-radius: 12px; border: 0;
      display: inline-grid; place-items: center; cursor: pointer;
      font: 700 1.2rem/1 var(--font-display); color: #fff; background: var(--muted);
      transition: transform 160ms var(--ease-spring);
    }
    .rate.static { cursor: default; }
    .rate.small { min-width: 42px; height: 30px; font-size: 1rem; border-radius: 9px; }
    .rate:not(.touched) { opacity: 0.85; }
    .top { background: #1d5fd1; } .good { background: #1f7a4a; } .ok { background: #4f7a12; } .meh { background: #b45309; } .bad { background: #b93a26; } .none { background: var(--surface-2); color: var(--muted); }

    .seg button:disabled { opacity: 0.4; cursor: not-allowed; }
    .av { position: relative; display: inline-grid; flex: none; border-radius: 50%; }
    .av.is-mvp { box-shadow: 0 0 0 2px var(--armband); }
    .mvp-dot { position: absolute; right: -10px; bottom: -6px; height: 20px; min-width: 30px; padding: 0 6px; border-radius: 10px; display: grid; place-items: center;
               background: var(--armband); color: var(--armband-ink); font: 800 0.72rem/1 var(--font-display); box-shadow: 0 0 0 2px var(--surface); white-space: nowrap; }
    .warn-text { color: var(--danger); font-weight: 600; }
    .mvp-card {
      display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; cursor: pointer; min-height: 64px; padding: 10px 14px;
      border-radius: 16px; border: 1.5px solid color-mix(in srgb, var(--armband) 60%, var(--line)); background: color-mix(in srgb, var(--armband) 12%, var(--surface));
      color: var(--ink); font: inherit;
    }
    .mvp-star { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; flex: none; background: var(--armband); color: var(--armband-ink); font-size: 1.2rem; }
    .sheet {
      position: fixed; inset: auto 0 0 0; margin: 0 auto; width: 100%; max-width: 560px; max-height: 85vh; overflow-y: auto; border: 0; color: var(--ink);
      background: var(--surface); border-radius: 22px 22px 0 0; padding: 8px 16px calc(16px + env(safe-area-inset-bottom, 0px));
      box-shadow: 0 -10px 40px rgb(0 0 0 / 25%);
    }
    .sheet[open] { display: flex; flex-direction: column; gap: 10px; animation: rise 260ms var(--ease-out); }
    .sheet::backdrop { background: rgb(10 20 14 / 45%); }
    .grab { width: 40px; height: 5px; border-radius: 3px; background: var(--line); align-self: center; }
    .sheet-title { font-size: var(--step-1); }
    .pick-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 8px; }
    .pick-p {
      appearance: none; border: 1.5px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 14px; cursor: pointer;
      display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 6px; font: 600 var(--step--1)/1.1 var(--font-body); min-width: 0;
    }
    .pick-p span { max-width: 100%; }
    .pick-p[aria-pressed='true'] { border-color: var(--armband); background: color-mix(in srgb, var(--armband) 18%, var(--surface)); }
    @keyframes rise { from { transform: translateY(100%); } to { transform: none; } }
    .star {
      flex: none; appearance: none; width: 40px; height: 40px; border-radius: 50%; cursor: pointer;
      border: 1.5px solid var(--line); background: var(--surface); color: var(--muted); font-size: 1.1rem;
      transition: transform 200ms var(--ease-spring), background 160ms;
    }
    .star[aria-pressed='true'] { background: var(--armband); color: var(--armband-ink); border-color: var(--armband); transform: scale(1.06); }

    .confirm { position: sticky; bottom: 8px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 6px 24px rgb(20 32 25 / 16%); }


    .voter summary { display: flex; align-items: center; gap: 10px; cursor: pointer; list-style: none; min-height: 36px; }
    .voter summary::-webkit-details-marker { display: none; }

  `,
})
export class VotesTab {
  protected readonly store = inject(MatchStore);
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly reprimand = inject(Reprimand);

  protected readonly teams: Team[] = ['white', 'black'];
  protected readonly teamLabel = computed(() => this.store.teamNames());
  protected readonly when = fmtWhen;

  protected readonly summary = signal<VoteSummary | null>(null);
  protected readonly scores = signal(new Map<string, number>());
  /** il migliore (o i migliori a pari voti) da mettere in evidenza nelle medie */
  protected readonly mvpTop = computed(() => (this.summary()?.players ?? []).filter((p) => p.is_mvp && p.mvp_votes > 0));
  /** il migliore in campo è obbligatorio quando le squadre sono fatte */
  protected readonly needsMvp = computed(() => this.store.match()?.mvp_mode !== 'per_team' && this.groups().some((g) => !!g.team));

  /** un solo migliore in campo */
  protected readonly mvpPick = signal<string | null>(null);
  private readonly mvpDialog = viewChild<ElementRef<HTMLDialogElement>>('mvpDialog');
  protected readonly all = signal<{ votes: PlayerVote[]; mvp: MvpVote[] } | null>(null);
  protected readonly canSeeAll = signal(false);
  protected readonly grantPick = signal(new Set<string>());
  protected readonly busy = signal(false);

  protected readonly participants = computed(() => this.store.team().map((b) => b.user_id).filter((id) => id !== this.session.uid()));
  /** tutti quelli da votare (chi vota non vota sé stesso) */
  protected readonly toVote = this.participants;
  protected readonly pane = signal<'vota' | 'medie' | 'miei' | 'tutti'>('medie');
  protected readonly given = signal<{ id: string; score: number }[]>([]);
  protected readonly myMvp = signal<{ white: string | null; black: string | null }>({ white: null, black: null });
  /** ha già votato: i voti sono definitivi */
  protected readonly done = computed(() => this.given().length > 0 || !!this.summary()?.my_votes_done);
  /** vota chi ha giocato e il Leader (anche se non ha giocato), finché le votazioni sono aperte */
  protected readonly canVote = computed(() =>
    (this.store.amParticipant() || this.session.isLeader()) && !!this.store.t()?.votesOpen && !this.done());

  /** «Vota» resta sempre tra le schede: disattivata quando non si può votare (non ha giocato, ha già votato, votazioni chiuse) */
  protected readonly panes = computed(() => {
    const out: { id: 'vota' | 'medie' | 'miei' | 'tutti'; label: string; disabled: boolean }[] = [
      { id: 'vota', label: 'Vota', disabled: !this.canVote() },
      { id: 'medie', label: 'Medie', disabled: false },
    ];
    if (this.done()) out.push({ id: 'miei', label: 'I miei voti', disabled: false });
    if (this.canSeeAll()) out.push({ id: 'tutti', label: 'Per votante', disabled: false });
    return out;
  });

  /** gruppi da votare: una squadra per gruppo (più chi è senza colore) */
  protected readonly groups = computed(() => {
    const names = this.teamLabel();
    const m = this.store.match();
    const out: { key: string; team: Team | null; label: string; color: string; ids: string[] }[] = [];
    for (const t of this.teams) {
      const ids = this.toVote().filter((id) => this.team(id) === t);
      if (ids.length) out.push({ key: t, team: t, label: names[t], color: kit(t === 'white' ? m?.team_a_kit : m?.team_b_kit).color, ids });
    }
    const loose = this.unassigned();
    if (loose.length) out.push({ key: 'none', team: null, label: 'Senza colore', color: 'var(--surface-2)', ids: loose });
    return out;
  });

  protected readonly myAvg = computed(() => {
    const ids = this.toVote();
    return ids.length ? ids.reduce((s, id) => s + this.score(id), 0) / ids.length : 6;
  });


  protected readonly myGiven = computed(() => {
    const mv = this.myMvp();
    return [...this.given()].sort((a, b) => b.score - a.score).map((v) => ({ ...v, mvp: v.id === mv.white || v.id === mv.black }));
  });
  // segnali "stretti": l'orologio interno non deve ricaricare i voti e cancellare quelli non inviati
  private readonly matchId = computed(() => this.store.match()?.id ?? null);
  private readonly resultOpen = computed(() => !(this.store.t()?.votesBefore ?? true));
  /** solo chi ha un account può vedere i voti */
  protected readonly participantsWithAccount = computed(() => this.participants().filter((id) => !this.session.memberMap().get(id)?.guest));
  protected readonly unassigned = computed(() => this.participants().filter((id) => !this.store.teamOf().has(id)));
  protected readonly voters = computed(() => {
    const a = this.all();
    if (!a) return [];
    return [...new Set([...a.votes.map((v) => v.voter_id), ...a.mvp.map((v) => v.voter_id)])];
  });

  protected readonly canGrant = computed(() => {
    const m = this.store.match();
    return !!m && this.store.now() <= new Date(m.ends_at).getTime() + 24 * 3600_000;
  });

  constructor() {
    effect(() => {
      const id = this.matchId();
      const uid = this.session.uid();
      if (!id || !uid || !this.resultOpen()) return;
      untracked(() => void this.load(id, uid));
    });
  }

  private async load(matchId: string, uid: string): Promise<void> {
    try {
      const [summary, mine, canSee] = await Promise.all([
        this.api.voteSummary(matchId), this.api.myVotes(matchId, uid), this.api.canSeeVotes(matchId),
      ]);
      this.summary.set(summary);
      this.given.set(mine.votes.map((v) => ({ id: v.target_id, score: Number(v.score) })));
      this.myMvp.set({ white: mine.mvp?.white_pick ?? null, black: mine.mvp?.black_pick ?? null });
      this.canSeeAll.set(canSee);
      if (canSee) this.all.set(await this.api.allVotes(matchId));
      // si apre su "Vota" se c'è da votare, altrimenti sulle medie
      this.pane.set(this.canVote() ? 'vota' : 'medie');
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }

  protected team(id: string): Team | undefined {
    return this.store.teamOf().get(id);
  }

  /** voto di un compagno: 6 finché non lo cambi (e il 6 vale come voto dato) */
  protected score(id: string): number {
    return this.scores().get(id) ?? 6;
  }

  protected fmt(v: number | null): string {
    if (v === null || v === undefined) return '–';
    return Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');
  }

  /** colore del voto, come nelle pagelle delle app di calcio */
  protected tone(v: number | null): string {
    if (v === null || v === undefined) return 'none';
    if (v >= 8.5) return 'top';
    if (v >= 7) return 'good';
    if (v >= 6) return 'ok';
    if (v >= 5) return 'meh';
    return 'bad';
  }

  protected setScore(id: string, value: number): void {
    const m = new Map(this.scores());
    m.set(id, value);
    this.scores.set(m);
  }

  protected openMvp(): void {
    const d = this.mvpDialog()?.nativeElement;
    if (d && !d.open) d.showModal();
  }

  protected closeMvp(): void {
    this.mvpDialog()?.nativeElement.close();
  }

  protected chooseMvp(id: string | null): void {
    this.mvpPick.set(id);
    this.closeMvp();
  }

  /** un tocco sullo sfondo chiude la finestra */
  protected mvpBackdrop(e: MouseEvent): void {
    if (e.target === this.mvpDialog()?.nativeElement) this.closeMvp();
  }

  protected votesBy(voter: string): PlayerVote[] {
    return (this.all()?.votes ?? []).filter((v) => v.voter_id === voter).sort((a, b) => b.score - a.score);
  }

  protected mvpLine(voter: string): string {
    const m = this.all()?.mvp.find((v) => v.voter_id === voter);
    if (!m || (!m.white_pick && !m.black_pick)) return 'migliore dedotto dai voti';
    return [m.white_pick && `★ ${this.session.name(m.white_pick)}`, m.black_pick && `★ ${this.session.name(m.black_pick)}`].filter(Boolean).join(', ');
  }

  protected toggleGrant(id: string): void {
    this.grantPick.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  protected async submit(): Promise<void> {
    if (this.reprimand.guard()) return;
    const id = this.store.match()!.id;
    if (!confirm('Confermare i voti? Una volta inviati non si possono più cambiare.')) return;
    this.busy.set(true);
    try {
      // tutti i compagni: chi non è stato toccato prende 6
      const votes = this.toVote().map((target_id) => ({ target_id, score: this.score(target_id) }));
      await this.api.submitVotes(id, votes, this.mvpPick(), null);
      this.toasts.show('Voti inviati. Restano segreti.');
      await this.load(id, this.session.uid()!);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async grant(): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.grantVotes(this.store.match()!.id, [...this.grantPick()]);
      this.toasts.show('Fatto: ora possono vedere i voti di questa partita.');
      this.grantPick.set(new Set());
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
