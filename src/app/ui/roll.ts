import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, untracked } from '@angular/core';
import { EASE, motionNow, motionOk } from '../core/motion';

/**
 * Numero che «rotola» quando cambia (idea dal componente Sliding Number di Motion Primitives su 21st.dev, rifatto
 * con GSAP): il valore vecchio esce verso l'alto e il nuovo entra dal basso (al contrario se scende).
 * Mai al primo disegno; con «riduci movimento» il numero cambia e basta. Il lettore di schermo legge solo il valore.
 */
@Component({
  selector: 'app-roll',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'roll' },
  template: `<span class="now">{{ value() }}</span>`,
  styles: `
    :host { display: inline-grid; overflow: hidden; vertical-align: bottom; }
    :host > span { grid-area: 1 / 1; display: block; }
  `,
})
export class Roll {
  readonly value = input.required<number | string>();
  private readonly host = inject(ElementRef).nativeElement as HTMLElement;
  private prev: string | null = null;

  constructor() {
    effect(() => {
      const v = String(this.value());
      untracked(() => this.roll(v));
    });
  }

  private roll(v: string): void {
    const old = this.prev;
    this.prev = v;
    if (old === null || old === v || !motionOk()) return;
    const m = motionNow();
    const now = this.host.querySelector<HTMLElement>('.now');
    if (!m || !now) return;
    const up = Number(v) >= Number(old) || Number.isNaN(Number(v));
    const ghost = document.createElement('span');
    ghost.textContent = old;
    ghost.setAttribute('aria-hidden', 'true');
    this.host.appendChild(ghost);
    m.gsap.killTweensOf(now);
    m.gsap.fromTo(now, { yPercent: up ? 100 : -100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.36, ease: EASE, clearProps: 'transform,opacity' });
    m.gsap.to(ghost, { yPercent: up ? -100 : 100, opacity: 0, duration: 0.36, ease: EASE, onComplete: () => ghost.remove() });
  }
}
