import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api } from '../core/api';
import { fmtAgo } from '../core/format';
import { AppNotification } from '../core/models';
import { Unread } from '../core/unread';

@Component({
  selector: 'app-inbox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page stack-l">
      <header class="spread">
        <h1>Avvisi</h1>
        @if (hasUnread()) { <button class="btn small" (click)="readAll()">Segna tutti come letti</button> }
      </header>
      <ul class="list">
        @for (n of items(); track n.id) {
          <li>
            <button class="list-item" [class.unread]="!n.read_at" (click)="open(n)">
              <span class="grow">
                <strong>{{ n.title }}</strong><br />
                <span class="small">{{ n.body }}</span>
              </span>
              <span class="small muted">{{ ago(n.created_at) }}</span>
            </button>
          </li>
        } @empty { <li class="empty">Nessun avviso. Qui trovi tutto quello che ti arriva come notifica.</li> }
      </ul>
    </main>
  `,
  styles: `
    .list-item.unread { background: var(--turf-soft); }
    .list-item.unread strong::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--turf); margin-right: 8px; vertical-align: middle; }
  `,
})
export class InboxPage implements OnInit {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly unread = inject(Unread);
  protected readonly items = signal<AppNotification[]>([]);
  protected readonly ago = fmtAgo;

  protected hasUnread(): boolean {
    return this.items().some((n) => !n.read_at);
  }

  async ngOnInit(): Promise<void> {
    this.items.set(await this.api.notifications());
  }

  protected async readAll(): Promise<void> {
    await this.api.markAllRead();
    this.items.update((l) => l.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    await this.unread.refresh();
  }

  protected async open(n: AppNotification): Promise<void> {
    if (!n.read_at) await this.readAll();
    if (n.url) await this.router.navigateByUrl(n.url);
  }
}
