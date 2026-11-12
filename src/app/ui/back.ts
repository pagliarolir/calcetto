import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Icon } from './icon';

/** «‹ Indietro» delle pagine di dettaglio: torna alla pagina precedente o, se si è entrati da un link, a `fallback`. */
@Component({
  selector: 'app-back',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button type="button" class="back-btn" (click)="back()"><app-icon name="back" [size]="18" /> Indietro</button>`,
})
export class Back {
  readonly fallback = input('/');
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  protected back(): void {
    if (this.router.lastSuccessfulNavigation()?.previousNavigation) this.location.back();
    else void this.router.navigateByUrl(this.fallback());
  }
}
