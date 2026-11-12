import { afterNextRender, ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, Injector, OnDestroy, signal, viewChild } from '@angular/core';
import { Empty } from '../ui/empty';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { fmtTime, fmtWhen, fmtDayShort } from '../core/format';
import { ChatMessage } from '../core/models';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { MatchStore } from './match-store';
import { Reprimand } from '../ui/reprimand';
import { Avatar } from '../ui/avatar';
import { scrollAppTo } from '../core/scroller';
import { Confirm } from '../core/confirm';
import { haptic } from '../core/haptics';
import { Icon } from '../ui/icon';

/** Chat di partita: aperta dalla creazione della partita fino a 24 ore dopo la fine. */
@Component({
  selector: 'app-chat-tab',
  imports: [FormsModule, Avatar, Empty, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.match(); as m) {
      <div class="chat">
        @if (!store.t()?.chatOpen) {
          <p class="note">
            @if (store.now() < at(m.chat_opens_at)) { La chat si apre {{ when(m.chat_opens_at) }}. }
            @else { La chat è chiusa: puoi rileggere i messaggi. }
          </p>
        }
        <ol class="msgs" #list aria-live="polite">
          @for (msg of messages(); track msg.id; let i = $index) {
            @if (newDay(i)) { <li class="day">{{ day(msg.created_at) }}</li> }
            <li class="row" [class.mine]="msg.user_id === session.uid()" [class.first]="!sameAuthor(i)">
              @if (msg.user_id !== session.uid()) {
                @if (!sameAuthor(i)) { <app-avatar [userId]="msg.user_id" [size]="30" /> } @else { <span class="av-space" aria-hidden="true"></span> }
              }
              <!-- pressione lunga, clic destro o Invio: menu Copia / Elimina -->
              <div class="msg enter-fade" [class.mine]="msg.user_id === session.uid()" [class.held]="menu()?.msg?.id === msg.id" [class.sending]="msg.state === 'sending'"
                   tabindex="0" role="button" aria-haspopup="menu" [attr.aria-label]="label(msg)"
                   (pointerdown)="press($event, msg)" (pointermove)="pressMove($event)" (pointerup)="unpress()" (pointercancel)="unpress()"
                   (contextmenu)="$event.preventDefault(); openMenu(msg, $event.currentTarget)"
                   (keydown.enter)="openMenu(msg, $event.currentTarget)" (keydown.space)="$event.preventDefault(); openMenu(msg, $event.currentTarget)">
                @if (msg.user_id !== session.uid() && !sameAuthor(i)) { <span class="who">{{ session.name(msg.user_id) }}</span> }
                <p>{{ msg.body }}</p>
                @if (msg.state === 'failed') {
                  <button type="button" class="retry" (click)="retry(msg)">Non inviato. Riprova</button>
                } @else {
                  <span class="time">{{ msg.state === 'sending' ? 'Invio…' : time(msg.created_at) }}</span>
                }
              </div>
            </li>
          } @empty {
            @if (store.t()?.chatOpen) { <li class="empty"><app-empty icon="chat" text="Nessun messaggio. Rompi il ghiaccio." /></li> }
          }
        </ol>
        <dialog #menuDlg class="msg-menu" (click)="menuBackdrop($event)" (close)="menu.set(null)" aria-label="Azioni sul messaggio">
          @if (menu(); as mm) {
            <div class="lift msg" [class.mine]="mm.mine" aria-hidden="true" [style.top.px]="mm.top" [style.left.px]="mm.left" [style.width.px]="mm.width">
              @if (mm.who) { <span class="who">{{ session.name(mm.msg.user_id) }}</span> }
              <p>{{ mm.msg.body }}</p>
              <span class="time">{{ time(mm.msg.created_at) }}</span>
            </div>
            <div class="acts" role="menu" [class.mine]="mm.mine" [style.top.px]="mm.menuTop" [style.left.px]="mm.menuLeft">
              <button type="button" role="menuitem" (click)="copy(mm.msg)"><app-icon name="copy" [size]="20" /> Copia</button>
              @if (mm.canDelete) {
                <button type="button" role="menuitem" class="danger" (click)="askRemove(mm.msg)"><app-icon name="trash" [size]="20" /> Elimina</button>
              }
            </div>
          }
        </dialog>
        @if (store.t()?.chatOpen) {
          <form class="composer" (ngSubmit)="send()">
            <label class="sr-only" for="msg">Messaggio</label>
            <textarea id="msg" class="input" name="body" [(ngModel)]="body" rows="1" maxlength="1000"
                      placeholder="Scrivi al gruppo" (keydown.enter)="enter($event)" (focus)="onFocus($event)"></textarea>
            <button class="btn primary" type="submit" [disabled]="!body.trim()">Invia</button>
          </form>
        }
      </div>
    }
  `,
  styles: `
    .chat { display: flex; flex-direction: column; gap: 12px; }
    .msgs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .day { align-self: center; font-size: var(--step--1); color: var(--muted); padding: 10px 0 4px; }
    .row { display: flex; align-items: flex-start; gap: 8px; }
    .row.first { margin-top: 6px; }
    .row.mine { justify-content: flex-end; }
    .av-space { width: 30px; flex: none; }
    .msg { max-width: 78%; padding: 8px 12px; border-radius: 16px 16px 16px 4px; background: var(--surface); border: 1px solid var(--line); }
    .msg.mine { background: var(--turf); color: var(--turf-ink); border-color: var(--turf); border-radius: 16px 16px 4px 16px; }
    .msg p { white-space: pre-wrap; overflow-wrap: anywhere; }
    .who { display: block; font-size: 0.75rem; font-weight: 700; color: var(--turf); margin-bottom: 2px; }
    .time { display: flex; gap: 8px; justify-content: flex-end; font-size: 0.7rem; opacity: 0.7; margin-top: 2px; }
    /* niente menu e selezione di sistema sui fumetti: Copia è nel menu dell'app */
    .msgs .msg { -webkit-touch-callout: none; user-select: none; -webkit-user-select: none; cursor: default; touch-action: manipulation; }
    .msgs .msg:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    .msgs .msg.held { opacity: 0; }
    .msgs .msg.sending { opacity: 0.7; }
    .retry { display: block; margin: 4px 0 0 auto; min-height: 44px; padding: 0 4px; border: 0; background: none; color: inherit;
             font: 600 var(--step--1)/1.2 var(--font-body); text-decoration: underline; cursor: pointer; }
    dialog.msg-menu { position: fixed; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: 0; border: 0;
                      background: transparent; overflow: hidden; animation: none; }
    dialog.msg-menu::backdrop { background: var(--backdrop); }
    .lift { position: absolute; max-width: none; margin: 0; box-shadow: 0 10px 30px rgb(0 0 0 / 30%); }
    .acts { position: absolute; width: 220px; display: flex; flex-direction: column; padding: 6px; border-radius: var(--r-m);
            background: var(--surface); color: var(--ink); box-shadow: 0 10px 30px rgb(0 0 0 / 30%); border: 1px solid var(--line); }
    .acts button { appearance: none; display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 0 12px; border: 0; border-radius: var(--r-s);
                   background: none; color: inherit; font: 500 var(--step-0)/1 var(--font-body); text-align: left; cursor: pointer; }
    .acts button:hover, .acts button:focus-visible { background: var(--surface-2); outline: none; }
    .acts button.danger { color: var(--danger); }
    @media (prefers-reduced-motion: no-preference) {
      .lift { animation: lift 180ms var(--ease-out) both; }
      .acts { animation: acts-in 180ms var(--ease-out) both; transform-origin: top left; }
      .acts.mine { transform-origin: top right; }
      @keyframes lift { from { transform: scale(1); } 60% { transform: scale(1.04); } to { transform: scale(1.02); } }
      @keyframes acts-in { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: none; } }
    }
    .composer {
      position: sticky; bottom: 8px;
      display: flex; gap: 8px; align-items: flex-end; padding: 8px; border-radius: var(--r-l);
      background: var(--surface); border: 1px solid var(--line); box-shadow: 0 6px 20px rgb(0 0 0 / 10%);
    }
    .composer textarea { min-height: 44px; max-height: 120px; border: 0; resize: none; }
    .composer textarea:focus { box-shadow: none; }
  `,
})
export class ChatTab implements OnDestroy {
  protected readonly store = inject(MatchStore);
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly reprimand = inject(Reprimand);
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  protected readonly messages = signal<ChatMessage[]>([]);
  protected body = '';
  protected readonly when = fmtWhen;
  protected readonly time = fmtTime;
  protected readonly day = fmtDayShort;
  private stop: (() => void) | null = null;
  private loadedFor: string | null = null;

  protected readonly ids = computed(() => this.messages().map((m) => m.id));

  constructor() {
    effect(() => {
      const m = this.store.match();
      if (!m || this.loadedFor === m.id) return;
      this.loadedFor = m.id;
      void this.api.chat(m.id).then((list) => { this.messages.set(list); this.scroll(); });
      this.stop?.();
      this.stop = this.api.watchChat(
        m.id,
        (msg) => {
          // il proprio messaggio appena scritto è già in elenco: si sostituisce, non si duplica
          const temp = this.messages().find((x) => x.state === 'sending' && x.user_id === msg.user_id && x.body === msg.body);
          if (temp) this.settle(temp.id, msg);
          else if (!this.messages().some((x) => x.id === msg.id)) {
            this.messages.update((l) => [...l, msg]);
            this.scroll();
          }
        },
        (id) => this.messages.update((l) => l.filter((x) => x.id !== id)),
      );
    });
  }

  protected at(iso: string): number {
    return new Date(iso).getTime();
  }

  protected newDay(i: number): boolean {
    const l = this.messages();
    return i === 0 || fmtDayShort(l[i].created_at) !== fmtDayShort(l[i - 1].created_at);
  }

  protected sameAuthor(i: number): boolean {
    const l = this.messages();
    return i > 0 && l[i - 1].user_id === l[i].user_id && !this.newDay(i);
  }

  protected onFocus(e: FocusEvent): void {
    if (this.reprimand.guard()) (e.target as HTMLElement).blur();
  }

  protected enter(e: Event): void {
    const k = e as KeyboardEvent;
    if (!k.shiftKey && matchMedia('(pointer: fine)').matches) {
      k.preventDefault();
      void this.send();
    }
  }

  /** risposta immediata: il messaggio compare subito («Invio…») e diventa vero quando il server lo salva */
  protected async send(): Promise<void> {
    if (this.reprimand.guard()) return;
    const text = this.body.trim();
    if (!text) return;
    const temp: ChatMessage = { id: -Date.now(), match_id: this.store.match()!.id, user_id: this.session.uid()!, body: text,
                                created_at: new Date().toISOString(), state: 'sending' };
    this.messages.update((l) => [...l, temp]);
    this.body = '';
    this.scroll();
    await this.deliver(temp);
  }

  protected async retry(msg: ChatMessage): Promise<void> {
    if (this.reprimand.guard()) return;
    this.messages.update((l) => l.map((x) => (x.id === msg.id ? { ...x, state: 'sending' as const } : x)));
    await this.deliver(msg);
  }

  private async deliver(temp: ChatMessage): Promise<void> {
    try {
      this.settle(temp.id, await this.api.sendChat(temp.match_id, temp.user_id, temp.body));
    } catch (e) {
      await this.session.refreshPunishment();
      if (this.reprimand.guard()) {
        // in punizione: il messaggio torna da scrivere
        this.messages.update((l) => l.filter((x) => x.id !== temp.id));
        this.body = temp.body;
        return;
      }
      this.messages.update((l) => l.map((x) => (x.id === temp.id ? { ...x, state: 'failed' as const } : x)));
      this.toasts.error(errorMessage(e));
    }
  }

  /** il messaggio provvisorio diventa quello salvato (se il tempo reale l'ha già portato, si toglie il doppione) */
  private settle(tempId: number, real: ChatMessage): void {
    this.messages.update((l) => (l.some((x) => x.id === real.id) ? l.filter((x) => x.id !== tempId) : l.map((x) => (x.id === tempId ? real : x))));
  }

  // ------------------------------------------------ menu del messaggio (pressione lunga)
  private readonly confirmBox = inject(Confirm);
  private readonly injector = inject(Injector);
  private readonly menuDlg = viewChild<ElementRef<HTMLDialogElement>>('menuDlg');
  protected readonly menu = signal<{ msg: ChatMessage; mine: boolean; who: boolean; canDelete: boolean; top: number; left: number; width: number; menuTop: number; menuLeft: number } | null>(null);
  private hold: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null;
  /** quando il dito si alza dopo la pressione lunga parte un clic nello stesso punto: non deve chiudere il menu appena aperto */
  private held = false;
  private releasedAt = 0;

  protected label(msg: ChatMessage): string {
    const who = msg.user_id === this.session.uid() ? 'Tu' : this.session.name(msg.user_id);
    return `${who}, ${this.time(msg.created_at)}: ${msg.body}. Premi Invio per copiare o eliminare.`;
  }

  protected press(e: PointerEvent, msg: ChatMessage): void {
    if (e.pointerType === 'mouse') return;   // da computer: clic destro
    const el = e.currentTarget as HTMLElement;
    this.unpress();
    this.hold = { x: e.clientX, y: e.clientY, timer: setTimeout(() => { this.hold = null; this.held = true; haptic(15); this.openMenu(msg, el); }, 450) };
  }

  protected pressMove(e: PointerEvent): void {
    if (this.hold && Math.hypot(e.clientX - this.hold.x, e.clientY - this.hold.y) > 8) this.unpress();
  }

  protected unpress(): void {
    if (this.held) { this.held = false; this.releasedAt = performance.now(); }
    if (this.hold) clearTimeout(this.hold.timer);
    this.hold = null;
  }

  protected openMenu(msg: ChatMessage, target: EventTarget | null): void {
    const el = target as HTMLElement | null;
    if (!el || this.menu() || msg.state === 'sending') return;
    const r = el.getBoundingClientRect();
    const mine = msg.user_id === this.session.uid();
    const canDelete = mine || this.session.isStaff();
    const vw = window.innerWidth, vh = window.innerHeight, pad = 12, gap = 8, w = 220;
    const menuH = 12 + 48 * (canDelete ? 2 : 1);
    // il fumetto resta dov'era; se sotto non c'è posto per il menu, tutto sale quanto basta
    let top = r.top;
    if (top + r.height + gap + menuH > vh - pad) top = vh - pad - menuH - gap - r.height;
    const left = Math.min(Math.max(pad, mine ? r.right - w : r.left), vw - pad - w);
    this.menu.set({ msg, mine, who: !!el.querySelector('.who'), canDelete, top, left: r.left, width: r.width, menuTop: top + r.height + gap, menuLeft: left });
    afterNextRender({ write: () => {
      const d = this.menuDlg()?.nativeElement;
      if (d && !d.open) { d.showModal(); (d.querySelector('[role=menuitem]') as HTMLElement | null)?.focus(); }
    } }, { injector: this.injector });
  }

  protected closeMenu(): void {
    this.menuDlg()?.nativeElement.close();
  }

  protected menuBackdrop(e: MouseEvent): void {
    if (this.held || performance.now() - this.releasedAt < 400) return;
    if (!(e.target as Element).closest('.acts')) this.closeMenu();
  }

  protected async copy(msg: ChatMessage): Promise<void> {
    this.closeMenu();
    try {
      await navigator.clipboard.writeText(msg.body);
      this.toasts.show('Messaggio copiato.');
    } catch {
      this.toasts.error('Non riesco a copiare il messaggio.');
    }
  }

  protected async askRemove(msg: ChatMessage): Promise<void> {
    this.closeMenu();
    // non ancora salvato: si toglie e basta
    if (msg.id < 0) { this.messages.update((l) => l.filter((x) => x.id !== msg.id)); return; }
    if (await this.confirmBox.ask({ title: 'Eliminare il messaggio?', ok: 'Elimina', danger: true })) await this.remove(msg);
  }

  protected async remove(msg: ChatMessage): Promise<void> {
    if (this.reprimand.guard()) return;
    try {
      await this.api.deleteChat(msg.id);
      this.messages.update((l) => l.filter((x) => x.id !== msg.id));
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }

  private scroll(): void {
    setTimeout(() => scrollAppTo('end'), 50);
  }

  ngOnDestroy(): void {
    this.stop?.();
  }
}
