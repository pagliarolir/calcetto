import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { fmtCountdown, fmtDayLong, fmtDayNum, fmtMonthShort, fmtTime, fmtWeekday, mapsUrl, titleCase } from '../core/format';
import { Icon } from '../ui/icon';
import { kit } from '../core/kits';
import { Branding } from '../core/branding';
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
          <!-- intestazione a biglietto: calendario, data, orario e luogo; sotto le squadre -->
          <div class="hero-in v-b">
            <div class="topbar">
              <a class="link" routerLink="/partite"><app-icon name="back" [size]="18" /> Partite</a>
              <span class="status">{{ status() }}</span>
            </div>
            <div class="ticket">
              @if (branding.logo512(); as logo) {
                <img class="calbig logo" [src]="logo" alt="" />
              } @else {
              <div class="calbig" aria-hidden="true"><small>{{ weekdayShort() }}</small><b>{{ dayNum() }}</b><small>{{ monthShort() }}</small></div>
              }
              <div class="tmain">
                <h1>{{ day() }}</h1>
                @if (m.moved || m.status === 'cancelled' || store.result()?.status === 'pending') {
                  <p class="flags">
                    @if (m.moved) { <span class="tag armband">Spostata</span> }
                    @if (m.status === 'cancelled') { <span class="tag danger">Annullata</span> }
                    @if (store.result()?.status === 'pending') { <span class="tag">da omologare</span> }
                  </p>
                }
                <p class="line time"><app-icon name="clock" [size]="18" />{{ kickoff() }} – {{ until() }}</p>
                @if (m.venue_name) {
                  <p class="line"><app-icon name="pitch" [size]="16" /><span class="ellipsis">{{ m.venue_name }}</span>
                    @if (m.venue_url) { <a class="mini" [href]="m.venue_url" target="_blank" rel="noopener" aria-label="Sito del circolo"><app-icon name="external" [size]="14" /></a> }
                  </p>
                }
                @if (maps(); as href) {
                  <a class="line link-line" [href]="href" target="_blank" rel="noopener" [attr.aria-label]="'Apri nelle mappe: ' + (address() || m.venue_name)">
                    <app-icon name="map" [size]="16" /><span class="ellipsis">{{ address() || 'Apri nelle mappe' }}</span>
                  </a>
                }
              </div>
            </div>
            <div class="strip" [class.played]="!!scoreboard()">
              <span class="team" [class.lose]="scoreboard()?.win === -1"><span class="kit sm" [style.background]="kitA().color" [style.color]="kitA().ink"><app-icon name="shirt" [size]="16" /></span>{{ store.teamNames().white }}</span>
              <span class="vs num">{{ scoreboard()?.big ?? 'contro' }}</span>
              <span class="team right" [class.lose]="scoreboard()?.win === 1">{{ store.teamNames().black }}<span class="kit sm" [style.background]="kitB().color" [style.color]="kitB().ink"><app-icon name="shirt" [size]="16" /></span></span>
            </div>
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
    .hero-in { max-width: 640px; margin: 0 auto; padding: 0 16px 6px; display: flex; flex-direction: column; gap: 2px; }
    .skeleton { height: 200px; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 36px; }
    .link { display: inline-flex; align-items: center; gap: 4px; color: inherit; opacity: 0.85; font-size: var(--step--1); font-weight: 600; text-decoration: none; min-height: 36px; }
    .status { font-size: 0.72rem; font-weight: 600; padding: 3px 10px; border-radius: 999px; background: rgb(255 255 255 / 14%); text-align: right; }
    /* biglietto: riquadro calendario a sinistra, data, orario e luogo a destra */
    .ticket { display: flex; gap: 14px; align-items: stretch; margin-top: 2px; }
    .calbig { flex: none; width: 76px; border-radius: 16px; background: var(--chalk, #f4f7f2); color: var(--turf); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 6px 0;
      box-shadow: 0 6px 16px rgb(0 0 0 / 20%); }
    .calbig b { font: 700 2.6rem/0.9 var(--font-display); }
    .calbig small { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.04em; }
    /* il logo dell'app prende il posto del calendario */
    .calbig.logo { height: 92px; align-self: center; padding: 0; object-fit: cover; background: #fff; }
    .tmain { min-width: 0; display: flex; flex-direction: column; gap: 2px; justify-content: center; }
    .tmain h1 { font: 700 1.75rem/1 var(--font-display); margin-bottom: 4px; }
    .tmain h1::first-letter { text-transform: uppercase; }
    .flags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 2px; }
    .flags .tag { font-size: 0.7rem; }
    .line { display: flex; align-items: center; gap: 6px; font-size: var(--step--1); font-weight: 600; min-width: 0; min-height: 26px; color: inherit; text-decoration: none; }
    .line.time { font: 700 1.3rem/1 var(--font-display); letter-spacing: 0.01em; min-height: 28px; }
    .link-line span { text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }
    .mini { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: rgb(255 255 255 / 14%); color: inherit; flex: none; }
    /* striscia delle squadre: diventa il punteggio a fine partita */
    .strip { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px; margin-top: 8px; padding: 6px 10px; border-radius: 14px; background: rgb(0 0 0 / 16%); }
    .strip .team { display: inline-flex; align-items: center; gap: 8px; font: 600 1.05rem/1 var(--font-display); min-width: 0; }
    .strip .team.right { justify-content: flex-end; }
    .strip .lose { opacity: 0.55; }
    .strip .vs { font: 700 1rem/1 var(--font-display); opacity: 0.85; }
    .strip.played .vs { font-size: 1.6rem; opacity: 1; }
    .kit { flex: none; border-radius: 50%; display: grid; place-items: center; }
    .kit.sm { width: 26px; height: 26px; box-shadow: 0 0 0 2px rgb(255 255 255 / 22%); }
    .tabs {
      max-width: 640px; margin: 0 auto; display: flex; gap: 4px; overflow-x: auto; padding: 0 12px;
      scrollbar-width: none;
    }
    .tabs::-webkit-scrollbar { display: none; }
    .tabs a {
      flex: none; position: relative; padding: 8px 12px 10px; color: inherit; text-decoration: none;
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
  protected readonly branding = inject(Branding);

  protected readonly day = computed(() => (this.store.match() ? fmtDayLong(this.store.match()!.starts_at) : ''));

  /** indirizzo con le iniziali maiuscole (solo in visualizzazione) */
  protected readonly address = computed(() => titleCase(this.store.match()?.venue_address));

  protected readonly kitA = computed(() => kit(this.store.match()?.team_a_kit ?? 'white'));
  protected readonly kitB = computed(() => kit(this.store.match()?.team_b_kit ?? 'black'));

  protected readonly maps = computed(() => {
    const m = this.store.match();
    return m ? mapsUrl(m.venue_name, m.venue_address) : null;
  });

  protected readonly weekdayName = computed(() => (this.store.match() ? fmtWeekday(this.store.match()!.starts_at) : ''));
  protected readonly weekdayShort = computed(() => this.weekdayName().slice(0, 3));
  protected readonly dayNum = computed(() => (this.store.match() ? fmtDayNum(this.store.match()!.starts_at) : ''));
  protected readonly monthShort = computed(() => (this.store.match() ? fmtMonthShort(this.store.match()!.starts_at) : ''));

  protected readonly kickoff = computed(() => (this.store.match() ? fmtTime(this.store.match()!.starts_at) : ''));
  protected readonly until = computed(() => (this.store.match() ? fmtTime(this.store.match()!.ends_at) : ''));

  /** punteggio per il tabellone: gol esatti se ci sono, altrimenti lo scarto per chi ha vinto */
  protected readonly scoreboard = computed(() => {
    const r = this.store.result();
    if (!r) return null;
    const n = this.store.teamNames();
    const win = Math.sign(r.diff);
    const final = r.status === 'pending' ? 'da omologare' : 'finale';
    if (r.white_goals !== null && r.black_goals !== null) return { big: `${r.white_goals} – ${r.black_goals}`, sub: final, win };
    if (r.diff === 0) return { big: 'Pari', sub: final, win };
    return { big: `+${Math.abs(r.diff)}`, sub: `per i ${r.diff > 0 ? n.white : n.black}`, win };
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
      if (this.store.free() && !m.lists_confirmed_at) {
        const avail = this.store.team().length + this.store.pending().length + this.store.reserves().length;
        return `${avail} disponibili, si gioca ${fmtCountdown(m.starts_at)}`;
      }
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
