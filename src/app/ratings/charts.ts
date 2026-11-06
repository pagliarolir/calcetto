import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { bandColor, GK_COLOR, Hex, RatingCard } from '../core/ratings';

/** Cerchio con il ruolo e il valore (l'anello si riempie in proporzione). */
@Component({
  selector: 'app-rating-ring',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 100 100" role="img" [attr.aria-label]="label() + ' ' + (value() ?? 'non disponibile')">
      <circle cx="50" cy="50" r="42" fill="none" stroke="var(--surface-2)" stroke-width="8" />
      <circle cx="50" cy="50" r="42" fill="none" stroke="var(--turf)" stroke-width="8" stroke-linecap="round"
              [attr.stroke-dasharray]="dash()" transform="rotate(-90 50 50)" />
      <text x="50" y="40" text-anchor="middle" class="lab">{{ label() }}</text>
      <text x="50" y="68" text-anchor="middle" class="val">{{ value() ?? '–' }}</text>
    </svg>
  `,
  styles: `
    :host { display: inline-grid; }
    .lab { font: 700 13px var(--font-body); fill: var(--muted); letter-spacing: 0.06em; }
    .val { font: 800 30px var(--font-display); fill: var(--ink); }
  `,
})
export class RatingRing {
  readonly label = input('');
  readonly value = input<number | null | undefined>(null);
  readonly size = input(104);
  protected readonly dash = computed(() => {
    const c = 2 * Math.PI * 42;
    return `${(c * Math.max(0, Math.min(100, this.value() ?? 0))) / 100} ${c}`;
  });
}

export interface HexSeries { hex: Hex; color: string; name: string }
const AXES: { key: keyof Hex; label: string }[] = [
  { key: 'attacco', label: 'Attacco' }, { key: 'tiro', label: 'Tiro' }, { key: 'tecnica', label: 'Tecnica' },
  { key: 'velocita', label: 'Velocità' }, { key: 'forza', label: 'Forza' }, { key: 'difesa', label: 'Difesa' },
];

/** Esagono delle caratteristiche (una o due serie sovrapposte). I numeri non si mostrano. */
@Component({
  selector: 'app-hex-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="-70 -64 140 128" role="img" [attr.aria-label]="'Caratteristiche: ' + names()">
      @for (lv of [1, 0.66, 0.33]; track lv) { <polygon [attr.points]="ring(lv)" class="grid" /> }
      @for (a of axes; track a.key; let i = $index) {
        <line x1="0" y1="0" [attr.x2]="pt(i, 1)[0]" [attr.y2]="pt(i, 1)[1]" class="grid" />
        <text [attr.x]="pt(i, 1.24)[0]" [attr.y]="pt(i, 1.24)[1] + 3" text-anchor="middle" class="ax">{{ a.label }}</text>
      }
      @for (s of series(); track s.name) {
        <polygon [attr.points]="poly(s.hex)" [attr.fill]="s.color" fill-opacity="0.28" [attr.stroke]="s.color" stroke-width="1.6" stroke-linejoin="round" />
      }
    </svg>
  `,
  styles: `
    :host { display: inline-grid; }
    .grid { fill: none; stroke: var(--line); stroke-width: 0.6; }
    .ax { font: 600 7px var(--font-body); fill: var(--muted); }
  `,
})
export class HexChart {
  readonly series = input<HexSeries[]>([]);
  readonly size = input(200);
  protected readonly axes = AXES;
  protected readonly names = computed(() => this.series().map((s) => s.name).join(' e '));
  protected pt(i: number, r: number): [number, number] {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    return [Math.cos(a) * 46 * r, Math.sin(a) * 46 * r];
  }
  protected ring(r: number): string {
    return AXES.map((_, i) => this.pt(i, r).map((n) => n.toFixed(1)).join(',')).join(' ');
  }
  protected poly(h: Hex): string {
    return AXES.map((a, i) => this.pt(i, Math.max(0.03, (h[a.key] ?? 0) / 100)).map((n) => n.toFixed(1)).join(',')).join(' ');
  }
}

/** Campo a fasce: attacco, esterni e centrocampo centrale, difesa; pallino del portiere in porta. */
@Component({
  selector: 'app-pitch-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pitch" role="img" [attr.aria-label]="aria()">
      <div class="band att" [style.background]="col('att')"><span>ATT</span></div>
      <div class="mid">
        <div class="band est" [style.background]="col('est')"></div>
        <div class="band cen" [style.background]="cenBg()"><span>CEN</span></div>
        <div class="band est" [style.background]="col('est')"></div>
      </div>
      <div class="band dif" [style.background]="col('dif')"><span>DIF</span></div>
      <div class="goal">@if (card().gk; as g) { <i class="gk" [style.background]="gk[g]"></i> }</div>
    </div>
  `,
  styles: `
    :host { display: inline-grid; }
    .pitch { width: 96px; height: 132px; display: grid; grid-template-rows: 1fr 1.15fr 1fr 14px; gap: 3px; padding: 4px; border-radius: 10px;
             background: var(--turf-deep, #14432c); box-shadow: inset 0 0 0 1.5px rgb(255 255 255 / 25%); }
    .band { border-radius: 4px; display: grid; place-items: center; opacity: 0.92; }
    .band span { font: 800 9px var(--font-body); color: rgb(0 0 0 / 55%); letter-spacing: 0.05em; }
    .mid { display: grid; grid-template-columns: 1fr 1.6fr 1fr; gap: 3px; }
    .goal { display: grid; place-items: center; border-radius: 3px; background: rgb(255 255 255 / 12%); width: 44%; justify-self: center; }
    .gk { width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 0 1.5px #fff; }
  `,
})
export class PitchChart {
  readonly card = input.required<RatingCard>();
  protected readonly gk = GK_COLOR;
  protected col(b: 'dif' | 'est' | 'att'): string {
    return bandColor(this.card(), b);
  }
  /** centrocampo centrale: sfumatura dei colori delle altre tre fasce */
  protected cenBg(): string {
    return `linear-gradient(180deg, ${this.col('att')}, ${this.col('est')}, ${this.col('dif')})`;
  }
  protected readonly aria = computed(() => {
    const c = this.card();
    return c.has ? `Campo: ruolo migliore ${c.best}` : 'Campo: valori non ancora inseriti';
  });
}
