import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FantaLeader, FlAudit, FlRule, FlSkill, ruleSummary } from '../core/fantaleader';
import { fmtWhen } from '../core/format';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { Avatar } from '../ui/avatar';
import { Icon } from '../ui/icon';

/** Area del Leader: mercato, schede del documento, giocatori, skill, ricalcoli e registro. */
@Component({
  selector: 'app-fl-admin',
  imports: [FormsModule, Avatar, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let st = fl.settings()!;
    <section class="panel stack">
      <div class="spread">
        <div><h3>Mercato</h3><p class="small muted">{{ st.market_open ? 'Aperto: si creano e si cambiano le fantasquadre.' : 'Chiuso: le fantasquadre sono bloccate.' }}</p></div>
        <button class="btn" [class.primary]="!st.market_open" [class.danger]="st.market_open" [disabled]="busy()" (click)="toggleMarket()">
          {{ st.market_open ? 'Chiudi il mercato' : 'Apri il mercato' }}</button>
      </div>
    </section>

    <section class="panel stack-s">
      <h3>Chi vede FantaLeader</h3>
      <label class="check"><input type="checkbox" [ngModel]="st.public" (ngModelChange)="setPublic($event)" [disabled]="busy()" /> Visibile a tutti</label>
      @if (!st.public) {
        <p class="small muted">In anteprima: lo vedono solo il Leader e queste persone.</p>
        <ul class="chips">
          @for (u of st.preview_users; track u) {
            <li><app-avatar [userId]="u" [size]="24" /> {{ session.name(u) }}
              <button type="button" class="rm" [attr.aria-label]="'Togli ' + session.name(u)" [disabled]="busy()" (click)="removePreview(u)">✕</button></li>
          } @empty { <li class="small muted">Nessuno oltre al Leader.</li> }
        </ul>
        <select class="input" [ngModel]="''" (ngModelChange)="addPreview($event)" aria-label="Aggiungi all'anteprima" [disabled]="busy()">
          <option value="">Aggiungi una persona…</option>
          @for (m of members(); track m.id) { @if (!st.preview_users.includes(m.id)) { <option [value]="m.id">{{ session.name(m.id) }}</option> } }
        </select>
      }
    </section>

    @if (checks(); as c) {
      <section class="panel stack-s">
        <h3>Stato dei calcoli</h3>
        <ul class="facts">
          <li><span>Giocatori acquistabili</span><strong>{{ c['eligible'] }}</strong></li>
          <li><span>Fantasquadre</span><strong>{{ c['teams'] }}</strong></li>
          <li><span>Giornate definitive / provvisorie</span><strong>{{ c['matches_final'] }} / {{ c['matches_provisional'] }}</strong></li>
          <li [class.warn]="c['homologated_without_points'] > 0"><span>Giornate omologate senza punti</span><strong>{{ c['homologated_without_points'] }}</strong></li>
          <li [class.warn]="c['without_votes'] > 0"><span>Giornate chiuse con meno di 2 votanti (voto d'ufficio 6)</span><strong>{{ c['without_votes'] }}</strong></li>
          <li><span>Revisioni dopo correzioni</span><strong>{{ c['revisions'] }}</strong></li>
        </ul>
        <button class="btn small" [disabled]="busy()" (click)="recompute()">Ricalcola tutte le giornate</button>
      </section>
    }

    <details class="panel fold">
      <summary><h3>Schede del documento</h3><app-icon name="chevron" [size]="18" class="chev" /></summary>
      <p class="small muted">Collega ogni scheda al profilo del giocatore: gli dà quotazione iniziale, descrizione e skill.</p>
      <ul class="rows">
        @for (p of fl.presets(); track p.code) {
          @let linked = linkedTo(p.code);
          <li>
            <span class="grow"><strong>{{ p.name }}</strong> <span class="small muted">Q.i. {{ p.price }}</span>
              @if (linked) { <span class="small"> → {{ session.name(linked) }}</span> }</span>
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
              <span class="small muted">@if (p) { {{ p.eligible ? 'Q.i. ' + p.price_initial : 'non acquistabile' }} · {{ fl.skillsOf(m.id).length }} skill } @else { non nel FantaLeader }</span></span>
            <button class="btn small" (click)="edit(m.id)">{{ p ? 'Modifica' : 'Aggiungi' }}</button>
          </li>
        }
      </ul>
    </details>

    <details class="panel fold">
      <summary><h3>Catalogo delle skill ({{ fl.skills().length }})</h3><app-icon name="chevron" [size]="18" class="chev" /></summary>
      <p class="small muted">Puoi cambiare nome, descrizione, importo e soglie, e attivarle o disattivarle. Le modifiche valgono dal prossimo ricalcolo.</p>
      @for (s of fl.skills(); track s.id) {
        <details class="skill">
          <summary><span class="sign" [class.neg]="s.kind === 'neg'">{{ s.kind === 'pos' ? '+' : '−' }}</span>
            <span class="grow"><strong>{{ s.name }}</strong>@if (!s.active) { <span class="small muted"> · non attiva</span> }<br /><span class="small muted">{{ rule(s.rule) }}</span></span></summary>
          <div class="stack-s edit">
            <label class="field"><span>Nome</span><input class="input" [(ngModel)]="draft(s).name" maxlength="60" /></label>
            <label class="field"><span>Descrizione</span><textarea class="input" rows="2" [(ngModel)]="draft(s).description"></textarea></label>
            <div class="nums">
              @for (k of numKeys(s.rule); track k) {
                <label class="field"><span>{{ labels[k] }}</span><input class="input" type="number" step="0.25" [(ngModel)]="draft(s).rule[k]" /></label>
              }
            </div>
            <label class="check"><input type="checkbox" [(ngModel)]="draft(s).active" /> Attiva</label>
            <button class="btn small primary" [disabled]="busy()" (click)="saveSkill(s)">Salva la skill</button>
          </div>
        </details>
      }
    </details>

    <details class="panel fold" (toggle)="loadAudit($event)">
      <summary><h3>Registro delle modifiche</h3><app-icon name="chevron" [size]="18" class="chev" /></summary>
      <ul class="log">
        @for (a of audit(); track a.id) { <li><span class="small muted">{{ when(a.at) }} · {{ a.actor ? session.name(a.actor) : 'sistema' }}</span><br />{{ a.action }}</li> }
        @empty { <li class="small muted">Nessuna operazione registrata.</li> }
      </ul>
    </details>

    <!-- modifica di un giocatore -->
    <dialog #ed class="sheet" (click)="edBackdrop($event)" aria-labelledby="ed-h">
      @if (editId(); as id) {
        <h3 id="ed-h">{{ session.name(id) }}</h3>
        <label class="check"><input type="checkbox" [(ngModel)]="form.eligible" /> Acquistabile nel FantaLeader</label>
        <label class="field"><span>Quotazione iniziale (euroLeader)</span><input class="input" type="number" min="1" max="1000" [(ngModel)]="form.price" /></label>
        <label class="field"><span>Descrizione</span><textarea class="input" rows="4" maxlength="2000" [(ngModel)]="form.description"></textarea></label>
        <fieldset class="skills"><legend class="small muted">Skill</legend>
          @for (s of fl.skills(); track s.id) {
            <label class="check"><input type="checkbox" [checked]="form.skills.has(s.id)" (change)="toggleSkill(s.id)" /> {{ s.kind === 'pos' ? '+' : '−' }} {{ s.name }}</label>
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
    :host { display: flex; flex-direction: column; gap: 14px; }
    h3 { font-size: var(--step-0); margin: 0; }
    .chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .chips li { display: inline-flex; align-items: center; gap: 6px; padding: 4px 6px 4px 4px; border-radius: 999px; background: var(--surface-2); font-size: var(--step--1); }
    .rm { border: 0; background: none; color: var(--muted); cursor: pointer; width: 24px; height: 24px; }
    .facts, .rows, .log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .facts li { display: flex; justify-content: space-between; gap: 10px; font-size: var(--step--1); }
    .facts li.warn strong { color: var(--danger); }
    .rows li { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--line); }
    .rows li:last-child { border-bottom: 0; }
    .rows .grow { min-width: 0; display: flex; flex-direction: column; }
    .input.sm { width: 130px; flex: none; min-height: 36px; padding: 4px 8px; }
    .skill { border-top: 1px solid var(--line); }
    .skill summary { display: flex; gap: 10px; align-items: flex-start; padding: 8px 0; cursor: pointer; list-style: none; }
    .skill summary::-webkit-details-marker { display: none; }
    .sign { flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; background: var(--turf); color: var(--turf-ink); }
    .sign.neg { background: var(--danger); color: #fff; }
    .edit { padding: 0 0 12px 32px; }
    .nums { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
    .check { display: flex; align-items: center; gap: 8px; font-size: var(--step--1); }
    .log li { font-size: var(--step--1); }
    .sheet { position: fixed; inset: auto 0 0 0; margin: 0 auto; width: 100%; max-width: 560px; max-height: 88dvh; overflow-y: auto; border: 0; color: var(--ink);
             background: var(--surface); border-radius: 22px 22px 0 0; padding: 16px 16px calc(20px + env(safe-area-inset-bottom, 0px)); box-shadow: 0 -10px 40px rgb(0 0 0 / 25%); }
    .sheet[open] { display: flex; flex-direction: column; gap: 12px; }
    .sheet::backdrop { background: rgb(10 20 14 / 45%); }
    .skills { border: 1px solid var(--line); border-radius: 12px; padding: 8px 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; max-height: 240px; overflow-y: auto; }
  `,
})
export class FlAdmin implements OnInit {
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
    amount: 'Punti', goals_min: 'Gol almeno', goals_max: 'Gol al massimo', conceded_lt: 'Subiti meno di', avg_gt: 'Media sopra', avg_lt: 'Media sotto',
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

  protected setPublic(v: boolean): void {
    const st = this.fl.settings()!;
    if (v && !confirm('Rendere FantaLeader visibile a tutti i giocatori?')) { this.fl.settings.set({ ...st }); return; }
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

  protected toggleMarket(): void {
    const open = this.fl.settings()!.market_open;
    const msg = open
      ? 'Chiudere il mercato? Le fantasquadre si bloccano e le quotazioni attuali diventano le nuove quotazioni iniziali.'
      : 'Aprire il mercato? Tutti potranno creare o cambiare la fantasquadra, pagando i giocatori alla quotazione attuale.';
    if (!confirm(msg)) return;
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
