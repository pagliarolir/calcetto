import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { centerCss, GK_COLOR, Hex, RatingCard, Zone, zoneCss } from '../core/ratings';

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

let pitchSeq = 0;

/**
 * Mappa dei ruoli: punta in alto, esterni offensivi e difensivi ai lati, difensore centrale in basso,
 * il centro è la sfumatura delle zone intorno. Le zone si fondono l'una nell'altra (sfocatura leggera),
 * colori con la regola mista (valore assoluto + penalità lontano dal ruolo migliore, vedi zoneHsl); pallino del portiere in porta.
 */
@Component({
  selector: 'app-pitch-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 84 116" width="84" height="116" role="img" [attr.aria-label]="aria()">
      <defs>
        <clipPath [attr.id]="clip"><rect width="84" height="116" rx="10" /></clipPath>
        <filter [attr.id]="blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="6" /></filter>
      </defs>
      <g [attr.clip-path]="'url(#' + clip + ')'">
        <rect width="84" height="116" fill="#14432c" />
        @if (card().has) {
          <g [attr.filter]="'url(#' + blur + ')'">
            <rect x="-10" y="-10" width="104" height="40" [attr.fill]="z('pu')" />
            <rect x="-10" y="30" width="30" height="27" [attr.fill]="z('eo')" /><rect x="64" y="30" width="30" height="27" [attr.fill]="z('eo')" />
            <rect x="-10" y="57" width="30" height="27" [attr.fill]="z('ed')" /><rect x="64" y="57" width="30" height="27" [attr.fill]="z('ed')" />
            <rect x="20" y="30" width="44" height="54" [attr.fill]="center()" />
            <rect x="-10" y="84" width="104" height="42" [attr.fill]="z('dc')" />
          </g>
        }
        <g fill="none" stroke="rgb(255 255 255 / 60%)" stroke-width="1.2">
          <rect x="4" y="4" width="76" height="108" rx="3" /><line x1="4" y1="58" x2="80" y2="58" /><circle cx="42" cy="58" r="9" />
          <rect x="24" y="4" width="36" height="13" /><rect x="24" y="99" width="36" height="13" />
        </g>
        <g class="lb"><text x="42" y="24">PU</text><text x="11" y="47">EO</text><text x="73" y="47">EO</text>
          <text x="11" y="74">ED</text><text x="73" y="74">ED</text><text x="42" y="92">DC</text></g>
        @if (card().gk; as g) { <circle cx="42" cy="108" r="3.6" [attr.fill]="gk[g]" stroke="#fff" stroke-width="1.4" /> }
      </g>
    </svg>
  `,
  styles: `
    :host { display: inline-grid; }
    .lb text { font: 800 7px var(--font-body); fill: rgb(0 0 0 / 55%); text-anchor: middle; }
  `,
})
export class PitchChart {
  readonly card = input.required<RatingCard>();
  protected readonly gk = GK_COLOR;
  private readonly n = ++pitchSeq;
  protected readonly clip = `pc-clip-${this.n}`;
  protected readonly blur = `pc-blur-${this.n}`;
  protected z(zone: Zone): string {
    return zoneCss(this.card(), zone);
  }
  protected readonly center = computed(() => centerCss(this.card()));
  protected readonly aria = computed(() => {
    const c = this.card();
    return c.has ? `Mappa dei ruoli: ruolo migliore ${c.best?.replace('_', ' ')}` : 'Mappa dei ruoli: valori non ancora inseriti';
  });
}
