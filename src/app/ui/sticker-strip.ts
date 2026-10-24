import { ChangeDetectionStrategy, Component, inject, input, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Achievements } from '../core/achievements';

/** Gli sticker sbloccati da un giocatore, sotto la sua foto. */
@Component({
  selector: 'app-sticker-strip',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ach.of(userId()).length) {
      <a class="strip" routerLink="/classifica" [queryParams]="{ scheda: 'obiettivi' }" [attr.aria-label]="'Sticker: ' + names()">
        @for (a of ach.of(userId()); track a.id) {
          <span class="st" [title]="a.name">
            @if (ach.imageUrl(a); as u) { <img [src]="u" alt="" /> } @else { <i aria-hidden="true">★</i> }
          </span>
        }
      </a>
    }
  `,
  styles: `
    .strip { display: flex; flex-wrap: wrap; gap: 6px; text-decoration: none; }
    .st { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; overflow: hidden;
          background: radial-gradient(circle at 35% 30%, #fff8d6, #f2c94c 70%); box-shadow: 0 0 0 2px var(--armband), 0 3px 8px rgb(0 0 0 / 15%); }
    .st img { width: 100%; height: 100%; object-fit: contain; }
    .st i { font-style: normal; color: var(--armband-ink); font-size: 0.95rem; }
  `,
})
export class StickerStrip implements OnInit {
  protected readonly ach = inject(Achievements);
  readonly userId = input.required<string>();

  protected names(): string {
    return this.ach.of(this.userId()).map((a) => a.name).join(', ');
  }

  ngOnInit(): void {
    if (!this.ach.loaded()) void this.ach.load().catch(() => undefined);
  }
}
