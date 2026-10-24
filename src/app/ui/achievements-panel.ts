import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Achievements } from '../core/achievements';
import { fmtWhen } from '../core/format';
import { Achievement } from '../core/models';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { Avatar } from './avatar';
import { Icon } from './icon';

/** Scheda «Obiettivi»: album degli sticker, dettaglio, classifica e strumenti del Leader. */
@Component({
  selector: 'app-achievements-panel',
  imports: [FormsModule, RouterLink, Avatar, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack-l">
      <div class="intro panel">
        <p>Completa le missioni per vincere gli sticker. <strong>Il primo che li completerà tutti riceverà tutti i poteri del Leader.</strong></p>
        <p class="small muted">Di ogni sticker vedi il nome; la missione si scopre solo dopo averlo sbloccato.</p>
      </div>

      <section class="section" aria-labelledby="album-h">
        <header><h2 id="album-h">Il tuo album</h2><span class="small muted">{{ mineCount() }} su {{ ach.list().length }}</span></header>
        <ul class="album">
          @for (a of ach.list(); track a.id) {
            <li>
              <button class="sticker" [class.got]="!!ach.mine(a.id)" (click)="open(a)"
                      [attr.aria-label]="'Sticker numero ' + a.number + ', ' + a.name + (ach.mine(a.id) ? ', sbloccato' : ', da sbloccare')">
                <span class="pic">
                  @if (ach.mine(a.id)) {
                    @if (ach.imageUrl(a); as u) { <img [src]="u" alt="" /> } @else { <span class="ph star" aria-hidden="true">★</span> }
                  } @else {
                    <span class="ph" aria-hidden="true"><app-icon name="lock" [size]="22" /></span>
                  }
                  <span class="num">{{ a.number }}</span>
                </span>
                <span class="sname">{{ a.name }}</span>
              </button>
            </li>
          }
        </ul>
      </section>

      <section class="section" aria-labelledby="rank-h">
        <header><h2 id="rank-h">Classifica obiettivi</h2></header>
        <ol class="rank">
          @for (r of ach.ranking(); track r.user_id; let i = $index) {
            <li>
              <span class="pos num">{{ i + 1 }}</span>
              <a class="who" [routerLink]="['/giocatore', r.user_id]"><app-avatar [userId]="r.user_id" [size]="32" /><span class="ellipsis">{{ session.name(r.user_id) }}</span></a>
              <span class="minis" aria-hidden="true">
                @for (a of ach.of(r.user_id).slice(0, 6); track a.id) {
                  @if (ach.imageUrl(a); as u) { <img [src]="u" alt="" [title]="a.name" /> } @else { <i [title]="a.name">★</i> }
                }
              </span>
              <span class="count num">{{ r.count }}/{{ ach.list().length }}</span>
            </li>
          } @empty { <li class="empty">Nessuno sticker sbloccato, per ora.</li> }
        </ol>
      </section>

      @if (session.isLeader()) {
        <section class="section" aria-labelledby="new-h">
          <header><h2 id="new-h">Nuovo obiettivo</h2></header>
          <div class="panel stack">
            <p class="small muted">Gli obiettivi che crei li assegni tu, dal dettaglio dello sticker.</p>
            <label class="field"><span>Nome</span><input class="input" maxlength="60" [(ngModel)]="newName" /></label>
            <label class="field"><span>Missione (facoltativa, la vede solo chi lo sblocca)</span><input class="input" maxlength="300" [(ngModel)]="newMission" /></label>
            <label class="btn small file-btn">{{ newFile() ? newFile()!.name : 'Scegli lo sticker (facoltativo)' }}
              <input type="file" accept="image/*" class="sr-only" (change)="pickNew($event)" />
            </label>
            <button class="btn primary" [disabled]="busy() || !newName.trim()" (click)="create()">Crea l'obiettivo</button>
          </div>
        </section>
      }
    </div>

    <dialog #dlg class="sheet" (click)="backdrop($event)" (close)="sel.set(null)" aria-labelledby="st-h">
      @if (sel(); as a) {
        <div class="grab" aria-hidden="true"></div>
        <div class="detail">
          <span class="pic big" [class.got]="!!ach.mine(a.id)">
            @if (ach.mine(a.id) || session.isLeader()) {
              @if (ach.imageUrl(a); as u) { <img [src]="u" alt="" /> } @else { <span class="ph star" aria-hidden="true">★</span> }
            } @else {
              <span class="ph" aria-hidden="true"><app-icon name="lock" [size]="34" /></span>
            }
          </span>
          <p class="small muted">Sticker n° {{ a.number }}</p>
          <h2 id="st-h">{{ a.name }}</h2>
          @if (mission(a); as m) {
            <p class="mission"><strong>Missione:</strong> {{ m }}</p>
            @if (!ach.mine(a.id) && session.isLeader()) { <p class="small muted">La missione la vedi solo tu, finché un giocatore non lo sblocca.</p> }
          } @else if (ach.mine(a.id) || session.isLeader()) {
            <p class="small muted">Nessuna missione scritta: lo assegna il Leader.</p>
          } @else {
            <p class="mission secret">Missione segreta: la scoprirai sbloccando lo sticker.</p>
          }
          @if (ach.mine(a.id); as u) { <p class="small">Sbloccato {{ when(u.unlocked_at) }}.</p> }
        </div>

        <div class="holders">
          <h3>L'hanno sbloccato</h3>
          <ul>
            @for (h of ach.holders(a.id); track h.user_id) {
              <li>
                <app-avatar [userId]="h.user_id" [size]="28" /><span class="grow ellipsis">{{ session.name(h.user_id) }}</span>
                @if (session.isLeader()) {
                  <button class="btn small ghost" [disabled]="busy()" (click)="revoke(a, h.user_id)" [attr.aria-label]="'Togli lo sticker a ' + session.name(h.user_id)">Togli</button>
                }
              </li>
            } @empty { <li class="small muted">Nessuno, per ora.</li> }
          </ul>
        </div>

        @if (session.isLeader()) {
          <div class="tools stack">
            <h3>Strumenti del Leader</h3>
            <div class="row">
              <select class="input grow" [(ngModel)]="awardTo" aria-label="Giocatore a cui assegnarlo">
                <option value="">Assegna a…</option>
                @for (m of candidates(); track m.id) { <option [value]="m.id">{{ session.name(m.id) }}</option> }
              </select>
              <button class="btn small primary" [disabled]="busy() || !awardTo" (click)="award(a)">Assegna</button>
            </div>
            <label class="btn small file-btn">{{ a.image_path ? 'Cambia lo sticker' : 'Carica lo sticker' }}
              <input type="file" accept="image/*" class="sr-only" [disabled]="busy()" (change)="pickImage(a, $event)" />
            </label>
            <label class="field"><span>Nome</span><input class="input" maxlength="60" [(ngModel)]="editName" /></label>
            @if (!a.code) {
              <label class="field"><span>Missione</span><input class="input" maxlength="300" [(ngModel)]="editMission" /></label>
            }
            <div class="row-wrap">
              <button class="btn small" [disabled]="busy() || !editName.trim()" (click)="save(a)">Salva</button>
              @if (!a.code) { <button class="btn small danger" [disabled]="busy()" (click)="remove(a)">Elimina l'obiettivo</button> }
            </div>
          </div>
        }
        <button class="btn block ghost" (click)="close()">Chiudi</button>
      }
    </dialog>
  `,
  styles: `
    .intro p { margin: 0 0 6px; }
    .section > header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    /* album: righe da 4, come le medaglie */
    .album { list-style: none; margin: 0; padding: 14px 10px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px 8px;
             border-radius: 18px; background: linear-gradient(160deg, var(--surface), var(--surface-2)); box-shadow: inset 0 0 0 1px var(--line); }
    .sticker { appearance: none; border: 0; background: none; color: var(--ink); cursor: pointer; width: 100%;
               display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 0; font: inherit; min-width: 0; }
    .pic { position: relative; width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; flex: none;
           background: var(--surface-2); box-shadow: inset 0 0 0 2px var(--line); }
    .got .pic, .pic.got { background: radial-gradient(circle at 35% 30%, #fff8d6, #f2c94c 70%); box-shadow: 0 0 0 2px var(--armband), 0 6px 14px rgb(0 0 0 / 18%); }
    .pic img { width: 100%; height: 100%; object-fit: contain; border-radius: 50%; }
    .ph { color: var(--muted); display: grid; place-items: center; }
    .ph.star { color: var(--armband-ink); font-size: 1.6rem; }
    .num { position: absolute; right: -4px; bottom: -2px; min-width: 22px; height: 22px; border-radius: 11px; padding: 0 5px; display: grid; place-items: center;
           font: 800 0.72rem/1 var(--font-display); background: var(--surface); color: var(--ink); box-shadow: 0 0 0 2px var(--line); }
    .got .num { background: var(--armband); color: var(--armband-ink); box-shadow: 0 0 0 2px var(--surface); }
    .sname { font-size: 0.72rem; font-weight: 600; text-align: center; line-height: 1.15; max-width: 100%; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .sticker:not(.got) .sname { color: var(--muted); }
    /* classifica */
    .rank { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
    .rank li { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-top: 1px solid var(--line); min-width: 0; }
    .rank li:first-child { border-top: 0; }
    .rank .pos { position: static; width: 20px; text-align: center; color: var(--muted); font-weight: 700; background: none; box-shadow: none; }
    .who { display: inline-flex; align-items: center; gap: 8px; min-width: 0; flex: 1; color: inherit; text-decoration: none; font-weight: 600; }
    .minis { display: inline-flex; gap: 2px; flex: none; }
    .minis img, .minis i { width: 20px; height: 20px; border-radius: 50%; object-fit: contain; display: grid; place-items: center; font-size: 0.7rem; font-style: normal;
                           background: radial-gradient(circle at 35% 30%, #fff8d6, #f2c94c 70%); color: var(--armband-ink); }
    .count { position: static; font-weight: 700; background: none; box-shadow: none; min-width: 36px; }
    .file-btn { position: relative; justify-content: center; }
    /* dettaglio */
    .sheet { position: fixed; inset: auto 0 0 0; margin: 0 auto; width: 100%; max-width: 560px; max-height: 88vh; overflow-y: auto; border: 0; color: var(--ink);
             background: var(--surface); border-radius: 22px 22px 0 0; padding: 8px 16px calc(16px + env(safe-area-inset-bottom, 0px)); box-shadow: 0 -10px 40px rgb(0 0 0 / 25%); }
    .sheet[open] { display: flex; flex-direction: column; gap: 14px; }
    .sheet::backdrop { background: rgb(10 20 14 / 45%); }
    .grab { width: 40px; height: 5px; border-radius: 3px; background: var(--line); align-self: center; }
    .detail { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px; }
    .pic.big { width: 120px; height: 120px; margin-bottom: 6px; }
    .mission { margin: 6px 0 0; }
    .secret { color: var(--muted); font-style: italic; }
    .holders ul { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .holders li { display: flex; align-items: center; gap: 8px; }
    .tools { border-top: 1px solid var(--line); padding-top: 12px; }
  `,
})
export class AchievementsPanel implements OnInit {
  protected readonly ach = inject(Achievements);
  protected readonly session = inject(Session);
  private readonly toasts = inject(Toasts);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');
  protected readonly sel = signal<Achievement | null>(null);
  protected readonly busy = signal(false);
  protected readonly newFile = signal<File | null>(null);
  protected readonly when = fmtWhen;
  protected newName = '';
  protected newMission = '';
  protected awardTo = '';
  protected editName = '';
  protected editMission = '';

  protected readonly mineCount = computed(() => this.ach.list().filter((a) => this.ach.mine(a.id)).length);
  /** a chi si può ancora assegnare lo sticker aperto */
  protected readonly candidates = computed(() => {
    const a = this.sel();
    if (!a) return [];
    const has = new Set(this.ach.holders(a.id).map((h) => h.user_id));
    return this.session.activeMembers().filter((m) => !has.has(m.id));
  });

  async ngOnInit(): Promise<void> {
    try {
      await this.ach.load();
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }

  protected mission(a: Achievement): string | null {
    return this.ach.missions().get(a.id) ?? null;
  }

  protected open(a: Achievement): void {
    this.sel.set(a);
    this.awardTo = '';
    this.editName = a.name;
    this.editMission = this.mission(a) ?? '';
    const d = this.dlg()?.nativeElement;
    if (d && !d.open) d.showModal();
  }

  protected close(): void {
    this.dlg()?.nativeElement.close();
  }

  protected backdrop(e: MouseEvent): void {
    if (e.target === this.dlg()?.nativeElement) this.close();
  }

  private async run(fn: () => Promise<void>, ok: string): Promise<void> {
    this.busy.set(true);
    try {
      await fn();
      this.toasts.show(ok);
      // il dettaglio aperto segue i dati aggiornati
      const cur = this.sel();
      if (cur) this.sel.set(this.ach.byId(cur.id) ?? null);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected pickNew(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.newFile.set(input.files?.[0] ?? null);
  }

  protected async create(): Promise<void> {
    const name = this.newName.trim();
    await this.run(async () => {
      await this.ach.create(name, this.newMission.trim() || null, this.newFile());
      this.newName = '';
      this.newMission = '';
      this.newFile.set(null);
    }, `Obiettivo «${name}» creato.`);
  }

  protected async award(a: Achievement): Promise<void> {
    const who = this.awardTo;
    await this.run(() => this.ach.award(a.id, who), `Sticker assegnato a ${this.session.name(who)}.`);
    this.awardTo = '';
  }

  protected async revoke(a: Achievement, userId: string): Promise<void> {
    if (!confirm(`Togliere «${a.name}» a ${this.session.name(userId)}?`)) return;
    await this.run(() => this.ach.revoke(a.id, userId), 'Sticker tolto.');
  }

  protected async pickImage(a: Achievement, e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.run(() => this.ach.setImage(a.id, file), 'Sticker aggiornato.');
  }

  protected async save(a: Achievement): Promise<void> {
    await this.run(() => this.ach.update(a.id, this.editName.trim(), a.code ? null : this.editMission.trim() || null), 'Obiettivo salvato.');
  }

  protected async remove(a: Achievement): Promise<void> {
    if (!confirm(`Eliminare l'obiettivo «${a.name}»? Sparisce anche dagli album di chi l'aveva sbloccato.`)) return;
    await this.run(async () => {
      await this.ach.remove(a.id);
      this.close();
    }, 'Obiettivo eliminato.');
  }
}
