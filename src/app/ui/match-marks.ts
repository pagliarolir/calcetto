import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Pallone: bianco per un gol, rosso per un autogol. */
@Component({
  selector: 'app-ball',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10.5" [attr.fill]="own() ? '#d6362b' : '#ffffff'" [attr.stroke]="own() ? '#7a1610' : '#1d2b22'" stroke-width="1.6" />
      <path d="M12 7.2l3.4 2.5-1.3 4h-4.2l-1.3-4z" [attr.fill]="own() ? '#7a1610' : '#1d2b22'" />
      <path d="M12 7.2V2.2M15.4 9.7l4.6-1.6M14.1 13.7l2.9 4.1M9.9 13.7l-2.9 4.1M8.6 9.7L4 8.1" [attr.stroke]="own() ? '#7a1610' : '#1d2b22'" stroke-width="1.3" fill="none" />
    </svg>
  `,
  styles: `:host { display: inline-grid; flex: none; } svg { display: block; }`,
})
export class Ball {
  readonly own = input(false);
  readonly size = input(16);
}

/** Scarpino: un assist. */
@Component({
  selector: 'app-boot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24">
      <path d="M3 6.5h6.2l1 3.1c2.8.9 6.4 1.6 9 2.1 1.4.3 2.3 1.3 2.3 2.6v1.4H3z" fill="currentColor" />
      <path d="M5 18.2h2.2M10 18.2h2.2M15.2 18.2h2.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
      <path d="M9.2 9.6l1.6-.9M11.4 10.4l1.6-.9" stroke="var(--surface, #fff)" stroke-width="1.1" stroke-linecap="round" />
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
