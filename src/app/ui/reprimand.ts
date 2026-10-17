import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, Injectable, signal, viewChild } from '@angular/core';
import { fmtWhen } from '../core/format';
import { Session } from '../core/session';

export const PUNISHMENT_MESSAGE = 'Sei in punizione per ordine del Leader, rifletti sui tuoi errori';

/** Rimprovero mostrato a chi è in punizione quando prova a intervenire. */
@Injectable({ providedIn: 'root' })
export class Reprimand {
  private readonly session = inject(Session);
  readonly visible = signal(false);
  /** cambia a ogni tentativo: fa ripartire lo scossone anche se il rimprovero è già aperto */
  readonly attempt = signal(0);

  show(): void {
    // bloccato dal server senza che l'app sapesse della punizione: si leggono durata e motivo
    if (!this.session.punishment()) void this.session.refreshPunishment();
    this.visible.set(true);
    this.attempt.update((n) => n + 1);
    navigator.vibrate?.([70, 50, 70]);
  }

  hide(): void {
    this.visible.set(false);
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
  host: { '(document:keydown.escape)': 'reprimand.hide()' },
  template: `
    @if (reprimand.visible()) {
      <div class="backdrop enter-fade" (click)="reprimand.hide()"></div>
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="rep-msg" aria-describedby="rep-sub">
        @for (k of [reprimand.attempt()]; track k) {
          <div class="sheet">
            <div class="red-card" aria-hidden="true"></div>
            <p id="rep-msg" class="msg">Sei in punizione per ordine del Leader, rifletti sui tuoi errori</p>
            <p id="rep-sub" class="sub">
              {{ until() }}
              @if (reason(); as r) { <br />Motivo: {{ r }} }
            </p>
            <button #ok class="ok" (click)="reprimand.hide()">Ho capito</button>
          </div>
        }
      </div>
    }
  `,
  styles: `
    .backdrop { position: absolute; inset: 0; z-index: 80; background: rgb(20 4 4 / 62%); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
    .dialog { position: absolute; inset: 0; z-index: 81; display: grid; place-items: center; padding: 24px; pointer-events: none; }
    .sheet {
      pointer-events: auto; position: relative; width: min(100%, 360px);
      padding: 76px 24px 22px; border-radius: 18px; text-align: center;
      background: var(--surface); border: 3px solid #c92a2a;
      box-shadow: 0 0 0 6px rgb(201 42 42 / 18%), 0 24px 60px rgb(0 0 0 / 45%);
      animation: scold 520ms cubic-bezier(.36,.07,.19,.97) both;
    }
    /* il cartellino rosso alzato dall'arbitro */
    .red-card {
      position: absolute; left: 50%; top: -58px; width: 78px; height: 108px; margin-left: -39px;
      border-radius: 9px; background: linear-gradient(160deg, #ff4b4b, #c41d1d 70%);
      box-shadow: 0 12px 24px rgb(0 0 0 / 35%), inset 0 0 0 2px rgb(255 255 255 / 25%);
      transform: rotate(-9deg); animation: raise 480ms var(--ease-spring) both;
    }
    .msg {
      margin: 0; color: #c92a2a;
      font: 700 1.85rem/1.08 var(--font-display); letter-spacing: 0.005em; text-wrap: balance;
    }
    .sub { margin: 14px 0 0; color: var(--muted); font-size: var(--step--1); }
    .ok {
      margin-top: 18px; min-height: 46px; padding: 0 22px; border-radius: 999px; cursor: pointer;
      background: #c92a2a; color: #fff; border: 0; font: 600 var(--step-0)/1 var(--font-body);
    }
    @media (prefers-color-scheme: dark) {
      .msg { color: #ff6b6b; }
      .sheet { border-color: #ff6b6b; box-shadow: 0 0 0 6px rgb(255 107 107 / 16%), 0 24px 60px rgb(0 0 0 / 60%); }
    }
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
    return p.ends_at ? `Fino a ${fmtWhen(p.ends_at)}.` : 'Fino a nuovo ordine del Leader.';
  });
  protected readonly reason = computed(() => this.session.punishment()?.reason ?? null);

  constructor() {
    // il pulsante prende il fuoco a ogni apertura (tastiera e lettori di schermo)
    effect(() => this.ok()?.nativeElement.focus());
  }
}
