import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { FIELD_ROLE_LABEL, FieldRole, ROLE_LABEL, VisibilityKey } from '../core/models';
import { Push } from '../core/push';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';

interface Form {
  first_name: string;
  last_name: string;
  nickname: string;
  field_role: FieldRole | '';
  birth_date: string;
  weight_kg: number | null;
  height_cm: number | null;
}

@Component({
  selector: 'app-profile',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page stack-l">
      <header class="stack">
        <h1>Il tuo profilo</h1>
        @if (session.profile(); as p) { <p class="muted">{{ roleLabel[p.role] }}</p> }
      </header>

      <section class="section">
        <header><h2>Notifiche</h2></header>
        <div class="panel stack">
          @switch (push.state()) {
            @case ('on') { <p>Le notifiche sono attive su questo dispositivo.</p>
              <button class="btn small" (click)="togglePush(false)">Disattiva su questo dispositivo</button> }
            @case ('off') { <p>Attivale per sapere quando aprono le prenotazioni, quando escono le squadre e quando si vota.</p>
              <button class="btn primary" (click)="togglePush(true)">Attiva le notifiche</button> }
            @case ('denied') { <p>Le notifiche sono bloccate nelle impostazioni del browser per questo sito. Sbloccale da lì e torna qui.</p> }
            @case ('needs-install') { <p>Su iPhone le notifiche funzionano solo con l'app sulla schermata Home: tocca Condividi, poi "Aggiungi alla schermata Home", e apri l'app da lì.</p> }
            @default { <p>Questo browser non supporta le notifiche push. Prova con Chrome, Edge, Firefox o Safari aggiornati.</p> }
          }
        </div>
      </section>

      <form class="section" (ngSubmit)="save()">
        <header><h2>I tuoi dati</h2></header>
        <p class="small muted">Solo il nome è obbligatorio. Con l'interruttore decidi cosa vedono gli altri.</p>
        <div class="panel stack">
          <label class="field"><span>Nome</span>
            <input class="input" name="first_name" [(ngModel)]="form.first_name" required maxlength="40" autocomplete="given-name" />
          </label>
          @for (f of optional; track f.key) {
            <div class="opt">
              <label class="field grow"><span>{{ f.label }}</span>
                @switch (f.key) {
                  @case ('field_role') {
                    <select class="input" name="field_role" [(ngModel)]="form.field_role">
                      <option value="">Non indicato</option>
                      @for (r of fieldRoles; track r[0]) { <option [value]="r[0]">{{ r[1] }}</option> }
                    </select>
                  }
                  @case ('birth_date') { <input class="input" type="date" name="birth_date" [(ngModel)]="form.birth_date" /> }
                  @case ('weight_kg') { <input class="input" type="number" inputmode="decimal" min="30" max="250" step="0.5" name="weight_kg" [(ngModel)]="form.weight_kg" /> }
                  @case ('height_cm') { <input class="input" type="number" inputmode="numeric" min="120" max="230" name="height_cm" [(ngModel)]="form.height_cm" /> }
                  @default { <input class="input" [name]="f.key" [(ngModel)]="$any(form)[f.key]" maxlength="60" /> }
                }
              </label>
              <label class="vis">
                <input type="checkbox" class="toggle" [checked]="visibility()[f.key]" (change)="toggleVis(f.key)" />
                <span class="small">{{ visibility()[f.key] ? 'Visibile' : 'Nascosto' }}</span>
              </label>
            </div>
          }
        </div>
        <button class="btn primary block" type="submit" [disabled]="busy()">Salva il profilo</button>
      </form>

      <section class="section">
        <header><h2>Sicurezza</h2></header>
        <a class="btn" routerLink="/nuova-password">Cambia password</a>
      </section>

      <button class="btn ghost" (click)="logout()">Esci dall'account</button>
    </main>
  `,
  styles: `
    .opt { display: flex; align-items: flex-end; gap: 10px; }
    .vis { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 66px; padding-bottom: 4px; cursor: pointer; }
    .toggle {
      appearance: none; width: 46px; height: 28px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--line);
      position: relative; cursor: pointer; margin: 0; transition: background 160ms;
    }
    .toggle::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: var(--surface);
      box-shadow: 0 1px 3px rgb(0 0 0 / 25%); transition: transform 180ms var(--ease-spring); }
    .toggle:checked { background: var(--turf); border-color: var(--turf); }
    .toggle:checked::after { transform: translateX(18px); }
  `,
})
export class ProfilePage {
  protected readonly session = inject(Session);
  protected readonly push = inject(Push);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);

  protected readonly roleLabel = ROLE_LABEL;
  protected readonly fieldRoles = Object.entries(FIELD_ROLE_LABEL);
  protected readonly optional: { key: VisibilityKey; label: string }[] = [
    { key: 'last_name', label: 'Cognome' },
    { key: 'nickname', label: 'Soprannome' },
    { key: 'field_role', label: 'Ruolo in campo' },
    { key: 'birth_date', label: 'Data di nascita' },
    { key: 'weight_kg', label: 'Peso (kg)' },
    { key: 'height_cm', label: 'Altezza (cm)' },
  ];

  protected form: Form = { first_name: '', last_name: '', nickname: '', field_role: '', birth_date: '', weight_kg: null, height_cm: null };
  protected readonly visibility = signal<Record<VisibilityKey, boolean>>({
    last_name: true, nickname: true, field_role: true, birth_date: false, weight_kg: false, height_cm: false,
  });
  protected readonly busy = signal(false);

  constructor() {
    effect(() => {
      const p = this.session.profile();
      if (!p) return;
      this.form = {
        first_name: p.first_name, last_name: p.last_name ?? '', nickname: p.nickname ?? '', field_role: p.field_role ?? '',
        birth_date: p.birth_date ?? '', weight_kg: p.weight_kg, height_cm: p.height_cm,
      };
      untracked(() => this.visibility.set({ ...this.visibility(), ...p.visibility }));
    });
  }

  protected toggleVis(k: VisibilityKey): void {
    this.visibility.update((v) => ({ ...v, [k]: !v[k] }));
  }

  protected async save(): Promise<void> {
    if (!this.form.first_name.trim()) {
      this.toasts.error('Il nome è obbligatorio.');
      return;
    }
    this.busy.set(true);
    try {
      const f = this.form;
      await this.api.updateProfile(this.session.uid()!, {
        first_name: f.first_name.trim(),
        last_name: f.last_name.trim() || null,
        nickname: f.nickname.trim() || null,
        field_role: f.field_role || null,
        birth_date: f.birth_date || null,
        weight_kg: f.weight_kg || null,
        height_cm: f.height_cm || null,
        visibility: this.visibility(),
      });
      await this.session.refresh();
      this.toasts.show('Profilo salvato.');
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async togglePush(on: boolean): Promise<void> {
    try {
      if (on) await this.push.enable();
      else await this.push.disable();
      this.toasts.show(on ? 'Notifiche attivate.' : 'Notifiche disattivate su questo dispositivo.');
    } catch (e) {
      await this.push.check();
      this.toasts.error(errorMessage(e));
    }
  }

  protected async logout(): Promise<void> {
    await this.push.disable().catch(() => undefined);
    await this.session.signOut();
    await this.router.navigateByUrl('/accesso');
  }
}
