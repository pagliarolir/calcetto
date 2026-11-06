import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { FIELD_ROLE_LABEL, FieldRole } from '../core/models';
import { Ratings, ROLE_SHORT } from '../core/ratings';
import { HexChart, PitchChart, RatingRing } from './charts';

/** La scheda dei valori che vedono tutti: cerchio con il valore nel ruolo, esagono e campo. */
@Component({
  selector: 'app-player-card',
  imports: [RatingRing, HexChart, PitchChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (card(); as c) {
      @if (c.has) {
        <div class="card">
          <div class="ring">
            <app-rating-ring [label]="roleShort()" [value]="c.role_value" [size]="92" />
            <span class="small muted">{{ roleLabel() }}</span>
          </div>
          <app-hex-chart [series]="[{ hex: c.hex!, color: 'var(--turf)', name: 'caratteristiche' }]" [size]="136" />
          <app-pitch-chart [card]="c" />
        </div>
      } @else {
        <p class="small muted">Valori non ancora inseriti dal Leader.</p>
      }
    }
  `,
  styles: `
    /* su schermi stretti cerchio, esagono e campo vanno a capo invece di uscire */
    .card { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-around; gap: 8px; padding: 10px; border-radius: 16px;
            background: var(--surface); box-shadow: 0 0 0 1px var(--line); }
    .ring { display: flex; flex-direction: column; align-items: center; gap: 2px; flex: none; }
  `,
})
export class PlayerCard {
  private readonly ratings = inject(Ratings);
  readonly userId = input.required<string>();
  protected readonly card = computed(() => this.ratings.cards().get(this.userId()));
  protected readonly roleShort = computed(() => {
    const c = this.card();
    return ROLE_SHORT[c?.role ?? c?.best ?? ''] ?? '';
  });
  protected readonly roleLabel = computed(() => {
    const c = this.card();
    const r = (c?.role ?? c?.best) as FieldRole | undefined;
    return r ? FIELD_ROLE_LABEL[r] + (c?.role ? '' : ' (ruolo migliore)') : '';
  });
  constructor() {
    effect(() => { void this.ratings.load([this.userId()]).catch(() => undefined); });
  }
}
