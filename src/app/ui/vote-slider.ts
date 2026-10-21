import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, model } from '@angular/core';

/**
 * Cursore del voto (da 1 a 10 a mezzo punto) pensato per il telefono:
 * - con il dito il voto cambia solo trascinando DI LATO: un tocco, o un movimento verticale
 *   (scorrere la pagina), non lo cambia mai;
 * - con il mouse basta un clic; da tastiera le frecce (mezzo punto), Pagina su/giù (un punto), Inizio/Fine.
 * La barra sfuma dal rosso al verde passando per il giallo.
 */
@Component({
  selector: 'app-vote-slider',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'slider',
    tabindex: '0',
    '[attr.aria-label]': 'label()',
    '[attr.aria-valuemin]': 'min',
    '[attr.aria-valuemax]': 'max',
    '[attr.aria-valuenow]': 'value()',
    '[attr.aria-valuetext]': 'text()',
    '(pointerdown)': 'down($event)',
    '(pointermove)': 'move($event)',
    '(pointerup)': 'end()',
    '(pointercancel)': 'end()',
    '(keydown)': 'key($event)',
  },
  template: `
    <span class="track" aria-hidden="true"><i class="tick" style="left: 55.6%"></i></span>
    <span class="thumb" aria-hidden="true" [style.left.%]="pos()" [class.dragging]="dragging"></span>
  `,
  styles: `
    :host {
      position: relative; display: block; height: 44px; cursor: pointer; outline: none;
      /* il browser gestisce lo scorrimento verticale; i movimenti di lato li gestiamo noi */
      touch-action: pan-y; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent;
    }
    :host(:focus-visible) .thumb { box-shadow: 0 0 0 3px var(--surface), 0 0 0 5px var(--focus); }
    .track {
      position: absolute; left: 0; right: 0; top: 50%; height: 10px; margin-top: -5px; border-radius: 999px;
      background: linear-gradient(90deg, #c0392b 0%, #e05a1f 22%, #f0a31a 40%, #f5d020 52%, #a6c837 68%, #3fa04a 84%, #1f7a4a 100%);
      box-shadow: inset 0 0 0 1px rgb(0 0 0 / 8%);
    }
    /* segno del 6, il voto di partenza */
    .tick { position: absolute; top: -3px; width: 2px; height: 16px; margin-left: -1px; border-radius: 1px; background: rgb(0 0 0 / 25%); }
    .thumb {
      position: absolute; top: 50%; width: 28px; height: 28px; margin: -14px 0 0 -14px; border-radius: 50%;
      background: #fff; box-shadow: 0 1px 4px rgb(0 0 0 / 35%), 0 0 0 1px rgb(0 0 0 / 8%);
      transition: left 90ms ease-out, transform 140ms ease-out;
    }
    .thumb.dragging { transform: scale(1.18); transition: transform 140ms ease-out; }
  `,
})
export class VoteSlider {
  private readonly el = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  readonly value = model(6);
  readonly label = input('Voto');
  protected readonly min = 1;
  protected readonly max = 10;
  /** il cursore sta dentro la barra anche agli estremi (mezza maniglia di margine) */
  protected readonly pos = computed(() => ((this.value() - this.min) / (this.max - this.min)) * 100);
  protected readonly text = computed(() => String(this.value()).replace('.', ','));
  protected dragging = false;
  private start: { x: number; y: number; id: number } | null = null;

  protected down(e: PointerEvent): void {
    if (e.pointerType === 'mouse') {
      // con il mouse non c'è il problema dello scorrimento: un clic imposta subito il voto
      this.dragging = true;
      this.capture(e.pointerId);
      this.setFromX(e.clientX);
      return;
    }
    // con il dito si aspetta di capire se è un trascinamento di lato o lo scorrimento della pagina
    this.start = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }

  protected move(e: PointerEvent): void {
    if (this.dragging) {
      this.setFromX(e.clientX);
      return;
    }
    if (!this.start || e.pointerId !== this.start.id) return;
    const dx = Math.abs(e.clientX - this.start.x);
    const dy = Math.abs(e.clientY - this.start.y);
    if (dy > 8 && dy >= dx) {
      this.start = null;            // sta scorrendo la pagina: il voto non si tocca
    } else if (dx > 8 && dx > dy * 1.3) {
      this.dragging = true;         // trascinamento di lato: da qui il cursore segue il dito
      this.capture(e.pointerId);
      this.setFromX(e.clientX);
    }
  }

  protected end(): void {
    this.start = null;
    this.dragging = false;
  }

  protected key(e: KeyboardEvent): void {
    const step: Record<string, number> = { ArrowRight: 0.5, ArrowUp: 0.5, ArrowLeft: -0.5, ArrowDown: -0.5, PageUp: 1, PageDown: -1 };
    if (e.key in step) this.set(this.value() + step[e.key]);
    else if (e.key === 'Home') this.set(this.min);
    else if (e.key === 'End') this.set(this.max);
    else return;
    e.preventDefault();
  }

  /** il cursore continua a seguire il dito anche se esce dalla barra (se il browser lo consente) */
  private capture(id: number): void {
    try {
      this.el.setPointerCapture(id);
    } catch {
      /* senza cattura funziona lo stesso finché il dito resta sulla barra */
    }
  }

  private setFromX(x: number): void {
    const r = this.el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (x - r.left) / r.width));
    this.set(this.min + ratio * (this.max - this.min));
  }

  private set(v: number): void {
    const snapped = Math.min(this.max, Math.max(this.min, Math.round(v * 2) / 2));
    if (snapped !== this.value()) this.value.set(snapped);
  }
}
