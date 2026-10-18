import { ChangeDetectionStrategy, Component, inject, OnInit, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Session } from '../core/session';
import { Api } from '../core/api';
import { errorMessage } from '../core/supabase';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="login">
      <section class="hero" aria-hidden="true">
        <div class="ball"></div>
      </section>
      <section class="sheet stack">
        <h1>G.d.L.</h1>
        <p class="muted">Bianchi contro neri, ogni settimana. Entra per prenotare il tuo posto.</p>

        @if (mode() === 'reset') {
          <form class="stack" (ngSubmit)="sendReset()">
            <h2>Password dimenticata</h2>
            <p class="small muted">Scrivi l'email con cui ti sei registrato: ti mandiamo un link per sceglierne una nuova.</p>
            <label class="field"><span>Email</span>
              <input class="input" name="email" type="email" [(ngModel)]="email" required autocomplete="email" inputmode="email" />
            </label>
            @if (error()) { <p class="note warn" role="alert">{{ error() }}</p> }
            @if (info()) { <p class="note" role="status">{{ info() }}</p> }
            <button class="btn primary block" type="submit" [disabled]="busy() || !email.trim()">Mandami il link</button>
            <p class="small muted">Non arriva niente? Chiedi al Leader o a un Premier: dalla Gestione possono darti una password temporanea.</p>
            <button class="btn ghost block" type="button" (click)="setMode('in')">Torna all'accesso</button>
          </form>
        } @else {
        @if (invite(); as iv) {
          <p class="note invite" role="status">Ciao <strong>{{ iv.first_name }}</strong>! Il Leader ha già creato il tuo profilo: {{ inviteAction() }} e ritrovi presenze, gol e voti.</p>
        }
        <div class="chips" role="tablist">
          <button class="chip" role="tab" [attr.aria-pressed]="mode() === 'in'" (click)="setMode('in')">Ho già un account</button>
          <button class="chip" role="tab" [attr.aria-pressed]="mode() === 'up'" (click)="setMode('up')">Sono nuovo</button>
        </div>

        <form class="stack" (ngSubmit)="submit()">
          @if (mode() === 'up') {
            <label class="field"><span>Nome</span>
              <input class="input" name="first" [(ngModel)]="firstName" required autocomplete="given-name" maxlength="40" />
            </label>
          }
          <label class="field"><span>Email</span>
            <input class="input" name="email" type="email" [(ngModel)]="email" required autocomplete="email" inputmode="email" />
          </label>
          <label class="field"><span>Password</span>
            <input class="input" name="password" type="password" [(ngModel)]="password" required minlength="6"
                   [attr.autocomplete]="mode() === 'in' ? 'current-password' : 'new-password'" />
          </label>
          @if (mode() === 'up' && !invite()) {
            <label class="field"><span>Codice invito (se te l'hanno dato)</span>
              <input class="input" name="code" [(ngModel)]="code" autocomplete="off" />
            </label>
          }
          @if (error()) { <p class="note warn" role="alert">{{ error() }}</p> }
          @if (info()) { <p class="note" role="status">{{ info() }}</p> }
          <button class="btn primary block" type="submit" [disabled]="busy()">
            {{ mode() === 'in' ? 'Entra' : 'Crea account' }}
          </button>
          @if (mode() === 'in') {
            <button class="btn ghost block" type="button" (click)="setMode('reset')">Password dimenticata?</button>
          }
        </form>

        @if (session.googleEnabled) {
          <button class="btn block" (click)="google()">Entra con Google</button>
        }
        }
      </section>
    </main>
  `,
  styles: `
    .login { min-height: 100dvh; display: flex; flex-direction: column; background: var(--turf); }
    .hero {
      flex: 1; min-height: 34vh; position: relative; overflow: hidden;
      background:
        linear-gradient(var(--chalk), var(--chalk)) center / 100% 2px no-repeat,
        repeating-linear-gradient(90deg, transparent 0 48px, rgb(255 255 255 / 4%) 48px 96px);
    }
    .hero::before {
      content: ''; position: absolute; left: 50%; top: 50%; width: 46vmin; height: 46vmin; max-width: 260px; max-height: 260px;
      transform: translate(-50%, -50%); border: 2px solid var(--chalk); border-radius: 50%;
    }
    .ball {
      position: absolute; left: 50%; top: 50%; width: 64px; height: 64px; border-radius: 50%;
      transform: translate(-50%, -50%);
      background: linear-gradient(var(--kit-white) 50%, var(--kit-black) 50%);
      box-shadow: 0 0 0 2px var(--chalk), 0 12px 30px rgb(0 0 0 / 30%);
      animation: drop-in 700ms var(--ease-spring) both;
    }
    .sheet {
      background: var(--bg); border-radius: var(--r-l) var(--r-l) 0 0;
      padding: 28px 20px calc(28px + env(safe-area-inset-bottom));
      max-width: 520px; width: 100%; margin: 0 auto;
    }
    h1 { font-size: var(--step-4); line-height: 0.95; }
  `,
})
export class LoginPage implements OnInit {
  protected readonly session = inject(Session);
  private readonly router = inject(Router);

  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(Api);
  protected readonly mode = signal<'in' | 'up' | 'reset'>('in');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly info = signal('');
  protected email = '';
  protected password = '';
  protected firstName = '';
  protected code = '';
  /** invito personale a collegarsi a un giocatore creato dal Leader */
  private inviteToken: string | null = null;
  protected readonly invite = signal<{ first_name: string } | null>(null);
  protected readonly inviteAction = computed(() => (this.mode() === 'up' ? "crea l'account" : 'entra con il tuo account'));

  ngOnInit(): void {
    const q = this.route.snapshot.queryParamMap;
    if (q.has('recupero')) this.mode.set('reset');
    this.inviteToken = q.get('invito');
    if (this.inviteToken) {
      if (q.get('modo') === 'nuovo') this.mode.set('up');
      void this.api.inviteInfo(this.inviteToken).then((i) => {
        this.invite.set(i);
        if (i && !this.firstName) this.firstName = i.first_name;
        if (!i) this.inviteToken = null;
      }).catch(() => (this.inviteToken = null));
    }
  }

  protected setMode(m: 'in' | 'up' | 'reset'): void {
    this.mode.set(m);
    this.error.set('');
    this.info.set('');
  }

  protected async sendReset(): Promise<void> {
    this.error.set('');
    this.info.set('');
    this.busy.set(true);
    try {
      const { error } = await this.session.requestPasswordReset(this.email.trim());
      if (error) throw error;
      // stesso messaggio in ogni caso: non riveliamo quali email sono registrate
      this.info.set('Se l\'indirizzo è registrato, tra poco ti arriva un\'email con il link. Controlla anche lo spam.');
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async submit(): Promise<void> {
    this.error.set('');
    this.info.set('');
    this.busy.set(true);
    try {
      if (this.mode() === 'in') {
        const { error } = await this.session.signIn(this.email.trim(), this.password);
        if (error) throw error;
        // account già esistente: si unisce al profilo creato dal Leader
        if (this.inviteToken) {
          await this.session.refresh();
          await this.api.claimGuestProfile(this.inviteToken);
        }
      } else {
        if (!this.firstName.trim()) throw new Error('Scrivi il tuo nome.');
        const { data, error } = await this.session.signUp(this.email.trim(), this.password, this.firstName.trim(), this.code.trim(), this.inviteToken);
        if (error) throw error;
        if (!data.session) {
          this.info.set('Controlla la tua email per confermare l\'account, poi torna qui ed entra.');
          return;
        }
      }
      await this.session.refresh();
      await this.router.navigateByUrl(this.session.profile()?.active ? '/' : '/in-attesa');
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async google(): Promise<void> {
    const { error } = await this.session.signInWithGoogle();
    if (error) this.error.set(errorMessage(error));
  }
}
