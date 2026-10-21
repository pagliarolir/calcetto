import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';

/** Nuova password: dal link dell'email, dopo una password temporanea, o dal profilo. */
@Component({
  selector: 'app-new-password',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page stack-l">
      @if (!ready()) {
        <p class="muted">Un attimo…</p>
      } @else if (!session.auth()) {
        <header class="stack">
          <h1>Link non più valido</h1>
          <p class="muted">Il link per cambiare password vale un'ora e si può usare una volta sola. Richiedine uno nuovo dalla pagina di accesso.</p>
        </header>
        <a class="btn primary" routerLink="/accesso" [queryParams]="{ recupero: 1 }">Richiedi un nuovo link</a>
      } @else {
        <header class="stack">
          <h1>{{ forced() ? 'Scegli una nuova password' : 'Cambia password' }}</h1>
          <p class="muted">{{ reason() }}</p>
        </header>
        <form class="stack" (ngSubmit)="save()">
          <label class="field"><span>Nuova password</span>
            <input class="input" name="pw" [type]="show() ? 'text' : 'password'" [(ngModel)]="password"
                   autocomplete="new-password" minlength="8" required />
          </label>
          <label class="field"><span>Ripetila</span>
            <input class="input" name="pw2" [type]="show() ? 'text' : 'password'" [(ngModel)]="confirm"
                   autocomplete="new-password" minlength="8" required />
          </label>
          <label class="switch">
            <span>Mostra le password</span>
            <input type="checkbox" [checked]="show()" (change)="show.set(!show())" />
          </label>
          @if (error()) { <p class="note warn" role="alert">{{ error() }}</p> }
          <button class="btn primary block" type="submit" [disabled]="busy()">Salva la nuova password</button>
          @if (!forced()) { <a class="btn ghost block" routerLink="/profilo" [queryParams]="{ scheda: 'sicurezza' }">Annulla</a> }
        </form>
      }
    </main>
  `,
})
export class NewPasswordPage implements OnInit {
  protected readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);

  protected readonly ready = signal(false);
  protected readonly busy = signal(false);
  protected readonly show = signal(false);
  protected readonly error = signal('');
  protected password = '';
  protected confirm = '';

  protected readonly temporary = computed(() => this.session.profile()?.must_change_password ?? false);
  protected readonly forced = computed(() => this.temporary() || this.session.recovering());
  protected readonly reason = computed(() => {
    if (this.temporary()) return 'Stai usando una password temporanea data dal Leader: sceglierne una tua è obbligatorio per continuare.';
    if (this.session.recovering()) return 'Sei entrato dal link dell\'email. Scegli la password che userai d\'ora in poi.';
    return 'Almeno 8 caratteri. Meglio una frase che ricordi facilmente.';
  });

  async ngOnInit(): Promise<void> {
    await this.session.whenReady();
    this.ready.set(true);
  }

  protected async save(): Promise<void> {
    this.error.set('');
    if (this.password.length < 8) return this.error.set('Usa almeno 8 caratteri.');
    if (this.password !== this.confirm) return this.error.set('Le due password non coincidono.');
    this.busy.set(true);
    try {
      await this.session.updatePassword(this.password);
      this.toasts.show('Password aggiornata.');
      await this.router.navigateByUrl(this.session.profile()?.active ? '/' : '/in-attesa');
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
