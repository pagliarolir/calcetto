import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Maglia numerata: il numero di slot nel tabellone prenotazioni. */
@Component({
  selector: 'app-jersey',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'jersey',
    '[class.mine]': 'mine()',
    '[class.reserve]': 'variant() === "reserve"',
    '[class.vacant]': 'variant() === "empty"',
    '[class.black]': 'variant() === "black"',
    '[attr.aria-hidden]': 'true',
  },
  template: `
    <svg viewBox="0 0 44 42"><path d="M15 2 L4 8 L1 17 L8 20 L9 40 L35 40 L36 20 L43 17 L40 8 L29 2 Q22 8 15 2 Z" /></svg>
    @if (captain()) { <span class="armband">C</span> }
    <b>{{ number() }}</b>
  `,
})
export class Jersey {
  readonly number = input<number | string | null>(null);
  readonly variant = input<'team' | 'reserve' | 'empty' | 'black'>('team');
  readonly mine = input(false);
  readonly captain = input(false);
}
