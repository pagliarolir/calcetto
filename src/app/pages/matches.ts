import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { diffText, fmtDayLong, fmtTime } from '../core/format';
import { kit, teamNames } from '../core/kits';
import {
  changedFields, ConfigField, configOfSettings, hhmm, isoDate, MatchConfig, nextWeekday, shortDate, WEEKDAYS, weeklyDates,
} from '../core/match-config';
import { AppSettings, Match, Result } from '../core/models';
import { scrollAppTo } from '../core/scroller';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { ApplyDialog } from '../ui/apply-dialog';
import { MatchConfigForm } from '../ui/match-config-form';

type Panel = 'none' | 'create' | 'defaults';

@Component({
  selector: 'app-matches',
  imports: [RouterLink, FormsModule, MatchConfigForm, ApplyDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page stack-l">
      <header class="spread">
        <h1>Partite</h1>
        @if (session.isLeader() && panel() === 'none' && !apply()) {
          <button class="btn small primary" (click)="openCreate()">Nuova partita</button>
        }
      </header>

      @if (session.isLeader() && panel() === 'none' && !apply()) {
        <button class="btn small ghost settings-link" (click)="openDefaults()">Configurazione predefinita</button>
      }

      <!-- Applica alle partite già create -->
      @if (apply(); as a) {
        <app-apply-dialog [matches]="a.matches" [fields]="a.fields" [busy]="busy()"
                          title="Applicare anche alle partite già create?" cancelLabel="Solo alle nuove partite"
                          (confirm)="applyTo($event)" (cancel)="apply.set(null)" />
      }

      <!-- Nuova partita -->
      @if (panel() === 'create' && config(); as c) {
        <section class="panel stack-l" aria-labelledby="create-h">
          <h2 id="create-h">Nuova partita</h2>
          <div class="chips" role="group" aria-label="Quante partite">
            <button class="chip" [attr.aria-pressed]="mode() === 'one'" (click)="mode.set('one')">Una partita</button>
            <button class="chip" [attr.aria-pressed]="mode() === 'series'" (click)="mode.set('series')">Ogni settimana fino a…</button>
          </div>

          @if (mode() === 'one') {
            <div class="pair">
              <label class="field"><span>Giorno</span><input class="input" type="date" [min]="today" [(ngModel)]="oneDate" (ngModelChange)="tick()" /></label>
              <label class="field"><span>Ora</span><input class="input" type="time" [(ngModel)]="time" (ngModelChange)="tick()" /></label>
            </div>
          } @else {
            <div class="pair">
              <label class="field"><span>Ogni</span>
                <select class="input" [(ngModel)]="weekday" (ngModelChange)="tick()">
                  @for (d of weekdays; track $index) { <option [ngValue]="$index">{{ d }}</option> }
                </select>
              </label>
              <label class="field"><span>Ora</span><input class="input" type="time" [(ngModel)]="time" (ngModelChange)="tick()" /></label>
            </div>
            <div class="pair">
              <label class="field"><span>Dal</span><input class="input" type="date" [min]="today" [(ngModel)]="from" (ngModelChange)="tick()" /></label>
              <label class="field"><span>Fino al</span><input class="input" type="date" [min]="from" [(ngModel)]="until" (ngModelChange)="tick()" /></label>
            </div>
          }
          <p class="note">{{ previewText() }}</p>

          <app-match-config-form [config]="c" (configChange)="config.set($event)" />

          <label class="switch">
            <span>Salva anche come configurazione predefinita</span>
            <input type="checkbox" [(ngModel)]="saveDefault" />
          </label>
          <div class="row-wrap">
            <button class="btn primary" [disabled]="busy() || !dates().length || !time" (click)="create()">
              {{ dates().length > 1 ? 'Crea ' + dates().length + ' partite' : 'Crea la partita' }}
            </button>
            <button class="btn ghost" (click)="close()">Annulla</button>
          </div>
        </section>
      }

      <!-- Configurazione predefinita -->
      @if (panel() === 'defaults' && config(); as c) {
        <section class="panel stack-l" aria-labelledby="def-h">
          <h2 id="def-h">Configurazione predefinita</h2>
          <p class="small muted">È il punto di partenza di ogni nuova partita, comprese quelle create in automatico quando non ce ne sono in programma.</p>
          <div class="pair">
            <label class="field"><span>Giorno</span>
              <select class="input" [(ngModel)]="weekday">
                @for (d of weekdays; track $index) { <option [ngValue]="$index">{{ d }}</option> }
              </select>
            </label>
            <label class="field"><span>Ora</span><input class="input" type="time" [(ngModel)]="time" (ngModelChange)="tick()" /></label>
          </div>
          <app-match-config-form [config]="c" (configChange)="config.set($event)" />
          <div class="row-wrap">
            <button class="btn primary" [disabled]="busy() || !time" (click)="saveDefaults()">Salva</button>
            <button class="btn ghost" (click)="close()">Annulla</button>
          </div>
        </section>
      }

      <ol class="list">
        @for (m of items(); track m.id) {
          <li>
            <a class="list-item" [routerLink]="['/partita', m.id]">
              <span class="grow"><span class="day">{{ day(m.starts_at) }}</span><br />
                <span class="small muted">{{ time2(m.starts_at) }}@if (m.venue_name) {, {{ m.venue_name }}}, {{ m.players_per_team }} contro {{ m.players_per_team }}@if (m.moved) {, spostata}@if (m.status === 'cancelled') {, annullata}</span>
                <span class="kits" aria-hidden="true"><i [style.background]="kitColor(m.team_a_kit)"></i><i [style.background]="kitColor(m.team_b_kit)"></i></span>
              </span>
              @if (m.results; as r) { <span class="num score">{{ text(r.diff, r.white_goals, r.black_goals, names(m)) }}</span> }
              @else if (m.status === 'scheduled') { <span class="tag turf">in programma</span> }
            </a>
          </li>
        } @empty { <li class="empty">Ancora nessuna partita.</li> }
      </ol>
    </main>
  `,
  styles: `
    .day { font-weight: 600; } .day::first-letter { text-transform: uppercase; }
    .score { font-size: var(--step-1); font-weight: 700; }
    .settings-link { align-self: flex-start; margin-top: -16px; padding-left: 0; }
    .pair { display: grid; grid-template-columns: 1.3fr 1fr; gap: 8px; }
    .kits { display: inline-flex; gap: 3px; margin-left: 6px; vertical-align: middle; }
    .kits i { width: 10px; height: 10px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 25%); }
  `,
})
export class MatchesPage implements OnInit {
  private readonly api = inject(Api);
  protected readonly session = inject(Session);
  private readonly toasts = inject(Toasts);

  protected readonly items = signal<(Match & { results: Result | null })[]>([]);
  protected readonly settings = signal<AppSettings | null>(null);
  protected readonly panel = signal<Panel>('none');
  protected readonly mode = signal<'one' | 'series'>('one');
  protected readonly config = signal<MatchConfig | null>(null);
  protected readonly busy = signal(false);
  protected readonly apply = signal<{ matches: Match[]; fields: ConfigField[]; config: MatchConfig; time: string } | null>(null);
  private readonly version = signal(0);   // fa ricalcolare l'anteprima delle date quando cambiano i campi

  protected readonly weekdays = WEEKDAYS;
  protected readonly today = isoDate(new Date());
  protected readonly day = fmtDayLong;
  protected readonly time2 = fmtTime;
  protected readonly text = diffText;
  protected readonly names = teamNames;
  protected oneDate = '';
  protected weekday = 4;
  protected time = '20:00';
  protected from = this.today;
  protected until = '';
  protected saveDefault = false;

  protected readonly dates = computed(() => {
    this.version();
    if (this.mode() === 'one') return this.oneDate ? [this.oneDate] : [];
    return weeklyDates(this.from, this.until, this.weekday);
  });

  protected readonly previewText = computed(() => {
    const d = this.dates();
    if (!d.length) return this.mode() === 'series' ? 'Scegli fino a quando: vedrai qui le date.' : 'Scegli il giorno.';
    if (d.length > 60) return `Sono ${d.length} partite: il massimo è 60 alla volta.`;
    const shown = d.slice(0, 6).map(shortDate).join(', ');
    return d.length === 1 ? `Si gioca ${shown} alle ${this.time}.` : `${d.length} partite: ${shown}${d.length > 6 ? '…' : ''}`;
  });

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    const [items, settings] = await Promise.all([this.api.matches(), this.api.settings()]);
    this.items.set(items);
    this.settings.set(settings);
  }

  protected tick(): void {
    this.version.update((v) => v + 1);
  }

  protected kitColor(key: string): string {
    return kit(key).color;
  }

  private resetFromSettings(): void {
    const s = this.settings()!;
    this.config.set(configOfSettings(s));
    this.weekday = s.game_weekday;
    this.time = hhmm(s.game_time);
    this.oneDate = nextWeekday(s.game_weekday);
    this.from = this.today;
    this.until = '';
    this.saveDefault = false;
    this.tick();
  }

  protected openCreate(): void {
    this.resetFromSettings();
    this.mode.set('one');
    this.panel.set('create');
  }

  protected openDefaults(): void {
    this.resetFromSettings();
    this.panel.set('defaults');
  }

  protected close(): void {
    this.panel.set('none');
  }

  protected async create(): Promise<void> {
    const dates = this.dates();
    if (dates.length > 60) return this.toasts.error('Al massimo 60 partite alla volta.');
    await this.run(async () => {
      const res = await this.api.createMatches(dates, this.time, this.config()!, this.saveDefault);
      const n = res.created.length;
      this.toasts.show(n === 0 ? 'Nessuna partita creata.' : n === 1 ? 'Partita creata.' : `${n} partite create.`, n ? 'ok' : 'info');
      if (res.skipped.length) {
        this.toasts.show(`Saltate (c'è già una partita o la data è passata): ${res.skipped.map(shortDate).join(', ')}.`, 'info', 9000);
      }
      this.panel.set('none');
      await this.load();
    });
  }

  protected async saveDefaults(): Promise<void> {
    const before = this.settings()!;
    const cfg = this.config()!;
    await this.run(async () => {
      await this.api.updateDefaultConfig(cfg, this.weekday, this.time);
      this.toasts.show('Configurazione predefinita salvata.');
      const fields = changedFields(configOfSettings(before), cfg, hhmm(before.game_time), this.time);
      this.panel.set('none');
      await this.load();
      const upcoming = await this.api.upcomingMatches();
      if (fields.length && upcoming.length) {
        this.apply.set({ matches: upcoming, fields, config: cfg, time: this.time });
        scrollAppTo('start');
      }
    });
  }

  protected async applyTo(ids: string[]): Promise<void> {
    const a = this.apply()!;
    await this.run(async () => {
      const n = await this.api.updateMatchesConfig(ids, a.config, a.fields, a.fields.includes('time') ? a.time : null);
      this.toasts.show(n === 1 ? '1 partita aggiornata.' : `${n} partite aggiornate.`);
      this.apply.set(null);
      await this.load();
    });
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await fn();
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
