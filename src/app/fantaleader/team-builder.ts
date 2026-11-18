import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FantaLeader, fmtPts } from '../core/fantaleader';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { Avatar } from '../ui/avatar';
import { Icon } from '../ui/icon';
import { InfoTip } from '../ui/info-tip';

/** La mia fantasquadra: vista (punti, capitano, spesa) e, a mercato aperto, creazione o modifica. */
@Component({
  selector: 'app-fl-team',
  imports: [Avatar, FormsModule, Icon, InfoTip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let st = fl.settings()!;
    @if (!editing()) {
      @if (fl.myTeam(); as t) {
        <!-- il «momento» della scheda: la squadra, con il fondo dell'intestazione -->
        <section class="hero-card">
          <div class="spread">
            <span class="two"><span class="lbl">Allenatore {{ session.name(t.owner_id) }}</span><h2>{{ t.name }}</h2></span>
            <span class="score"><strong class="num">{{ fmt(t.total) }}</strong><small>{{ t.pos }}° posto</small></span>
          </div>
          <div class="facts">
            <span><small>Spesi</small><strong class="num">{{ t.spent }}</strong></span>
            <span><small>Residui</small><strong class="num">{{ st.budget - t.spent }}</strong></span>
            <span><small>Ultima</small><strong class="num">{{ fmt(t.last_points) }}</strong></span>
          </div>
        </section>
        <section class="section">
          <header><h2>Giocatori</h2>@if (t.provisional) { <app-info-tip [lines]="['Alcuni punti sono provvisori finché le pagelle sono aperte.']" /> }</header>
          <ul class="list">
            @for (u of t.members; track u; let i = $index) {
              <li><button type="button" class="list-item" (click)="openPlayer.emit(u)">
                <span class="av"><app-avatar [userId]="u" [size]="40" />@if (u === t.captain_id) { <span class="cap" aria-label="Capitano">C</span> }</span>
                <span class="grow two"><span class="ellipsis"><strong>{{ session.name(u) }}</strong></span><small class="muted">pagato {{ fl.myVersion()?.prices?.[i] ?? '–' }}</small></span>
                <strong class="num pts">{{ fmt(fl.rankOf().get(u)?.total) }}</strong>
              </button></li>
            }
          </ul>
        </section>
        @if (st.market_open) {
          <button class="btn block" (click)="startEdit()"><app-icon name="pencil" [size]="18" /> Modifica la fantasquadra
            <app-info-tip [lines]="['Il mercato è aperto: ogni giocatore si paga alla quotazione attuale.']" /></button>
        } @else {
          <p class="note"><app-icon name="lock" [size]="16" /> Mercato chiuso: la squadra si potrà cambiare quando lo riaprirà il Leader.</p>
        }
      } @else if (st.market_open) {
        <section class="panel stack">
          <h2>Crea la tua fantasquadra</h2>
          <p class="muted">Scegli {{ st.team_size }} giocatori con {{ st.budget }} euroLeader e nomina il capitano.</p>
          <button class="btn primary block" (click)="startEdit()"><app-icon name="plus" [size]="18" /> Inizia</button>
        </section>
      } @else {
        <p class="note"><app-icon name="lock" [size]="16" /> Mercato chiuso: potrai creare la tua fantasquadra quando lo aprirà il Leader.</p>
      }
    } @else {
      <!-- ============================== costruttore -->
      <section class="stack">
        <label class="field"><span>Nome della fantasquadra</span>
          <input class="input" [(ngModel)]="name" maxlength="40" placeholder="Es. I Galacticos del giovedì" />
        </label>
        @if (removedSelf()) {
          <p class="note">Ti ho tolto dalla squadra: non puoi far parte della tua fantasquadra. Scegli un altro giocatore al tuo posto.</p>
        }
        <div class="bar" role="status">
          <span><strong>{{ picked().length }}</strong>/{{ st.team_size }}</span>
          <span>Spesi <strong>{{ spent() }}</strong></span>
          <span [class.over]="spent() > st.budget">Residui <strong>{{ st.budget - spent() }}</strong></span>
          <span>Capitano <strong>{{ captain() ? session.name(captain()) : '–' }}</strong></span>
          <button type="button" class="zero" [disabled]="!picked().length" (click)="reset()" aria-label="Azzera la squadra"><app-icon name="undo" [size]="16" /> Azzera</button>
        </div>
        <label class="search"><app-icon name="search" [size]="18" /><input class="input" type="search" [(ngModel)]="q" placeholder="Cerca un giocatore" aria-label="Cerca un giocatore" />
          <app-info-tip class="tip" [lines]="['Tu non puoi far parte della tua fantasquadra.', 'Tocca il prezzo per prendere un giocatore, la «C» per nominare il capitano.']" /></label>
        <ul class="pick">
          @for (p of list(); track p.user_id) {
            @let sel = picked().includes(p.user_id);
            <li [class.sel]="sel">
              <button type="button" class="who" (click)="openPlayer.emit(p.user_id)" [attr.aria-label]="'Scheda di ' + session.name(p.user_id)">
                <app-avatar [userId]="p.user_id" [size]="36" />
                <span class="grow"><strong>{{ session.name(p.user_id) }}</strong>
                  <span class="small muted">{{ fmt(fl.rankOf().get(p.user_id)?.total) }} punti
                    @if (delta(p.user_id); as d) { <span [class.up]="d > 0" [class.down]="d < 0">, quota {{ d > 0 ? '+' : '' }}{{ d }}</span> }</span></span>
              </button>
              @if (sel) {
                <button type="button" class="c" [class.on]="captain() === p.user_id" (click)="captain.set(p.user_id)"
                        [attr.aria-pressed]="captain() === p.user_id" [attr.aria-label]="'Capitano: ' + session.name(p.user_id)">C</button>
              }
              <button type="button" class="price" [class.on]="sel" [disabled]="!sel && !canAdd(p.user_id)" (click)="toggle(p.user_id)"
                      [attr.aria-pressed]="sel" [attr.aria-label]="(sel ? 'Togli ' : 'Prendi ') + session.name(p.user_id) + ' per ' + price(p.user_id)">
                {{ price(p.user_id) }}
              </button>
            </li>
          }
        </ul>
        @if (problem(); as why) { <p class="small muted">{{ why }}</p> }
        <div class="row actions">
          <button class="btn ghost grow" [disabled]="busy()" (click)="editing.set(false)">Annulla</button>
          <button class="btn primary grow" [disabled]="!!problem() || busy()" (click)="confirm()">Conferma la squadra</button>
        </div>
      </section>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 24px; }
    h2 { font-size: var(--step-1); margin: 0; }
    .two { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .grow { flex: 1; }
    .ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* la squadra: fondo dell'intestazione, punti sul gesso */
    .hero-card { display: flex; flex-direction: column; gap: 16px; padding: 20px; border-radius: var(--r-l); background: var(--hero-bg); color: var(--hero-ink); }
    .hero-card h2 { font: 500 var(--step-2)/1.1 var(--font-display); color: inherit; overflow-wrap: anywhere; }
    .hero-card .lbl { font-size: var(--step--1); opacity: 0.85; }
    .hero-card .score { display: flex; flex-direction: column; align-items: center; flex: none; min-width: 72px; padding: 8px 12px; border-radius: var(--r-m);
      background: var(--chalk, #f4f7f2); color: var(--on-chalk); }
    .hero-card .score strong { font: 600 var(--step-3)/1 var(--font-display); }
    .hero-card .score small { font-size: 0.7rem; }
    .facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .facts span { display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; border-radius: var(--r-m); background: rgb(255 255 255 / 12%); }
    .facts small { font-size: 0.72rem; opacity: 0.85; }
    .facts strong { font: 600 var(--step-1)/1 var(--font-display); }
    .section > header { align-items: center; }
    .list-item { min-height: 56px; padding: 8px 16px; }
    .pts { font: 600 var(--step-1)/1 var(--font-display); }
    .note { display: flex; align-items: center; gap: 8px; }
    .btn app-info-tip { margin-left: 4px; }
    .budget, .bar { display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: var(--step--1); color: var(--muted); }
    .budget strong, .bar strong { color: var(--ink); }
    .bar { position: sticky; top: 0; z-index: 2; align-items: center; padding: 12px 16px; border-radius: var(--r-m); background: var(--surface); border: 1px solid var(--line); }
    .bar .over strong { color: var(--danger); }
    .zero { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; min-height: 36px; border: 1.5px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 999px; padding: 0 12px;
            font: 600 var(--step--1)/1 var(--font-body); cursor: pointer; }
    .zero:disabled { opacity: 0.4; cursor: not-allowed; }
    .search { position: relative; display: block; }
    .search > app-icon { position: absolute; left: 12px; top: 50%; translate: 0 -50%; color: var(--muted); pointer-events: none; display: grid; }
    .search .input { padding-left: 40px; padding-right: 48px; }
    .search .tip { position: absolute; right: 4px; top: 50%; translate: 0 -50%; }
    .up { color: color-mix(in srgb, var(--turf) 70%, var(--ink)); font-weight: 600; } .down { color: var(--danger); font-weight: 600; }
    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    ul.list { gap: 0; }
    .who { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; border: 0; background: none; padding: 0; text-align: left; color: inherit; cursor: pointer; }
    .who .grow { min-width: 0; display: flex; flex-direction: column; }
    .who strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .av { position: relative; display: inline-grid; flex: none; }
    .cap { position: absolute; right: -4px; bottom: -4px; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center;
           background: var(--armband); color: var(--armband-ink); font: 600 0.72rem/1 var(--font-display); box-shadow: 0 0 0 2px var(--surface); }
    .pick li { display: flex; align-items: center; gap: 8px; min-height: 56px; padding: 8px 8px 8px 12px; border-radius: var(--r-m); background: var(--surface); border: 1px solid var(--line); }
    .pick li.sel { background: var(--turf-soft); border-color: transparent; }
    .price { flex: none; min-width: 52px; height: 40px; border-radius: 12px; border: 1.5px solid var(--line); background: var(--surface); color: var(--ink);
             font: 600 var(--step-0)/1 var(--font-display); cursor: pointer; }
    .price.on { background: var(--turf); border-color: var(--turf); color: var(--turf-ink); }
    .price:disabled { opacity: 0.35; cursor: not-allowed; }
    .c { flex: none; width: 40px; height: 40px; border-radius: 50%; border: 1.5px dashed var(--muted); background: none; color: var(--ink); font: 600 0.85rem/1 var(--font-display); cursor: pointer; }
    .c.on { border: 0; background: var(--armband); color: var(--armband-ink); }
    .actions { position: sticky; bottom: 0; padding: 12px 0 4px; background: var(--bg); }
  `,
})
export class FlTeam {
  protected readonly fl = inject(FantaLeader);
  protected readonly session = inject(Session);
  private readonly toasts = inject(Toasts);
  readonly openPlayer = output<string>();
  protected readonly editing = signal(false);
  protected readonly busy = signal(false);
  protected readonly picked = signal<string[]>([]);
  protected readonly captain = signal<string | null>(null);
  protected name = '';
  protected q = '';
  protected readonly fmt = fmtPts;

  protected price(userId: string): number {
    return this.fl.rankOf().get(userId)?.price_current ?? this.fl.playerOf().get(userId)?.price_initial ?? 0;
  }

  /** variazione della quotazione attuale rispetto all'iniziale (0 = nessuna) */
  protected delta(userId: string): number {
    const r = this.fl.rankOf().get(userId);
    return r ? r.price_current - r.price_initial : 0;
  }

  protected readonly spent = computed(() => this.picked().reduce((s, u) => s + this.price(u), 0));

  protected list() {
    const q = this.q.trim().toLowerCase();
    return this.fl.eligible()
      .filter((p) => p.user_id !== this.session.uid())   // nessuno sceglie sé stesso
      .filter((p) => !q || this.session.name(p.user_id).toLowerCase().includes(q))
      .sort((a, b) => this.price(b.user_id) - this.price(a.user_id) || this.session.name(a.user_id).localeCompare(this.session.name(b.user_id)));
  }

  protected canAdd(userId: string): boolean {
    const st = this.fl.settings()!;
    return this.picked().length < st.team_size && this.spent() + this.price(userId) <= st.budget;
  }

  protected toggle(userId: string): void {
    if (this.picked().includes(userId)) {
      this.picked.update((l) => l.filter((x) => x !== userId));
      if (this.captain() === userId) this.captain.set(null);
    } else if (this.canAdd(userId)) {
      this.picked.update((l) => [...l, userId]);
    }
  }

  /** «Azzera»: toglie tutti i giocatori e il capitano in un colpo */
  protected reset(): void {
    this.picked.set([]);
    this.captain.set(null);
  }

  protected readonly problem = computed(() => {
    const st = this.fl.settings()!;
    const n = this.picked().length;
    if (n !== st.team_size) return `Scegli ancora ${st.team_size - n} ${st.team_size - n === 1 ? 'giocatore' : 'giocatori'}.`;
    if (this.spent() > st.budget) return `Hai superato il budget di ${this.spent() - st.budget} euroLeader.`;
    if (!this.captain()) return 'Tocca la «C» accanto a un giocatore per nominare il capitano.';
    return null;
  });

  /** la squadra conteneva l'allenatore (creata prima della regola «non puoi sceglierti»): tolto in automatico */
  protected readonly removedSelf = signal(false);

  protected startEdit(): void {
    const v = this.fl.myVersion();
    const me = this.session.uid();
    const members = v ? [...v.members] : [];
    this.removedSelf.set(!!me && members.includes(me));
    this.picked.set(members.filter((u) => u !== me));
    this.captain.set(v?.captain_id && v.captain_id !== me ? v.captain_id : null);
    this.name = this.fl.myTeam()?.name ?? '';
    this.editing.set(true);
  }

  protected async confirm(): Promise<void> {
    if (this.name.trim().length < 2) { this.toasts.error('Dai un nome alla tua fantasquadra.'); return; }
    this.busy.set(true);
    try {
      const r = await this.fl.confirmTeam(this.name.trim(), this.picked(), this.captain()!);
      this.toasts.show(`Fantasquadra confermata: spesi ${r.spent}, residui ${r.left}.`);
      this.editing.set(false);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
