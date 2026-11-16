import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { filter } from 'rxjs';
import { newChanges } from '../core/changelog';
import { Icon } from './icon';

/**
 * Avviso «Nuova versione pronta» con le novità: il pulsante con la freccia apre il riquadro con l'elenco di cosa cambia.
 * Si chiude da solo dopo 12 secondi se non lo si apre; aperto resta finché non si tocca la X.
 * La nuova versione si attiva quando l'app va in secondo piano (come prima).
 */
@Component({
  selector: 'app-update-notice',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown()) {
      <div class="notice enter-fade" role="status">
        <div class="head">
          <span class="grow">Nuova versione pronta: si attiva alla prossima apertura.</span>
          @if (changes().length) {
            <button type="button" class="more" (click)="toggle()" [attr.aria-expanded]="open()" aria-controls="update-changes">
              Novità <app-icon name="chevron" [size]="16" class="chev" [class.up]="open()" />
            </button>
          }
          <button type="button" class="close" (click)="shown.set(false)" aria-label="Chiudi"><app-icon name="x" [size]="16" /></button>
        </div>
        @if (open()) {
          <ul id="update-changes" class="list-changes">
            @for (c of changes(); track $index) { <li>{{ c }}</li> }
          </ul>
        }
      </div>
    }
  `,
  styles: `
    :host { display: contents; }
    .notice { pointer-events: auto; width: 100%; max-width: 520px; border-radius: var(--r-m); background: var(--ink); color: var(--bg);
      box-shadow: 0 8px 24px rgb(0 0 0 / 20%); font: 500 var(--step--1)/1.35 var(--font-body); }
    .head { display: flex; align-items: center; gap: 4px; padding: 4px 4px 4px 16px; min-height: 52px; }
    .grow { flex: 1; min-width: 0; padding: 8px 0; }
    button { appearance: none; border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; border-radius: 999px; }
    button:focus-visible { outline: 2px solid var(--bg); outline-offset: 2px; }
    .more { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; padding: 0 10px; font-weight: 700;
      box-shadow: inset 0 0 0 1.5px currentColor; }
    .chev { transform: rotate(90deg); transition: transform 0.2s; }
    .chev.up { transform: rotate(-90deg); }
    .close { width: 44px; height: 44px; display: grid; place-items: center; flex: none; }
    .list-changes { margin: 0; padding: 0 16px 14px 34px; display: flex; flex-direction: column; gap: 6px; max-height: 40dvh; overflow-y: auto; }
    @media (prefers-reduced-motion: no-preference) {
      .list-changes { animation: changes-in 220ms ease-out; }
      @keyframes changes-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
    }
    @media (prefers-reduced-motion: reduce) { .chev { transition: none; } }
  `,
})
export class UpdateNotice {
  protected readonly shown = signal(false);
  protected readonly open = signal(false);
  protected readonly changes = signal<string[]>([]);
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    const sw = inject(SwUpdate);
    if (!sw.isEnabled) return;
    sw.versionUpdates.pipe(filter((e) => e.type === 'VERSION_READY')).subscribe(async () => {
      this.changes.set(await newChanges());
      this.open.set(false);
      this.shown.set(true);
      this.timer = setTimeout(() => { if (!this.open()) this.shown.set(false); }, 12000);
      document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && location.reload(), { once: true });
    });
  }

  protected toggle(): void {
    this.open.update((v) => !v);
    clearTimeout(this.timer);
  }
}
