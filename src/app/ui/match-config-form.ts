import { ChangeDetectionStrategy, Component, computed, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { KITS, kit } from '../core/kits';
import { MatchConfig } from '../core/match-config';

/** Modulo della configurazione di una partita: usato per creare, per la configurazione predefinita e per modificare. */
@Component({
  selector: 'app-match-config-form',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cfg stack">
      <fieldset>
        <legend>Giocatori</legend>
        <div class="row-wrap" role="group" aria-label="Giocatori per squadra">
          @for (n of players; track n) {
            <button type="button" class="chip" [attr.aria-pressed]="config().players_per_team === n" (click)="set('players_per_team', n)">{{ n }} contro {{ n }}</button>
          }
        </div>
        <p class="small muted">In lista {{ config().players_per_team * 2 }} posti, il Leader resta il numero 1; le riserve partono dal {{ config().players_per_team * 2 + 1 }}.</p>
      </fieldset>

      <fieldset>
        <legend>Durata</legend>
        <div class="row-wrap duration">
          @for (d of durations; track d) {
            <button type="button" class="chip" [attr.aria-pressed]="config().duration_min === d" (click)="set('duration_min', d)">{{ d }} minuti</button>
          }
          <label class="field mins"><span class="sr-only">Durata in minuti</span>
            <input class="input" type="number" inputmode="numeric" min="1" max="90" step="1"
                   [ngModel]="config().duration_min" (ngModelChange)="setDuration($event)" aria-label="Durata in minuti" />
          </label>
        </div>
        <p class="small muted">Da 1 a 90 minuti. Le votazioni si aprono contando dalla fine della partita.</p>
      </fieldset>

      <fieldset>
        <legend>Colori delle squadre</legend>
        @for (side of sides; track side.key) {
          <div class="kit-row">
            <span class="small kit-label">{{ side.label }}: <strong>{{ kitOf(side.key).name }}</strong></span>
            <div class="swatches" role="group" [attr.aria-label]="'Colore ' + side.label">
              @for (k of kits; track k.key) {
                <button type="button" class="swatch" [style.background]="k.color" [attr.aria-pressed]="config()[side.key] === k.key"
                        [disabled]="config()[side.other] === k.key" [attr.aria-label]="k.name" [title]="k.name"
                        (click)="set(side.key, k.key)"></button>
              }
            </div>
          </div>
        }
        <p class="vs"><span class="pill" [style.background]="kitOf('team_a_kit').color" [style.color]="kitOf('team_a_kit').ink">{{ kitOf('team_a_kit').name }}</span>
          contro <span class="pill" [style.background]="kitOf('team_b_kit').color" [style.color]="kitOf('team_b_kit').ink">{{ kitOf('team_b_kit').name }}</span></p>
      </fieldset>

      <fieldset>
        <legend>Prenotazioni</legend>
        <div class="row-wrap" role="group" aria-label="Modalità di prenotazione">
          <button type="button" class="chip" [attr.aria-pressed]="config().booking_mode === 'order'" (click)="set('booking_mode', 'order')">In ordine di arrivo</button>
          <button type="button" class="chip" [attr.aria-pressed]="config().booking_mode === 'free'" (click)="set('booking_mode', 'free')">Sceglie il Leader</button>
        </div>
        <p class="small muted">
          @if (config().booking_mode === 'order') {
            Fa fede l'ordine di prenotazione: i primi {{ config().players_per_team * 2 }} giocano, gli altri sono riserve in ordine.
          } @else {
            Nessun ordine: i giocatori dicono solo se ci sono; dopo la chiusura il Leader sceglie titolari e riserve e li avvisa.
          }
        </p>
        <div class="pair">
          <label class="field"><span>Si aprono</span>
            <select class="input" [ngModel]="config().booking_open_days" (ngModelChange)="set('booking_open_days', +$event)">
              @for (d of days; track d) { <option [ngValue]="d">{{ dayLabel(d) }}</option> }
            </select>
          </label>
          <label class="field"><span>alle</span>
            <input class="input" type="time" [ngModel]="config().booking_open_time" (ngModelChange)="set('booking_open_time', $event)" />
          </label>
        </div>
        <div class="pair">
          <label class="field"><span>Si chiudono</span>
            <select class="input" [ngModel]="config().booking_close_days" (ngModelChange)="set('booking_close_days', +$event)">
              @for (d of days; track d) { <option [ngValue]="d">{{ dayLabel(d) }}</option> }
            </select>
          </label>
          <label class="field"><span>alle</span>
            <input class="input" type="time" [ngModel]="config().booking_close_time" (ngModelChange)="set('booking_close_time', $event)" />
          </label>
        </div>
        <p class="small muted">Dopo la chiusura i giocatori non possono più cambiare: il Leader sì, fino all'inizio.</p>
      </fieldset>

      <fieldset>
        <legend>Votazioni</legend>
        <div class="pair">
          <label class="field"><span>Si aprono</span>
            <select class="input" [ngModel]="config().votes_open_after_min" (ngModelChange)="set('votes_open_after_min', +$event)">
              @for (o of voteOpenOptions(); track o) { <option [ngValue]="o">{{ openLabel(o) }}</option> }
            </select>
          </label>
          <label class="field"><span>Restano aperte</span>
            <select class="input" [ngModel]="config().votes_hours" (ngModelChange)="set('votes_hours', +$event)">
              @for (h of voteHourOptions(); track h) { <option [ngValue]="h">{{ hoursLabel(h) }}</option> }
            </select>
          </label>
        </div>
      </fieldset>
    </div>
  `,
  styles: `
    fieldset { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    legend { font: 600 var(--step-1)/1.2 var(--font-display); margin-bottom: 6px; padding: 0; }
    .pair { display: grid; grid-template-columns: 1.4fr 1fr; gap: 8px; }
    .kit-row { display: flex; flex-direction: column; gap: 6px; }
    .swatches { display: flex; flex-wrap: wrap; gap: 8px; }
    .swatch { appearance: none; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; border: 2px solid var(--line); padding: 0; }
    .swatch[aria-pressed='true'] { box-shadow: 0 0 0 3px var(--surface), 0 0 0 5px var(--turf); }
    .swatch:disabled { opacity: 0.25; cursor: not-allowed; }
    .vs { display: flex; align-items: center; gap: 8px; font-size: var(--step--1); }
    .duration { align-items: center; }
    .mins { width: 88px; position: relative; }
    .pill { padding: 4px 12px; border-radius: 999px; font-weight: 700; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 15%); }
  `,
})
export class MatchConfigForm {
  readonly config = model.required<MatchConfig>();

  protected readonly kits = KITS;
  protected readonly players = [5, 6, 7, 8];
  protected readonly days = Array.from({ length: 15 }, (_, i) => i);
  protected readonly sides = [
    { key: 'team_a_kit' as const, other: 'team_b_kit' as const, label: 'Squadra 1' },
    { key: 'team_b_kit' as const, other: 'team_a_kit' as const, label: 'Squadra 2' },
  ];

  protected readonly voteOpenOptions = computed(() => withValue([0, 15, 30, 60, 120, 180, 720, 1440], this.config().votes_open_after_min));
  protected readonly voteHourOptions = computed(() => withValue([12, 24, 48, 72, 168], this.config().votes_hours));

  protected readonly durations = [45, 60, 90];

  protected setDuration(v: number | string): void {
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n >= 1 && n <= 90) this.set('duration_min', n);
  }

  protected kitOf(key: 'team_a_kit' | 'team_b_kit') {
    return kit(this.config()[key]);
  }

  protected set<K extends keyof MatchConfig>(k: K, v: MatchConfig[K]): void {
    this.config.set({ ...this.config(), [k]: v });
  }

  protected dayLabel(d: number): string {
    return d === 0 ? 'Il giorno della partita' : d === 1 ? '1 giorno prima' : `${d} giorni prima`;
  }

  protected openLabel(min: number): string {
    if (min === 0) return 'Appena finita la partita';
    if (min < 60) return `${min} minuti dopo la fine`;
    if (min % 60 === 0) return min === 60 ? '1 ora dopo la fine' : `${min / 60} ore dopo la fine`;
    return `${min} minuti dopo la fine`;
  }

  protected hoursLabel(h: number): string {
    if (h % 24 === 0) return h === 24 ? 'per 1 giorno' : h === 168 ? 'per 1 settimana' : `per ${h / 24} giorni`;
    return `per ${h} ore`;
  }
}

function withValue(list: number[], value: number): number[] {
  return list.includes(value) ? list : [...list, value].sort((a, b) => a - b);
}
