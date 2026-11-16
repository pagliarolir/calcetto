import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { filter } from 'rxjs';
import { nextHasChanges } from '../core/changelog';
import { Icon } from './icon';

/**
 * Avviso «Nuova versione pronta» (solo se la nuova versione ha voci nuove nel changelog): si chiude da solo dopo 12 secondi. La nuova versione si attiva quando l'app va in
 * secondo piano; alla riapertura le novità compaiono nel riquadro da telegiornale di `<app-changes-notice>`.
 */
@Component({
  selector: 'app-update-notice',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown()) {
      <div class="notice enter-fade" role="status">
        <span class="grow">Nuova versione pronta: alla prossima apertura trovi le novità.</span>
        <button type="button" class="close" (click)="shown.set(false)" aria-label="Chiudi"><app-icon name="x" [size]="16" /></button>
      </div>
    }
  `,
  styles: `
    :host { display: contents; }
    .notice { pointer-events: auto; width: 100%; max-width: 520px; border-radius: var(--r-m); background: var(--ink); color: var(--bg);
      box-shadow: 0 8px 24px rgb(0 0 0 / 20%); font: 500 var(--step--1)/1.35 var(--font-body);
      display: flex; align-items: center; gap: 4px; padding: 4px 4px 4px 16px; min-height: 52px; }
    .grow { flex: 1; min-width: 0; padding: 8px 0; }
    .close { appearance: none; border: 0; background: transparent; color: inherit; cursor: pointer; border-radius: 999px;
      width: 44px; height: 44px; display: grid; place-items: center; flex: none; }
    .close:focus-visible { outline: 2px solid var(--bg); outline-offset: 2px; }
  `,
})
export class UpdateNotice {
  protected readonly shown = signal(false);

  constructor() {
    const sw = inject(SwUpdate);
    if (!sw.isEnabled) return;
    sw.versionUpdates.pipe(filter((e) => e.type === 'VERSION_READY')).subscribe(() => {
      // avviso solo se la nuova versione porta novità: le correzioni silenziose si installano e basta
      void nextHasChanges().then((news) => {
        if (!news) return;
        this.shown.set(true);
        setTimeout(() => this.shown.set(false), 12000);
      });
      document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && location.reload(), { once: true });
    });
  }
}
