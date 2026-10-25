import { inject, Injectable } from '@angular/core';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { appScroller } from './scroller';

/**
 * «Indietro» riporta esattamente dove si era: prima di lasciare una pagina si annota quanto
 * era scorsa (per indirizzo, comprese le scelte salvate nell'indirizzo, come la scheda aperta);
 * tornandoci con «Indietro» (o il gesto del telefono) la si riporta allo stesso punto, appena il
 * contenuto è abbastanza lungo (i dati arrivano dopo).
 */
@Injectable({ providedIn: 'root' })
export class ScrollMemory {
  private readonly router = inject(Router);
  private readonly saved = new Map<string, number>();
  private back = false;

  constructor() {
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationStart) {
        const el = appScroller();
        if (el) this.saved.set(this.router.url, el.scrollTop);
        this.back = e.navigationTrigger === 'popstate';
      } else if (e instanceof NavigationEnd && this.back) {
        const y = this.saved.get(e.urlAfterRedirects);
        if (y) this.restore(y);
      }
    });
  }

  private restore(y: number): void {
    let tries = 0;
    const step = () => {
      const el = appScroller();
      if (el && el.scrollHeight - el.clientHeight >= y) {
        el.scrollTop = y;
      } else if (++tries < 40) {
        setTimeout(step, 50);   // fino a 2 secondi per i dati
      } else if (el) {
        el.scrollTop = y;
      }
    };
    setTimeout(step, 0);
  }
}
