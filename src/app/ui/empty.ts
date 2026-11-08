import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Icon } from './icon';

/** Stato vuoto unico: icona in un cerchio e frase. */
@Component({
  selector: 'app-empty',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="ic" aria-hidden="true"><app-icon [name]="icon()" [size]="24" /></span><span class="tx">{{ text() }}</span>`,
  styles: `
    :host { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 22px 12px; text-align: center; color: var(--muted); }
    .ic { width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; background: var(--turf-soft); color: var(--turf); }
    .tx { max-width: 300px; font-size: var(--step--1); line-height: 1.4; }
  `,
})
export class Empty {
  readonly icon = input('info');
  readonly text = input('');
}
