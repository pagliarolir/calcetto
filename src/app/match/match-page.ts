import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { MatchSkeleton } from '../ui/match-skeleton';
import { Skeleton } from '../ui/skeleton';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { fmtCountdown, fmtDayLong, fmtDayNum, fmtMonthShort, fmtTime, fmtWeekday, mapsUrl, titleCase } from '../core/format';
import { Icon } from '../ui/icon';
import { kit } from '../core/kits';
import { Branding } from '../core/branding';
import { MatchStore } from './match-store';
import { SwipeTabs } from '../ui/swipe-tabs';
import { Session } from '../core/session';
import { haptic } from '../core/haptics';

@Component({
  selector: 'app-match-page',
  imports: [SwipeTabs, RouterOutlet, RouterLink, RouterLinkActive, Icon, MatchSkeleton],
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
    } @else if (!store.loading() && store.match(); as m) {
      <header class="hero">
          <!-- intestazione a biglietto: calendario, data, orario e luogo; sotto le squadre -->
          <div class="hero-in v-b">
            <div class="ticket with-cal">
              @if (branding.headerUrl(); as logo) {
                <span class="logo-box" #logoBox><img [src]="logo" alt="" /></span>
              } @else {
              <div class="calbig" aria-hidden="true"><small>{{ weekdayShort() }}</small><b>{{ dayNum() }}</b><small>{{ monthShort() }}</small></div>
              }
              <div class="tmain" #tmain>
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
              <a class="cal-link" routerLink="/partite" aria-label="Tutte le partite" title="Tutte le partite"><app-icon name="calendar" [size]="18" /></a>
            </div>
          </div>
        <nav class="tabs" [class.off]="tools()" aria-label="Sezioni della partita">
          @if (finished()) {
            <a routerLink="risultato" routerLinkActive="on" [attr.aria-disabled]="tools() || null" [attr.tabindex]="tools() ? -1 : null">Risultato</a>
            <a routerLink="voti" routerLinkActive="on" [attr.aria-disabled]="tools() || null" [attr.tabindex]="tools() ? -1 : null">Pagelle</a>
          } @else {
            <a routerLink="." [routerLinkActiveOptions]="{ exact: true }" routerLinkActive="on" [attr.aria-disabled]="tools() || null" [attr.tabindex]="tools() ? -1 : null">Lista</a>
            <a routerLink="squadre" routerLinkActive="on" [attr.aria-disabled]="tools() || null" [attr.tabindex]="tools() ? -1 : null">Squadre</a>
          }
          <a routerLink="chat" routerLinkActive="on" [attr.aria-disabled]="tools() || null" [attr.tabindex]="tools() ? -1 : null">Chat
            @if (store.chatUnread()) { <span class="dot" role="img" aria-label="messaggi nuovi"></span> }
          </a>
          @if (canTools()) {
            <!-- Strumenti del Leader: la pagina della partita si gira e mostra gli strumenti; ritoccando si torna indietro -->
            <button type="button" class="tools-btn" [attr.aria-pressed]="tools()" (click)="toggleTools()"
                    [attr.aria-label]="tools() ? 'Chiudi gli strumenti del Leader' : 'Strumenti del Leader'" [title]="tools() ? 'Chiudi gli strumenti' : 'Strumenti del Leader'">
              <app-icon name="tools" [size]="18" />
            </button>
          }
        </nav>
      </header>
      <main class="scroll-area" appSwipeTabs (swipe)="swipeTab($event)">
        <div class="page below-header flip" [class.flip-out]="flipping() === 'out'" [class.flip-in]="flipping() === 'in'">
          <router-outlet />
        </div>
      </main>
    } @else {
      <app-match-skeleton />
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; flex: 1 1 0; min-height: 0; }
    .hero {
      color: var(--hero-ink);
      background:
        radial-gradient(circle at 50% 135%, transparent 0 88px, rgb(241 245 239 / 35%) 89px 91px, transparent 92px),
        var(--hero-bg);
      padding-top: env(safe-area-inset-top);
      /* fissa in cima: scorre solo il contenuto sotto (.scroll-area) */
      flex: none; z-index: 2;
    }
    .hero-in { max-width: 640px; margin: 0 auto; padding: 8px 16px 4px; display: flex; flex-direction: column; gap: 2px; }
    /* icona calendario: porta all'elenco delle partite */
    /* in alto a destra, fuori dalla colonna: le righe sotto (indirizzo) usano tutta la larghezza */
    .ticket.with-cal { position: relative; }
    .ticket.with-cal .tmain h1, .ticket.with-cal .tmain .flags { padding-right: 38px; }
    /* stessa misura dell'icona di ordinamento (32 px); l'area di tocco resta 44 px con il margine invisibile */
    .cal-link { position: absolute; top: 0; right: 0; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center;
                color: inherit; background: rgb(255 255 255 / 14%); }
    .cal-link::after, .tools-btn::after { content: ''; position: absolute; inset: -6px; }
    .cal-link app-icon { display: grid; place-items: center; width: 18px; height: 18px; }
    .cal-link app-icon ::ng-deep svg { display: block; }
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
    /* il logo è alto quanto le scritte accanto, quadrato, con gli angoli un po' arrotondati */
    /* il contenitore prende l'altezza delle scritte accanto (non la impone): l'immagine lo riempie */
    .logo-box { flex: none; align-self: center; position: relative; width: 92px; height: 92px; }
    .logo-box img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: 14px; box-shadow: 0 4px 12px rgb(0 0 0 / 22%); }
    .tmain { min-width: 0; display: flex; flex-direction: column; gap: 2px; justify-content: center; }
    /* la data resta su una riga (si rimpicciolisce sugli schermi stretti): l'altezza delle scritte non dipende dal logo */
    .tmain h1 { font: 700 clamp(1.3rem, 5.4vw, 1.75rem)/1 var(--font-display); margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tmain h1::first-letter { text-transform: uppercase; }
    .flags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 2px; }
    .flags .tag { font-size: 0.7rem; }
    .line { display: flex; align-items: center; gap: 6px; font-size: var(--step--1); font-weight: 600; min-width: 0; min-height: 26px; color: inherit; text-decoration: none; }
    .line.time { font: 700 1.3rem/1 var(--font-display); letter-spacing: 0.01em; min-height: 28px; }
    .link-line span { text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }
    /* l'indirizzo non si taglia: va a capo (al massimo due righe) */
    .link-line { align-items: flex-start; }
    .link-line app-icon { margin-top: 5px; }
    .link-line .ellipsis { white-space: normal; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-height: 1.3; padding: 4px 0; }
    .mini { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: rgb(255 255 255 / 14%); color: inherit; flex: none; }
    /* schede con la lineetta sotto quella attiva; testo un po' più grande per vederle bene sul campo */
    .tabs {
      max-width: 640px; margin: 0 auto; display: flex; align-items: flex-end; gap: 4px; overflow-x: auto; padding: 0 12px;
      scrollbar-width: none;
    }
    .tabs::-webkit-scrollbar { display: none; }
    .tabs a {
      flex: none; position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px 10px; color: inherit; text-decoration: none;
      font-weight: 500; font-size: var(--step-0); line-height: 1.2;
    }
    /* testo sempre pieno (leggibile su ogni intestazione): la scheda attiva si riconosce dal grassetto e dalla lineetta */
    .tabs a.on { font-weight: 700; }
    .tabs a.on::after { content: ''; position: absolute; left: 12px; right: 12px; bottom: 0; height: 3px; border-radius: 3px 3px 0 0; background: var(--chalk); }
    /* messaggi nuovi in chat: pallino allineato alla parola */
    .tabs .dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--armband); }
    .tabs.off a { opacity: 0.4; pointer-events: none; }
    .tabs.off a.on::after { opacity: 0; }
    /* interruttore degli strumenti: spento trasparente, acceso pieno */
    .tools-btn { position: relative; flex: none; margin: 0 4px 6px auto; width: 32px; height: 32px; border: 0; border-radius: 50%; display: grid; place-items: center; cursor: pointer;
                 color: inherit; background: rgb(255 255 255 / 14%); transition: background 200ms, color 200ms; }
    .tools-btn[aria-pressed='true'] { background: var(--chalk); color: var(--turf); }
    .tools-btn:focus-visible { outline: 3px solid var(--chalk); outline-offset: 2px; }
    .tools-btn app-icon { display: grid; place-items: center; transition: transform 300ms var(--ease-spring); }
    .tools-btn[aria-pressed='true'] app-icon { transform: rotate(-45deg); }
    /* «flip» della pagina sull'asse verticale, con profondità: solo dentro l'area che scorre (la barra non si muove) */
    @media (prefers-reduced-motion: no-preference) {
      .flip.flip-out, .flip.flip-in { transform-origin: 50% 30%; backface-visibility: hidden; }
      .flip.flip-out { animation: flip-out 180ms cubic-bezier(0.4, 0, 1, 1) forwards; }
      .flip.flip-in { animation: flip-in 260ms cubic-bezier(0.2, 0.9, 0.3, 1.1); }
      @keyframes flip-out { from { transform: perspective(1400px) rotateY(0); } to { transform: perspective(1400px) rotateY(90deg); opacity: 0.6; } }
      @keyframes flip-in { from { transform: perspective(1400px) rotateY(-90deg); opacity: 0.6; } to { transform: perspective(1400px) rotateY(0); opacity: 1; } }
    }
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

  /** a partita finita le schede sono Risultato, Pagelle e Chat */
  protected readonly finished = computed(() => !!this.store.t()?.ended);
  private readonly router = inject(Router);

  // ------------------------------------------------ strumenti del Leader (rotta «strumenti»)
  private readonly session = inject(Session);
  protected readonly tools = computed(() => this.url().split('?')[0].split('/')[3] === 'strumenti');
  protected readonly canTools = computed(() => {
    const m = this.store.match();
    return this.session.isLeader() && !!m && m.status === 'scheduled' && !this.store.t()?.started;
  });
  protected readonly flipping = signal<'out' | 'in' | null>(null);
  /** scheda da cui si sono aperti gli strumenti: richiudendoli si torna lì */
  private toolsFrom = '';

  protected async toggleTools(): Promise<void> {
    const m = this.store.match();
    if (!m || this.flipping()) return;
    haptic();
    const opening = !this.tools();
    if (opening) this.toolsFrom = this.router.url.split('?')[0].split('/')[3] ?? '';
    const target = ['/partita', m.id, ...(opening ? ['strumenti'] : this.toolsFrom ? [this.toolsFrom] : [])];
    const motion = matchMedia('(prefers-reduced-motion: no-preference)').matches;
    if (motion) { this.flipping.set('out'); await new Promise((r) => setTimeout(r, 180)); }
    await this.router.navigate(target);
    if (motion) { this.flipping.set('in'); setTimeout(() => this.flipping.set(null), 270); }
    else this.flipping.set(null);
  }

  /** scorrimento di lato: scheda accanto (Lista, Squadre, Chat; a partita finita Risultato, Pagelle, Chat) */
  protected swipeTab(d: 1 | -1): void {
    const m = this.store.match();
    if (!m || this.tools()) return;
    const tabs = this.finished() ? ['risultato', 'voti', 'chat'] : ['', 'squadre', 'chat'];
    const seg = this.router.url.split('?')[0].split('/')[3] ?? '';
    const i = tabs.indexOf(seg) + d;
    if (i >= 0 && i < tabs.length) void this.router.navigate(['/partita', m.id, ...(tabs[i] ? [tabs[i]] : [])]);
  }
  private readonly url = toSignal(this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map(() => this.router.url)), { initialValue: this.router.url });

  // il logo è un quadrato alto quanto le scritte accanto (le misura e le segue se cambiano)
  private readonly tmainEl = viewChild<ElementRef<HTMLElement>>('tmain');
  private readonly logoEl = viewChild<ElementRef<HTMLElement>>('logoBox');

  constructor() {
    effect((onCleanup) => {
      const t = this.tmainEl()?.nativeElement;
      const l = this.logoEl()?.nativeElement;
      if (!t || !l) return;
      const fit = () => {
        const h = Math.round(t.getBoundingClientRect().height);
        if (h > 0 && l.style.height !== `${h}px`) l.style.width = l.style.height = `${h}px`;
      };
      const ro = new ResizeObserver(fit);
      ro.observe(t);
      fit();
      onCleanup(() => ro.disconnect());
    });
    // a partita finita, Lista e Squadre non ci sono più: si apre il Risultato
    effect(() => {
      const id = this.store.match()?.id;
      if (!id || !this.finished()) return;
      const path = this.url().split('?')[0].split('#')[0];
      if (path === `/partita/${id}` || path === `/partita/${id}/squadre`) {
        void this.router.navigateByUrl(`/partita/${id}/risultato`, { replaceUrl: true });
      }
    });
    effect(() => {
      const id = this.id();
      untracked(() => void this.store.load(id));
    });
  }
}
