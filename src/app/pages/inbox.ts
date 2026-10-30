import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Api } from '../core/api';
import { fmtAgo, fmtWhen } from '../core/format';
import { parseInfo } from '../core/info-text';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { AppNotification } from '../core/models';
import { Unread } from '../core/unread';
import { Icon } from '../ui/icon';

@Component({
  selector: 'app-inbox',
  imports: [Icon, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page stack-l">
      <header class="spread">
        <h1>{{ tab() === 'info' ? 'Info' : 'Avvisi' }}</h1>
        @if (tab() === 'avvisi' && hasUnread()) { <button class="btn small" (click)="readAll()">Segna tutti come letti</button> }
        @if (tab() === 'info' && session.isLeader() && !editing()) { <button class="btn small" (click)="startEdit()">Modifica</button> }
      </header>

      <div class="itabs" role="tablist" aria-label="Avvisi e informazioni">
        <button role="tab" [attr.aria-selected]="tab() === 'avvisi'" (click)="selectTab('avvisi')"><app-icon name="bell" [size]="18" /> Avvisi</button>
        <button role="tab" [attr.aria-selected]="tab() === 'info'" (click)="selectTab('info')"><app-icon name="info" [size]="18" /> Info</button>
      </div>

      @if (tab() === 'info') {
        <!-- regole e storie del Leader: il testo lo scrive solo lui -->
        <article class="info panel stack">
          <h2 class="info-title">GIOVEDÌ DEL LEADER</h2>
          @if (editing()) {
            <label class="field"><span>Testo</span>
              <textarea class="input" rows="16" [(ngModel)]="draft" maxlength="20000"></textarea>
            </label>
            <p class="small muted">Riga vuota = nuovo paragrafo · <strong>**grassetto**</strong> · «# » all'inizio = titoletto · «- » all'inizio = elenco</p>
            <div class="row">
              <button class="btn ghost grow" [disabled]="busy()" (click)="editing.set(false)">Annulla</button>
              <button class="btn primary grow" [disabled]="busy()" (click)="saveInfo()">Salva</button>
            </div>
          } @else {
            @for (b of blocks(); track $index) {
              @switch (b.kind) {
                @case ('h') { <h3>@for (sg of b.lines[0]; track $index) {<span [class.b]="sg.bold">{{ sg.text }}</span>}</h3> }
                @case ('ul') {
                  <ul>@for (l of b.lines; track $index) { <li>@for (sg of l; track $index) {<span [class.b]="sg.bold">{{ sg.text }}</span>}</li> }</ul>
                }
                @default {
                  <p>@for (l of b.lines; track $index; let last = $last) { @for (sg of l; track $index) {<span [class.b]="sg.bold">{{ sg.text }}</span>}@if (!last) { <br /> } }</p>
                }
              }
            } @empty {
              <p class="muted">{{ session.isLeader() ? 'Ancora vuoto: premi «Modifica» per scrivere regole e storie del gruppo.' : 'Il Leader non ha ancora scritto nulla.' }}</p>
            }
            @if (infoUpdated(); as d) { <p class="small muted">Aggiornato {{ when(d) }}.</p> }
          }
        </article>
      } @else {
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
      }
    </main>
  `,
  styles: `
    .itabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; border-radius: 14px; background: var(--surface-2); margin-top: -8px; }
    .itabs button { appearance: none; border: 0; background: transparent; color: var(--muted); cursor: pointer; min-height: 42px; border-radius: 10px;
                    display: inline-flex; align-items: center; justify-content: center; gap: 8px; font: 600 var(--step--1)/1 var(--font-body); }
    .itabs button[aria-selected='true'] { background: var(--surface); color: var(--ink); box-shadow: 0 1px 3px rgb(20 32 25 / 14%); }
    .info .b { font-weight: 700; }
    .info-title { font: 800 var(--step-2)/1.05 var(--font-display); letter-spacing: 0.01em; }
    .info h3 { font-size: var(--step-1); margin-top: 6px; }
    .info p, .info ul { margin: 0; line-height: 1.5; }
    .info ul { padding-left: 1.2em; display: flex; flex-direction: column; gap: 4px; }
    .info textarea { min-height: 280px; font-size: 0.95rem; line-height: 1.45; }
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
  // ------------------------------------------------ scheda Info (nell'indirizzo: ?scheda=info)
  protected readonly session = inject(Session);
  private readonly route = inject(ActivatedRoute);
  private readonly toasts = inject(Toasts);
  protected readonly tab = signal<'avvisi' | 'info'>(this.route.snapshot.queryParamMap.get('scheda') === 'info' ? 'info' : 'avvisi');
  private readonly infoText = signal<string | null>(null);
  protected readonly infoUpdated = signal<string | null>(null);
  protected readonly blocks = computed(() => parseInfo(this.infoText()));
  protected readonly editing = signal(false);
  protected readonly busy = signal(false);
  protected draft = '';
  protected readonly when = fmtWhen;

  protected selectTab(t: 'avvisi' | 'info'): void {
    this.tab.set(t);
    void this.router.navigate([], { queryParams: { scheda: t === 'info' ? 'info' : null }, replaceUrl: true });
    if (t === 'info') void this.loadInfo();
  }

  private async loadInfo(): Promise<void> {
    try {
      const st = await this.api.settings();
      this.infoText.set(st.info_text ?? null);
      this.infoUpdated.set(st.info_updated_at ?? null);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }

  protected startEdit(): void {
    this.draft = this.infoText() ?? '';
    this.editing.set(true);
  }

  protected async saveInfo(): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.setInfoText(this.draft);
      await this.loadInfo();
      this.editing.set(false);
      this.toasts.show('Info aggiornate.');
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** icona e tono per ogni tipo di avviso */
  protected iconOf(kind: string): { name: string; tone: string } {
    if (kind === 'achievement') return { name: 'star', tone: 'turf' };
    if (kind === 'chat') return { name: 'chat', tone: 'turf' };
    if (kind === 'team_full') return { name: 'list', tone: 'turf' };
    if (/^(punished|pardoned|late_withdrawal|withdrawal|match_cancelled|avatar_removed|stats_deleted)/.test(kind)) return { name: 'whistle', tone: 'red' };
    if (/^(leader_points|votes|vote_grant|my_votes)/.test(kind)) return { name: 'star', tone: 'gold' };
    if (/^(result|homologate|confirm)/.test(kind)) return { name: 'score', tone: '' };
    if (/^lineup/.test(kind)) return { name: 'pitch', tone: 'turf' };
    if (/^(match_moved|venue_changed)/.test(kind)) return { name: 'map', tone: '' };
    if (/^(stats_)/.test(kind)) return { name: 'table', tone: '' };
    if (/^(member_pending|guest_linked|password)/.test(kind)) return { name: 'user', tone: '' };
    if (/^(booking|priority|need_one|reserve|placed_by|promoted|demoted|lists)/.test(kind)) return { name: 'calendar', tone: 'turf' };
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
    if (this.tab() === 'info') void this.loadInfo();   // aperta direttamente sulla scheda Info
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
