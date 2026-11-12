import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { toSquareJpeg } from '../core/image';
import { FIELD_ROLE_LABEL } from '../core/models';
import { Session } from '../core/session';
import { errorMessage, Supabase } from '../core/supabase';
import { Toasts } from '../core/toast';
import { Avatar } from '../ui/avatar';

type Field = 'first_name' | 'last_name' | 'nickname' | 'field_role' | 'birth_date' | 'weight_kg' | 'height_cm';

/** Il Leader modifica profilo e foto di un altro giocatore. Si inviano solo i campi cambiati (quelli nascosti dal giocatore non si cancellano). */
@Component({
  selector: 'app-profile-admin',
  imports: [FormsModule, Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="sheet" (click)="backdrop($event)" aria-labelledby="pa-h">
      @if (userId(); as id) {
        <h3 id="pa-h">Profilo di {{ session.name(id) }}</h3>
        <div class="photo">
          <app-avatar [userId]="id" [size]="72" />
          <label class="btn small">Cambia la foto<input type="file" accept="image/*" class="sr-only" (change)="photo($event)" [disabled]="busy()" /></label>
        </div>
        <label class="field"><span>Nome</span><input class="input" [ngModel]="f.first_name" (ngModelChange)="set('first_name', $event)" maxlength="40" /></label>
        <label class="field"><span>Cognome</span><input class="input" [ngModel]="f.last_name" (ngModelChange)="set('last_name', $event)" maxlength="40" /></label>
        <label class="field"><span>Soprannome</span><input class="input" [ngModel]="f.nickname" (ngModelChange)="set('nickname', $event)" maxlength="60" /></label>
        <label class="field"><span>Ruolo in campo</span>
          <select class="input" [ngModel]="f.field_role ?? ''" (ngModelChange)="set('field_role', $event)">
            <option value="">Non indicato</option>
            @for (r of roles; track r.key) { <option [value]="r.key">{{ r.label }}</option> }
          </select></label>
        <label class="field"><span>Data di nascita</span><input class="input" type="date" [ngModel]="f.birth_date" (ngModelChange)="set('birth_date', $event)" /></label>
        <div class="two">
          <label class="field"><span>Peso (kg)</span><input class="input" type="number" [ngModel]="f.weight_kg" (ngModelChange)="set('weight_kg', $event)" /></label>
          <label class="field"><span>Altezza (cm)</span><input class="input" type="number" [ngModel]="f.height_cm" (ngModelChange)="set('height_cm', $event)" /></label>
        </div>
        <p class="small muted">I dati che il giocatore ha nascosto qui risultano vuoti: restano com'erano se non li modifichi.</p>
        <div class="row">
          <button class="btn ghost grow" (click)="close()">Annulla</button>
          <button class="btn primary grow" [disabled]="busy() || !dirty().size" (click)="save()">Salva</button>
        </div>
      }
    </dialog>
  `,
  styles: `
    .sheet { position: fixed; inset: auto 0 0 0; margin: 0 auto; width: 100%; max-width: 560px; max-height: 90dvh; overflow-y: auto; border: 0; color: var(--ink);
             background: var(--surface); border-radius: 22px 22px 0 0; padding: 16px 16px calc(20px + env(safe-area-inset-bottom, 0px)); box-shadow: 0 -10px 40px rgb(0 0 0 / 25%); }
    .sheet[open] { display: flex; flex-direction: column; gap: 10px; }
    .sheet::backdrop { background: var(--backdrop); }
    .photo { display: flex; align-items: center; gap: 12px; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  `,
})
export class ProfileAdmin {
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly sb = inject(Supabase).client;
  private readonly toasts = inject(Toasts);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');
  protected readonly userId = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly dirty = signal(new Set<Field>());
  protected readonly roles = Object.entries(FIELD_ROLE_LABEL).map(([key, label]) => ({ key, label }));
  protected f: Record<Field, string | number | null> = { first_name: '', last_name: null, nickname: null, field_role: null, birth_date: null, weight_kg: null, height_cm: null };

  open(id: string): void {
    const m = this.session.members().find((x) => x.id === id);
    this.f = { first_name: m?.first_name ?? '', last_name: m?.last_name ?? null, nickname: m?.nickname ?? null, field_role: m?.field_role ?? null,
               birth_date: m?.birth_date ?? null, weight_kg: m?.weight_kg ?? null, height_cm: m?.height_cm ?? null };
    this.dirty.set(new Set());
    this.userId.set(id);
    queueMicrotask(() => { const d = this.dlg()?.nativeElement; if (d && !d.open) d.showModal(); });
  }

  protected set(k: Field, v: string | number | null): void {
    this.f[k] = v;
    this.dirty.update((s) => new Set(s).add(k));
  }

  protected close(): void {
    this.dlg()?.nativeElement.close();
  }

  protected backdrop(e: MouseEvent): void {
    if (e.target === this.dlg()?.nativeElement) this.close();
  }

  protected async save(): Promise<void> {
    const id = this.userId()!;
    const patch = Object.fromEntries([...this.dirty()].map((k) => [k, this.f[k] === null || this.f[k] === undefined ? '' : String(this.f[k])]));
    this.busy.set(true);
    try {
      const r = await this.sb.rpc('admin_update_profile', { p_user: id, p: patch });
      if (r.error) throw r.error;
      await this.session.refresh();
      this.toasts.show(`Profilo di ${this.session.name(id)} salvato.`);
      this.close();
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** foto: stesso ritaglio quadrato del profilo; cartella del giocatore, collegata con admin_set_avatar */
  protected async photo(e: Event): Promise<void> {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!file) return;
    const id = this.userId()!;
    this.busy.set(true);
    try {
      const blob = await toSquareJpeg(file);
      if (id === this.session.uid()) {
        await this.api.setAvatar(id, blob, this.session.members().find((m) => m.id === id)?.avatar_path ?? null);
      } else {
        const path = `${id}/${crypto.randomUUID()}.jpg`;
        const up = await this.sb.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '604800', upsert: false });
        if (up.error) throw up.error;
        const r = await this.sb.rpc('admin_set_avatar', { p_user: id, p_path: path });
        if (r.error) { await this.sb.storage.from('avatars').remove([path]); throw r.error; }
        if (r.data) await this.sb.storage.from('avatars').remove([r.data as string]);
      }
      await this.session.refresh();
      this.toasts.show('Foto aggiornata.');
    } catch (err) {
      this.toasts.error(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
