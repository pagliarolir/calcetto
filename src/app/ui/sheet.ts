import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';

/** sotto questa velocità (px/ms) e sotto un terzo dell'altezza, il foglio lasciato torna su */
const FLICK = 0.6;

/**
 * Comportamento comune di tutti i fogli dal basso (`<dialog class="sheet">`):
 * - chiusura animata (scende invece di sparire) per X, Esc, tocco sul velo e `close()` chiamato dal codice;
 * - trascinamento in giù da qualsiasi punto quando il contenuto è all'inizio: oltre un terzo dell'altezza
 *   o con un colpo veloce si chiude, altrimenti torna su.
 * Lo stile è in `styles.scss` (dialog.sheet). Con «riduci movimento» il foglio segue il dito ma si chiude senza animazione.
 * Elementi che usano il trascinamento per sé: `data-no-sheet-drag` (cursori dei voti e range sono già esclusi).
 */
@Directive({ selector: 'dialog.sheet' })
export class Sheet {
  private readonly el: HTMLDialogElement = inject(ElementRef<HTMLDialogElement>).nativeElement;
  private readonly reduce = matchMedia('(prefers-reduced-motion: reduce)');
  private closing = false;
  private start: { x: number; y: number; top: boolean } | null = null;
  private dragging = false;
  private dy = 0;
  private last = { y: 0, t: 0, v: 0 };

  constructor() {
    const el = this.el;
    const nativeClose = HTMLDialogElement.prototype.close;
    el.close = (rv?: string) => this.animateClose(() => nativeClose.call(el, rv));

    const onCancel = (e: Event) => { e.preventDefault(); el.close(); };
    // un tocco sul margine interno ha lo stesso bersaglio del velo: non deve chiudere
    const onClickInside = (e: MouseEvent) => {
      if (e.target !== el) return;
      const b = el.getBoundingClientRect();
      if (e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom) e.stopImmediatePropagation();
    };
    const onStart = (e: TouchEvent) => this.touchStart(e);
    const onMove = (e: TouchEvent) => this.touchMove(e);
    const onEnd = () => this.touchEnd();
    el.addEventListener('cancel', onCancel);
    el.addEventListener('click', onClickInside, { capture: true });
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    inject(DestroyRef).onDestroy(() => {
      el.removeEventListener('cancel', onCancel);
      el.removeEventListener('click', onClickInside, { capture: true });
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    });
  }

  private animateClose(done: () => void): void {
    const el = this.el;
    if (!el.open || this.closing) return;
    if (this.reduce.matches) { this.reset(); done(); return; }
    this.closing = true;
    el.style.transition = '';
    el.classList.add('closing');   // l'animazione parte dalla posizione attuale (anche a metà trascinamento)
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      el.removeEventListener('animationend', onAnim);
      this.closing = false;
      this.reset();
      done();
    };
    const onAnim = (e: AnimationEvent) => { if (e.target === el) finish(); };
    el.addEventListener('animationend', onAnim);
    setTimeout(finish, 320);
  }

  private reset(): void {
    this.el.classList.remove('closing');
    this.el.style.transform = '';
    this.el.style.transition = '';
    this.el.style.removeProperty('--sheet-fade');
    this.dragging = false;
    this.start = null;
    this.dy = 0;
  }

  private touchStart(e: TouchEvent): void {
    const t = e.target as Element | null;
    if (!this.el.open || this.closing || e.touches.length !== 1) return;
    if (t?.closest('input[type=range], app-vote-slider, [data-no-sheet-drag]')) return;
    const p = e.touches[0];
    this.start = { x: p.clientX, y: p.clientY, top: this.atTop(t) };
    this.last = { y: p.clientY, t: e.timeStamp, v: 0 };
  }

  /** il foglio e ogni riquadro scorrevole sotto il dito sono all'inizio */
  private atTop(t: Element | null): boolean {
    for (let n = t; n && n !== this.el; n = n.parentElement) if (n.scrollTop > 0) return false;
    return this.el.scrollTop <= 0;
  }

  private touchMove(e: TouchEvent): void {
    const s = this.start;
    if (!s) return;
    const p = e.touches[0];
    const dx = p.clientX - s.x, dy = p.clientY - s.y;
    if (!this.dragging) {
      if (!s.top || dy < 0) { this.start = null; return; }                       // contenuto da scorrere
      if (Math.abs(dx) > Math.abs(dy)) { if (Math.abs(dx) > 6) this.start = null; return; }  // gesto di lato
      e.preventDefault();                                                        // niente rimbalzo della pagina
      if (dy < 6) return;
      this.dragging = true;
      this.el.style.transition = 'none';
    }
    e.preventDefault();
    this.dy = Math.max(0, dy - 6);
    const dt = e.timeStamp - this.last.t;
    if (dt > 0) this.last = { y: p.clientY, t: e.timeStamp, v: 0.7 * ((p.clientY - this.last.y) / dt) + 0.3 * this.last.v };
    this.el.style.transform = `translateY(${this.dy}px)`;
    this.el.style.setProperty('--sheet-fade', String(Math.max(0.2, 1 - this.dy / (this.el.offsetHeight || 1))));
  }

  private touchEnd(): void {
    const was = this.dragging;
    this.start = null;
    if (!was) return;
    this.dragging = false;
    if (this.dy > this.el.offsetHeight / 3 || this.last.v > FLICK) { this.el.close(); return; }
    // torna su
    this.el.style.removeProperty('--sheet-fade');
    this.el.style.transition = this.reduce.matches ? 'none' : 'transform 280ms var(--ease-spring)';
    this.el.style.transform = '';
    this.dy = 0;
  }
}
