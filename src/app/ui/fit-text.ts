import { afterNextRender, DestroyRef, Directive, ElementRef, inject } from '@angular/core';

/**
 * Tiene un titolo su una sola riga (l'elemento deve avere la sua larghezza, es. `flex: 1 1 0`): se il testo non entra nello spazio, il carattere si rimpicciolisce
 * (fino al 70%); oltre, i puntini di sospensione. Si ricalcola quando cambiano larghezza o testo.
 */
@Directive({ selector: '[appFitText]' })
export class FitText {
  private readonly el = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;

  constructor() {
    afterNextRender(() => {
      const ro = new ResizeObserver(() => this.fit());
      ro.observe(this.el);
      if (this.el.parentElement) ro.observe(this.el.parentElement);
      const mo = new MutationObserver(() => this.fit());
      mo.observe(this.el, { characterData: true, childList: true, subtree: true });
      this.fit();
      // i caratteri del titolo possono arrivare dopo: si rimisura quando sono pronti
      void document.fonts?.ready.then(() => this.fit());
      this.destroy = () => { ro.disconnect(); mo.disconnect(); };
    });
    inject(DestroyRef).onDestroy(() => this.destroy?.());
  }

  private destroy?: () => void;

  private textWidth(): number {
    const r = document.createRange();
    r.selectNodeContents(this.el);
    const before = parseFloat(getComputedStyle(this.el, '::before').width) || 0;
    const mr = parseFloat(getComputedStyle(this.el, '::before').marginRight) || 0;
    return r.getBoundingClientRect().width + (before ? before + mr : 0);
  }

  private fit(): void {
    const el = this.el;
    el.style.fontSize = '';
    const base = parseFloat(getComputedStyle(el).fontSize) || 16;
    let size = base;
    // larghezza reale del testo (con i decimali) contro lo spazio disponibile: niente puntini per mezzo pixel
    const over = () => el.scrollWidth > el.clientWidth || this.textWidth() > el.clientWidth - 0.5;
    while (over() && size > base * 0.7) {
      size -= 0.5;
      el.style.fontSize = `${size}px`;
    }
  }
}
