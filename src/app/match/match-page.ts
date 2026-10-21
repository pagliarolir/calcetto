import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { fmtCountdown, fmtDayLong, fmtTime, mapsUrl, titleCase } from '../core/format';
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
          <div class="topbar">
            <a class="link" routerLink="/partite"><app-icon name="back" [size]="18" /> Partite</a>
            <span class="status">{{ status() }}</span>
          </div>

          <!-- tabellone: le due squadre ai lati, al centro orario o punteggio -->
          <div class="board" [class.played]="!!scoreboard()">
            <div class="side" [class.lose]="scoreboard()?.win === -1">
              <span class="kit" [style.background]="kitA().color" [style.color]="kitA().ink" aria-hidden="true"><app-icon name="shirt" [size]="24" /></span>
              <span class="tname">{{ store.teamNames().white }}</span>
            </div>
            <div class="mid">
              @if (scoreboard(); as sb) {
                <span class="big num" aria-label="Risultato">{{ sb.big }}</span>
                <span class="sub">{{ sb.sub }}</span>
              } @else {
                <span class="big num">{{ kickoff() }}</span>
                <span class="sub">fino alle {{ until() }}</span>
              }
            </div>
            <div class="side" [class.lose]="scoreboard()?.win === 1">
              <span class="kit" [style.background]="kitB().color" [style.color]="kitB().ink" aria-hidden="true"><app-icon name="shirt" [size]="24" /></span>
              <span class="tname">{{ store.teamNames().black }}</span>
            </div>
          </div>

          <h1 class="date">{{ day() }}@if (scoreboard()) {, {{ kickoff() }}}</h1>
          @if (m.moved || m.status === 'cancelled' || store.result()?.status === 'pending') {
            <p class="flags">
              @if (m.moved) { <span class="tag armband">Spostata</span> }
              @if (m.status === 'cancelled') { <span class="tag danger">Annullata</span> }
              @if (store.result()?.status === 'pending') { <span class="tag">risultato da omologare</span> }
            </p>
          }
          @if (m.venue_name || m.venue_address) {
            <div class="venue">
              @if (m.venue_name) {
                @if (m.venue_url) {
                  <a class="venue-name" [href]="m.venue_url" target="_blank" rel="noopener" [attr.aria-label]="m.venue_name + ': sito del circolo'">
                    {{ m.venue_name }} <app-icon name="external" [size]="14" />
                  </a>
                } @else {
                  <span class="venue-name">{{ m.venue_name }}</span>
                }
              }
              @if (maps(); as href) {
                <a class="venue-addr" [href]="href" target="_blank" rel="noopener" [attr.aria-label]="'Apri nelle mappe: ' + (address() || m.venue_name)">
                  <app-icon name="map" [size]="16" /> <span>{{ address() || 'Apri nelle mappe' }}</span>
                </a>
              }
            </div>
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
    .hero-in { max-width: 640px; margin: 0 auto; padding: 4px 16px 10px; display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; }
    .skeleton { height: 190px; }
    .topbar { align-self: stretch; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 40px; }
    .link { display: inline-flex; align-items: center; gap: 4px; color: inherit; opacity: 0.85; font-size: var(--step--1); font-weight: 600; text-decoration: none; min-height: 36px; }
    .status { font-size: 0.75rem; font-weight: 600; padding: 4px 10px; border-radius: 999px; background: rgb(255 255 255 / 14%); text-align: right; }
    .board { align-self: stretch; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; padding: 6px 0 2px; }
    .side { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; transition: opacity 200ms; }
    .side.lose { opacity: 0.55; }
    .kit { width: 54px; height: 54px; border-radius: 50%; display: grid; place-items: center; box-shadow: 0 0 0 3px rgb(255 255 255 / 22%), 0 6px 16px rgb(0 0 0 / 22%); }
    .tname { font: 600 var(--step-1)/1 var(--font-display); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mid { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 120px; }
    .big { font: 700 3.4rem/0.9 var(--font-display); letter-spacing: 0.01em; }
    .sub { font-size: 0.75rem; font-weight: 600; opacity: 0.8; }
    .date { font: 600 var(--step-1)/1.15 var(--font-body); margin-top: 2px; }
    .date::first-letter { text-transform: uppercase; }
    .flags { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
    .venue { display: flex; flex-direction: column; align-items: center; gap: 0; }
    .venue-name { display: inline-flex; align-items: center; gap: 6px; min-height: 26px; color: inherit; font-weight: 600; font-size: var(--step--1); text-decoration: none; }
    a.venue-name { text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }
    .venue-addr {
      display: inline-flex; align-items: center; gap: 6px; min-height: 28px; color: inherit; opacity: 0.85;
      font-size: var(--step--1); text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px;
    }
    .venue-addr app-icon { flex: none; }
    .tabs {
      max-width: 640px; margin: 0 auto; display: flex; gap: 4px; overflow-x: auto; padding: 0 12px;
      scrollbar-width: none;
    }
    .tabs::-webkit-scrollbar { display: none; }
    .tabs a {
      flex: none; position: relative; padding: 10px 12px 12px; color: inherit; text-decoration: none;
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

  /** indirizzo con le iniziali maiuscole (solo in visualizzazione) */
  protected readonly address = computed(() => titleCase(this.store.match()?.venue_address));

  protected readonly kitA = computed(() => kit(this.store.match()?.team_a_kit ?? 'white'));
  protected readonly kitB = computed(() => kit(this.store.match()?.team_b_kit ?? 'black'));

  protected readonly maps = computed(() => {
    const m = this.store.match();
    return m ? mapsUrl(m.venue_name, m.venue_address) : null;
  });

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
