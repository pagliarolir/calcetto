import { ChangeDetectionStrategy, Component, input } from '@angular/core';

let uid = 0;

/** Pallone classico (pentagono al centro, esagoni attorno): bianco per un gol, rosso per un autogol. */
@Component({
  selector: 'app-ball',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24">
      <defs>
        <clipPath [attr.id]="'bc' + id"><circle cx="12" cy="12" r="10.6" /></clipPath>
        <radialGradient [attr.id]="'bg' + id" cx="32%" cy="28%" r="38%">
          <stop offset="0" stop-color="#fff" stop-opacity=".75" /><stop offset="1" stop-color="#fff" stop-opacity="0" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="10.6" [attr.fill]="own() ? '#e2463b' : '#ffffff'" />
      <g [attr.clip-path]="'url(#bc' + id + ')'">
        <g [attr.fill]="dark()"><path d="M12.00 8.30 L15.52 10.86 L14.17 14.99 L9.83 14.99 L8.48 10.86Z" /><path d="M12.00 5.00 L9.15 2.93 L10.24 -0.43 L13.76 -0.43 L14.85 2.93Z M18.66 9.84 L19.75 6.48 L23.27 6.48 L24.36 9.84 L21.51 11.91Z M16.11 17.66 L19.64 17.66 L20.73 21.02 L17.88 23.09 L15.02 21.02Z M7.89 17.66 L8.98 21.02 L6.12 23.09 L3.27 21.02 L4.36 17.66Z M5.34 9.84 L2.49 11.91 L-0.36 9.84 L0.73 6.48 L4.25 6.48Z" /></g>
        <path d="M12.00 8.30 L12.00 5.00 M14.62 3.44 L17.41 4.56 L19.33 6.87 M15.52 10.86 L18.66 9.84 M20.95 11.84 L20.75 14.84 L19.15 17.39 M14.17 14.99 L16.11 17.66 M14.91 20.46 L12.00 21.20 L9.09 20.46 M9.83 14.99 L7.89 17.66 M4.85 17.39 L3.25 14.84 L3.05 11.84 M8.48 10.86 L5.34 9.84 M4.67 6.87 L6.59 4.56 L9.38 3.44" [attr.stroke]="dark()" stroke-width=".8" stroke-linecap="round" stroke-linejoin="round" fill="none" />
      </g>
      @if (own()) { <circle cx="12" cy="12" r="10.6" [attr.fill]="'url(#bg' + id + ')'" /> }
      <circle cx="12" cy="12" r="10.6" fill="none" [attr.stroke]="dark()" stroke-width="1.2" />
    </svg>
  `,
  styles: `:host { display: inline-grid; flex: none; } svg { display: block; }`,
})
export class Ball {
  readonly own = input(false);
  readonly size = input(16);
  protected readonly id = ++uid;
  protected dark(): string {
    return this.own() ? '#7a1610' : '#1d2b22';
  }
}

/** Scarpino da calcio (con tacchetti e la striscia verde dell'app): un assist. Prende il colore del testo. */
@Component({
  selector: 'app-boot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24">
      <path d="M2.6 15.2c0-2.9 1.6-5.4 4.4-6.3l3.9-1.1c1.3-.4 2.4.3 3 1.4.9 1.7 2.9 2.9 5.6 3.4 1.6.3 2.4 1.3 2.4 2.5v.8c0 .8-.7 1.5-1.5 1.5H4.1c-.8 0-1.5-.6-1.5-1.4z" fill="currentColor" />
      <path d="M3.2 16.3h18.4" stroke="var(--surface, #fff)" stroke-width=".9" stroke-linecap="round" opacity=".55" />
      <path d="M6.2 13.4c3.6-1.6 7.8-1.5 12.6.3" stroke="#2fa36b" stroke-width="1.5" stroke-linecap="round" fill="none" />
      <path d="M8.6 9.4l1.1 1.7M10.4 8.9l1.1 1.7M12.2 8.5l1 1.6" stroke="var(--surface, #fff)" stroke-width=".9" stroke-linecap="round" />
      <g fill="currentColor"><rect x="4.2" y="17.4" width="2" height="2.1" rx=".7" /><rect x="7.6" y="17.4" width="2" height="2.1" rx=".7" /><rect x="14.4" y="17.4" width="2" height="2.1" rx=".7" /><rect x="18.4" y="17.4" width="2" height="2.1" rx=".7" /></g>
    </svg>
  `,
  styles: `:host { display: inline-grid; flex: none; color: var(--ink); } svg { display: block; }`,
})
export class Boot {
  readonly size = input(16);
}

/** Maglia piena del colore della squadra (con il bordo, così si vede anche la bianca su fondo bianco). */
@Component({
  selector: 'app-kit-shirt',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `
    <svg [attr.width]="tight() ? size() * 21.8 / 19.4 : size()" [attr.height]="size()" [attr.viewBox]="tight() ? '1.1 2.3 21.8 19.4' : '0 0 24 24'">
      <path d="M8.2 2.8L3.6 5.2 1.6 10l3.6 1.5V21.2h13.6V11.5L22.4 10l-2-4.8-4.6-2.4c-.6 1.5-2 2.4-3.8 2.4S8.8 4.3 8.2 2.8z"
            [attr.fill]="color()" stroke="rgb(0 0 0 / 35%)" stroke-width="1" stroke-linejoin="round" />
      <path d="M8.2 2.8c.6 1.5 2 2.4 3.8 2.4s3.2-.9 3.8-2.4" [attr.stroke]="ink()" stroke-width="1.2" fill="none" opacity="0.7" />
    </svg>
  `,
  styles: `:host { display: inline-grid; flex: none; filter: drop-shadow(0 3px 6px rgb(0 0 0 / 18%)); } svg { display: block; }`,
})
export class KitShirt {
  readonly color = input('#ffffff');
  readonly ink = input('#1d2b22');
  readonly size = input(44);
  /** riquadro stretto attorno al disegno: «size» diventa l'altezza della maglia */
  readonly tight = input(false);
}
