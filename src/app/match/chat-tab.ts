import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, OnDestroy, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { fmtTime, fmtWhen, fmtDayShort } from '../core/format';
import { ChatMessage } from '../core/models';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { MatchStore } from './match-store';
import { Reprimand } from '../ui/reprimand';
import { scrollAppTo } from '../core/scroller';

/** Chat di partita: aperta dalla creazione della partita fino a 24 ore dopo la fine. */
@Component({
  selector: 'app-chat-tab',
  imports: [FormsModule],
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
            <li class="msg enter-fade" [class.mine]="msg.user_id === session.uid()">
              @if (msg.user_id !== session.uid() && !sameAuthor(i)) { <span class="who">{{ session.name(msg.user_id) }}</span> }
              <p>{{ msg.body }}</p>
              <span class="time">{{ time(msg.created_at) }}
                @if (msg.user_id === session.uid() || session.isStaff()) {
                  <button class="del" (click)="remove(msg)" aria-label="Elimina messaggio">Elimina</button>
                }
              </span>
            </li>
          } @empty {
            @if (store.t()?.chatOpen) { <li class="empty">Nessun messaggio. Rompi il ghiaccio.</li> }
          }
        </ol>
        @if (store.t()?.chatOpen) {
          <form class="composer" (ngSubmit)="send()">
            <label class="sr-only" for="msg">Messaggio</label>
            <textarea id="msg" class="input" name="body" [(ngModel)]="body" rows="1" maxlength="1000"
                      placeholder="Scrivi al gruppo" (keydown.enter)="enter($event)" (focus)="onFocus($event)"></textarea>
            <button class="btn primary" type="submit" [disabled]="!body.trim() || busy()">Invia</button>
          </form>
        }
      </div>
    }
  `,
  styles: `
    .chat { display: flex; flex-direction: column; gap: 12px; }
    .msgs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .day { align-self: center; font-size: var(--step--1); color: var(--muted); padding: 10px 0 4px; }
    .msg { align-self: flex-start; max-width: 82%; padding: 8px 12px; border-radius: 16px 16px 16px 4px; background: var(--surface); border: 1px solid var(--line); }
    .msg.mine { align-self: flex-end; background: var(--turf); color: var(--turf-ink); border-color: var(--turf); border-radius: 16px 16px 4px 16px; }
    .msg p { white-space: pre-wrap; overflow-wrap: anywhere; }
    .who { display: block; font-size: 0.75rem; font-weight: 700; color: var(--turf); margin-bottom: 2px; }
    .time { display: flex; gap: 8px; justify-content: flex-end; font-size: 0.7rem; opacity: 0.7; margin-top: 2px; }
    .del { appearance: none; border: 0; background: none; color: inherit; font: inherit; text-decoration: underline; cursor: pointer; padding: 0; }
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
  protected readonly busy = signal(false);
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
          if (!this.messages().some((x) => x.id === msg.id)) {
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

  protected async send(): Promise<void> {
    if (this.reprimand.guard()) return;
    const text = this.body.trim();
    if (!text) return;
    this.busy.set(true);
    try {
      await this.api.sendChat(this.store.match()!.id, this.session.uid()!, text);
      this.body = '';
    } catch (e) {
      await this.session.refreshPunishment();
      if (this.reprimand.guard()) return;
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
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
