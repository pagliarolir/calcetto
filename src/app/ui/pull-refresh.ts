import { ChangeDetectionStrategy, Component, computed, inject, input, OnDestroy, OnInit, signal } from '@angular/core';
import { Refresher } from '../core/refresher';

const TRIGGER = 72;   // distanza (già frenata) oltre la quale, rilasciando, si aggiorna
const MAX = 110;

/**
 * Gesto «trascina per aggiornare»: in cima alla pagina, trascinando verso il basso scende un
 * cerchio con una freccia che ruota; oltre la soglia, rilasciando, parte l'aggiornamento.
 * Non scatta se c'è una finestra aperta o se la pagina non è in cima.
 */
@Component({
  selector: 'app-pull-refresh',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ptr" [class.on]="dist() > 0 || refresher.busy()" [class.ready]="dist() >= trigger" [class.busy]="refresher.busy()"
         [style.transform]="'translate(-50%, ' + (refresher.busy() ? trigger - 44 : dist() - 44) + 'px)'" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22" [style.transform]="'rotate(' + rotation() + 'deg)'">
        <path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        <path d="M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </div>
    <span class="sr-only" role="status" aria-live="polite">{{ refresher.busy() ? 'Aggiornamento in corso' : '' }}</span>
  `,
  styles: `
    :host { position: fixed; top: env(safe-area-inset-top, 0px); left: 0; right: 0; height: 0; z-index: 60; pointer-events: none; }
    .ptr {
      position: absolute; left: 50%; top: 0; width: 44px; height: 44px; border-radius: 50%;
      display: grid; place-items: center; background: var(--surface); color: var(--muted);
      box-shadow: 0 4px 14px rgb(0 0 0 / 22%), 0 0 0 1px var(--line);
      opacity: 0; transition: opacity 120ms;
    }
    .ptr.on { opacity: 1; }
    .ptr.ready { color: var(--turf); }
    .ptr.busy svg { animation: spin 800ms linear infinite; color: var(--turf); }
    .ptr:not(.on) { transition: opacity 120ms, transform 220ms ease-out; }
    @keyframes spin { to { rotate: 360deg; } }
    @media (prefers-reduced-motion: reduce) { .ptr.busy svg { animation-duration: 2s; } }
  `,
})
export class PullRefresh implements OnInit, OnDestroy {
  protected readonly refresher = inject(Refresher);
  /** il riquadro dell'app su cui si ascolta il gesto */
  readonly target = input.required<HTMLElement>();
  protected readonly trigger = TRIGGER;
  protected readonly dist = signal(0);
  protected readonly rotation = computed(() => Math.min(1, this.dist() / TRIGGER) * 270);
  private startY = 0;
  private startX = 0;
  private scroller: HTMLElement | null = null;
  private pulling = false;
  private tracking = false;

  private readonly onStart = (e: TouchEvent) => {
    if (e.touches.length !== 1 || this.refresher.busy() || document.querySelector('dialog[open]')) return;
    // lo scorrimento che conta è quello del contenitore centrale (se la pagina ne ha uno) o del riquadro
    this.scroller = (e.target as HTMLElement).closest?.('.scroll-area') as HTMLElement | null ?? this.target();
    const inner = this.target().querySelector<HTMLElement>('.scroll-area');
    const atTop = (this.scroller?.scrollTop ?? 0) <= 0 && (!inner || inner.scrollTop <= 0) && this.target().scrollTop <= 0;
    if (!atTop) return;
    this.tracking = true;
    this.pulling = false;
    this.startY = e.touches[0].clientY;
    this.startX = e.touches[0].clientX;
  };

  private readonly onMove = (e: TouchEvent) => {
    if (!this.tracking) return;
    const dy = e.touches[0].clientY - this.startY;
    const dx = Math.abs(e.touches[0].clientX - this.startX);
    if (!this.pulling) {
      if (dy > 8 && dy > dx * 1.2 && (this.scroller?.scrollTop ?? 0) <= 0) this.pulling = true;
      else if (dy < -4 || dx > 12) { this.tracking = false; return; }
      else return;
    }
    e.preventDefault();   // niente rimbalzo della pagina mentre si tira
    this.dist.set(Math.min(MAX, Math.max(0, dy * 0.5)));
  };

  private readonly onEnd = () => {
    if (!this.tracking) return;
    this.tracking = false;
    const go = this.pulling && this.dist() >= TRIGGER;
    this.pulling = false;
    this.dist.set(0);
    if (go) void this.refresher.refresh();
  };

  ngOnInit(): void {
    const el = this.target();
    el.addEventListener('touchstart', this.onStart, { passive: true });
    el.addEventListener('touchmove', this.onMove, { passive: false });
    el.addEventListener('touchend', this.onEnd, { passive: true });
    el.addEventListener('touchcancel', this.onEnd, { passive: true });
  }

  ngOnDestroy(): void {
    const el = this.target();
    el.removeEventListener('touchstart', this.onStart);
    el.removeEventListener('touchmove', this.onMove);
    el.removeEventListener('touchend', this.onEnd);
    el.removeEventListener('touchcancel', this.onEnd);
  }
}
