import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { age, fmtDate } from '../core/format';
import { FIELD_ROLE_LABEL, MatchFact, ROLE_LABEL, StatsRow } from '../core/models';
import { Session } from '../core/session';
import { Avatar } from '../ui/avatar';

@Component({
  selector: 'app-player',
  imports: [RouterLink, Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page stack-l">
      @if (member(); as m) {
        <header class="stack">
          <a class="small muted back" routerLink="/classifica">Classifica</a>
          <div class="id">
            <app-avatar [userId]="m.id" [size]="88" />
            <h1>{{ session.fullName(m.id) }}</h1>
          </div>
          <div class="row-wrap">
            @if (m.nickname) { <span class="tag">detto {{ m.nickname }}</span> }
            @if (m.role !== 'user') { <span class="tag armband">{{ roleLabel[m.role] }}</span> }
            @if (m.field_role) { <span class="tag turf">{{ fieldRole[m.field_role] }}</span> }
            @if (!m.active) { <span class="tag danger">non più nel gruppo</span> }
          </div>
          @if (bio()) { <p class="muted">{{ bio() }}</p> }
        </header>
      }

      @if (stats(); as s) {
        <section class="grid">
          <div><span class="num v">{{ s.played }}</span><span class="small muted">partite</span></div>
          <div><span class="num v">{{ s.wins }}–{{ s.draws }}–{{ s.losses }}</span><span class="small muted">vinte, pari, perse</span></div>
          <div><span class="num v">{{ s.goals }}</span><span class="small muted">gol</span></div>
          <div><span class="num v">{{ s.assists }}</span><span class="small muted">assist</span></div>
          <div><span class="num v">{{ s.avg_vote !== null ? dec(s.avg_vote) : '–' }}</span><span class="small muted">voto medio</span></div>
          <div><span class="num v">{{ s.mvp_count }}</span><span class="small muted">volte migliore</span></div>
          <div><span class="num v">{{ s.cur_win_streak }}</span><span class="small muted">vittorie di fila ora (record {{ s.best_win_streak }})</span></div>
          <div><span class="num v">{{ s.cur_unbeaten }}</span><span class="small muted">senza perdere ora (record {{ s.best_unbeaten }})</span></div>
          <div><span class="num v">{{ s.attendances }}</span><span class="small muted">presenze</span></div>
        </section>
      }

      <section class="section">
        <header><h2>Partite</h2></header>
        <ol class="list">
          @for (f of history(); track f.match_id) {
            <li>
              <a class="list-item" [routerLink]="['/partita', f.match_id, 'risultato']">
                <span class="res" [class.w]="f.outcome === 'W'" [class.l]="f.outcome === 'L'">{{ outcome[f.outcome] }}</span>
                <span class="grow">{{ date(f.starts_at) }} <span class="small muted">con i {{ f.team === 'white' ? 'Bianchi' : 'Neri' }}</span><br />
                  <span class="small muted">{{ line(f) }}</span></span>
                @if (f.is_mvp) { <span class="tag armband">MVP</span> }
                @if (f.avg_vote !== null) { <span class="num">{{ dec(f.avg_vote) }}</span> }
              </a>
            </li>
          } @empty { <li class="empty">Ancora nessuna partita omologata.</li> }
        </ol>
      </section>
    </main>
  `,
  styles: `
    .back { text-decoration: none; }
    .id { display: flex; align-items: center; gap: 16px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: var(--r-m); overflow: hidden; }
    .grid > div { background: var(--surface); padding: 12px; display: flex; flex-direction: column; gap: 2px; }
    .v { font-size: var(--step-2); font-weight: 700; }
    .res { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; font: 700 1rem/1 var(--font-display); background: var(--surface-2); }
    .res.w { background: var(--turf); color: var(--turf-ink); }
    .res.l { background: var(--danger-soft); color: var(--danger); }
  `,
})
export class PlayerPage {
  readonly id = input.required<string>();
  protected readonly session = inject(Session);
  private readonly api = inject(Api);

  protected readonly roleLabel = ROLE_LABEL;
  protected readonly fieldRole = FIELD_ROLE_LABEL;
  protected readonly outcome = { W: 'V', D: 'N', L: 'P' };
  protected readonly date = fmtDate;
  protected readonly stats = signal<StatsRow | null>(null);
  protected readonly history = signal<MatchFact[]>([]);

  protected readonly member = computed(() => this.session.memberMap().get(this.id()) ?? null);
  protected readonly bio = computed(() => {
    const m = this.member();
    if (!m) return '';
    const a = age(m.birth_date);
    return [a !== null && `${a} anni`, m.height_cm && `${m.height_cm} cm`, m.weight_kg && `${m.weight_kg} kg`].filter(Boolean).join(', ');
  });

  constructor() {
    effect(() => {
      const id = this.id();
      void this.api.stats(null, null).then((rows) => this.stats.set(rows.find((r) => r.user_id === id) ?? null));
      void this.api.history(id, null, null).then((h) => this.history.set(h));
    });
  }

  protected dec(n: number): string {
    return Number(n).toFixed(2).replace('.', ',');
  }

  protected line(f: MatchFact): string {
    const score = f.team_goals !== null ? `${f.team_goals}–${f.opp_goals}` : f.diff === 0 ? 'pari' : f.diff > 0 ? `+${f.diff}` : `${f.diff}`;
    const bits = [score, f.goals && `${f.goals} gol`, f.assists && `${f.assists} assist`, f.own_goals && `${f.own_goals} autogol`];
    return bits.filter(Boolean).join(', ');
  }
}
