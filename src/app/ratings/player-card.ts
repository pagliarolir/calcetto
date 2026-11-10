import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Icon } from '../ui/icon';
import { Session } from '../core/session';
import { FIELD_ROLE_LABEL, FieldRole } from '../core/models';
import { Ratings, ROLE_SHORT } from '../core/ratings';
import { HexChart, PitchChart, RatingRing } from './charts';

/** La scheda dei valori che vedono tutti: cerchio con il valore nel ruolo, esagono e campo. */
@Component({
  selector: 'app-player-card',
  imports: [RatingRing, HexChart, PitchChart, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (card(); as c) {
      @if (c.has) {
        <div class="card">
          <div class="ring">
            <app-rating-ring [label]="roleShort()" [value]="c.role_value" [size]="86" />
            <span class="small muted rl">{{ roleLabel() }}
              @if (!c.role) {
                <button type="button" class="ri" aria-label="Perché questo ruolo" [attr.aria-expanded]="tip()" (click)="tip.set(!tip())"><app-icon name="info" [size]="14" /></button>
              }
            </span>
            @if (tip()) {
              <div class="pop-shield" aria-hidden="true" (click)="tip.set(false)"></div>
              <div class="tip panel" role="note">Ruolo non indicato nel profilo: è il ruolo migliore secondo i valori.</div>
            }
            <!-- medie per ruolo -->
            <ul class="avg">
              @for (r of roles(); track r.key) {
                <li [class.mine]="r.mine"><span class="rn">{{ r.label }}</span><strong class="num">{{ r.value }}</strong></li>
              }
            </ul>
          </div>
          <div class="charts">
            <app-hex-chart [series]="[{ hex: c.hex!, color: 'var(--turf)', name: 'caratteristiche' }]" [size]="168" />
            <app-pitch-chart [card]="c" />
          </div>
        </div>
      } @else {
        @if (session.isLeader()) { <p class="small muted">Valori non ancora inseriti: aprili dal menu ⋯.</p> }
      }
    }
  `,
  styles: `
    /* due colonne: a sinistra cerchio, ruolo e medie per ruolo; a destra esagono e campo */
    .card { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; gap: 8px; padding: 12px 10px; border-radius: 16px;
            background: var(--surface); box-shadow: 0 0 0 1px var(--line); }
    .ring { display: flex; flex-direction: column; align-items: center; gap: 4px; position: relative; min-width: 0; }
    .rl { text-align: center; }
    .avg { list-style: none; margin: 6px 0 0; padding: 0; width: 100%; display: flex; flex-direction: column; gap: 2px; }
    .avg li { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; padding: 4px 6px; border-radius: 8px; font-size: var(--step--1); }
    .avg li .rn { color: var(--muted); min-width: 0; }
    .avg li strong { font-size: 1.05rem; }
    .avg li.mine { background: var(--turf-soft); } .avg li.mine .rn { color: var(--ink); font-weight: 600; }
    .charts { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; }
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
  /** medie per ruolo, evidenziato il ruolo del giocatore (o il migliore) */
  protected readonly roles = computed(() => {
    const c = this.card();
    if (!c?.has) return [];
    const mine = c.role ?? c.best;
    return ([['punta', 'pu'], ['esterno_offensivo', 'eo'], ['esterno_difensivo', 'ed'], ['difensore_centrale', 'dc']] as const)
      .map(([k, z]) => ({ key: k, label: FIELD_ROLE_LABEL[k as FieldRole], value: c[z] ?? '–', mine: k === mine }));
  });
  readonly userId = input.required<string>();
  protected readonly card = computed(() => this.ratings.cards().get(this.userId()));
  protected readonly roleShort = computed(() => {
    const c = this.card();
    return ROLE_SHORT[c?.role ?? c?.best ?? ''] ?? '';
  });
  protected readonly roleLabel = computed(() => {
    const c = this.card();
    const r = (c?.role ?? c?.best) as FieldRole | undefined;
    return r ? FIELD_ROLE_LABEL[r] : '';
  });
  constructor() {
    effect(() => { void this.ratings.load([this.userId()]).catch(() => undefined); });
  }
}
