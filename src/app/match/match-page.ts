import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { fmtCountdown, fmtDayLong, fmtTime, diffText, mapsUrl } from '../core/format';
import { Icon } from '../ui/icon';
import { kit } from '../core/kits';
import { MatchStore } from './match-store';

@Component({
  selector: 'app-match-page',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  providers: [MatchStore],
  host: {
    '[style.--team-a]': 'kitA().color', '[style.--team-a-ink]': 'kitA().ink',
    '[style.--team-b]': 'kitB().color', '[style.--team-b-ink]': 'kitB().ink',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.notFound()) {
      <main class="page stack">
        <h1>Partita non trovata</h1>
        <a class="btn" routerLink="/">Vai alla prossima partita</a>
      </main>
    } @else if (store.match(); as m) {
      <header class="hero">
        <div class="hero-in">
          <div class="spread">
            <a class="link" routerLink="/partite"><app-icon name="calendar" [size]="18" /> Tutte le partite</a>
            <span class="status">{{ status() }}</span>
          </div>
          <h1>{{ day() }}</h1>
          <p class="when">
            <span class="num">{{ time() }}</span>
            @if (m.moved) { <span class="tag armband">Spostata</span> }
            @if (m.status === 'cancelled') { <span class="tag danger">Annullata</span> }
          </p>
          @if (m.venue_name || m.venue_address) {
            <a class="venue" [href]="maps()" target="_blank" rel="noopener">
              <app-icon name="pin" [size]="18" /> {{ m.venue_name || m.venue_address }}
            </a>
          }
          @if (store.result(); as r) {
            <p class="score num" aria-label="Risultato">{{ scoreText() }}
              @if (r.status === 'pending') { <span class="tag">da omologare</span> }
            </p>
          }
        </div>
        <nav class="tabs" aria-label="Sezioni della partita">
          <a routerLink="." [routerLinkActiveOptions]="{ exact: true }" routerLinkActive="on">Lista</a>
          <a routerLink="squadre" routerLinkActive="on">Squadre</a>
          <a routerLink="risultato" routerLinkActive="on">Risultato</a>
          <a routerLink="voti" routerLinkActive="on">Pagelle</a>
          <a routerLink="chat" routerLinkActive="on">Chat
            @if (store.t()?.chatOpen) { <span class="dot" aria-label="aperta"></span> }
          </a>
        </nav>
      </header>
      <main class="page below-header">
        <router-outlet />
      </main>
    } @else {
      <header class="hero"><div class="hero-in skeleton"></div></header>
    }
  `,
  styles: `
    .hero {
      color: var(--chalk);
      background:
        radial-gradient(circle at 50% 135%, transparent 0 88px, rgb(241 245 239 / 35%) 89px 91px, transparent 92px),
        linear-gradient(var(--turf), var(--turf));
      padding-top: env(safe-area-inset-top);
    }
    @media (prefers-color-scheme: dark) { .hero { color: #eef5ef; background-color: #14482f; background-image: radial-gradient(circle at 50% 135%, transparent 0 88px, rgb(207 224 212 / 30%) 89px 91px, transparent 92px); } }
    .hero-in { max-width: 640px; margin: 0 auto; padding: 14px 16px 20px; display: flex; flex-direction: column; gap: 6px; }
    .skeleton { height: 150px; }
    .link { display: inline-flex; align-items: center; gap: 6px; color: inherit; opacity: 0.85; font-size: var(--step--1); text-decoration: none; min-height: 36px; }
    .status { font-size: var(--step--1); font-weight: 600; opacity: 0.9; }
    h1 { font-size: var(--step-4); line-height: 0.92; }
    h1::first-letter { text-transform: uppercase; }
    .when { display: flex; align-items: center; gap: 10px; font-size: var(--step-2); }
    .venue {
      align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; min-height: 32px;
      color: inherit; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px;
    }
    .score { font-size: var(--step-3); font-weight: 700; display: flex; align-items: center; gap: 10px; }
    .score .tag { font-family: var(--font-body); }
    .tabs {
      max-width: 640px; margin: 0 auto; display: flex; gap: 4px; overflow-x: auto; padding: 0 12px;
      scrollbar-width: none;
    }
    .tabs::-webkit-scrollbar { display: none; }
    .tabs a {
      flex: none; position: relative; padding: 12px 12px 14px; color: inherit; text-decoration: none;
      opacity: 0.75; font-weight: 600; font-size: var(--step--1);
    }
    .tabs a.on { opacity: 1; }
    .tabs a.on::after { content: ''; position: absolute; left: 12px; right: 12px; bottom: 0; height: 3px; border-radius: 3px 3px 0 0; background: var(--chalk); }
    .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--armband); margin-left: 4px; vertical-align: middle; }
  `,
})
export class MatchPage {
  readonly id = input.required<string>();
  protected readonly store = inject(MatchStore);

  protected readonly day = computed(() => (this.store.match() ? fmtDayLong(this.store.match()!.starts_at) : ''));
  protected readonly time = computed(() => {
    const m = this.store.match();
    if (!m) return '';
    return `${fmtTime(m.starts_at)} – ${fmtTime(m.ends_at)}`;
  });

  protected readonly kitA = computed(() => kit(this.store.match()?.team_a_kit ?? 'white'));
  protected readonly kitB = computed(() => kit(this.store.match()?.team_b_kit ?? 'black'));

  protected readonly maps = computed(() => {
    const m = this.store.match();
    return m ? mapsUrl(m.venue_name, m.venue_address) : null;
  });

  protected readonly scoreText = computed(() => {
    const r = this.store.result();
    return r ? diffText(r.diff, r.white_goals, r.black_goals, this.store.teamNames()) : '';
  });

  protected readonly status = computed(() => {
    const m = this.store.match();
    const t = this.store.t();
    if (!m || !t) return '';
    this.store.now();
    if (m.status === 'cancelled') return 'Non si gioca';
    if (t.beforeOpen) return `Prenotazioni ${fmtCountdown(m.bookings_open_at)}`;
    if (!t.started) {
      const n = this.store.team().length;
      return `${n} su ${this.store.size()}, si gioca ${fmtCountdown(m.starts_at)}`;
    }
    if (!t.resultOpen) return 'Si sta giocando';
    if (!t.locked) return 'Risultato e pagelle aperti';
    return 'Partita chiusa';
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.store.load(id));
    });
  }
}
