import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Scheletri di caricamento: la stessa forma del contenuto che arriverà, così la pagina non «salta».
 * kind: 'match' (contenuto della partita), 'table' (classifica), 'player' (scheda giocatore), 'chat' (fumetti della chat),
 * 'votes' (pagelle: selettore e righe con il voto), 'lines' (righe).
 */
@Component({
  selector: 'app-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-busy': 'true', 'aria-label': 'Caricamento', role: 'status' },
  template: `
    @switch (kind()) {
      @case ('match') {
        <!-- come la scheda Lista: titolo con «i» e pillola, tre pulsanti, schede, griglia di card -->
        <div class="hrow"><div class="sk line w45 h24"></div><div class="sk circ"></div><div class="sk spill"></div></div>
        <div class="row3"><div class="sk h56"></div><div class="sk h56"></div><div class="sk h56"></div></div>
        <div class="tabs3"><div class="sk line t"></div><div class="sk line t"></div><div class="sk line t"></div></div>
        <div class="grid2">@for (i of n(10); track i) { <div class="sk h60"></div> }</div>
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
      @case ('chat') {
        <!-- fumetti alternati: quelli degli altri con la foto a sinistra, i propri a destra -->
        @for (i of n(5); track i) {
          @if (i % 3 === 2) { <div class="bub mine"><div class="sk b" [style.width.%]="44 + (i * 7) % 20"></div></div> }
          @else { <div class="bub"><div class="sk av"></div><div class="sk b" [style.width.%]="40 + (i * 11) % 26"></div></div> }
        }
      }
      @case ('votes') {
        <div class="sk h44 seg"></div>
        @for (i of n(rows()); track i) { <div class="vrow"><div class="sk av"></div><div class="sk line w40"></div><div class="sk pill right"></div></div> }
      }
      @default {
        @for (i of n(rows()); track i) { <div class="sk h56"></div> }
      }
    }
  `,
  styles: `
    .hrow { display: flex; align-items: center; gap: 8px; }
    .hrow .w45 { width: 45%; } .circ { width: 24px; height: 24px; border-radius: 50%; flex: none; }
    .spill { margin-left: auto; width: 128px; height: 28px; border-radius: 14px; flex: none; }
    .tabs3 { display: flex; justify-content: space-around; align-items: center; height: 44px; border-bottom: 1px solid var(--line); }
    .tabs3 .t { width: 22%; }
    .h60 { height: 60px; border-radius: 16px; }
    :host { display: flex; flex-direction: column; gap: 12px; }
    /* il riflesso è una sfumatura della superficie verso il testo: in Figurina e Alto contrasto --line è il colore del testo */
    .sk { border-radius: 12px; background: linear-gradient(90deg, var(--surface-2) 25%, color-mix(in srgb, var(--surface-2) 90%, var(--ink)) 40%, var(--surface-2) 55%);
          background-size: 300% 100%; animation: sk 1.3s ease-in-out infinite; }
    .line { height: 14px; border-radius: 7px; }
    .h20 { height: 20px; } .h24 { height: 24px; } .h48 { height: 48px; } .h56 { height: 56px; } .h64 { height: 64px; }
    .w30 { width: 30%; } .w40 { width: 40%; } .w50 { width: 50%; } .w60 { width: 60%; } .w80 { width: 80%; }
    .right { margin-left: auto; }
    .row3 { display: grid; grid-template-columns: 1.3fr 1fr 1fr; gap: 8px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .tbl { display: flex; flex-direction: column; gap: 16px; padding: 12px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
    .trow { display: flex; align-items: center; gap: 12px; }
    .dot { width: 22px; height: 22px; border-radius: 50%; flex: none; }
    .bub { display: flex; align-items: flex-end; gap: 8px; } .bub.mine { justify-content: flex-end; }
    .av { width: 30px; height: 30px; border-radius: 50%; flex: none; }
    .b { height: 40px; border-radius: 16px; }
    .h44 { height: 44px; } .seg { border-radius: 14px; }
    .vrow { display: flex; align-items: center; gap: 12px; min-height: 48px; }
    .pill { width: 48px; height: 28px; border-radius: 14px; flex: none; }
    @keyframes sk { from { background-position: 100% 0; } to { background-position: 0 0; } }
    @media (prefers-reduced-motion: reduce) { .sk { animation: none; } }
  `,
})
export class Skeleton {
  readonly kind = input<'match' | 'table' | 'player' | 'chat' | 'votes' | 'lines'>('lines');
  readonly rows = input(8);
  protected n(k: number): number[] {
    return Array.from({ length: k }, (_, i) => i);
  }
}
