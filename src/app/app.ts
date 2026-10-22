import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { filter, map } from 'rxjs';
import { Session } from './core/session';
import { Toasts } from './core/toast';
import { Unread } from './core/unread';
import { Icon } from './ui/icon';
import { ReprimandView } from './ui/reprimand';
import { Branding } from './core/branding';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, Icon, ReprimandView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- App shell: il documento non scorre mai; scorre solo questo riquadro. La barra è l'ultimo
         elemento della colonna, quindi non dipende dall'altezza della pagina che si sta caricando. -->
    <div class="app-scroller" #scroller>
      <router-outlet />
    </div>

    @if (showTabs()) {
      <nav class="tabbar" aria-label="Sezioni">
        @for (t of tabs(); track t.path) {
          <a [routerLink]="t.path" [attr.aria-current]="isActive(t.path) ? 'page' : null">
            <span class="ico">
              <app-icon [name]="t.icon" />
              @if (t.path === '/avvisi' && unread.count() > 0) {
                <span class="badge">{{ unread.count() > 9 ? '9+' : unread.count() }}</span>
              }
            </span>
            <span>{{ t.label }}</span>
          </a>
        }
      </nav>
    }

    <app-reprimand />

    <div class="toasts" role="status" aria-live="polite">
      @for (t of toasts.items(); track t.id) {
        <button class="toast enter-fade" [class.error]="t.tone === 'error'" (click)="toasts.dismiss(t.id)">{{ t.text }}</button>
      }
    </div>
  `,
  styles: `
    /* Colonna alta quanto l'area visibile: contenuto che scorre sopra, barra sotto.
       100dvh e non 100vh: nell'app installata su iPhone 100vh supera l'area visibile e la barra
       finisce sotto lo schermo. max-height: 100% è una sicurezza: la colonna non può mai essere
       più alta dell'area della pagina, quindi la barra resta sempre visibile. */
    :host {
      position: fixed; top: 0; left: 0; right: 0; z-index: 1;
      height: 100%;
      height: 100dvh;
      max-height: 100%;
      display: flex; flex-direction: column;
      /* clip e non solo hidden: la colonna non deve mai poter scorrere, nemmeno quando il browser
         porta in vista un elemento con il fuoco (altrimenti tutto scivola fuori e resta lo sfondo) */
      overflow: hidden;
      overflow: clip;
    }

    .app-scroller {
      /* contenitore di riferimento per gli elementi posizionati (anche quelli nascosti, come le caselle dei chip) */
      position: relative;
      flex: 1 1 auto; min-height: 0;
      overflow-y: auto; overflow-x: hidden;
      overscroll-behavior-y: contain;
      -webkit-overflow-scrolling: touch;
    }

    .tabbar {
      flex: none; position: relative; z-index: 2;
      display: flex; justify-content: space-around;
      height: var(--tabbar-total);
      padding-bottom: var(--tabbar-pad);
      background: var(--surface);
      border-top: 1px solid var(--line);
    }
    /* icone a distanza fissa dal bordo superiore della barra */
    .tabbar a {
      flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 2px;
      padding-top: 10px;
      text-decoration: none; color: var(--muted); font-size: 0.72rem; font-weight: 600;
    }
    .tabbar a[aria-current='page'] { color: var(--turf); }
    .tabbar a[aria-current='page'] .ico { background: var(--turf-soft); }
    .ico { position: relative; display: grid; place-items: center; width: 52px; height: 30px; border-radius: 999px; transition: background 180ms; }
    .badge {
      position: absolute; top: -4px; right: 6px; min-width: 18px; height: 18px; padding: 0 5px;
      border-radius: 999px; background: var(--danger); color: #fff;
      font: 700 0.68rem/18px var(--font-body); text-align: center;
    }
    .toasts {
      position: absolute; z-index: 60; left: 12px; right: 12px;
      bottom: calc(var(--tabbar-total) + 12px);
      display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none;
    }
    .toast {
      pointer-events: auto; appearance: none; border: 0; cursor: pointer;
      max-width: 520px; padding: 12px 18px; border-radius: var(--r-m);
      background: var(--ink); color: var(--bg); font: 500 var(--step--1)/1.35 var(--font-body);
      box-shadow: 0 8px 24px rgb(0 0 0 / 20%); text-align: left;
    }
    .toast.error { background: var(--danger); color: #fff; }
  `,
})
export class App {
  private readonly router = inject(Router);
  private readonly session = inject(Session);
  private readonly branding = inject(Branding);
  protected readonly toasts = inject(Toasts);
  protected readonly unread = inject(Unread);

  private readonly url = toSignal(
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map((e) => (e as NavigationEnd).urlAfterRedirects)),
    { initialValue: '/' },
  );

  protected readonly showTabs = computed(() => {
    const u = this.url();
    return !!this.session.auth() && !!this.session.profile()?.active && !u.startsWith('/accesso') && !u.startsWith('/in-attesa') && !u.startsWith('/nuova-password');
  });

  protected readonly tabs = computed(() => [
    { path: '/', label: 'Partita', icon: 'pitch' },
    { path: '/classifica', label: 'Classifica', icon: 'table' },
    { path: '/avvisi', label: 'Avvisi', icon: 'bell' },
    { path: '/profilo', label: 'Profilo', icon: 'user' },
    ...(this.session.isStaff() ? [{ path: '/gestione', label: 'Gestione', icon: 'whistle' }] : []),
  ]);

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  constructor() {
    // logo dell'app (icona e manifest): anche prima dell'accesso
    void this.branding.load();
    // rete di sicurezza: se un browser facesse comunque scorrere la colonna, torna subito a posto
    const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    host.addEventListener('scroll', () => {
      if (host.scrollTop || host.scrollLeft) host.scrollTo(0, 0);
    });
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.scroller()?.nativeElement.scrollTo({ top: 0 });
    });

    // nuova versione dell'app pronta: si ricarica alla prossima apertura senza chiedere nulla
    const sw = inject(SwUpdate);
    if (sw.isEnabled) {
      sw.versionUpdates.pipe(filter((e) => e.type === 'VERSION_READY')).subscribe(() => {
        this.toasts.show('Nuova versione pronta: si attiva alla prossima apertura.', 'info', 8000);
        document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && location.reload(), { once: true });
      });
    }
  }

  protected isActive(path: string): boolean {
    const u = this.url();
    if (path === '/') return u === '/' || u.startsWith('/partita');
    return u.startsWith(path);
  }
}
