import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../core/api';

/** Porta direttamente alla prossima partita. */
@Component({
  selector: 'app-home',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page stack-l">
      @if (none()) {
        <h1>Nessuna partita in calendario</h1>
        <p class="muted">La prossima viene creata in automatico dal sistema. Se non compare entro qualche minuto, avvisa il Leader.</p>
        <a class="btn" routerLink="/partite">Vedi le partite passate</a>
      }
    </main>
  `,
})
export class HomePage implements OnInit {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  protected readonly none = signal(false);

  async ngOnInit(): Promise<void> {
    const m = await this.api.nextMatch().catch(() => null);
    if (m) await this.router.navigate(['/partita', m.id], { replaceUrl: true });
    else this.none.set(true);
  }
}
