import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';

/** Link d'invito a collegare un account a un giocatore creato dal Leader. */
@Component({
  selector: 'app-invite',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page stack-l">
      @if (loading()) {
        <p class="muted">Controllo l'invito…</p>
      } @else if (!info()) {
        <h1>Invito non valido</h1>
        <p>Il link è scaduto o è già stato usato. Chiedine uno nuovo al Leader.</p>
        <a class="btn" routerLink="/">Vai all'app</a>
      } @else {
        <h1>Ciao {{ info()!.first_name }}!</h1>
        <p>Il Leader ha creato il tuo profilo nel gruppo: le tue presenze, i gol e i voti sono già lì. Collegalo a un account per prenotarti, votare e seguire le tue statistiche.</p>
        @if (session.auth()) {
          <p class="small muted">Sei collegato come {{ session.name(session.uid()) }}: il profilo di {{ info()!.first_name }} verrà unito al tuo account.</p>
          <button class="btn primary" [disabled]="busy()" (click)="claim()">Collega al mio account</button>
        } @else {
          <div class="stack">
            <a class="btn primary block" routerLink="/accesso" [queryParams]="{ invito: token(), modo: 'nuovo' }">Crea il mio account</a>
            <a class="btn block" routerLink="/accesso" [queryParams]="{ invito: token() }">Ho già un account</a>
          </div>
        }
      }
    </main>
  `,
})
export class InvitePage implements OnInit {
  readonly token = input.required<string>();
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);
  protected readonly info = signal<{ first_name: string } | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);

  async ngOnInit(): Promise<void> {
    await this.session.whenReady();
    this.info.set(await this.api.inviteInfo(this.token()).catch(() => null));
    this.loading.set(false);
  }

  protected async claim(): Promise<void> {
    this.busy.set(true);
    try {
      const name = await this.api.claimGuestProfile(this.token());
      await this.session.refresh();
      this.toasts.show(`Fatto: il profilo di ${name} è ora il tuo.`);
      await this.router.navigateByUrl('/');
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
