import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, inject, Injector, input, OnDestroy, signal, viewChild } from '@angular/core';
import { Icon } from './icon';

const W = 300;   // larghezza massima della finestrella
const GAP = 10;  // distanza dalla «i» (spazio per la punta)
const EDGE = 8;  // margine dai bordi dello schermo

/**
 * Pulsante «i» con una finestrella di spiegazioni (come accanto a «Sei titolare»): una frase per riga,
 * al posto dei sottotitoli fissi. Funziona anche dentro un <summary> senza aprire o chiudere la tendina.
 * La finestrella sta nel livello più alto della pagina (popover): niente può coprirla, nemmeno il
 * riquadro successivo. Si apre sotto la «i» (sopra, se sotto non c'è spazio) con una punta che la indica.
 * Si chiude toccando fuori, con Esc o scorrendo.
 */
@Component({
  selector: 'app-info-tip',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button #btn type="button" class="info-i" [attr.aria-label]="label()" [attr.aria-expanded]="open()" (click)="toggle($event)">
      <app-icon name="info" [size]="size()" />
    </button>
    @if (open()) {
      <div #layer class="tip-layer" popover="manual" (click)="close($event)">
        <div #pop class="info-pop" role="note" [class.above]="pos().above" [style.left.px]="pos().left" [style.top.px]="pos().top"
             [style.width.px]="pos().width" (click)="$event.preventDefault(); $event.stopPropagation()">
          <i class="tip-caret" aria-hidden="true" [style.left.px]="pos().caret"></i>
          <ul>@for (l of lines(); track $index) { <li>{{ l }}</li> }</ul>
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: inline-flex; flex: none; vertical-align: middle; }
    .info-i { width: 32px; height: 32px; flex: none; border: 0; border-radius: 50%; background: none; color: var(--muted); display: grid; place-items: center; cursor: pointer; padding: 0; }
    /* area di tocco di 44 px */
    .info-i { position: relative; } .info-i::after { content: ''; position: absolute; inset: -6px; }
    .info-i[aria-expanded='true'] { color: var(--turf); background: var(--turf-soft); }
    /* livello trasparente a tutto schermo: tocco fuori = chiudi */
    .tip-layer { position: fixed; inset: 0; width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0;
                 background: transparent; overflow: visible; cursor: default; z-index: 1000; }
    .tip-layer::backdrop { background: transparent; }
    .info-pop { position: fixed; padding: 12px 14px; text-align: left; background: var(--surface); color: var(--ink);
                border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 12px 30px rgb(0 0 0 / 22%);
                font: 400 var(--step--1)/1.4 var(--font-body); text-transform: none; letter-spacing: normal; cursor: default; }
    .info-pop ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; }
    /* punta verso la «i» */
    .tip-caret { position: absolute; top: -7px; width: 12px; height: 12px; margin-left: -6px; background: var(--surface);
                 border-left: 1px solid var(--line); border-top: 1px solid var(--line); transform: rotate(45deg); border-top-left-radius: 3px; }
    .info-pop.above .tip-caret { top: auto; bottom: -7px; transform: rotate(225deg); }
    @media (prefers-reduced-motion: no-preference) {
      .info-pop { animation: tip-in 140ms var(--ease-out, ease-out); transform-origin: var(--o, 50% 0); }
      @keyframes tip-in { from { opacity: 0; transform: scale(0.96) translateY(-3px); } }
      .info-pop.above { animation-name: tip-in-up; }
      @keyframes tip-in-up { from { opacity: 0; transform: scale(0.96) translateY(3px); } }
    }
  `,
})
export class InfoTip implements OnDestroy {
  /** le frasi della spiegazione, una per riga */
  readonly lines = input.required<string[]>();
  readonly label = input('Spiegazione');
  readonly size = input(18);
  protected readonly open = signal(false);
  protected readonly pos = signal({ left: 0, top: 0, width: W, caret: 20, above: false });
  private readonly btn = viewChild.required<ElementRef<HTMLButtonElement>>('btn');
  private readonly layer = viewChild<ElementRef<HTMLElement>>('layer');
  private readonly pop = viewChild<ElementRef<HTMLElement>>('pop');
  private readonly injector = inject(Injector);
  private readonly onScroll = (): void => this.hide();
  private readonly onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') this.hide(); };

  protected toggle(e: Event): void {
    // dentro un <summary> il tocco non deve aprire o chiudere la tendina
    e.preventDefault();
    e.stopPropagation();
    if (this.open()) { this.hide(); return; }
    this.place(false);
    this.open.set(true);
    afterNextRender(() => {
      const layer = this.layer()?.nativeElement as (HTMLElement & { showPopover?: () => void }) | undefined;
      try { layer?.showPopover?.(); } catch { /* già aperto */ }
      // se sotto non c'è spazio, la finestrella va sopra la «i»
      const h = this.pop()?.nativeElement.offsetHeight ?? 0;
      const r = this.btn().nativeElement.getBoundingClientRect();
      if (r.bottom + GAP + h > window.innerHeight - EDGE && r.top - GAP - h > EDGE) this.place(true, h);
      addEventListener('scroll', this.onScroll, { capture: true, passive: true });
      addEventListener('resize', this.onScroll, { passive: true });
      addEventListener('keydown', this.onKey);
    }, { injector: this.injector });
  }

  /** posizione accanto alla «i»: centrata sulla «i», senza uscire dallo schermo; la punta resta sulla «i» */
  private place(above: boolean, h = 0): void {
    const r = this.btn().nativeElement.getBoundingClientRect();
    const width = Math.min(W, window.innerWidth - EDGE * 2);
    const cx = r.left + r.width / 2;
    const left = Math.max(EDGE, Math.min(cx - width / 2, window.innerWidth - width - EDGE));
    const top = above ? r.top - GAP - h : r.bottom + GAP;
    this.pos.set({ left, top, width, caret: Math.max(16, Math.min(cx - left, width - 16)), above });
  }

  protected close(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    this.hide();
  }

  private hide(): void {
    if (!this.open()) return;
    removeEventListener('scroll', this.onScroll, { capture: true });
    removeEventListener('resize', this.onScroll);
    removeEventListener('keydown', this.onKey);
    this.open.set(false);
    this.btn().nativeElement.focus({ preventScroll: true });
  }

  ngOnDestroy(): void {
    removeEventListener('scroll', this.onScroll, { capture: true });
    removeEventListener('resize', this.onScroll);
    removeEventListener('keydown', this.onKey);
  }
}
