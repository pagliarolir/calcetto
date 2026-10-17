import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Team } from '../core/models';
import { Session } from '../core/session';

/** Foto profilo rotonda; senza foto (o se non si carica) mostra le iniziali. */
@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'avatar',
    '[class.white]': "team() === 'white'",
    '[class.black]': "team() === 'black'",
    '[class.has-photo]': '!!url()',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    '[style.font-size.px]': 'size() * 0.36',
    'aria-hidden': 'true',
  },
  template: `
    @if (url(); as u) {
      <img [src]="u" alt="" loading="lazy" decoding="async" (error)="broken.set(u)" />
    } @else {
      {{ session.initials(userId()) }}
    }
  `,
})
export class Avatar {
  protected readonly session = inject(Session);
  readonly userId = input.required<string>();
  readonly size = input(36);
  readonly team = input<Team | null | undefined>(null);

  protected readonly broken = signal<string | null>(null);
  protected readonly url = computed(() => {
    const u = this.session.avatarUrls().get(this.userId());
    return u && u !== this.broken() ? u : null;
  });
}
