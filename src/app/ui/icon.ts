import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Icone a tratto, disegnate per l'app. */
const PATHS: Record<string, string> = {
  pitch: 'M3 5h18v14H3z M12 5v14 M12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0 M3 9h3v6H3 M21 9h-3v6h3',
  table: 'M4 5h16 M4 10h16 M4 15h16 M4 20h16 M9 5v15',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z M10 20a2 2 0 0 0 4 0',
  user: 'M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8z M4 21c1-4 4.5-6 8-6s7 2 8 6',
  whistle: 'M3 11a5 5 0 1 0 10 0V9h8V6H8a5 5 0 0 0-5 5z M8 11h.01',
  back: 'M15 5l-7 7l7 7',
  chevron: 'M9 5l7 7l-7 7',
  send: 'M4 12l16-8l-6 16l-3-7z',
  check: 'M5 12l5 5l9-10',
  x: 'M6 6l12 12 M18 6L6 18',
  plus: 'M12 5v14 M5 12h14',
  calendar: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4',
  list: 'M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01',
  shirt: 'M8 3l-5 3l2 4l3-1v12h8V9l3 1l2-4l-5-3a4 4 0 0 1-8 0z',
  score: 'M4 5h16v14H4z M12 5v14 M8 10v4 M15 10h2v4h-2',
  star: 'M12 3l2.7 5.6l6.1.9l-4.4 4.3l1 6.1L12 17l-5.4 2.9l1-6.1L3.2 9.5l6.1-.9z',
  chat: 'M4 5h16v11H9l-5 4z',
  clock: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0 -16 0 M12 8v4l3 2',
  logout: 'M15 4h4v16h-4 M10 8l-4 4l4 4 M6 12h10',
  trash: 'M5 7h14 M10 7V4h4v3 M7 7l1 13h8l1-13',
  share: 'M12 3v12 M7 8l5-5l5 5 M5 14v6h14v-6',
  trophy: 'M8 21h8 M12 17v4 M7 4h10v5a5 5 0 0 1-10 0V4z M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5 M7 6H4v1.5A3.5 3.5 0 0 0 7.5 11',
  info: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18z M12 11v5.5 M12 7.6v.1',
  key: 'M8 15m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0 M11 12l9-9 M17 6l3 3 M15 8l2 2',
  pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z M12 9.5m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z M9 4v14 M15 6v14',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3 M5 11h14v10H5z M12 15v2',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4z M12 16.5a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7z',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
};

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path [attr.d]="d()" />
    </svg>
  `,
  styles: [':host{display:inline-flex;flex:none}'],
})
export class Icon {
  readonly name = input.required<string>();
  readonly size = input(22);
  protected readonly d = computed(() => PATHS[this.name()] ?? '');
}
