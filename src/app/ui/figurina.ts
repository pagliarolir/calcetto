import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Session } from '../core/session';
import { inject } from '@angular/core';
import { Avatar } from './avatar';

/**
 * Un giocatore nel tabellone, come una figurina: foto (o sigla) nel cerchio, il numero del posto
 * agganciato come un distintivo e la fascia da capitano per il Leader.
 */
@Component({
  selector: 'app-figurina',
  imports: [Avatar, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'figurina',
    '[class.me]': 'mine()',
    '[class.reserve]': "variant() === 'reserve'",
    '[class.empty]': "variant() === 'empty'",
  },
  template: `
    <span class="pic">
      @if (userId(); as id) {
        <app-avatar [userId]="id" [size]="48" />
      } @else {
        <span class="hole" aria-hidden="true"></span>
      }
      @if (number() !== null) { <span class="num" [attr.aria-label]="'numero ' + number()">{{ number() }}</span> }
      @if (captain()) { <span class="armband" title="Capitano" aria-label="Capitano">C</span> }
    </span>
    <span class="txt">
      @if (userId(); as id) {
        <a class="name ellipsis" [routerLink]="['/giocatore', id]">{{ session.name(id) }}</a>
      } @else {
        <span class="name muted">{{ emptyLabel() }}</span>
      }
      @if (note(); as n) { <span class="sub" [class.turf]="noteTone() === 'turf'">{{ n }}</span> }
    </span>
  `,
  styles: `
    :host {
      display: flex; align-items: center; gap: 12px; min-width: 0; min-height: 64px;
      padding: 8px 12px 8px 8px; border-radius: 16px;
      background: var(--surface); border: 1px solid var(--line);
    }
    :host(.me) { border-color: var(--turf); box-shadow: inset 0 0 0 1px var(--turf); background: linear-gradient(var(--turf-soft), var(--turf-soft)) padding-box; }
    :host(.empty) { background: transparent; border-style: dashed; }
    .pic { position: relative; flex: none; width: 48px; height: 48px; }
    .pic app-avatar { box-shadow: 0 0 0 2px var(--surface); }
    .hole { display: block; width: 48px; height: 48px; border-radius: 50%; border: 2px dashed var(--line); }
    /* il numero del posto, agganciato alla foto come quello sulla maglia */
    .num {
      position: absolute; right: -6px; bottom: -4px; min-width: 22px; height: 22px; padding: 0 5px;
      display: grid; place-items: center; border-radius: 11px;
      background: var(--ink); color: var(--surface); box-shadow: 0 0 0 2px var(--surface);
      font: 700 0.8rem/1 var(--font-display); letter-spacing: 0.02em;
    }
    :host(.reserve) .num { background: var(--muted); }
    :host(.empty) .num { background: var(--surface-2); color: var(--muted); box-shadow: none; }
    :host(.me) .num { background: var(--turf); color: var(--turf-ink); box-shadow: 0 0 0 2px var(--turf-soft); }
    /* la fascia da capitano */
    .armband {
      position: absolute; left: -7px; top: -5px; height: 18px; padding: 0 5px; border-radius: 4px;
      display: grid; place-items: center; transform: rotate(-12deg);
      background: var(--armband); color: var(--armband-ink); box-shadow: 0 0 0 2px var(--surface);
      font: 800 0.72rem/1 var(--font-display);
    }
    .txt { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
    .name { font-weight: 700; color: inherit; text-decoration: none; font-size: var(--step-0); }
    .sub { font-size: 0.75rem; color: var(--muted); }
    .sub.turf { color: var(--turf); font-weight: 600; }
  `,
})
export class Figurina {
  protected readonly session = inject(Session);
  readonly userId = input<string | null>(null);
  readonly number = input<number | null>(null);
  readonly captain = input(false);
  readonly mine = input(false);
  readonly variant = input<'team' | 'reserve' | 'empty' | 'free'>('team');
  readonly note = input<string | null>(null);
  readonly noteTone = input<'muted' | 'turf'>('muted');
  readonly emptyLabel = input('Posto libero');
}
