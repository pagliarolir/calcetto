import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Scheletri di caricamento: la stessa forma del contenuto che arriverà, così la pagina non «salta».
 * kind: 'match' (contenuto della partita), 'table' (classifica), 'player' (scheda giocatore), 'lines' (righe).
 */
@Component({
  selector: 'app-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-busy': 'true', 'aria-label': 'Caricamento', role: 'status' },
  template: `
    @switch (kind()) {
      @case ('match') {
        <div class="sk line w60 h24"></div>
        <div class="row3"><div class="sk h56"></div><div class="sk h56"></div><div class="sk h56"></div></div>
        <div class="sk line w80"></div>
        <div class="sk h48"></div>
        <div class="grid2">@for (i of n(8); track i) { <div class="sk h56"></div> }</div>
      }
      @case ('table') {
        <div class="tbl">
          <div class="sk line w40 h20"></div>
          @for (i of n(rows()); track i) { <div class="trow"><div class="sk dot"></div><div class="sk line w50"></div><div class="sk line w30 right"></div></div> }
        </div>
      }
      @case ('player') {
        <div class="grid3">@for (i of n(9); track i) { <div class="sk h64"></div> }</div>
        <div class="sk line w40 h24"></div>
        @for (i of n(4); track i) { <div class="sk h56"></div> }
      }
      @default {
        @for (i of n(rows()); track i) { <div class="sk h56"></div> }
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 12px; }
    .sk { border-radius: 12px; background: linear-gradient(90deg, var(--surface-2) 25%, var(--line) 40%, var(--surface-2) 55%);
          background-size: 300% 100%; animation: sk 1.3s ease-in-out infinite; }
    .line { height: 14px; border-radius: 7px; }
    .h20 { height: 20px; } .h24 { height: 24px; } .h48 { height: 48px; } .h56 { height: 56px; } .h64 { height: 64px; }
    .w30 { width: 30%; } .w40 { width: 40%; } .w50 { width: 50%; } .w60 { width: 60%; } .w80 { width: 80%; }
    .right { margin-left: auto; }
    .row3 { display: grid; grid-template-columns: 1.3fr 1fr 1fr; gap: 8px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .tbl { display: flex; flex-direction: column; gap: 14px; padding: 12px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
    .trow { display: flex; align-items: center; gap: 10px; }
    .dot { width: 22px; height: 22px; border-radius: 50%; flex: none; }
    @keyframes sk { from { background-position: 100% 0; } to { background-position: 0 0; } }
    @media (prefers-reduced-motion: reduce) { .sk { animation: none; } }
  `,
})
export class Skeleton {
  readonly kind = input<'match' | 'table' | 'player' | 'lines'>('lines');
  readonly rows = input(8);
  protected n(k: number): number[] {
    return Array.from({ length: k }, (_, i) => i);
  }
}
