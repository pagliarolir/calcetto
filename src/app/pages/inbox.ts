import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api } from '../core/api';
import { fmtAgo } from '../core/format';
import { AppNotification } from '../core/models';
import { Unread } from '../core/unread';
import { Icon } from '../ui/icon';

@Component({
  selector: 'app-inbox',
  imports: [Icon],
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
              <span class="kind" [class]="'kind ' + iconOf(n.kind).tone" aria-hidden="true"><app-icon [name]="iconOf(n.kind).name" [size]="18" /></span>
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
    .kind { flex: none; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: var(--surface-2); color: var(--muted); }
    .kind.turf { background: var(--turf-soft); color: var(--turf); }
    .kind.gold { background: color-mix(in srgb, var(--armband) 22%, transparent); color: color-mix(in srgb, var(--armband) 70%, var(--ink)); }
    .kind.red { background: var(--danger-soft); color: var(--danger); }
    .list-item.unread .kind { box-shadow: 0 0 0 2px var(--surface); }
    .list-item.unread strong::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--turf); margin-right: 8px; vertical-align: middle; }
  `,
})
export class InboxPage implements OnInit {
  /** icona e tono per ogni tipo di avviso */
  protected iconOf(kind: string): { name: string; tone: string } {
    if (/^(punished|pardoned|late_withdrawal|match_cancelled|avatar_removed|stats_deleted)/.test(kind)) return { name: 'whistle', tone: 'red' };
    if (/^(leader_points|votes|vote_grant|my_votes)/.test(kind)) return { name: 'star', tone: 'gold' };
    if (/^(result|homologate|confirm)/.test(kind)) return { name: 'score', tone: '' };
    if (/^lineup/.test(kind)) return { name: 'pitch', tone: 'turf' };
    if (/^(match_moved|venue_changed)/.test(kind)) return { name: 'map', tone: '' };
    if (/^(stats_)/.test(kind)) return { name: 'table', tone: '' };
    if (/^(member_pending|guest_linked|password)/.test(kind)) return { name: 'user', tone: '' };
    if (/^(booking|priority|need_one|reserve|placed_by|promoted|demoted|lists|chat)/.test(kind)) return { name: 'calendar', tone: 'turf' };
    return { name: 'bell', tone: '' };
  }

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
