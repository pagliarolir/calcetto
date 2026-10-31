import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FantaLeader, fmtPts } from '../core/fantaleader';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { Avatar } from '../ui/avatar';

/** La mia fantasquadra: vista (punti, capitano, spesa) e, a mercato aperto, creazione o modifica. */
@Component({
  selector: 'app-fl-team',
  imports: [Avatar, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let st = fl.settings()!;
    @if (!editing()) {
      @if (fl.myTeam(); as t) {
        <section class="panel stack">
          <div class="spread">
            <div><p class="small muted">La tua fantasquadra · allenatore {{ session.name(t.owner_id) }}</p><h2>{{ t.name }}</h2></div>
            <div class="big"><strong class="num">{{ fmt(t.total) }}</strong><span class="small muted">{{ t.pos }}° posto</span></div>
          </div>
          <div class="budget"><span>Spesi <strong>{{ t.spent }}</strong></span><span>Residui <strong>{{ st.budget - t.spent }}</strong></span><span>Ultima giornata <strong>{{ fmt(t.last_points) }}</strong></span></div>
          <ul class="mine">
            @for (u of t.members; track u; let i = $index) {
              <li>
                <button type="button" class="who" (click)="openPlayer.emit(u)">
                  <span class="av"><app-avatar [userId]="u" [size]="40" />@if (u === t.captain_id) { <span class="cap" aria-label="Capitano">C</span> }</span>
                  <span class="grow"><strong>{{ session.name(u) }}</strong><span class="small muted">pagato {{ fl.myVersion()?.prices?.[i] ?? '–' }} · {{ fmt(fl.rankOf().get(u)?.total) }} punti</span></span>
                </button>
              </li>
            }
          </ul>
          @if (t.provisional) { <p class="small muted">Alcuni punti sono provvisori finché le pagelle sono aperte.</p> }
        </section>
        @if (st.market_open) {
          <button class="btn block" (click)="startEdit()">Modifica la fantasquadra</button>
          <p class="small muted">Il mercato è aperto: ogni giocatore si paga alla quotazione attuale.</p>
        } @else {
          <p class="note">Il mercato è chiuso: la squadra si potrà cambiare quando lo riaprirà il Leader.</p>
        }
      } @else if (st.market_open) {
        <section class="panel stack">
          <h2>Crea la tua fantasquadra</h2>
          <p class="muted">Scegli {{ st.team_size }} giocatori con {{ st.budget }} euroLeader e nomina il capitano. Partecipi come {{ session.name(session.uid()) }}.</p>
          <button class="btn primary block" (click)="startEdit()">Inizia</button>
        </section>
      } @else {
        <p class="note">Il mercato è chiuso: potrai creare la tua fantasquadra quando lo aprirà il Leader.</p>
      }
    } @else {
      <!-- ============================== costruttore -->
      <section class="stack">
        <label class="field"><span>Nome della fantasquadra</span>
          <input class="input" [(ngModel)]="name" maxlength="40" placeholder="Es. I Galacticos del giovedì" />
        </label>
        <div class="bar" role="status">
          <span><strong>{{ picked().length }}</strong>/{{ st.team_size }}</span>
          <span>Spesi <strong>{{ spent() }}</strong></span>
          <span [class.over]="spent() > st.budget">Residui <strong>{{ st.budget - spent() }}</strong></span>
          <span>Capitano <strong>{{ captain() ? session.name(captain()) : '–' }}</strong></span>
        </div>
        <input class="input" type="search" [(ngModel)]="q" placeholder="Cerca un giocatore" aria-label="Cerca un giocatore" />
        <ul class="pick">
          @for (p of list(); track p.user_id) {
            @let sel = picked().includes(p.user_id);
            <li [class.sel]="sel">
              <button type="button" class="who" (click)="openPlayer.emit(p.user_id)" [attr.aria-label]="'Scheda di ' + session.name(p.user_id)">
                <app-avatar [userId]="p.user_id" [size]="36" />
                <span class="grow"><strong>{{ session.name(p.user_id) }}</strong><span class="small muted">{{ fmt(fl.rankOf().get(p.user_id)?.total) }} punti</span></span>
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
    h2 { font-size: var(--step-1); }
    .big { display: flex; flex-direction: column; align-items: flex-end; }
    .big strong { font: 800 var(--step-3)/1 var(--font-display); }
    .budget, .bar { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: var(--step--1); color: var(--muted); }
    .budget strong, .bar strong { color: var(--ink); }
    .bar { position: sticky; top: 0; z-index: 2; padding: 10px 12px; border-radius: 12px; background: var(--surface); box-shadow: 0 0 0 1px var(--line), 0 6px 14px -10px rgb(0 0 0 / 30%); }
    .bar .over strong { color: var(--danger); }
    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .who { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; border: 0; background: none; padding: 0; text-align: left; color: inherit; cursor: pointer; }
    .who .grow { min-width: 0; display: flex; flex-direction: column; }
    .who strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mine li { padding: 6px 0; border-bottom: 1px solid var(--line); }
    .mine li:last-child { border-bottom: 0; }
    .av { position: relative; display: inline-grid; }
    .cap { position: absolute; right: -4px; bottom: -4px; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center;
           background: var(--armband); color: var(--armband-ink); font: 800 0.72rem/1 var(--font-display); box-shadow: 0 0 0 2px var(--surface); }
    .pick li { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 14px; background: var(--surface); box-shadow: 0 0 0 1px var(--line); }
    .pick li.sel { box-shadow: 0 0 0 2px var(--turf); background: var(--turf-soft); }
    .price { flex: none; min-width: 52px; height: 36px; border-radius: 10px; border: 1.5px solid var(--line); background: var(--surface); color: var(--ink);
             font: 800 var(--step-0)/1 var(--font-display); cursor: pointer; }
    .price.on { background: var(--turf); border-color: var(--turf); color: var(--turf-ink); }
    .price:disabled { opacity: 0.35; cursor: not-allowed; }
    .c { flex: none; width: 34px; height: 34px; border-radius: 50%; border: 1.5px dashed var(--armband); background: none; color: var(--armband-ink); font: 800 0.85rem/1 var(--font-display); cursor: pointer; }
    .c.on { border-style: solid; background: var(--armband); }
    .actions { position: sticky; bottom: 0; padding: 10px 0 4px; background: var(--bg); }
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

  protected readonly spent = computed(() => this.picked().reduce((s, u) => s + this.price(u), 0));

  protected list() {
    const q = this.q.trim().toLowerCase();
    return this.fl.eligible()
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

  protected readonly problem = computed(() => {
    const st = this.fl.settings()!;
    const n = this.picked().length;
    if (n !== st.team_size) return `Scegli ancora ${st.team_size - n} ${st.team_size - n === 1 ? 'giocatore' : 'giocatori'}.`;
    if (this.spent() > st.budget) return `Hai superato il budget di ${this.spent() - st.budget} euroLeader.`;
    if (!this.captain()) return 'Tocca la «C» accanto a un giocatore per nominare il capitano.';
    return null;
  });

  protected startEdit(): void {
    const v = this.fl.myVersion();
    this.picked.set(v ? [...v.members] : []);
    this.captain.set(v?.captain_id ?? null);
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
