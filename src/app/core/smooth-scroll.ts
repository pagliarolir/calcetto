import { Injectable } from '@angular/core';
import Lenis from 'lenis';
import { motionOk } from './motion';

/**
 * Scorrimento morbido con Lenis (scelta del proprietario, vedi CLAUDE.md), montato sul riquadro che scorre
 * (`.app-scroller`, o la `.scroll-area` delle pagine con la parte alta fissa), mai sulla finestra.
 *
 * Solo con mouse o trackpad (`pointer: fine`): sul telefono lo scorrimento col dito resta quello nativo, che su iPhone
 * è già il migliore (con l'inerzia giusta e il «trascina per aggiornare»), e così non gira un ciclo di animazione
 * continuo che consuma batteria. Spento con «riduci movimento». I fogli `<dialog>`, i campi di testo e ciò che ha
 * `data-lenis-prevent` scorrono da soli.
 */
/** istanza attiva e riquadro su cui sta: scrollAppTo (core/scroller.ts) la usa per scorrere con la stessa curva */
let active: { lenis: Lenis; el: HTMLElement } | null = null;
export function lenisFor(el: HTMLElement): Lenis | null {
  return active && active.el === el ? active.lenis : null;
}

@Injectable({ providedIn: 'root' })
export class SmoothScroll {
  private lenis: Lenis | null = null;
  private target: HTMLElement | null = null;
  private queued = false;

  start(): void {
    if (typeof matchMedia !== 'function' || !matchMedia('(pointer: fine)').matches || !motionOk()) return;
    const shell = document.querySelector<HTMLElement>('.app-scroller');
    if (!shell) return;
    // le pagine cambiano dentro il riquadro: si segue sempre quello che scorre davvero
    new MutationObserver(() => this.queue()).observe(shell, { childList: true, subtree: true });
    this.queue();
  }

  private queue(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => { this.queued = false; this.attach(); });
  }

  private attach(): void {
    const el = document.querySelector<HTMLElement>('.app-scroller .scroll-area') ?? document.querySelector<HTMLElement>('.app-scroller');
    if (!el || el === this.target) return;
    this.lenis?.destroy();
    this.target = el;
    this.lenis = new Lenis({
      wrapper: el,
      content: (el.firstElementChild as HTMLElement | null) ?? el,
      autoRaf: true,
      lerp: 0.12,
      smoothWheel: true,
      syncTouch: false,
      prevent: (node: HTMLElement) => !!node.closest?.('dialog, textarea, select, [data-lenis-prevent]'),
    });
    active = { lenis: this.lenis, el };
  }
}
