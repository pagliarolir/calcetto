import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { filter, map } from 'rxjs';
import { Session } from './core/session';
import { Toasts } from './core/toast';
import { Unread } from './core/unread';
import { Icon } from './ui/icon';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />

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

    <div class="toasts" role="status" aria-live="polite">
      @for (t of toasts.items(); track t.id) {
        <button class="toast enter-fade" [class.error]="t.tone === 'error'" (click)="toasts.dismiss(t.id)">{{ t.text }}</button>
      }
    </div>
  `,
  styles: `
    .tabbar {
      position: fixed; inset: auto 0 0 0; z-index: 50;
      display: flex; justify-content: space-around;
      height: var(--tabbar-total);
      padding-bottom: var(--tabbar-pad);
      background: color-mix(in srgb, var(--surface) 92%, transparent);
      backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
      border-top: 1px solid var(--line);
    }
    .tabbar a {
      flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
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
      position: fixed; z-index: 60; left: 12px; right: 12px;
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

  constructor() {
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
