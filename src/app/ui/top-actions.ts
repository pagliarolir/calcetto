import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { Unread } from '../core/unread';
import { Icon } from './icon';

/** Angolo in alto a destra delle sezioni: la campanella degli avvisi (non sta nella barra in basso). */
@Component({
  selector: 'app-top-actions',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!here('/avvisi')) {
      <a class="ta bell" routerLink="/avvisi" [attr.aria-label]="unread.count() ? 'Avvisi, ' + unread.count() + ' da leggere' : 'Avvisi'">
        <app-icon name="bell" [size]="20" />
        @if (unread.count() > 0) { <span class="badge">{{ unread.count() > 9 ? '9+' : unread.count() }}</span> }
      </a>
    }
  `,
  styles: [`
    :host { display: contents; }
    /* nell'intestazione verde della partita: colori dell'intestazione, misura del calendario */
    .ta { position: relative; flex: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; color: var(--ink); text-decoration: none; }
    .ta::after { content: ''; position: absolute; inset: -4px; }
    .bell { background: var(--surface-2); }
    :host(.hero) .ta { color: inherit; width: 32px; height: 32px; }
    :host(.hero) .bell { background: rgb(255 255 255 / 14%); }
    :host(.hero) .ta::after { inset: -6px; }
    .badge {
      position: absolute; top: -4px; right: -6px; min-width: 18px; height: 18px; padding: 0 4px;
      border-radius: 999px; background: var(--danger); color: var(--danger-ink);
      font: 700 0.68rem/18px var(--font-body); text-align: center;
    }
  `],
})
export class TopActions {
  protected readonly unread = inject(Unread);
  private readonly router = inject(Router);
  private readonly url = toSignal(this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map((e) => (e as NavigationEnd).urlAfterRedirects)), { initialValue: this.router.url });
  protected here(p: string) { return this.url().startsWith(p); }
}
