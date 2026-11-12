import { DestroyRef, Directive, ElementRef, inject, output } from '@angular/core';
import { haptic } from '../core/haptics';

/**
 * Scorrimento di lato tra le schede (punto 4 dell'analisi UX), sull'area che scorre di una pagina con schede.
 * Il contenuto non segue il dito (niente transform sul cambio pagina, vedi CLAUDE.md): superata la soglia
 * si emette `swipe` (+1 scheda dopo, -1 scheda prima) e il nuovo contenuto compare con una breve dissolvenza.
 * Non parte vicino ai bordi (gesto «Indietro» del telefono), dal campo in cui si sta scrivendo, da aree di testo,
 * cursori, finestre, elementi che scorrono di lato o marcati `data-no-swipe`.
 */
@Directive({ selector: '[appSwipeTabs]' })
export class SwipeTabs {
  readonly swipe = output<1 | -1>();
  private readonly el: HTMLElement = inject(ElementRef<HTMLElement>).nativeElement;
  private start: { x: number; y: number; t: number } | null = null;

  constructor() {
    const onStart = (e: TouchEvent) => this.touchStart(e);
    const onMove = (e: TouchEvent) => this.touchMove(e);
    const onEnd = (e: TouchEvent) => this.touchEnd(e);
    const onCancel = () => (this.start = null);
    this.el.addEventListener('touchstart', onStart, { passive: true });
    this.el.addEventListener('touchmove', onMove, { passive: true });
    this.el.addEventListener('touchend', onEnd, { passive: true });
    this.el.addEventListener('touchcancel', onCancel, { passive: true });
    inject(DestroyRef).onDestroy(() => {
      this.el.removeEventListener('touchstart', onStart);
      this.el.removeEventListener('touchmove', onMove);
      this.el.removeEventListener('touchend', onEnd);
      this.el.removeEventListener('touchcancel', onCancel);
    });
  }

  private touchStart(e: TouchEvent): void {
    this.start = null;
    if (e.touches.length !== 1) return;
    const p = e.touches[0];
    if (p.clientX < 24 || p.clientX > innerWidth - 24) return;
    const t = e.target as Element | null;
    if (t?.closest('textarea, input[type=range], app-vote-slider, dialog, [data-no-swipe]')) return;
    // il campo in cui si sta scrivendo usa il dito per il cursore
    if (t && document.activeElement !== document.body && document.activeElement?.contains(t)) return;
    for (let n = t; n && n !== this.el; n = n.parentElement) {
      const ox = getComputedStyle(n).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth + 1) return;
    }
    this.start = { x: p.clientX, y: p.clientY, t: e.timeStamp };
  }

  private touchMove(e: TouchEvent): void {
    const s = this.start;
    if (!s) return;
    const p = e.touches[0];
    const dx = p.clientX - s.x, dy = p.clientY - s.y;
    if (Math.abs(dy) > 30 && Math.abs(dy) > Math.abs(dx)) this.start = null;   // sta scorrendo in verticale
  }

  private touchEnd(e: TouchEvent): void {
    const s = this.start;
    this.start = null;
    if (!s) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - s.x, dy = p.clientY - s.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < 2 * Math.abs(dy) || e.timeStamp - s.t > 700) return;
    haptic();
    this.el.classList.remove('swiped');
    void this.el.offsetWidth;   // fa ripartire la dissolvenza
    this.el.classList.add('swiped');
    setTimeout(() => this.el.classList.remove('swiped'), 300);
    this.swipe.emit(dx < 0 ? 1 : -1);
  }
}
