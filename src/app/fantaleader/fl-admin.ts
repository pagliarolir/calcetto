import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FantaLeader, FlAudit, FlRule, FlSkill, ruleSummary } from '../core/fantaleader';
import { fmtWhen } from '../core/format';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { Avatar } from '../ui/avatar';
import { Icon } from '../ui/icon';
import { InfoTip } from '../ui/info-tip';
import { Confirm } from '../core/confirm';
import { Sheet } from '../ui/sheet';

/** Area del Leader: mercato, schede del documento, giocatori, skill, ricalcoli e registro. */
@Component({
  selector: 'app-fl-admin',
  imports: [Sheet, FormsModule, Avatar, Icon, InfoTip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let st = fl.settings()!;
    <!-- il «momento» della Gestione: il mercato, l'unico interruttore che tutti sentono -->
    <section class="panel market" [class.open]="st.market_open">
      <app-icon [name]="st.market_open ? 'unlock' : 'lock'" [size]="22" />
      <span class="grow two"><strong>{{ st.market_open ? 'Mercato aperto' : 'Mercato chiuso' }}</strong>
        <small class="muted">{{ st.market_open ? 'Si creano e si cambiano le fantasquadre' : 'Le fantasquadre sono bloccate' }}</small></span>
      <button class="btn small" [class.primary]="!st.market_open" [disabled]="busy()" (click)="toggleMarket()">{{ st.market_open ? 'Chiudi' : 'Apri' }}</button>
    </section>

    <details class="panel fold">
      <summary><h3>Chi vede FantaLeader</h3><app-info-tip [lines]="['In anteprima lo vedono solo il Leader e le persone scelte qui.']" /><app-icon name="chevron" [size]="18" class="chev" /></summary>
      <label class="switch"><span>Visibile a tutti</span><input type="checkbox" role="switch" [checked]="st.public" (change)="setPublic($any($event.target).checked)" [disabled]="busy()" /></label>
      @if (!st.public) {
        <ul class="chips">
          @for (u of st.preview_users; track u) {
            <li><app-avatar [userId]="u" [size]="24" /> {{ session.name(u) }}
              <button type="button" class="rm" [attr.aria-label]="'Togli ' + session.name(u)" [disabled]="busy()" (click)="removePreview(u)"><app-icon name="x" [size]="14" /></button></li>
          } @empty { <li class="small muted">Nessuno oltre al Leader.</li> }
        </ul>
        <select class="input" [ngModel]="''" (ngModelChange)="addPreview($event)" aria-label="Aggiungi all'anteprima" [disabled]="busy()">
          <option value="">Aggiungi una persona…</option>
          @for (m of members(); track m.id) { @if (!st.preview_users.includes(m.id)) { <option [value]="m.id">{{ session.name(m.id) }}</option> } }
        </select>
      }
    </details>

    @if (checks(); as c) {
      <details class="panel fold">
        <summary><h3>Stato dei calcoli</h3>@if (c['homologated_without_points'] > 0 || c['without_votes'] > 0) { <span class="warn-dot" aria-label="Da controllare"></span> }<app-icon name="chevron" [size]="18" class="chev" /></summary>
        <ul class="facts">
          <li><span>Giocatori acquistabili</span><strong>{{ c['eligible'] }}</strong></li>
          <li><span>Fantasquadre</span><strong>{{ c['teams'] }}</strong></li>
          <li><span>Giornate definitive / provvisorie</span><strong>{{ c['matches_final'] }} / {{ c['matches_provisional'] }}</strong></li>
          <li [class.warn]="c['homologated_without_points'] > 0"><span>Giornate omologate senza punti</span><strong>{{ c['homologated_without_points'] }}</strong></li>
          <li [class.warn]="c['without_votes'] > 0"><span>Giornate chiuse con meno di 2 votanti (voto d'ufficio 6)</span><strong>{{ c['without_votes'] }}</strong></li>
          <li><span>Revisioni dopo correzioni</span><strong>{{ c['revisions'] }}</strong></li>
        </ul>
        <button class="btn small" [disabled]="busy()" (click)="recompute()"><app-icon name="undo" [size]="16" /> Ricalcola tutte le giornate</button>
      </details>
    }

    <details class="panel fold">
      <summary><h3>Schede del documento</h3><app-info-tip [lines]="['Collega ogni scheda al profilo del giocatore: gli dà quotazione iniziale, descrizione e skill.']" /><app-icon name="chevron" [size]="18" class="chev" /></summary>
      <ul class="rows">
        @for (p of fl.presets(); track p.code) {
          @let linked = linkedTo(p.code);
          <li>
            <span class="grow"><strong>{{ p.name }}</strong><span class="small muted">quota {{ p.price }}@if (linked) {, collegata a {{ session.name(linked) }}}</span></span>
            <select class="input sm" [ngModel]="linked ?? ''" (ngModelChange)="link(p.code, $event)" [attr.aria-label]="'Profilo di ' + p.name">
              <option value="">{{ linked ? 'Cambia…' : 'Scegli…' }}</option>
              @for (m of members(); track m.id) { <option [value]="m.id">{{ session.name(m.id) }}</option> }
            </select>
          </li>
        }
      </ul>
    </details>

    <details class="panel fold">
      <summary><h3>Giocatori, quotazioni e skill</h3><app-icon name="chevron" [size]="18" class="chev" /></summary>
      <ul class="rows">
        @for (m of members(); track m.id) {
          @let p = fl.playerOf().get(m.id);
          <li>
            <app-avatar [userId]="m.id" [size]="32" />
            <span class="grow"><strong>{{ session.name(m.id) }}</strong>
              <span class="small muted">@if (p) { {{ p.eligible ? 'quota ' + p.price_initial : 'non acquistabile' }}, {{ fl.skillsOf(m.id).length }} skill } @else { non nel FantaLeader }</span></span>
            <button class="ib" (click)="edit(m.id)" [attr.aria-label]="(p ? 'Modifica ' : 'Aggiungi ') + session.name(m.id)"><app-icon [name]="p ? 'pencil' : 'plus'" [size]="18" /></button>
          </li>
        }
      </ul>
    </details>

    <details class="panel fold">
      <summary><h3>Catalogo delle skill</h3><span class="count">{{ fl.skills().length }}</span><app-info-tip [lines]="['Puoi cambiare nome, descrizione, importo e soglie, e attivarle o disattivarle.', 'Le modifiche valgono dal prossimo ricalcolo.']" /><app-icon name="chevron" [size]="18" class="chev" /></summary>
      @for (s of fl.skills(); track s.id) {
        <details class="skill">
          <summary><span class="sign" [class.neg]="s.kind === 'neg'"><app-icon [name]="s.kind === 'pos' ? 'plus' : 'minus'" [size]="14" /></span>
            <span class="grow two"><strong>{{ s.name }}@if (!s.active) { <span class="small muted"> (non attiva)</span> }</strong><span class="small muted">{{ rule(s.rule) }}</span></span></summary>
          <div class="stack-s edit">
            <label class="field"><span>Nome</span><input class="input" [(ngModel)]="draft(s).name" maxlength="60" /></label>
            <label class="field"><span>Descrizione</span><textarea class="input" rows="2" [(ngModel)]="draft(s).description"></textarea></label>
            <div class="nums">
              @for (k of numKeys(s.rule); track k) {
                <label class="field"><span>{{ labels[k] }}</span><input class="input" type="number" step="0.25" [(ngModel)]="draft(s).rule[k]" /></label>
              }
            </div>
            <label class="switch"><span>Attiva</span><input type="checkbox" role="switch" [(ngModel)]="draft(s).active" /></label>
            <button class="btn small primary" [disabled]="busy()" (click)="saveSkill(s)">Salva la skill</button>
          </div>
        </details>
      }
    </details>

    <details class="panel fold" (toggle)="loadAudit($event)">
      <summary><h3>Registro delle modifiche</h3><app-icon name="chevron" [size]="18" class="chev" /></summary>
      <ul class="log">
        @for (a of audit(); track a.id) { <li><span>{{ a.action }}</span><span class="small muted">{{ when(a.at) }}, {{ a.actor ? session.name(a.actor) : 'sistema' }}</span></li> }
        @empty { <li class="small muted">Nessuna operazione registrata.</li> }
      </ul>
    </details>

    <!-- modifica di un giocatore -->
    <dialog #ed class="sheet" (click)="edBackdrop($event)" aria-labelledby="ed-h">
      <div class="grab" aria-hidden="true"></div>
      <button type="button" class="x-close" (click)="ed.close()" aria-label="Chiudi"><span><app-icon name="x" [size]="16" /></span></button>
      @if (editId(); as id) {
        <h3 id="ed-h">{{ session.name(id) }}</h3>
        <label class="switch"><span>Acquistabile nel FantaLeader</span><input type="checkbox" role="switch" [(ngModel)]="form.eligible" /></label>
        <label class="field"><span>Quotazione iniziale (euroLeader)</span><input class="input" type="number" min="1" max="1000" [(ngModel)]="form.price" /></label>
        <label class="field"><span>Descrizione</span><textarea class="input" rows="4" maxlength="2000" [(ngModel)]="form.description"></textarea></label>
        <fieldset class="skills"><legend class="small muted">Skill</legend>
          @for (s of fl.skills(); track s.id) {
            <label class="check"><input type="checkbox" [checked]="form.skills.has(s.id)" (change)="toggleSkill(s.id)" /><span class="sg" [class.neg]="s.kind === 'neg'">{{ s.kind === 'pos' ? '+' : '−' }}</span> {{ s.name }}</label>
          }
        </fieldset>
        <div class="row">
          <button class="btn ghost grow" (click)="closeEd()">Annulla</button>
          <button class="btn primary grow" [disabled]="busy() || !(form.price >= 1)" (click)="savePlayer()">Salva</button>
        </div>
      }
    </dialog>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    h3 { font-size: var(--step-0); margin: 0; }
    .chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
    .chips li { display: inline-flex; align-items: center; gap: 8px; padding: 4px 8px 4px 4px; border-radius: 999px; background: var(--surface-2); font-size: var(--step--1); }
    .rm { border: 0; background: none; color: var(--muted); cursor: pointer; width: 28px; height: 28px; display: grid; place-items: center; }
    .two { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .market { display: flex; align-items: center; gap: 12px; }
    .market > app-icon { color: var(--muted); display: grid; }
    .market.open { box-shadow: inset 4px 0 0 var(--turf); }
    .market.open > app-icon { color: color-mix(in srgb, var(--turf) 70%, var(--ink)); }
    .market .grow { flex: 1; }
    .count { min-width: 24px; height: 20px; padding: 0 4px; border-radius: 10px; display: inline-grid; place-items: center; background: var(--surface-2); color: var(--muted); font: 600 0.75rem/1 var(--font-body); }
    .warn-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); }
    .ib { flex: none; width: 44px; height: 44px; border-radius: 12px; border: 0; background: none; color: var(--ink); display: grid; place-items: center; cursor: pointer; }
    .ib:active { background: var(--surface-2); }
    .sg { width: 12px; text-align: center; font-weight: 600; color: color-mix(in srgb, var(--turf) 70%, var(--ink)); }
    .sg.neg { color: var(--danger); }
    .facts, .rows, .log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .facts li { display: flex; justify-content: space-between; gap: 12px; font-size: var(--step--1); }
    .facts li.warn strong { color: var(--danger); }
    .rows li { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line); }
    .rows li:last-child { border-bottom: 0; }
    .rows .grow { min-width: 0; display: flex; flex-direction: column; }
    .input.sm { width: 130px; flex: none; min-height: 36px; padding: 4px 8px; }
    .skill { border-top: 1px solid var(--line); }
    .skill summary { display: flex; gap: 12px; align-items: flex-start; padding: 8px 0; cursor: pointer; list-style: none; }
    .skill summary::-webkit-details-marker { display: none; }
    .sign { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--turf-soft); color: color-mix(in srgb, var(--turf) 70%, var(--ink)); }
    .sign.neg { background: var(--danger-soft); color: var(--danger); }
    .edit { padding: 0 0 12px 36px; }
    .nums { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
    .check { display: flex; align-items: center; gap: 8px; font-size: var(--step--1); }
    .log li { display: flex; flex-direction: column; gap: 2px; font-size: var(--step--1); padding-bottom: 8px; border-bottom: 1px solid var(--line); }
    .log li:last-child { border-bottom: 0; }
    .skills { border: 1px solid var(--line); border-radius: 12px; padding: 8px 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; max-height: 240px; overflow-y: auto; }
  `,
})
export class FlAdmin implements OnInit {
  private readonly confirmBox = inject(Confirm);
  protected readonly fl = inject(FantaLeader);
  protected readonly session = inject(Session);
  private readonly toasts = inject(Toasts);
  private readonly ed = viewChild<ElementRef<HTMLDialogElement>>('ed');
  protected readonly busy = signal(false);
  protected readonly checks = signal<Record<string, number> | null>(null);
  protected readonly audit = signal<FlAudit[]>([]);
  protected readonly editId = signal<string | null>(null);
  protected form = { eligible: true, price: 10, description: '', skills: new Set<number>() };
  protected readonly rule = ruleSummary;
  protected readonly when = fmtWhen;
  private readonly drafts = new Map<number, { name: string; description: string; active: boolean; rule: FlRule }>();
  protected readonly labels: Record<string, string> = {
    amount: 'Punti', goals_min: 'Gol almeno', goals_max: 'Gol al massimo', conceded_lt: 'Subiti meno di', conceded_gt: 'Subiti più di', avg_gt: 'Media sopra', avg_lt: 'Media sotto',
  };
  protected readonly members = computed(() =>
    [...this.session.members()].sort((a, b) => this.session.name(a.id).localeCompare(this.session.name(b.id))),
  );

  ngOnInit(): void {
    void this.refreshChecks();
  }

  private async refreshChecks(): Promise<void> {
    try { this.checks.set((await this.fl.checks()) as Record<string, number>); } catch { this.checks.set(null); }
  }

  private async run(fn: () => Promise<unknown>, ok: string): Promise<void> {
    this.busy.set(true);
    try {
      await fn();
      this.toasts.show(ok);
      await this.refreshChecks();
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async setPublic(v: boolean): Promise<void> {
    const st = this.fl.settings()!;
    if (v && !(await this.confirmBox.ask({ title: 'Rendere FantaLeader visibile a tutti?', ok: 'Rendi visibile' }))) { this.fl.settings.set({ ...st }); return; }
    void this.run(() => this.fl.setVisibility(v, st.preview_users), v ? 'FantaLeader ora è visibile a tutti.' : 'FantaLeader torna in anteprima.');
  }

  protected addPreview(id: string): void {
    if (!id) return;
    const st = this.fl.settings()!;
    void this.run(() => this.fl.setVisibility(st.public, [...st.preview_users, id]), `${this.session.name(id)} ora vede FantaLeader.`);
  }

  protected removePreview(id: string): void {
    const st = this.fl.settings()!;
    void this.run(() => this.fl.setVisibility(st.public, st.preview_users.filter((u) => u !== id)), `${this.session.name(id)} non vede più FantaLeader.`);
  }

  protected async toggleMarket(): Promise<void> {
    const open = this.fl.settings()!.market_open;
    const ok = await this.confirmBox.ask(open
      ? { title: 'Chiudere il mercato e bloccare le fantasquadre?', ok: 'Chiudi il mercato' }
      : { title: 'Aprire il mercato a tutti?', ok: 'Apri il mercato' });
    if (!ok) return;
    void this.run(() => this.fl.setMarket(!open), open ? 'Mercato chiuso.' : 'Mercato aperto.');
  }

  protected recompute(): void {
    void this.run(async () => this.toasts.show(`Ricalcolate ${await this.fl.recomputeAll()} giornate.`), 'Ricalcolo completato.');
  }

  protected linkedTo(code: string): string | null {
    return this.fl.players().find((p) => p.preset_code === code)?.user_id ?? null;
  }

  protected link(code: string, userId: string): void {
    if (!userId) return;
    const name = this.fl.presets().find((p) => p.code === code)?.name;
    void this.run(() => this.fl.linkPreset(code, userId), `${name} collegato a ${this.session.name(userId)}.`);
  }

  protected edit(userId: string): void {
    const p = this.fl.playerOf().get(userId);
    this.form = {
      eligible: p?.eligible ?? true, price: p?.price_initial ?? 10, description: p?.description ?? '',
      skills: new Set(this.fl.playerSkills().filter((x) => x.user_id === userId).map((x) => x.skill_id)),
    };
    this.editId.set(userId);
    queueMicrotask(() => { const d = this.ed()?.nativeElement; if (d && !d.open) d.showModal(); });
  }

  protected toggleSkill(id: number): void {
    if (this.form.skills.has(id)) this.form.skills.delete(id); else this.form.skills.add(id);
  }

  protected closeEd(): void {
    this.ed()?.nativeElement.close();
    this.editId.set(null);
  }

  protected edBackdrop(e: MouseEvent): void {
    if (e.target === this.ed()?.nativeElement) this.closeEd();
  }

  protected savePlayer(): void {
    const id = this.editId()!;
    void this.run(async () => {
      await this.fl.savePlayer(id, this.form.eligible, Math.round(this.form.price), this.form.description);
      await this.fl.setPlayerSkills(id, [...this.form.skills]);
      await this.fl.load();
      this.closeEd();
    }, `${this.session.name(id)} salvato.`);
  }

  protected draft(s: FlSkill) {
    if (!this.drafts.has(s.id)) this.drafts.set(s.id, { name: s.name, description: s.description, active: s.active, rule: { ...s.rule } });
    return this.drafts.get(s.id)! as { name: string; description: string; active: boolean; rule: Record<string, unknown> & FlRule };
  }

  protected numKeys(r: FlRule): string[] {
    return Object.keys(this.labels).filter((k) => k in r);
  }

  protected saveSkill(s: FlSkill): void {
    const d = this.draft(s);
    const rule = { ...d.rule };
    for (const k of this.numKeys(rule)) (rule as Record<string, unknown>)[k] = Number((rule as Record<string, unknown>)[k]);
    void this.run(() => this.fl.saveSkill({ id: s.id, name: d.name, kind: s.kind, description: d.description, rule, active: d.active }), `Skill «${d.name}» salvata.`);
  }

  protected loadAudit(e: Event): void {
    if ((e.target as HTMLDetailsElement).open) void this.fl.audit().then((a) => this.audit.set(a)).catch(() => undefined);
  }
}
