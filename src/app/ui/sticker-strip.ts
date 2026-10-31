import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { Achievements } from '../core/achievements';
import { fmtWhen } from '../core/format';

/**
 * Gli sticker sbloccati da un giocatore, sotto la sua foto. Toccandone uno si apre un fumetto
 * ancorato con lo sticker, il nome, come si ottiene e quando l'ha vinto (non si cambia pagina).
 */
@Component({
  selector: 'app-sticker-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'close()', '(document:keydown.escape)': 'close()' },
  template: `
    @if (ach.of(userId()).length) {
      <div class="strip" role="list" aria-label="Sticker sbloccati">
        @for (a of ach.of(userId()); track a.id) {
          <span class="slot" role="listitem">
            <button type="button" class="st" [class.on]="open() === a.id" [attr.aria-expanded]="open() === a.id" [attr.aria-label]="a.name"
                    (click)="toggle(a.id, $event)">
              @if (ach.imageUrl(a); as u) { <img [src]="u" alt="" /> } @else { <i aria-hidden="true">★</i> }
            </button>
            @if (open() === a.id) {
              <div class="pop" role="dialog" [attr.aria-label]="a.name" [class.flip]="flip()" (click)="$event.stopPropagation()">
                <div class="head">
                  <span class="big">@if (ach.imageUrl(a); as u) { <img [src]="u" alt="" /> } @else { <i aria-hidden="true">★</i> }</span>
                  <strong>{{ a.name }}</strong>
                </div>
                @if (ach.missions().get(a.id); as m) { <p>{{ m }}</p> }
                @if (unlockedAt(a.id); as d) { <p class="muted">Sbloccato {{ when(d) }}</p> }
              </div>
            }
          </span>
        }
      </div>
    }
  `,
  styles: `
    .strip { display: flex; flex-wrap: wrap; gap: 6px; }
    .slot { position: relative; }
    .st { width: 34px; height: 34px; padding: 0; border: 0; cursor: pointer; border-radius: 50%; display: grid; place-items: center; overflow: hidden;
          background: radial-gradient(circle at 35% 30%, #fff8d6, #f2c94c 70%); box-shadow: 0 0 0 2px var(--armband), 0 3px 8px rgb(0 0 0 / 15%); }
    .st.on { box-shadow: 0 0 0 3px var(--turf), 0 3px 8px rgb(0 0 0 / 15%); }
    .st img, .big img { width: 100%; height: 100%; object-fit: contain; }
    .st i, .big i { font-style: normal; color: var(--armband-ink); font-size: 0.95rem; }
    /* fumetto ancorato sotto lo sticker */
    .pop { position: absolute; top: calc(100% + 10px); left: -8px; z-index: 30; width: min(250px, 78vw); padding: 12px 14px; border-radius: 14px;
           background: var(--surface); color: var(--ink); box-shadow: 0 10px 30px rgb(0 0 0 / 22%), 0 0 0 1px var(--line);
           display: flex; flex-direction: column; gap: 6px; font-size: var(--step--1); text-align: left; }
    .pop.flip { left: auto; right: -8px; }
    .pop::before { content: ''; position: absolute; top: -6px; left: 20px; width: 12px; height: 12px; background: var(--surface); transform: rotate(45deg); box-shadow: -1px -1px 0 var(--line); }
    .pop.flip::before { left: auto; right: 20px; }
    .pop p { margin: 0; line-height: 1.4; }
    .head { display: flex; align-items: center; gap: 10px; }
    .head strong { font: 700 var(--step-0)/1.2 var(--font-display); }
    .big { width: 44px; height: 44px; flex: none; border-radius: 50%; display: grid; place-items: center; overflow: hidden;
           background: radial-gradient(circle at 35% 30%, #fff8d6, #f2c94c 70%); box-shadow: 0 0 0 2px var(--armband); }
  `,
})
export class StickerStrip implements OnInit {
  protected readonly ach = inject(Achievements);
  readonly userId = input.required<string>();
  protected readonly open = signal<string | null>(null);
  /** se lo sticker è nella metà destra dello schermo, il fumetto si apre verso sinistra */
  protected readonly flip = signal(false);
  protected readonly when = fmtWhen;
  private readonly rows = computed(() => this.ach.unlocked().filter((r) => r.user_id === this.userId()));

  protected unlockedAt(achievementId: string): string | null {
    return this.rows().find((r) => r.achievement_id === achievementId)?.unlocked_at ?? null;
  }

  protected toggle(id: string, e: Event): void {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.flip.set(r.left > window.innerWidth / 2);
    this.open.update((v) => (v === id ? null : id));
  }

  protected close(): void {
    if (this.open()) this.open.set(null);
  }

  ngOnInit(): void {
    if (!this.ach.loaded()) void this.ach.load().catch(() => undefined);
  }
}
