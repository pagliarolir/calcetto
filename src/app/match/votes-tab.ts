import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Api } from '../core/api';
import { fmtWhen } from '../core/format';
import { MvpVote, PlayerVote, Team, VoteSummary } from '../core/models';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { MatchStore } from './match-store';
import { Reprimand } from '../ui/reprimand';
import { Avatar } from '../ui/avatar';

@Component({
  selector: 'app-votes-tab',
  imports: [Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.match(); as m) {
      <div class="stack-l">
        @if (store.t()?.votesBefore) {
          <p class="empty">Le pagelle si aprono {{ when(m.votes_opens_at) }}.</p>
        } @else {
          <!-- Medie (REQ-043) -->
          <section class="section">
            <header><h2>Pagelle</h2>
              @if (summary(); as s) { <span class="small muted">{{ s.voters }} hanno votato</span> }</header>
            @if (summary(); as s) {
              @if (s.players) {
                <ol class="list">
                  @for (p of s.players; track p.user_id; let i = $index) {
                    <li class="list-item">
                      <app-avatar [userId]="p.user_id" [team]="team(p.user_id)" />
                      <span class="grow">{{ session.name(p.user_id) }}
                        @if (p.is_mvp) { <span class="tag armband">Migliore in campo</span> }
                      </span>
                      <span class="num avg">{{ p.avg !== null ? p.avg.toFixed(2) : '–' }}</span>
                    </li>
                  }
                </ol>
              } @else {
                <p class="empty">Le medie compaiono quando avranno votato almeno {{ s.threshold }} giocatori. Finora: {{ s.voters }}.</p>
              }
            }
          </section>

          <!-- Il mio voto (REQ-041, REQ-042, REQ-044) -->
          @if (store.amParticipant() && store.t()?.votesOpen) {
            <section class="section">
              <header><h2>I tuoi voti</h2><span class="small muted">segreti, fino a {{ when(m.votes_closes_at) }}</span></header>
              @for (t of teams; track t) {
                <div class="panel stack">
                  <h3>{{ teamLabel()[t] }}</h3>
                  @for (id of others(t); track id) {
                    <div class="vote">
                      <div class="spread">
                        <span class="grow ellipsis">{{ session.name(id) }}</span>
                        <button class="star" [attr.aria-pressed]="mvp()[t] === id" (click)="pickMvp(t, id)"
                                [attr.aria-label]="'Migliore in campo dei ' + teamLabel()[t] + ': ' + session.name(id)">★</button>
                        <output class="num score" [class.unset]="scores().get(id) == null">{{ scoreText(id) }}</output>
                      </div>
                      <input type="range" min="1" max="10" step="0.5" [value]="scores().get(id) ?? 6"
                             [attr.aria-label]="'Voto a ' + session.name(id)" (input)="setScore(id, $any($event.target).value)" />
                    </div>
                  } @empty { <p class="small muted">Nessun compagno da votare in questa squadra.</p> }
                </div>
              }
              @if (unassigned().length) {
                <div class="panel stack">
                  <h3>Senza colore</h3>
                  @for (id of unassigned(); track id) {
                    <div class="vote">
                      <div class="spread">
                        <span class="grow ellipsis">{{ session.name(id) }}</span>
                        <output class="num score" [class.unset]="scores().get(id) == null">{{ scoreText(id) }}</output>
                      </div>
                      <input type="range" min="1" max="10" step="0.5" [value]="scores().get(id) ?? 6"
                             [attr.aria-label]="'Voto a ' + session.name(id)" (input)="setScore(id, $any($event.target).value)" />
                    </div>
                  }
                </div>
              }
              <p class="small muted">La stella indica il migliore in campo di ciascuna squadra. Se non la scegli, vale chi ha il tuo voto più alto.</p>
              <button class="btn primary block" [disabled]="busy() || scores().size === 0" (click)="submit()">
                {{ summary()?.my_votes_done ? 'Aggiorna i voti' : 'Invia i voti' }}
              </button>
            </section>
          } @else if (store.amParticipant() && store.t()?.votesClosed) {
            <p class="note">Le votazioni sono chiuse.</p>
          }

          <!-- Tutti i voti: Leader o chi è autorizzato (REQ-045, REQ-046) -->
          @if (canSeeAll()) {
            <section class="section">
              <header><h2>Chi ha votato cosa</h2></header>
              @for (v of voters(); track v) {
                <details class="panel">
                  <summary>{{ session.name(v) }}
                    <span class="small muted">{{ mvpLine(v) }}</span></summary>
                  <ul class="plain">
                    @for (pv of votesBy(v); track pv.target_id) {
                      <li class="spread"><span>{{ session.name(pv.target_id) }}</span><span class="num">{{ pv.score }}</span></li>
                    }
                  </ul>
                </details>
              } @empty { <p class="empty">Nessun voto ancora.</p> }
            </section>
          }

          @if (session.isLeader() && canGrant()) {
            <section class="panel stack">
              <h3>Mostra i voti a qualcuno</h3>
              <p class="small muted">Potranno vedere tutti i voti di questa partita fino a 24 ore prima della prossima.</p>
              <div class="row-wrap">
                @for (id of participants(); track id) {
                  <button class="chip" [attr.aria-pressed]="grantPick().has(id)" (click)="toggleGrant(id)">{{ session.name(id) }}</button>
                }
              </div>
              <button class="btn small primary" [disabled]="!grantPick().size || busy()" (click)="grant()">Mostra i voti</button>
            </section>
          }
        }
      </div>
    }
  `,
  styles: `
    .avg { font-size: var(--step-2); font-weight: 700; }
    .vote { display: flex; flex-direction: column; gap: 4px; padding: 8px 0; border-top: 1px solid var(--line); }
    .score { min-width: 48px; text-align: right; font-size: var(--step-2); font-weight: 700; }
    .score.unset { color: var(--muted); font-size: var(--step-0); }
    .star {
      appearance: none; border: 1.5px solid var(--line); background: var(--surface); color: var(--muted);
      width: 40px; height: 40px; border-radius: 50%; font-size: 1.1rem; cursor: pointer;
      transition: transform 200ms var(--ease-spring), background 160ms;
    }
    .star[aria-pressed='true'] { background: var(--armband); color: var(--armband-ink); border-color: var(--armband); transform: scale(1.08); }
    input[type='range'] { width: 100%; accent-color: var(--turf); height: 32px; }
    summary { cursor: pointer; font-weight: 600; display: flex; justify-content: space-between; gap: 8px; }
    .plain { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
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
  protected readonly mvp = signal<Record<Team, string | null>>({ white: null, black: null });
  protected readonly all = signal<{ votes: PlayerVote[]; mvp: MvpVote[] } | null>(null);
  protected readonly canSeeAll = signal(false);
  protected readonly grantPick = signal(new Set<string>());
  protected readonly busy = signal(false);

  protected readonly participants = computed(() => this.store.team().map((b) => b.user_id).filter((id) => id !== this.session.uid()));
  // segnali "stretti": l'orologio interno non deve ricaricare i voti e cancellare quelli non inviati
  private readonly matchId = computed(() => this.store.match()?.id ?? null);
  private readonly resultOpen = computed(() => !(this.store.t()?.votesBefore ?? true));
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
      this.scores.set(new Map(mine.votes.map((v) => [v.target_id, Number(v.score)])));
      this.mvp.set({ white: mine.mvp?.white_pick ?? null, black: mine.mvp?.black_pick ?? null });
      this.canSeeAll.set(canSee);
      if (canSee) this.all.set(await this.api.allVotes(matchId));
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }

  protected team(id: string): Team | undefined {
    return this.store.teamOf().get(id);
  }

  protected others(t: Team): string[] {
    return this.participants().filter((id) => this.team(id) === t);
  }

  protected scoreText(id: string): string {
    const s = this.scores().get(id);
    return s == null ? 'da votare' : String(s).replace('.', ',');
  }

  protected setScore(id: string, value: string): void {
    const m = new Map(this.scores());
    m.set(id, Number(value));
    this.scores.set(m);
  }

  protected pickMvp(t: Team, id: string): void {
    this.mvp.update((p) => ({ ...p, [t]: p[t] === id ? null : id }));
  }

  protected votesBy(voter: string): PlayerVote[] {
    return (this.all()?.votes ?? []).filter((v) => v.voter_id === voter).sort((a, b) => b.score - a.score);
  }

  protected mvpLine(voter: string): string {
    const m = this.all()?.mvp.find((v) => v.voter_id === voter);
    if (!m || (!m.white_pick && !m.black_pick)) return 'migliori dedotti dai voti';
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
    this.busy.set(true);
    try {
      const votes = [...this.scores()].map(([target_id, score]) => ({ target_id, score }));
      await this.api.submitVotes(id, votes, this.mvp().white, this.mvp().black);
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
