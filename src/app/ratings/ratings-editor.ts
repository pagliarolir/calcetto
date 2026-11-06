import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ATTRS, Gk, Ratings } from '../core/ratings';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';

/** Solo il Leader: le 13 caratteristiche (0-100), il pallino del portiere e l'eventuale valore impostato a mano. */
@Component({
  selector: 'app-ratings-editor',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loaded()) {
      <p class="small muted">Li vedi solo tu: i giocatori vedono il cerchio, l'esagono e il campo. Servono tutte e 13 le caratteristiche.</p>
      <div class="grid">
        @for (a of attrs; track a.key) {
          <label class="row-v"><span>{{ a.label }}</span>
            <input class="input num" type="number" inputmode="numeric" min="0" max="100" [(ngModel)]="vals[a.key]" [attr.aria-label]="a.label + ', da 0 a 100'" />
            <i class="bar" aria-hidden="true"><b [style.width.%]="vals[a.key] ?? 0"></b></i>
          </label>
        }
      </div>
      <fieldset class="gk"><legend class="small muted">Portiere (sulla media generale: verde +2, giallo +1, rosso 0)</legend>
        @for (o of gkOpts; track o.v) {
          <button type="button" class="chip" [attr.aria-pressed]="gk() === o.v" (click)="gk.set(o.v)">@if (o.c) { <i class="dot" [style.background]="o.c"></i> }{{ o.l }}</button>
        }
      </fieldset>
      <label class="field"><span>Valore impostato a mano (vuoto = calcolato@if (computed(); as c) { : {{ c }} })</span>
        <input class="input" type="number" min="0" max="100" [(ngModel)]="override" placeholder="calcolato" />
      </label>
      <button class="btn primary block" [disabled]="busy()" (click)="save()">Salva i valori</button>
    }
  `,
  styles: `
    .grid { display: grid; grid-template-columns: 1fr; gap: 6px; }
    @media (min-width: 520px) { .grid { grid-template-columns: 1fr 1fr; } }
    .row-v { display: grid; grid-template-columns: 1fr 64px; align-items: center; gap: 2px 8px; font-size: var(--step--1); }
    .row-v .num { min-height: 38px; padding: 4px 8px; text-align: center; }
    .bar { grid-column: 1 / -1; height: 4px; border-radius: 2px; background: var(--surface-2); overflow: hidden; }
    .bar b { display: block; height: 100%; background: var(--turf); }
    .gk { border: 0; padding: 0; margin: 4px 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; }
  `,
})
export class RatingsEditor {
  private readonly ratings = inject(Ratings);
  private readonly toasts = inject(Toasts);
  readonly userId = input.required<string>();
  protected readonly attrs = ATTRS;
  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);
  protected readonly gk = signal<Gk>(null);
  protected readonly computed = signal<number | null>(null);
  protected vals: Record<string, number | null> = {};
  protected override: number | null = null;
  protected readonly gkOpts: { v: Gk; l: string; c: string | null }[] = [
    { v: null, l: 'Nessuno', c: null }, { v: 'green', l: 'Verde', c: 'hsl(150 58% 40%)' },
    { v: 'yellow', l: 'Giallo', c: 'hsl(48 88% 52%)' }, { v: 'red', l: 'Rosso', c: 'hsl(4 76% 50%)' },
  ];

  constructor() {
    effect(() => { void this.load(this.userId()); });
  }

  private async load(id: string): Promise<void> {
    this.loaded.set(false);
    const raw = await this.ratings.raw(id).catch(() => null);
    this.vals = Object.fromEntries(ATTRS.map((a) => [a.key, (raw?.[a.key] as number | null) ?? null]));
    this.gk.set((raw?.['gk'] as Gk) ?? null);
    this.override = (raw?.['override'] as number | null) ?? null;
    await this.ratings.load([id], true).catch(() => undefined);
    this.computed.set(this.ratings.card(id)?.role_value ?? null);
    this.loaded.set(true);
  }

  protected async save(): Promise<void> {
    const vals: Record<string, number | null> = {};
    for (const a of ATTRS) {
      const v = this.vals[a.key];
      if (v !== null && v !== undefined && ((v as unknown) as string) !== '' && (v < 0 || v > 100)) { this.toasts.error(`${a.label}: da 0 a 100.`); return; }
      vals[a.key] = v === null || v === undefined || ((v as unknown) as string) === '' ? null : Math.round(v);
    }
    const ov = this.override === null || ((this.override as unknown) as string) === '' ? null : Math.round(this.override);
    this.busy.set(true);
    try {
      const card = await this.ratings.save(this.userId(), vals, this.gk(), ov);
      this.toasts.show(card.has ? `Valori salvati: ${card.role_value} nel ruolo.` : 'Valori salvati: mancano alcune caratteristiche per la scheda.');
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
