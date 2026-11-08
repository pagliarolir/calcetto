import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { MatchSkeleton } from '../ui/match-skeleton';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../core/api';

/** Porta direttamente alla prossima partita. */
@Component({
  selector: 'app-home',
  imports: [RouterLink, MatchSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `:host { display: flex; flex-direction: column; flex: 1 1 0; min-height: 0; }`,
  template: `
    @if (!none()) {
      <!-- mentre cerca la prossima partita: lo stesso scheletro completo della pagina della partita -->
      <app-match-skeleton />
    } @else {
    <main class="page stack-l">
        <h1>Nessuna partita in calendario</h1>
        <p class="muted">La prossima viene creata in automatico dal sistema. Se non compare entro qualche minuto, avvisa il Leader.</p>
        <a class="btn" routerLink="/partite">Vedi le partite passate</a>
    </main>
    }
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
