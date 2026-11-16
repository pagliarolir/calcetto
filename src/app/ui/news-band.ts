import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';

export interface BandItem { who: string; text: string }

/**
 * Banda delle Leader News nell'intestazione della partita, come la striscia del telegiornale.
 * - crawl: le notizie scorrono da destra a sinistra senza fine;
 * - rotate: una notizia alla volta, cambia ogni 5 secondi (con «riduci movimento» resta ferma sulla prima).
 * Colori fissi da tv (`--tv-*`), come il riquadro delle Leader News.
 */
@Component({
  selector: 'app-news-band',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': "'band ' + look() + ' ' + mode()" },
  template: `
    <button type="button" class="hit" (click)="open.emit()" [attr.aria-label]="'Leader News: ' + items()[0]?.text + '. Tocca per leggere tutto'">
      <span class="tag" aria-hidden="true"><span class="rec"></span>{{ tag() }}</span>
      <span class="track" aria-hidden="true">
        @if (mode() === 'crawl') {
          <span class="crawl" [style.--dur.s]="duration()">
            @for (pass of [0, 1]; track pass) {
              <span class="run">
                @for (n of items(); track $index) { <span class="item"><b>{{ n.who }}</b> {{ n.text }}</span> }
              </span>
            }
          </span>
        } @else {
          @for (n of [items()[idx() % items().length]]; track idx()) { <span class="one"><b>{{ n?.who }}</b> {{ n?.text }}</span> }
          @if (items().length > 1) { <span class="count">{{ idx() % items().length + 1 }}/{{ items().length }}</span> }
        }
      </span>
    </button>
  `,
  styles: `
    :host { --tv-blue: #2541a8; --tv-blue-2: #1b2f80; --tv-red: #e3262f; --tv-yellow: #ffe100; --tv-ink: #111111;
      display: block; position: relative; flex: none; }
    .hit { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: stretch; width: 100%; height: 100%; }
    .hit:focus-visible { outline: 3px solid var(--tv-yellow); outline-offset: -3px; }
    .tag { flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 0 16px 0 10px; position: relative; z-index: 1;
      background: var(--tv-yellow); color: var(--tv-ink); font: 900 0.82rem/1 var(--font-display, var(--font-body)); text-transform: uppercase; letter-spacing: 0.02em;
      clip-path: polygon(0 0, 100% 0, calc(100% - 9px) 100%, 0 100%); }
    .rec { width: 8px; height: 8px; border-radius: 50%; background: var(--tv-ink); }
    .track { flex: 1; min-width: 0; position: relative; overflow: hidden; display: flex; align-items: center; margin-left: -9px; padding-left: 14px;
      background: linear-gradient(180deg, var(--tv-blue), var(--tv-blue-2)); color: #fff; font: 600 0.88rem/1 var(--font-body); white-space: nowrap; }
    .track b { font-family: var(--font-display, var(--font-body)); font-weight: 800; text-transform: uppercase; color: var(--tv-yellow); margin-right: 4px; }
    .crawl { display: inline-flex; }
    .run { display: inline-flex; }
    .item { padding-right: 34px; position: relative; }
    /* tra una notizia e l'altra un trattino rosso, come in tv */
    .item::after { content: ''; position: absolute; right: 12px; top: 50%; width: 10px; height: 4px; margin-top: -2px; background: var(--tv-red); }
    .one { overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
    .count { flex: none; margin: 0 10px 0 8px; font: 700 0.72rem/1 var(--font-body); opacity: 0.85; }

    /* striscia piena: banda a tutta larghezza con la linea rossa sotto */
    :host(.flat) { height: 30px; }
    :host(.flat)::after { content: ''; position: absolute; left: 0; right: 0; bottom: -3px; height: 3px; background: var(--tv-red); }
    /* sottopancia: rettangolo con gli angoli arrotondati dentro i margini della pagina */
    :host(.card) { height: 32px; margin: 0 16px; border-radius: 10px; overflow: hidden; box-shadow: 0 6px 14px rgb(0 0 0 / 22%); }
    :host(.card) .track { border-bottom: 3px solid var(--tv-red); }

    @media (prefers-reduced-motion: no-preference) {
      .crawl { animation: crawl var(--dur, 18s) linear infinite; }
      .hit:hover .crawl, .hit:focus-visible .crawl { animation-play-state: paused; }
      @keyframes crawl { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      .rec { animation: blink 1.2s steps(2, start) infinite; }
      @keyframes blink { 50% { opacity: 0.15; } }
      .one { animation: up 5s ease-in-out infinite; }
      @keyframes up { 0% { opacity: 0; transform: translateY(8px); } 8%, 92% { opacity: 1; transform: none; } 100% { opacity: 0; transform: translateY(-8px); } }
    }
  `,
})
export class NewsBand {
  readonly items = input<BandItem[]>([]);
  readonly mode = input<'crawl' | 'rotate'>('crawl');
  readonly look = input<'flat' | 'card'>('flat');
  readonly tag = input('Leader News');
  readonly open = output<void>();
  /** velocità costante: più testo, più tempo */
  protected readonly duration = computed(() => Math.max(12, this.items().reduce((n, i) => n + i.who.length + i.text.length, 0) / 6));
  protected readonly idx = signal(0);

  constructor() {
    // una notizia ogni 5 secondi; con «riduci movimento» resta ferma (si leggono tutte toccando la banda)
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => this.idx.update((i) => i + 1), 5000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }
}
