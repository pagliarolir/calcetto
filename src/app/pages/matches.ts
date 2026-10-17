import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { diffText, fmtDayLong, fmtTime } from '../core/format';
import { Match, Result } from '../core/models';

@Component({
  selector: 'app-matches',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page stack-l">
      <h1>Partite</h1>
      <ol class="list">
        @for (m of items(); track m.id) {
          <li>
            <a class="list-item" [routerLink]="['/partita', m.id]">
              <span class="grow"><span class="day">{{ day(m.starts_at) }}</span><br />
                <span class="small muted">{{ time(m.starts_at) }}@if (m.venue_name) {, {{ m.venue_name }}}@if (m.moved) {, spostata}@if (m.status === 'cancelled') {, annullata}</span></span>
              @if (m.results; as r) { <span class="num score">{{ text(r.diff, r.white_goals, r.black_goals) }}</span> }
              @else if (m.status === 'scheduled') { <span class="tag turf">in programma</span> }
            </a>
          </li>
        } @empty { <li class="empty">Ancora nessuna partita.</li> }
      </ol>
    </main>
  `,
  styles: `.day { font-weight: 600; } .day::first-letter { text-transform: uppercase; } .score { font-size: var(--step-1); font-weight: 700; }`,
})
export class MatchesPage implements OnInit {
  private readonly api = inject(Api);
  protected readonly items = signal<(Match & { results: Result | null })[]>([]);
  protected readonly day = fmtDayLong;
  protected readonly time = fmtTime;
  protected readonly text = diffText;

  async ngOnInit(): Promise<void> {
    this.items.set(await this.api.matches());
  }
}
