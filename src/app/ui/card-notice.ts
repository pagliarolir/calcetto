import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { PayCards } from '../core/pay-cards';

/**
 * Avviso del cartellino (giallo o rosso) all'apertura dell'app, una volta per cartellino: come la schermata della
 * punizione, ma per il giallo è solo un'ammonizione (nessun blocco). Porta ai Conti per saldare.
 */
@Component({
  selector: 'app-card-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (card(); as c) {
      <div class="backdrop enter-fade" (click)="ok()"></div>
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="card-msg" aria-describedby="card-sub">
        <div class="sheet" [class.red]="c.color === 'red'">
          <div class="card-shape" [class.red]="c.color === 'red'" aria-hidden="true"></div>
          @if (c.color === 'yellow') {
            <p id="card-msg" class="msg">Cartellino giallo</p>
            <p id="card-sub" class="sub">La quota del campo non è stata pagata entro le 12 del giorno dopo la partita.<br />Salda in Conti: se alla prossima partita hai ancora un debito, è rosso.</p>
          } @else {
            <p id="card-msg" class="msg">Cartellino rosso</p>
            <p id="card-sub" class="sub">Hai ancora un debito del campo: sei in punizione finché non saldi e chi riceve conferma.<br />I Conti restano sempre aperti per pagare.</p>
          }
          <div class="acts">
            <button class="btn" (click)="ok()">Ho capito</button>
            <button class="btn primary" (click)="ok(true)">Vai ai Conti</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .backdrop { position: fixed; inset: 0; z-index: 90; background: rgb(0 0 0 / 55%); }
    .dialog { position: fixed; inset: 0; z-index: 91; display: grid; place-items: center; padding: 20px; pointer-events: none; }
    .sheet { pointer-events: auto; width: min(420px, 100%); padding: 24px 20px 20px; border-radius: 22px; text-align: center;
      background: var(--surface); color: var(--ink); box-shadow: 0 20px 50px rgb(0 0 0 / 35%); display: flex; flex-direction: column; align-items: center; gap: 10px; }
    /* il cartellino: colori fissi, come quelli veri (giallo e rosso dell'arbitro) */
    .card-shape { width: 58px; height: 82px; border-radius: 6px; background: #ffd400; box-shadow: 0 6px 16px rgb(0 0 0 / 30%), inset 0 0 0 2px rgb(0 0 0 / 12%); }
    .card-shape.red { background: #e3262f; }
    .msg { margin: 6px 0 0; font: 800 var(--step-2)/1.15 var(--font-display, var(--font-body)); }
    .sub { margin: 0; color: var(--muted); line-height: 1.45; }
    .acts { display: flex; gap: 10px; width: 100%; margin-top: 8px; }
    .acts .btn { flex: 1; min-height: 48px; }
    @media (prefers-reduced-motion: no-preference) {
      .card-shape { animation: card-up 520ms cubic-bezier(0.2, 0.9, 0.25, 1.2) both; }
      @keyframes card-up { from { opacity: 0; transform: translateY(18px) scale(0.85); } to { opacity: 1; transform: none; } }
    }
  `,
})
export class CardNotice {
  private readonly cards = inject(PayCards);
  private readonly router = inject(Router);
  /** il cartellino non ancora visto (prima il rosso) */
  protected readonly card = computed(() => {
    const l = this.cards.mine().filter((c) => !c.seen);
    return l.find((c) => c.color === 'red') ?? l[0] ?? null;
  });

  protected ok(go = false): void {
    const c = this.card();
    if (c) void this.cards.seen(c.id);
    // il rosso nasconde anche il giallo che l'ha preceduto
    if (c?.color === 'red') for (const y of this.cards.mine().filter((x) => !x.seen)) void this.cards.seen(y.id);
    if (go) void this.router.navigateByUrl('/pagamenti');
  }
}
