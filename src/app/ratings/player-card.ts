import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Icon } from '../ui/icon';
import { Session } from '../core/session';
import { FieldRole } from '../core/models';
import { Ratings, ROLE_SHORT } from '../core/ratings';
import { HexChart, PitchChart, RatingRing } from './charts';

/** La scheda dei valori che vedono tutti: cerchio con il valore nel ruolo, esagono e campo. */
/** nomi corti sotto il cerchio: quelli interi farebbero sbordare la mappa del campo */
const CARD_ROLE_LABEL: Record<FieldRole, string> = { difensore_centrale: 'Difensore', esterno_difensivo: 'Esterno dif.', esterno_offensivo: 'Esterno off.', punta: 'Punta' };

@Component({
  selector: 'app-player-card',
  imports: [RatingRing, HexChart, PitchChart, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (card(); as c) {
      @if (c.has) {
        <div class="card">
          <div class="ring">
            <app-rating-ring [label]="roleShort()" [value]="c.role_value" [size]="84" />
            <span class="small muted rl">{{ roleLabel() }}
              @if (!c.role) {
                <button type="button" class="ri" aria-label="Perché questo ruolo" [attr.aria-expanded]="tip()" (click)="tip.set(!tip())"><app-icon name="info" [size]="14" /></button>
              }
            </span>
            @if (tip()) {
              <div class="pop-shield" aria-hidden="true" (click)="tip.set(false)"></div>
              <div class="tip panel" role="note">Ruolo non indicato nel profilo: è il ruolo migliore secondo i valori.</div>
            }
          </div>
          <app-hex-chart [series]="[{ hex: c.hex!, color: 'var(--turf)', name: 'caratteristiche' }]" [size]="120" />
          <app-pitch-chart [card]="c" />
        </div>
      } @else {
        @if (session.isLeader()) { <p class="small muted">Valori non ancora inseriti: aprili dal menu ⋯.</p> }
      }
    }
  `,
  styles: `
    /* cerchio, esagono e campo sempre su una riga */
    .card { display: flex; flex-wrap: nowrap; align-items: center; justify-content: space-between; gap: 6px; padding: 10px; border-radius: 16px;
            background: var(--surface); box-shadow: 0 0 0 1px var(--line); }
    .ring { display: flex; flex-direction: column; align-items: center; gap: 2px; flex: none; position: relative; }
    .rl { display: inline-flex; align-items: center; gap: 2px; }
    .ri { width: 28px; height: 28px; border: 0; border-radius: 50%; background: none; color: var(--muted); display: grid; place-items: center; cursor: pointer; padding: 0; }
    .ri[aria-expanded='true'] { color: var(--turf); }
    .pop-shield { position: fixed; inset: 0; z-index: 5; }
    .tip { position: absolute; left: 0; top: 100%; z-index: 6; width: 220px; padding: 10px 12px; font-size: var(--step--1); box-shadow: 0 12px 30px rgb(0 0 0 / 22%); }
  `,
})
export class PlayerCard {
  private readonly ratings = inject(Ratings);
  protected readonly session = inject(Session);
  protected readonly tip = signal(false);
  readonly userId = input.required<string>();
  protected readonly card = computed(() => this.ratings.cards().get(this.userId()));
  protected readonly roleShort = computed(() => {
    const c = this.card();
    return ROLE_SHORT[c?.role ?? c?.best ?? ''] ?? '';
  });
  protected readonly roleLabel = computed(() => {
    const c = this.card();
    const r = (c?.role ?? c?.best) as FieldRole | undefined;
    return r ? CARD_ROLE_LABEL[r] : '';
  });
  constructor() {
    effect(() => { void this.ratings.load([this.userId()]).catch(() => undefined); });
  }
}
