import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Icon } from '../ui/icon';
import { toSquareJpeg } from '../core/image';
import { fmtWhen } from '../core/format';
import { Avatar } from '../ui/avatar';
import { Api } from '../core/api';
import { FIELD_ROLE_LABEL, FieldRole, ROLE_LABEL, VisibilityKey, NotifyCategory } from '../core/models';
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

type ProfileTab = 'dati' | 'foto' | 'notifiche' | 'sicurezza';

@Component({
  selector: 'app-profile',
  imports: [FormsModule, RouterLink, Avatar, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page stack-l">
      <header class="me">
        @if (session.uid(); as uid) { <app-avatar [userId]="uid" [size]="88" /> }
        <div class="stack">
          <h1>Il tuo profilo</h1>
          @if (session.profile(); as p) { <p class="muted">{{ roleLabel[p.role] }}</p> }
          @if (session.punishment(); as pu) {
            <p class="tag danger">In punizione {{ pu.ends_at ? 'fino a ' + when(pu.ends_at) : 'fino a nuovo ordine' }}</p>
          }
        </div>
      </header>

      <nav class="ptabs" role="tablist" aria-label="Profilo">
        @for (t of tabs; track t.id) {
          <button role="tab" [id]="'ptab-' + t.id" [attr.aria-selected]="tab() === t.id" [attr.aria-controls]="'ppanel-' + t.id"
                  [attr.tabindex]="tab() === t.id ? 0 : -1" (click)="selectTab(t.id)" (keydown)="tabKey($event)">
            <app-icon [name]="t.icon" [size]="20" /><span>{{ t.label }}</span>
          </button>
        }
      </nav>

      <div class="ppanel" role="tabpanel" [id]="'ppanel-' + tab()" [attr.aria-labelledby]="'ptab-' + tab()">
        @switch (tab()) {
          @case ('dati') {
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
          }
          @case ('foto') {
      <section class="section">
        <header><h2>Foto</h2></header>
        <div class="panel stack">
          @if (preview(); as pv) {
            <div class="row">
              <img class="preview" [src]="pv.url" alt="Anteprima della nuova foto profilo" />
              <p class="small">Così la vedranno gli altri: ritagliata in un cerchio. Va bene?</p>
            </div>
            <div class="row-wrap">
              <button class="btn small primary" [disabled]="photoBusy()" (click)="savePhoto()">{{ photoBusy() ? 'Caricamento…' : 'Salva la foto' }}</button>
              <button class="btn small ghost" [disabled]="photoBusy()" (click)="cancelPhoto()">Annulla</button>
            </div>
          } @else {
            <div class="row-wrap">
              <label class="btn small primary">
                {{ session.profile()?.avatar_path ? 'Cambia foto' : 'Aggiungi una foto' }}
                <input type="file" accept="image/*" class="sr-only" (change)="pickPhoto($event)" />
              </label>
              @if (session.profile()?.avatar_path) {
                <button class="btn small ghost" [disabled]="photoBusy()" (click)="removePhoto()">Rimuovi</button>
              }
            </div>
          }
          <label class="switch">
            <span>Mostra la foto agli altri</span>
            <input type="checkbox" [checked]="visibility().avatar" (change)="togglePhotoVisibility()" />
          </label>
          <p class="small muted">Compare nelle formazioni, nella classifica, nelle pagelle e nella tua scheda. Se la nascondi, gli altri vedono le tue iniziali.</p>
        </div>
      </section>
          }
          @case ('notifiche') {
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
        <div class="panel stack prefs">
          <h3>Cosa vuoi ricevere</h3>
          <p class="small muted">Vale per le notifiche sul telefono e per gli Avvisi. Quelli che riguardano solo te (ad esempio entri in squadra o il Leader ti sposta) arrivano sempre.</p>
          <ul class="toggles">
            @for (c of notifyCategories; track c.key) {
              <li>
                <label class="switch">
                  <span><strong>{{ c.label }}</strong><br /><span class="small muted">{{ c.hint }}</span></span>
                  <input type="checkbox" [checked]="wants(c.key)" [disabled]="prefsBusy()" (change)="togglePref(c.key)" />
                </label>
              </li>
            }
          </ul>
        </div>
      </section>
          }
          @case ('sicurezza') {
      <section class="section">
        <header><h2>Sicurezza</h2></header>
        <a class="btn" routerLink="/nuova-password">Cambia password</a>
      </section>
      <button class="btn ghost" (click)="logout()">Esci dall'account</button>
          }
        }
      </div>
    </main>
  `,
  styles: `
    .me { display: flex; align-items: center; gap: 16px; }
    /* schede del profilo: icona sopra, nome sotto */
    .ptabs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; padding: 4px; border-radius: 16px; background: var(--surface-2); margin-top: -8px; }
    .ptabs button {
      appearance: none; border: 0; background: transparent; color: var(--muted); cursor: pointer; border-radius: 12px;
      min-height: 58px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
      font: 600 0.75rem/1 var(--font-body); transition: background 160ms, color 160ms;
    }
    .ptabs button[aria-selected='true'] { background: var(--surface); color: var(--turf); box-shadow: 0 1px 3px rgb(20 32 25 / 14%); }
    .ppanel { display: flex; flex-direction: column; gap: var(--space-l, 24px); }
    .preview { width: 96px; height: 96px; border-radius: 50%; object-fit: cover; flex: none; box-shadow: 0 0 0 2px var(--line); }
    label.btn { position: relative; }
    label.btn:focus-within { outline: 3px solid var(--focus); outline-offset: 2px; }
    .opt { display: flex; align-items: flex-end; gap: 10px; }
    .toggles { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .toggles li { padding: 10px 0; border-top: 1px solid var(--line); }
    .toggles li:first-child { border-top: 0; padding-top: 0; }
    .toggles .switch { align-items: center; gap: 12px; }
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
  protected readonly tabs: { id: ProfileTab; label: string; icon: string }[] = [
    { id: 'dati', label: 'Dati', icon: 'user' },
    { id: 'foto', label: 'Foto', icon: 'camera' },
    { id: 'notifiche', label: 'Notifiche', icon: 'bell' },
    { id: 'sicurezza', label: 'Sicurezza', icon: 'key' },
  ];
  protected readonly tab = signal<ProfileTab>(
    ((): ProfileTab => {
      const q = inject(ActivatedRoute).snapshot.queryParamMap.get('scheda') as ProfileTab | null;
      return q && ['dati', 'foto', 'notifiche', 'sicurezza'].includes(q) ? q : 'dati';
    })(),
  );

  protected selectTab(t: ProfileTab): void {
    this.tab.set(t);
    void this.router.navigate([], { queryParams: { scheda: t === 'dati' ? null : t }, replaceUrl: true });
  }

  /** frecce sinistra e destra per passare da una scheda all'altra */
  protected tabKey(e: KeyboardEvent): void {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = this.tabs.findIndex((t) => t.id === this.tab());
    const next = this.tabs[(i + (e.key === 'ArrowRight' ? 1 : this.tabs.length - 1)) % this.tabs.length].id;
    this.selectTab(next);
    document.getElementById('ptab-' + next)?.focus();
  }
  protected readonly when = fmtWhen;
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
    last_name: true, nickname: true, field_role: true, birth_date: false, weight_kg: false, height_cm: false, avatar: true,
  });
  protected readonly preview = signal<{ blob: Blob; url: string } | null>(null);
  protected readonly photoBusy = signal(false);
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

  protected async pickPhoto(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const blob = await toSquareJpeg(file);
      this.cancelPhoto();
      this.preview.set({ blob, url: URL.createObjectURL(blob) });
    } catch (err) {
      this.toasts.error(errorMessage(err));
    }
  }

  protected cancelPhoto(): void {
    const p = this.preview();
    if (p) URL.revokeObjectURL(p.url);
    this.preview.set(null);
  }

  protected async savePhoto(): Promise<void> {
    const p = this.preview();
    const uid = this.session.uid();
    if (!p || !uid) return;
    this.photoBusy.set(true);
    try {
      await this.api.setAvatar(uid, p.blob, this.session.profile()?.avatar_path ?? null);
      this.cancelPhoto();
      await this.session.refresh();
      this.toasts.show('Foto aggiornata.');
    } catch (err) {
      this.toasts.error(errorMessage(err));
    } finally {
      this.photoBusy.set(false);
    }
  }

  protected async removePhoto(): Promise<void> {
    const uid = this.session.uid();
    const path = this.session.profile()?.avatar_path;
    if (!uid || !path || !confirm('Rimuovere la foto profilo?')) return;
    this.photoBusy.set(true);
    try {
      await this.api.removeAvatar(uid, path);
      await this.session.refresh();
      this.toasts.show('Foto rimossa.');
    } catch (err) {
      this.toasts.error(errorMessage(err));
    } finally {
      this.photoBusy.set(false);
    }
  }

  protected async togglePhotoVisibility(): Promise<void> {
    const uid = this.session.uid();
    if (!uid) return;
    const v = { ...this.visibility(), avatar: !this.visibility().avatar };
    this.visibility.set(v);
    try {
      await this.api.updateProfile(uid, { visibility: v });
      await this.session.refresh();
      this.toasts.show(v.avatar ? 'La foto è visibile agli altri.' : 'La foto ora la vedi solo tu.');
    } catch (err) {
      this.visibility.set({ ...v, avatar: !v.avatar });
      this.toasts.error(errorMessage(err));
    }
  }

  // --------------------------------------------------------- quali notifiche
  protected readonly notifyCategories: { key: NotifyCategory; label: string; hint: string }[] = [
    { key: 'chat', label: 'Messaggi in chat', hint: 'Quando qualcuno scrive nella chat di una partita in cui sei in lista' },
    { key: 'booking_open', label: 'Apertura delle prenotazioni', hint: 'Quando puoi rispondere per la prossima partita' },
    { key: 'team_full', label: 'Squadra al completo', hint: 'Quando la lista arriva a 10: chi risponde dopo va tra le riserve' },
    { key: 'withdrawal', label: 'Rinuncia di un titolare', hint: 'Quando un titolare non gioca più o manca un giocatore' },
    { key: 'lineup_official', label: 'Formazioni ufficiali', hint: 'Quando escono le squadre' },
    { key: 'lineup_change', label: 'Cambi di formazione', hint: 'Quando le squadre ufficiali cambiano' },
    { key: 'match_changes', label: 'Giorno, orario o campo', hint: 'Quando la partita si sposta, cambia campo o viene annullata' },
    { key: 'result', label: 'Risultato', hint: 'Quando si inserisce, si conferma o si contesta il risultato' },
    { key: 'votes', label: 'Votazioni', hint: 'Quando puoi votare i compagni' },
  ];
  protected readonly prefsBusy = signal(false);

  /** voce mancante = accesa, tranne la chat (spenta finché non la accendi) */
  protected wants(key: NotifyCategory): boolean {
    return this.session.profile()?.notify_prefs?.[key] ?? key !== 'chat';
  }

  protected async togglePref(key: NotifyCategory): Promise<void> {
    const uid = this.session.uid();
    if (!uid) return;
    const next = { ...(this.session.profile()?.notify_prefs ?? {}), [key]: !this.wants(key) };
    this.prefsBusy.set(true);
    try {
      await this.api.updateProfile(uid, { notify_prefs: next });
      await this.session.refresh();
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.prefsBusy.set(false);
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
