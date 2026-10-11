import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Session } from '../core/session';

@Component({
  selector: 'app-pending',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page stack-l">
      @if (session.profile()?.pending) {
        <h1>Richiesta inviata</h1>
        <p>Il Leader o uno dei Premier deve approvare il tuo ingresso nel gruppo. Ti arriverà un avviso appena fatto.</p>
      } @else {
        <h1>Account non attivo</h1>
        <p>Questo account è stato rimosso dal gruppo. Se pensi sia un errore, scrivi al Leader.</p>
      }
      <div class="row">
        <button class="btn primary" (click)="check()">Controlla di nuovo</button>
        <button class="btn ghost" (click)="logout()">Esci</button>
      </div>
    </main>
  `,
})
export class PendingPage {
  protected readonly session = inject(Session);
  private readonly router = inject(Router);

  protected async check(): Promise<void> {
    await this.session.refresh();
    if (this.session.profile()?.active) await this.router.navigateByUrl('/');
  }

  protected async logout(): Promise<void> {
    await this.session.signOut();
    await this.router.navigateByUrl('/accesso');
  }
}
