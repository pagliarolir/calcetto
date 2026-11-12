import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { PlayerPage } from './player';
import { PALETTE } from '../core/color';
import { Theme, ThemeChoice } from '../core/theme';
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
import { Confirm } from '../core/confirm';
import { Sheet } from '../ui/sheet';

interface Form {
  first_name: string;
  last_name: string;
  nickname: string;
  field_role: FieldRole | '';
  birth_date: string;
  weight_kg: number | null;
  height_cm: number | null;
}

type ProfileTab = 'dati' | 'stats' | 'foto' | 'notifiche' | 'aspetto' | 'sicurezza';

@Component({
  selector: 'app-profile',
  imports: [Sheet, FormsModule, RouterLink, Avatar, Icon, PlayerPage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-head">
      <div class="head-in">
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

      @if (session.isStaff()) {
        <!-- Area Leader: la gestione del gruppo (non più nella barra in basso) -->
        <a class="lead-area" routerLink="/gestione"><app-icon name="whistle" [size]="20" /><span class="grow"><strong>Area Leader</strong><span class="small muted">Gestione del gruppo, partite e giocatori</span></span><app-icon name="chevron" [size]="18" /></a>
      }
      <nav class="ptabs" role="tablist" aria-label="Profilo">
        @for (t of tabs; track t.id) {
          <button role="tab" [id]="'ptab-' + t.id" [attr.aria-selected]="tab() === t.id" [attr.aria-controls]="'ppanel-' + t.id"
                  [attr.tabindex]="tab() === t.id ? 0 : -1" (click)="selectTab(t.id)" (keydown)="tabKey($event)">
            <app-icon [name]="t.icon" [size]="16" /><span>{{ t.label }}</span>
          </button>
        }
      </nav>
      </div>
    </div>
    <main class="scroll-area">
      <div class="page stack-l in-body">

      <div class="ppanel" role="tabpanel" [id]="'ppanel-' + tab()" [attr.aria-labelledby]="'ptab-' + tab()">
        @switch (tab()) {
          @case ('dati') {
      <form class="section" (ngSubmit)="save()">
        <header><h2>I tuoi dati</h2></header>
        <p class="small muted">Solo il nome è obbligatorio. Con l'interruttore decidi cosa vedono gli altri.</p>
        <div class="panel stack">
          <div class="opt">
            <label class="field grow"><span>Nome</span>
              <input class="input" name="first_name" [(ngModel)]="form.first_name" required maxlength="40" autocomplete="given-name" />
            </label>
            <label class="vis">
              <input type="checkbox" class="toggle" [checked]="visibility().first_name !== false" (change)="toggleName($event)"
                     aria-label="Mostra agli altri: Nome (se lo nascondi vedono il soprannome)" />
            </label>
          </div>
          @if (visibility().first_name === false) {
            <p class="small muted">Gli altri vedono il tuo soprannome al posto del nome.</p>
          }
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
                <input type="checkbox" class="toggle" [checked]="visibility()[f.key]" (change)="toggleVis(f.key)"
                       [disabled]="f.key === 'nickname' && visibility().first_name === false"
                       [attr.aria-label]="'Mostra agli altri: ' + f.label" />
              </label>
            </div>
          }
        </div>
        <button class="btn primary block" type="submit" [disabled]="busy()">Salva il profilo</button>
      </form>

      <!-- nascondere il nome: al suo posto il soprannome -->
      <dialog #nickDlg class="sheet" (click)="nickBackdrop($event)" aria-labelledby="nick-h">
        <div class="grab" aria-hidden="true"></div>
        <button type="button" class="x-close" (click)="nickDlg.close()" aria-label="Chiudi"><span><app-icon name="x" [size]="16" /></span></button>
        <h2 id="nick-h">Mostra il soprannome</h2>
        <p class="small muted">Al posto del nome, gli altri vedranno il tuo soprannome: in lista, in classifica, nella chat e negli avvisi.</p>
        <label class="field"><span>Soprannome</span>
          <input class="input" name="nick_popup" [(ngModel)]="nickDraft" maxlength="60" autocomplete="nickname" />
        </label>
        <div class="row">
          <button type="button" class="btn ghost grow" (click)="closeNick()">Annulla</button>
          <button type="button" class="btn primary grow" [disabled]="!nickDraft.trim() || busy()" (click)="confirmNick()">Usa il soprannome</button>
        </div>
      </dialog>
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
                  <input type="checkbox" [checked]="wants(c.key)" (change)="togglePref(c.key)" />
                </label>
              </li>
            }
          </ul>
        </div>
      </section>
          }
          @case ('stats') {
            <!-- i valori del giocatore (inseriti dal Leader): cerchio, esagono e campo -->
            <!-- lo stesso blocco della pagina di un giocatore: valori, sticker conquistati, numeri, partite -->
            <app-player [id]="session.uid()!" [embedded]="true" />
          }
          @case ('aspetto') {
            <section class="section stack">
              <header><h2>Tema</h2></header>
              <div class="themes" role="radiogroup" aria-label="Tema dell'app">
                @for (o of themeOptions; track o.id) {
                  <button type="button" role="radio" class="theme" [class.on]="theme.choice() === o.id" [attr.aria-checked]="theme.choice() === o.id" (click)="theme.set(o.id)">
                    <span class="prev" aria-hidden="true" [style.background]="o.bg">
                      <i class="ph" [style.background]="o.hero"></i>
                      <span class="pr"><i [style.background]="o.primary"></i><i [style.background]="o.accent"></i><i class="grow" [style.background]="o.soft"></i></span>
                    </span>
                    <span class="tn"><app-icon [name]="o.icon" [size]="16" /><strong>{{ o.label }}</strong>@if (theme.choice() === o.id) { <app-icon name="check" [size]="16" class="ok" /> }</span>
                    <span class="small muted">{{ o.desc }}</span>
                  </button>
                }
              <!-- tema personalizzato: scelta dei colori -->
              <button type="button" role="radio" class="theme" [class.on]="theme.choice() === 'custom'" [attr.aria-checked]="theme.choice() === 'custom'" (click)="theme.set('custom')">
                <span class="prev" aria-hidden="true" [style.background]="customCard().bg">
                  <i class="ph" [style.background]="customCard().hero"></i>
                  <span class="pr"><i [style.background]="customCard().primary"></i><i [style.background]="customCard().accent"></i><i class="grow" [style.background]="customCard().soft"></i></span>
                </span>
                <span class="tn"><app-icon name="palette" [size]="16" /><strong>Personalizzato</strong>@if (theme.choice() === 'custom') { <app-icon name="check" [size]="16" class="ok" /> }</span>
                <span class="small muted">Scegli tu i colori</span>
              </button>
              </div>
              @if (theme.choice() === 'custom') {
                @let c = theme.custom();
                <div class="panel stack custom-ed">
                  <div class="stack-s">
                    <span class="lab">Base</span>
                    <div class="ui-seg" role="radiogroup" aria-label="Base del tema">
                      <button type="button" role="radio" [attr.aria-checked]="c.base === 'light'" (click)="theme.setCustom({ base: 'light' })"><app-icon name="sun" [size]="16" /> Chiara</button>
                      <button type="button" role="radio" [attr.aria-checked]="c.base === 'dark'" (click)="theme.setCustom({ base: 'dark' })"><app-icon name="moon" [size]="16" /> Scura</button>
                    </div>
                  </div>
                  <div class="stack-s">
                    <span class="lab">Colore principale</span>
                    <div class="sw" role="radiogroup" aria-label="Colore principale">
                      @for (p of palette; track p.hex) {
                        <button type="button" role="radio" class="dot" [style.background]="p.hex" [attr.aria-checked]="c.primary === p.hex" [attr.aria-label]="p.name" [title]="p.name" (click)="pickPrimary(p.hex)">
                          @if (c.primary === p.hex) { <app-icon name="check" [size]="16" /> }
                        </button>
                      }
                      <label class="dot other" title="Altro colore" [class.on]="!isPal(c.primary)" [style.background]="isPal(c.primary) ? null : c.primary">
                        <app-icon name="plus" [size]="16" /><input type="color" class="sr-only" [value]="c.primary" (input)="pickPrimary($any($event.target).value)" aria-label="Altro colore principale" />
                      </label>
                    </div>
                  </div>
                  <div class="stack-s">
                    <span class="lab">Colore secondario <span class="muted">(fascia da capitano, migliore in campo, sticker)</span></span>
                    <div class="sw" role="radiogroup" aria-label="Colore secondario">
                      <button type="button" role="radio" class="auto" [attr.aria-checked]="c.accent === 'auto'" (click)="pickAccent('auto')"><app-icon name="sparkle" [size]="14" /> Automatico</button>
                      @for (p of palette; track p.hex) {
                        <button type="button" role="radio" class="dot" [style.background]="p.hex" [attr.aria-checked]="c.accent === p.hex" [attr.aria-label]="p.name" [title]="p.name" (click)="pickAccent(p.hex)">
                          @if (c.accent === p.hex) { <app-icon name="check" [size]="16" /> }
                        </button>
                      }
                    </div>
                  </div>
                </div>
              }
              <!-- testo: dimensione e spaziatura -->
              <div class="panel stack text-ed">
                <h3>Testo</h3>
                <label class="rng">
                  <span class="rl"><app-icon name="type" [size]="18" /><span class="grow">Dimensione</span><strong class="num">{{ theme.textScale() }}%</strong></span>
                  <input type="range" min="85" max="130" step="5" [value]="theme.textScale()" (input)="theme.setText(+$any($event.target).value, theme.textSpacing())"
                         aria-label="Dimensione del testo" [attr.aria-valuetext]="theme.textScale() + ' per cento'" />
                  <span class="ends small muted"><span>A</span><span class="big">A</span></span>
                </label>
                <label class="rng">
                  <span class="rl"><app-icon name="spacing" [size]="18" /><span class="grow">Spaziatura</span><strong class="num">{{ spacingLabel() }}</strong></span>
                  <input type="range" min="0" max="100" step="25" [value]="theme.textSpacing()" (input)="theme.setText(theme.textScale(), +$any($event.target).value)"
                         aria-label="Spaziatura del testo" [attr.aria-valuetext]="spacingLabel()" />
                  <span class="ends small muted"><span>normale</span><span>ampia</span></span>
                </label>
                <p class="sample">Giovedì alle 21:00 al Centro Sportivo Aurora: rispondi entro mercoledì.</p>
                @if (theme.textScale() !== 100 || theme.textSpacing() !== 0) {
                  <button type="button" class="btn ghost small" (click)="theme.setText(100, 0)">Ripristina</button>
                }
              </div>
            </section>
          }
          @case ('sicurezza') {
      <section class="section">
        <header><h2>Sicurezza</h2></header>
        <a class="btn" routerLink="/nuova-password">Cambia password</a>
      </section>
      <button class="btn danger" (click)="logout()">Esci dall'account</button>
          }
        }
      </div>
    </div>
    </main>
  `,
  styles: `
    :host { display: flex; flex-direction: column; flex: 1 1 0; min-height: 0; }
    .me { display: flex; align-items: center; gap: 16px; }
    /* schede del profilo: icona sopra, nome sotto */
    .themes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .theme { appearance: none; text-align: left; cursor: pointer; display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: var(--r-m);
             border: 1.5px solid var(--line); background: var(--surface); color: var(--ink); min-height: 44px; }
    .theme.on { border-color: var(--turf); box-shadow: 0 0 0 2px var(--turf); }
    .theme.custom { width: 100%; }
    .text-ed { gap: 14px; }
    .rng { display: flex; flex-direction: column; gap: 6px; }
    .rl { display: flex; align-items: center; gap: 8px; font-weight: 600; }
    .rng input[type='range'] { width: 100%; min-height: 44px; accent-color: var(--turf); }
    .ends { display: flex; justify-content: space-between; margin-top: -6px; } .ends .big { font-size: 1.3rem; }
    .sample { margin: 0; padding: 10px 12px; border-radius: var(--r-m); background: var(--surface-2); }
    .custom-ed { gap: 16px; }
    .lab { font: 700 var(--step--1)/1.2 var(--font-body); }
    .seg2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; border-radius: var(--r-m); background: var(--surface-2); }
    .seg2 button { appearance: none; border: 0; min-height: 44px; border-radius: calc(var(--r-m) - 4px); background: transparent; color: var(--muted);
                   font: 700 var(--step--1)/1 var(--font-body); display: inline-flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; }
    .seg2 button[aria-checked='true'] { background: var(--surface); color: var(--ink); box-shadow: 0 1px 3px rgb(0 0 0 / 14%); }
    .sw { display: flex; flex-wrap: wrap; gap: 10px; }
    .dot { width: 44px; height: 44px; border-radius: 50%; border: 0; cursor: pointer; display: grid; place-items: center; color: #fff;
           box-shadow: inset 0 0 0 1px rgb(0 0 0 / 15%); }
    .dot[aria-checked='true'], .dot.on { box-shadow: 0 0 0 3px var(--surface), 0 0 0 5px var(--ink); }
    .dot.other { background: conic-gradient(#e53935, #fbc02d, #43a047, #1e88e5, #8e24aa, #e53935); position: relative; }
    .auto { appearance: none; min-height: 44px; padding: 0 14px; border-radius: 22px; border: 1.5px solid var(--line); background: var(--surface); color: var(--ink);
            font: 700 var(--step--1)/1 var(--font-body); display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
    .auto[aria-checked='true'] { border-color: var(--turf); box-shadow: 0 0 0 2px var(--turf); }
    .checks { display: flex; flex-wrap: wrap; gap: 6px; }
    .chk { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 99px; font: 700 0.75rem/1.2 var(--font-body);
           background: var(--turf-soft); color: var(--ink); }
    .chk.aaa { box-shadow: inset 0 0 0 1.5px var(--turf); }
    .prev { display: grid; grid-template-rows: 18px 1fr; height: 58px; border-radius: 8px; overflow: hidden; border: 1px solid rgb(0 0 0 / 12%); }
    .ph { display: block; }
    .pr { display: flex; gap: 5px; align-items: center; padding: 6px; }
    .pr i { display: block; width: 24px; height: 11px; border-radius: 4px; } .pr i.grow { flex: 1; }
    .tn { display: flex; align-items: center; gap: 6px; } .tn .ok { margin-left: auto; color: var(--turf); }
    .lead-area { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 10px 14px; border-radius: var(--r-m); text-decoration: none; color: var(--ink);
                 background: var(--surface); box-shadow: 0 0 0 1px var(--line); }
    .lead-area > app-icon:first-child { color: var(--turf); }
    .lead-area .grow { display: flex; flex-direction: column; gap: 2px; }
    .ptabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; padding: 3px; border-radius: 14px; background: var(--surface-2); }
    .ptabs button {
      appearance: none; border: 0; background: transparent; color: var(--muted); cursor: pointer; border-radius: 12px;
      min-height: 44px; padding: 0 6px; display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 6px;
      font: 600 0.8rem/1 var(--font-body); transition: background 160ms, color 160ms;
    }
    .ptabs button[aria-selected='true'] { background: var(--surface); color: var(--turf); box-shadow: 0 1px 3px rgb(20 32 25 / 14%); }
    .ppanel { display: flex; flex-direction: column; gap: var(--space-l, 24px); }
    .preview { width: 96px; height: 96px; border-radius: 50%; object-fit: cover; flex: none; box-shadow: 0 0 0 2px var(--line); }
    label.btn { position: relative; }
    label.btn:focus-within { outline: 3px solid var(--focus); outline-offset: 2px; }
    .opt { display: flex; align-items: flex-end; gap: 12px; }
    .toggle:disabled { opacity: 0.6; cursor: not-allowed; }
    .opt .field { min-width: 0; }
    .opt .input { min-width: 0; }
    /* su iPhone il campo data ha una larghezza propria: lo si accorcia e lo si lascia restringere */
    .opt input[type='date'] { -webkit-appearance: none; appearance: none; display: block; max-width: 190px; }
    .toggles { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .toggles li { padding: 10px 0; border-top: 1px solid var(--line); }
    .toggles li:first-child { border-top: 0; padding-top: 0; }
    .toggles .switch { align-items: center; gap: 12px; }
    /* alto quanto il campo (48 px): l'interruttore resta centrato sul campo */
    .vis { flex: none; height: 48px; display: grid; place-items: center; cursor: pointer; }
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
  private readonly confirmBox = inject(Confirm);
  protected readonly session = inject(Session);
  protected readonly push = inject(Push);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);

  protected readonly roleLabel = ROLE_LABEL;
  protected readonly theme = inject(Theme);
  protected readonly themeOptions: { id: ThemeChoice; label: string; icon: string; desc: string; bg: string; hero: string; primary: string; accent: string; soft: string }[] = [
    { id: 'auto', label: 'Automatico', icon: 'sun', desc: 'Gesso di giorno, Notturno con il telefono scuro', bg: 'linear-gradient(90deg, #F3F5F0 50%, #0A120E 50%)', hero: 'linear-gradient(90deg, #1F7A4D 50%, #0F1A14 50%)', primary: '#1B6A43', accent: '#8BE26A', soft: '#9AA59D' },
    { id: 'gesso', label: 'Gesso', icon: 'sun', desc: 'Chiaro, verde campo', bg: '#F3F5F0', hero: '#1F7A4D', primary: '#1B6A43', accent: '#F2B705', soft: '#E6ECE4' },
    { id: 'notturno', label: 'Notturno', icon: 'moon', desc: 'Scuro, luci dello stadio', bg: '#0A120E', hero: '#0F1A14', primary: '#8BE26A', accent: '#FFB547', soft: '#1B2721' },
    { id: 'figurina', label: 'Figurina', icon: 'star', desc: "Album degli anni '90", bg: '#F5ECD7', hero: '#C81E36', primary: '#C81E36', accent: '#E9B44C', soft: '#EBDFC2' },
    { id: 'azzurro', label: 'Azzurro', icon: 'shirt', desc: 'Blu Nazionale e oro', bg: '#F2F5FA', hero: '#0D5BBF', primary: '#0B4EA2', accent: '#C9A227', soft: '#E3EAF5' },
    { id: 'tramonto', label: 'Tramonto', icon: 'sun', desc: 'Scuro e caldo, corallo e oro', bg: '#170F14', hero: '#3A1A24', primary: '#FF8A5B', accent: '#FFD166', soft: '#2D1E27' },
    { id: 'contrasto', label: 'Alto contrasto', icon: 'eye', desc: 'Massima leggibilità (AAA)', bg: '#FFFFFF', hero: '#000000', primary: '#003D24', accent: '#FFD400', soft: '#F0F0F0' },
  ];
  // ------------------------------------------------ tema personalizzato
  protected readonly palette = PALETTE;
  protected readonly customCard = computed(() => {
    const v = this.theme.derived().vars;
    return { bg: v['--bg'], hero: v['--hero-bg'], primary: v['--turf'], accent: v['--armband'], soft: v['--surface-2'] };
  });
  protected pickPrimary(hex: string): void { this.theme.setCustom({ primary: hex.toUpperCase() }); }
  protected pickAccent(hex: string | 'auto'): void { this.theme.setCustom({ accent: hex === 'auto' ? 'auto' : hex.toUpperCase() }); }
  protected fmtRatio(r: number): string { return r.toFixed(1).replace('.', ','); }
  protected spacingLabel(): string {
    return ['normale', 'un po\' più ampia', 'ampia', 'molto ampia', 'massima'][Math.round(this.theme.textSpacing() / 25)] ?? 'normale';
  }
  protected isPal(hex: string): boolean { return PALETTE.some((p) => p.hex === hex); }

  protected readonly tabs: { id: ProfileTab; label: string; icon: string }[] = [
    { id: 'dati', label: 'Dati', icon: 'user' },
    { id: 'stats', label: 'Stats', icon: 'stats' },
    { id: 'foto', label: 'Foto', icon: 'camera' },
    { id: 'notifiche', label: 'Notifiche', icon: 'bell' },
    { id: 'aspetto', label: 'Aspetto', icon: 'palette' },
    { id: 'sicurezza', label: 'Sicurezza', icon: 'key' },
  ];
  protected readonly tab = signal<ProfileTab>(
    ((): ProfileTab => {
      const q = inject(ActivatedRoute).snapshot.queryParamMap.get('scheda') as ProfileTab | null;
      // le schede valide sono quelle dell'elenco (anche quelle aggiunte in futuro)
      return q && ['dati', 'stats', 'foto', 'notifiche', 'aspetto', 'sicurezza'].includes(q) ? q : 'dati';
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
    first_name: true, last_name: true, nickname: true, field_role: true, birth_date: false, weight_kg: false, height_cm: false, avatar: true,
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

  // ------------------------------------------------ nome nascosto => soprannome
  private readonly nickDlg = viewChild<ElementRef<HTMLDialogElement>>('nickDlg');
  protected nickDraft = '';

  /** spegnere il nome apre la finestra del soprannome; riaccenderlo basta */
  protected toggleName(e: Event): void {
    const box = e.target as HTMLInputElement;
    if (box.checked) {
      this.visibility.update((v) => ({ ...v, first_name: true }));
      return;
    }
    box.checked = true;   // resta acceso finché non si conferma il soprannome
    this.nickDraft = this.form.nickname;
    const d = this.nickDlg()?.nativeElement;
    if (d && !d.open) d.showModal();
  }

  protected closeNick(): void {
    this.nickDlg()?.nativeElement.close();
  }

  protected nickBackdrop(e: MouseEvent): void {
    if (e.target === this.nickDlg()?.nativeElement) this.closeNick();
  }

  protected async confirmNick(): Promise<void> {
    const nick = this.nickDraft.trim();
    if (!nick) return;
    this.form.nickname = nick;
    this.visibility.update((v) => ({ ...v, first_name: false, nickname: true }));
    this.closeNick();
    await this.save();
  }

  protected toggleVis(k: VisibilityKey): void {
    this.visibility.update((v) => ({ ...v, [k]: !v[k] }));
  }

  protected async save(): Promise<void> {
    if (!this.form.first_name.trim()) {
      this.toasts.error('Il nome è obbligatorio.');
      return;
    }
    if (this.visibility().first_name === false && !this.form.nickname.trim()) {
      this.toasts.error('Hai nascosto il nome: serve un soprannome.');
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
    if (!uid || !path || !(await this.confirmBox.ask({ title: 'Rimuovere la foto profilo?', ok: 'Rimuovi', danger: true }))) return;
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
    { key: 'achievements', label: 'Obiettivi sbloccati', hint: 'Quando qualcuno vince uno sticker' },
  ];

  /** scelte appena toccate, in attesa del server (risposta immediata) */
  private readonly prefsDraft = signal<Partial<Record<NotifyCategory, boolean>>>({});
  private prefsQueue: Promise<void> = Promise.resolve();

  /** voce mancante = accesa, tranne la chat (spenta finché non la accendi) */
  protected wants(key: NotifyCategory): boolean {
    return this.prefsDraft()[key] ?? this.session.profile()?.notify_prefs?.[key] ?? key !== 'chat';
  }

  /** l'interruttore cambia subito; i salvataggi partono in fila e un errore riporta la voce com'era */
  protected togglePref(key: NotifyCategory): void {
    const uid = this.session.uid();
    if (!uid) return;
    const value = !this.wants(key);
    this.prefsDraft.update((d) => ({ ...d, [key]: value }));
    this.prefsQueue = this.prefsQueue.then(async () => {
      const next = { ...(this.session.profile()?.notify_prefs ?? {}), [key]: value };
      try {
        await this.api.updateProfile(uid, { notify_prefs: next });
        await this.session.refresh();
      } catch (e) {
        this.toasts.error(errorMessage(e));
      } finally {
        // tolta solo se nel frattempo non è stata toccata di nuovo
        this.prefsDraft.update((d) => { if (d[key] !== value) return d; const { [key]: _, ...rest } = d; return rest; });
      }
    });
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
