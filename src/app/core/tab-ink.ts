import { Injectable } from '@angular/core';
import { EASE, motionNow, motionOk } from './motion';

/**
 * Lineetta delle schede che scivola da una scheda all'altra (idea dagli «Animated Tabs» con indicatore scorrevole di
 * 21st.dev, rifatta con GSAP). Vale da sola per tutte le `.ui-tabs` dell'app e per le schede con `data-ink`
 * (quelle della partita): una sola lineetta per gruppo, che si sposta invece di sparire da una scheda e comparire
 * nell'altra. Al primo disegno è già al suo posto; con «riduci movimento» salta senza scivolare.
 */
interface Kind { sel: string; active: string; inset: number; cls: string }
const KINDS: Kind[] = [
  { sel: '.ui-tabs', active: ':scope > button[aria-selected="true"], :scope > a[aria-selected="true"]', inset: 0, cls: 'ink-turf' },
  { sel: '[data-ink]', active: ':scope > a.on, :scope > .tab-group.on', inset: 12, cls: 'ink-chalk' },
];

@Injectable({ providedIn: 'root' })
export class TabInk {
  private started = false;
  private queued = false;
  private readonly inks = new WeakMap<HTMLElement, { el: HTMLElement; x: number; w: number }>();

  start(): void {
    if (this.started || typeof MutationObserver === 'undefined') return;
    this.started = true;
    const mo = new MutationObserver(() => this.queue());
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-selected'] });
    addEventListener('resize', () => this.queue(true));
    this.queue();
  }

  private queue(jump = false): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => { this.queued = false; this.scan(jump); });
  }

  private scan(jump: boolean): void {
    for (const k of KINDS) {
      document.querySelectorAll<HTMLElement>(k.sel).forEach((host) => this.place(host, k, jump));
    }
  }

  private place(host: HTMLElement, k: Kind, jump: boolean): void {
    let st = this.inks.get(host);
    if (!st) {
      const el = document.createElement('span');
      el.className = `tab-ink ${k.cls}`;
      el.setAttribute('aria-hidden', 'true');
      host.classList.add('has-ink');
      host.appendChild(el);
      st = { el, x: -1, w: -1 };
      this.inks.set(host, st);
      jump = true;
    }
    const a = host.querySelector<HTMLElement>(k.active);
    if (!a || !a.offsetWidth) { st.el.style.opacity = '0'; return; }
    const hr = host.getBoundingClientRect(), r = a.getBoundingClientRect();
    const x = Math.round(r.left - hr.left + host.scrollLeft + k.inset), w = Math.round(r.width - 2 * k.inset);
    if (x === st.x && w === st.w && st.el.style.opacity !== '0') return;
    const first = st.x < 0 || st.el.style.opacity === '0';
    st.x = x; st.w = w;
    st.el.style.opacity = '';
    const m = !jump && !first && motionOk() ? motionNow() : null;
    if (m) m.gsap.to(st.el, { x, width: w, duration: 0.32, ease: EASE, overwrite: true });
    else if (motionNow()) motionNow()!.gsap.set(st.el, { x, width: w });
    else { st.el.style.transform = `translate(${x}px, 0)`; st.el.style.width = `${w}px`; }
  }
}
