import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Icon } from './icon';

let nextId = 0;

/**
 * Riquadro da telegiornale (Leader News e Novità dell'aggiornamento): etichetta gialla con il pallino che lampeggia,
 * fascia blu con le righe, barra rossa e, sotto, una scheda con i colori del tema in cui va il contenuto (ng-content).
 * X e «Letto» emettono `done`. I colori `--tv-*` sono fissi in tutti i temi (scelta del proprietario), con i contrasti
 * controllati: bianco sul blu 8,6:1, nero sul giallo 15:1.
 */
@Component({
  selector: 'app-tv-notice',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="news" role="status" [attr.aria-labelledby]="hid">
      <div class="tv">
        <span class="live" aria-hidden="true"><span class="rec"></span>{{ tag() }}</span>
        <div class="banner"><h2 [id]="hid">{{ heading() }}</h2><span class="stripes" aria-hidden="true"></span></div>
        <div class="red" aria-hidden="true"></div>
      </div>
      <div class="card">
        <button type="button" class="close" (click)="done.emit()" [attr.aria-label]="closeLabel()"><app-icon name="x" [size]="18" /></button>
        <div class="body"><ng-content /></div>
        <div class="actions">
          <button type="button" class="btn small ok" (click)="done.emit()"><app-icon name="check" [size]="16" /> Letto</button>
        </div>
      </div>
    </section>
  `,
  styles: `
    :host { display: contents; }
    .news { --tv-blue: #2541a8; --tv-blue-2: #1b2f80; --tv-red: #e3262f; --tv-yellow: #ffe100; --tv-ink: #111111;
      pointer-events: auto; width: 100%; max-width: 520px; display: flex; flex-direction: column; filter: drop-shadow(0 12px 26px rgb(0 0 0 / 30%)); }
    .tv { position: relative; padding-top: 16px; margin-right: 20px; }
    .live { position: absolute; z-index: 2; top: 0; left: 10px; display: inline-flex; align-items: center; gap: 8px; padding: 4px 16px 4px 8px;
      background: var(--tv-yellow); color: var(--tv-ink); font: 900 0.95rem/1 var(--font-display, var(--font-body)); text-transform: uppercase; letter-spacing: 0.02em;
      clip-path: polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0 100%); }
    .rec { width: 10px; height: 10px; border-radius: 50%; background: var(--tv-ink); }
    .banner { position: relative; display: flex; align-items: center; min-height: 50px; padding: 12px 92px 8px 20px;
      background: linear-gradient(180deg, var(--tv-blue), var(--tv-blue-2)); color: #fff;
      clip-path: polygon(0 0, 100% 0, calc(100% - 16px) 100%, 0 100%); }
    h2 { margin: 0; font: 900 clamp(1.35rem, 6.4vw, 1.9rem)/1 var(--font-display, var(--font-body)); text-transform: uppercase; letter-spacing: 0.01em; color: #fff; white-space: nowrap; }
    .stripes { position: absolute; top: 8px; bottom: 8px; right: 22px; width: 58px;
      background: repeating-linear-gradient(115deg, transparent 0 6px, rgb(255 255 255 / 85%) 6px 10px); }
    .red { height: 12px; width: 72%; background: var(--tv-red); clip-path: polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%); }
    .card { position: relative; margin-top: 8px; border-radius: 16px; background: var(--surface); color: var(--ink); border: 1px solid var(--line); }
    .close { position: absolute; top: 2px; right: 2px; appearance: none; border: 0; background: transparent; color: var(--ink); cursor: pointer;
      width: 44px; height: 44px; display: grid; place-items: center; border-radius: 999px; }
    .close:focus-visible, .ok:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
    .body { padding: 16px 48px 4px 16px; display: flex; flex-direction: column; gap: 16px; max-height: 42dvh; overflow-y: auto; }
    .actions { display: flex; justify-content: flex-end; padding: 4px 12px 12px; }
    .ok { gap: 8px; min-height: 44px; padding: 0 16px; background: var(--tv-blue) !important; color: #fff !important; border-color: transparent; font-weight: 700; }
    @media (prefers-reduced-motion: no-preference) {
      /* entra come in tv: prima la fascia blu, poi l'etichetta, la barra rossa e il testo */
      .banner { animation: tv-wipe 420ms var(--ease) both; }
      .live { animation: tv-pop 260ms 300ms var(--ease) both; }
      .red { animation: tv-wipe 380ms 180ms var(--ease) both; }
      .card { animation: tv-up 320ms 360ms var(--ease) both; }
      .rec { animation: tv-blink 1.2s 700ms steps(2, start) infinite; }
      @keyframes tv-wipe { from { clip-path: polygon(0 0, 0 0, 0 100%, 0 100%); } }
      @keyframes tv-pop { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      @keyframes tv-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
      @keyframes tv-blink { 50% { opacity: 0.15; } }
    }
  `,
})
export class TvNotice {
  readonly tag = input('Live');
  readonly heading = input.required<string>();
  readonly closeLabel = input('Chiudi');
  readonly done = output<void>();
  protected readonly hid = `tv-h-${++nextId}`;
}
