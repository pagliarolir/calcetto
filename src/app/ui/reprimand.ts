import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, Injectable, signal, untracked, viewChild } from '@angular/core';
import { PayCards } from '../core/pay-cards';
import { fmtWhen } from '../core/format';
import { Session } from '../core/session';

export const PUNISHMENT_MESSAGE = 'Sei in punizione per ordine del Leader, rifletti sui tuoi errori';
/** il rosso dei Conti (migrazione 68): si può solo saldare, poi si torna attivi da soli */
export const PAY_PUNISHMENT_MESSAGE = 'Sei in punizione per la quota del campo: puoi solo saldare in Conti, poi torni attivo da solo';

/** Rimprovero mostrato a chi è in punizione quando prova a intervenire. */
@Injectable({ providedIn: 'root' })
export class Reprimand {
  private readonly session = inject(Session);
  readonly visible = signal(false);
  /** cambia a ogni tentativo: fa ripartire lo scossone anche se il rimprovero è già aperto */
  readonly attempt = signal(0);
  /** cartellino giallo dei Pagamenti (migrazione 64): stessa schermata, in giallo, come ammonizione senza blocchi */
  readonly yellow = signal<number | null>(null);

  showYellow(cardId: number): void {
    this.yellow.set(cardId);
    this.visible.set(true);
    this.attempt.update((n) => n + 1);
    navigator.vibrate?.([70, 50, 70]);
  }

  show(): void {
    this.yellow.set(null);
    // bloccato dal server senza che l'app sapesse della punizione: si leggono durata e motivo
    if (!this.session.punishment()) void this.session.refreshPunishment();
    this.visible.set(true);
    this.attempt.update((n) => n + 1);
    navigator.vibrate?.([70, 50, 70]);
  }

  hide(): void {
    this.visible.set(false);
  }

  /** chiusura del giallo: il cartellino è stato visto */
  readonly yellowSeen = signal<number | null>(null);
  close(): void {
    const y = this.yellow();
    this.hide();
    if (y !== null) { this.yellowSeen.set(y); this.yellow.set(null); }
  }

  /** Da chiamare all'inizio di ogni azione: true (e rimprovero) se l'utente è in punizione. */
  guard(): boolean {
    if (!this.session.punishment()) return false;
    this.show();
    return true;
  }
}

@Component({
  selector: 'app-reprimand',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'reprimand.close()' },
  template: `
    @if (reprimand.visible()) {
      <div class="backdrop enter-fade" (click)="reprimand.close()"></div>
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="rep-msg" aria-describedby="rep-sub">
        @for (k of [reprimand.attempt()]; track k) {
          @if (reprimand.yellow() !== null) {
            <!-- cartellino giallo: stessa schermata e stessa animazione, ma è solo un'ammonizione -->
            <div class="sheet yellow">
              <div class="red-card" aria-hidden="true"></div>
              <p id="rep-msg" class="msg">Sei ammonito: la quota del campo non è stata pagata in tempo</p>
              <p id="rep-sub" class="sub">Salda in Conti: se alla prossima partita hai ancora un debito, è cartellino rosso.</p>
              <button #ok class="ok" (click)="reprimand.close()">Ho capito</button>
            </div>
          } @else {
            <div class="sheet">
              <div class="red-card" aria-hidden="true"></div>
              <p id="rep-msg" class="msg">{{ payRed() ? payMessage : leaderMessage }}</p>
              <p id="rep-sub" class="sub">
                {{ until() }}
                @if (reason(); as r) { <br />Motivo: {{ r }} }
              </p>
              <button #ok class="ok" (click)="reprimand.close()">Ho capito</button>
            </div>
          }
        }
      </div>
    }
  `,
  styles: `
    .backdrop { position: absolute; inset: 0; z-index: 80; background: rgb(20 4 4 / 62%); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
    .dialog { position: absolute; inset: 0; z-index: 81; display: grid; place-items: center; padding: 24px; pointer-events: none; }
    .sheet {
      pointer-events: auto; position: relative; width: min(100%, 360px);
      padding: 76px 24px 24px; border-radius: 18px; text-align: center;
      background: var(--surface); border: 3px solid var(--danger);
      box-shadow: 0 0 0 6px color-mix(in srgb, var(--danger) 18%, transparent), 0 24px 60px rgb(0 0 0 / 45%);
      animation: scold 520ms cubic-bezier(.36,.07,.19,.97) both;
    }
    /* il cartellino rosso alzato dall'arbitro */
    .red-card {
      position: absolute; left: 50%; top: -58px; width: 78px; height: 108px; margin-left: -40px;
      border-radius: 9px; background: linear-gradient(160deg, #ff4b4b, #c41d1d 70%);
      box-shadow: 0 12px 24px rgb(0 0 0 / 35%), inset 0 0 0 2px rgb(255 255 255 / 25%);
      transform: rotate(-9deg); animation: raise 480ms var(--ease-spring) both;
    }
    .msg {
      margin: 0; color: var(--danger);
      font: 700 1.85rem/1.08 var(--font-display); letter-spacing: 0.005em; text-wrap: balance;
    }
    .sub { margin: 16px 0 0; color: var(--muted); font-size: var(--step--1); }
    .ok {
      margin-top: 20px; min-height: 46px; padding: 0 24px; border-radius: 999px; cursor: pointer;
      background: var(--danger); color: var(--danger-ink); border: 0; font: 600 var(--step-0)/1 var(--font-body);
    }
    /* giallo: colori dell'arbitro per il cartellino, bordo e pulsante con la fascia ambra del tema, testo in --ink */
    .sheet.yellow { border-color: var(--armband); box-shadow: 0 0 0 6px color-mix(in srgb, var(--armband) 22%, transparent), 0 24px 60px rgb(0 0 0 / 45%); }
    .sheet.yellow .red-card { background: linear-gradient(160deg, #ffe45c, #f2c200 70%); }
    .sheet.yellow .msg { color: var(--ink); }
    .sheet.yellow .ok { background: var(--armband); color: var(--armband-ink); }
    @keyframes raise { from { transform: translateY(40px) rotate(-24deg); opacity: 0; } to { transform: rotate(-9deg); opacity: 1; } }
    @keyframes scold {
      0% { transform: scale(0.9); opacity: 0; }
      30% { transform: scale(1.02) translateX(0); opacity: 1; }
      45% { transform: translateX(-10px); } 60% { transform: translateX(9px); }
      75% { transform: translateX(-6px); } 90% { transform: translateX(3px); } 100% { transform: none; }
    }
  `,
})
export class ReprimandView {
  protected readonly reprimand = inject(Reprimand);
  private readonly session = inject(Session);
  private readonly ok = viewChild<ElementRef<HTMLButtonElement>>('ok');

  protected readonly until = computed(() => {
    const p = this.session.punishment();
    if (!p) return '';
    // il rosso dei Pagamenti finisce da solo con il saldo confermato (migrazione 64)
    if (!p.ends_at && p.reason?.startsWith('Quota del campo')) return 'Finisce appena chi riceve conferma il tuo pagamento.';
    return p.ends_at ? `Fino a ${fmtWhen(p.ends_at)}.` : 'Fino a nuovo ordine del Leader.';
  });
  protected readonly reason = computed(() => (this.payRed() ? null : this.session.punishment()?.reason ?? null));
  /** rosso dei Conti: niente «per ordine del Leader», si spiega che basta saldare */
  protected readonly payRed = computed(() => { const p = this.session.punishment(); return !!p && !p.ends_at && !!p.reason?.startsWith('Quota del campo'); });
  protected readonly payMessage = PAY_PUNISHMENT_MESSAGE;
  protected readonly leaderMessage = PUNISHMENT_MESSAGE;

  private readonly cards = inject(PayCards);

  constructor() {
    // il pulsante prende il fuoco a ogni apertura (tastiera e lettori di schermo)
    effect(() => this.ok()?.nativeElement.focus());
    // cartellino giallo non ancora visto: all'apertura dell'app la schermata dell'ammonizione (una volta)
    effect(() => {
      const y = this.cards.mine().find((c) => c.color === 'yellow' && !c.seen);
      untracked(() => { if (y && !this.reprimand.visible()) this.reprimand.showYellow(y.id); });
    });
    effect(() => {
      const id = this.reprimand.yellowSeen();
      if (id !== null) untracked(() => void this.cards.seen(id));
    });
  }
}
