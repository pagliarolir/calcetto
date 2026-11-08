import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Skeleton } from './skeleton';

/**
 * Scheletro completo della pagina della partita (intestazione + contenuto).
 * Lo usano la pagina della partita e «Partita» dalla barra in basso mentre cerca la prossima:
 * stesso scheletro dall'inizio alla fine, così si vede un solo cambio (scheletro → pagina).
 */
@Component({
  selector: 'app-match-skeleton',
  imports: [Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
      <!-- scheletro con la stessa forma della pagina: niente pezzi che compaiono uno alla volta -->
      <header class="hero" aria-hidden="true">
        <div class="hero-in sk-hero">
          <div class="sk-top"><span class="skw w20"></span><span class="skw w30"></span></div>
          <div class="sk-ticket"><span class="skw box"></span><span class="sk-lines"><span class="skw w70 h22"></span><span class="skw w50"></span><span class="skw w60"></span></span></div>
          <span class="skw strip"></span>
          <div class="sk-tabs"><span class="skw w15"></span><span class="skw w15"></span><span class="skw w15"></span></div>
        </div>
      </header>
      <main class="scroll-area"><div class="page below-header"><app-skeleton kind="match" /></div></main>
  `,
  styles: `
    :host { display: flex; flex-direction: column; flex: 1 1 0; min-height: 0; }
    .hero {
      color: var(--hero-ink, var(--chalk));
      background:
        radial-gradient(circle at 50% 135%, transparent 0 88px, rgb(241 245 239 / 35%) 89px 91px, transparent 92px),
        var(--hero-bg, linear-gradient(var(--turf), var(--turf)));
      padding-top: env(safe-area-inset-top);
      /* fissa in cima: scorre solo il contenuto sotto (.scroll-area) */
      flex: none; z-index: 2;
    }
    @media (prefers-color-scheme: dark) { :host-context(html:not([data-theme])) .hero { color: #eef5ef; background-color: #14482f; background-image: radial-gradient(circle at 50% 135%, transparent 0 88px, rgb(207 224 212 / 30%) 89px 91px, transparent 92px); } }
    .hero-in { max-width: 640px; margin: 0 auto; padding: 0 16px 6px; display: flex; flex-direction: column; gap: 2px; }
    .sk-hero { display: flex; flex-direction: column; gap: 14px; padding-bottom: 12px; }
    .skw { display: block; height: 12px; border-radius: 6px; background: rgb(255 255 255 / 16%); }
    .sk-top { display: flex; justify-content: space-between; } .sk-top .w20 { width: 22%; } .sk-top .w30 { width: 34%; }
    .sk-ticket { display: flex; gap: 14px; align-items: center; } .skw.box { width: 84px; height: 92px; border-radius: 16px; flex: none; }
    .sk-lines { flex: 1; display: flex; flex-direction: column; gap: 10px; } .skw.w70 { width: 75%; } .skw.w50 { width: 50%; } .skw.w60 { width: 60%; } .skw.h22 { height: 22px; }
    .skw.strip { height: 40px; border-radius: 12px; }
    .sk-tabs { display: flex; gap: 22px; } .sk-tabs .w15 { width: 48px; }
  `,
})
export class MatchSkeleton {}
