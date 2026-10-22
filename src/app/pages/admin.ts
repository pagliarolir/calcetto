import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Branding, IconMode } from '../core/branding';
import { logoColor, toIconPng } from '../core/image';
import { Api } from '../core/api';
import { fmtAgo, fmtWhen, fromLocalInput } from '../core/format';
import { AppSettings, Member, Role, ROLE_LABEL, FIELD_ROLE_LABEL } from '../core/models';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { Icon } from '../ui/icon';
import { Avatar } from '../ui/avatar';
import { scrollAppTo } from '../core/scroller';

@Component({
  selector: 'app-admin',
  imports: [FormsModule, Icon, Avatar, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page stack-l">
      <header class="stack">
        <h1>Gestione</h1>
        <p class="muted">{{ leadershipText() }}</p>
      </header>

      @if (temp(); as t) {
        <section class="panel stack temp enter-drop" role="alertdialog" aria-labelledby="temp-h">
          <h2 id="temp-h">Password temporanea per {{ t.name }}</h2>
          <p class="pw" aria-label="Password temporanea">{{ t.password }}</p>
          <p class="small">Mandagliela in privato. Al primo accesso dovrà sceglierne una sua. Chiuso questo riquadro non potrai più rivederla.</p>
          <div class="row-wrap">
            <button class="btn small primary" (click)="copy(t.password)">Copia</button>
            @if (canShare) { <button class="btn small" (click)="share(t.name, t.password)">Condividi</button> }
            <button class="btn small ghost" (click)="temp.set(null)">Fatto</button>
          </div>
        </section>
      }

      @if (inviteLink(); as il) {
        <section class="panel stack temp enter-drop" role="dialog" aria-labelledby="inv-h">
          <h2 id="inv-h">Invito per {{ il.name }}</h2>
          <p class="small">Mandagli questo link: creando l'account (o entrando con quello che ha già) si ritrova il profilo con presenze, gol e voti. Vale fino a {{ when(il.expires) }} e una sola volta.</p>
          <input class="input" readonly [value]="il.url" aria-label="Link d'invito" (focus)="selectAll($event)" />
          <div class="row-wrap">
            <button class="btn small primary" (click)="copyInvite(il.url)">Copia il link</button>
            @if (canShare) { <button class="btn small" (click)="shareInvite(il.name, il.url)">Condividi</button> }
            <button class="btn small ghost" (click)="inviteLink.set(null)">Chiudi</button>
          </div>
        </section>
      }

      @if (editingGuest(); as gid) {
        <section class="panel stack enter-drop" role="dialog" aria-labelledby="eg-h">
          <h2 id="eg-h">Modifica {{ session.fullName(gid) }}</h2>
          <div class="pair">
            <label class="field"><span>Nome</span><input class="input" [(ngModel)]="gFirst" maxlength="40" /></label>
            <label class="field"><span>Cognome</span><input class="input" [(ngModel)]="gLast" maxlength="40" /></label>
          </div>
          <div class="pair">
            <label class="field"><span>Soprannome</span><input class="input" [(ngModel)]="gNick" maxlength="30" /></label>
            <label class="field"><span>Ruolo in campo</span>
              <select class="input" [(ngModel)]="gRole">
                <option value="">—</option>
                @for (r of fieldRoles; track r.key) { <option [value]="r.key">{{ r.label }}</option> }
              </select>
            </label>
          </div>
          <div class="row-wrap">
            <button class="btn small primary" [disabled]="busy() || !gFirst.trim()" (click)="saveGuest(gid)">Salva</button>
            <button class="btn small ghost" (click)="closeGuestEdit()">Annulla</button>
          </div>
        </section>
      }

      @if (punishing(); as target) {
        <section class="panel stack punish enter-drop" role="dialog" aria-labelledby="pun-h">
          <h2 id="pun-h">Metti in punizione {{ session.fullName(target) }}</h2>
          <p class="small muted">Potrà entrare e consultare tutto, statistiche comprese, ma non prenotarsi, scrivere in chat, votare né inserire risultati. Riceverà un avviso.</p>
          <div class="row-wrap" role="group" aria-label="Durata">
            @for (d of durations; track d.id) {
              <button class="chip" [attr.aria-pressed]="punishFor() === d.id" (click)="punishFor.set(d.id)">{{ d.label }}</button>
            }
          </div>
          @if (punishFor() === 'custom') {
            <label class="field"><span>Fino a</span><input class="input" type="datetime-local" [(ngModel)]="punishUntil" /></label>
          }
          <label class="field"><span>Motivo (facoltativo: lo vedrà)</span>
            <input class="input" [(ngModel)]="punishReason" maxlength="200" placeholder="Es. ritardi continui" />
          </label>
          <div class="row-wrap">
            <button class="btn small danger" [disabled]="busy()" (click)="confirmPunish(target)">Metti in punizione</button>
            <button class="btn small ghost" (click)="punishing.set(null)">Annulla</button>
          </div>
        </section>
      }

      @if (pending().length) {
        <section class="section">
          <header><h2>Richieste di accesso</h2></header>
          <ul class="list">
            @for (m of pending(); track m.id) {
              <li class="list-item">
                <span class="grow">{{ m.first_name }} {{ m.last_name }}</span>
                <button class="btn small primary" (click)="approve(m)">Accetta</button>
                <button class="btn small ghost" (click)="remove(m)">Rifiuta</button>
              </li>
            }
          </ul>
        </section>
      }

      @if (punished().length) {
        <section class="section">
          <header><h2>In punizione</h2></header>
          <ul class="list">
            @for (p of punished(); track p.user_id) {
              <li class="list-item">
                <app-avatar [userId]="p.user_id" />
                <span class="grow">
                  <strong>{{ session.fullName(p.user_id) }}</strong><br />
                  <span class="small muted">{{ p.ends_at ? 'fino a ' + when(p.ends_at) : 'fino a nuovo ordine' }}@if (p.reason) {, {{ p.reason }}}</span>
                </span>
                @if (session.isLeader()) {
                  <button class="btn small" [disabled]="busy()" (click)="pardon(p.user_id)">Revoca</button>
                }
              </li>
            }
          </ul>
        </section>
      }

      @if (session.isLeader() && !editingGuest()) {
        <section class="section" aria-labelledby="guest-h">
          <header><h2 id="guest-h">Giocatore senza account</h2></header>
          <div class="panel stack">
            <p class="small muted">Per chi non usa l'app: lo metti tu in lista, entra nelle formazioni, viene votato e resta nelle statistiche. Quando vuole, con <strong>Invita</strong> gli mandi un link per collegare un account.</p>
            <div class="pair">
              <label class="field"><span>Nome</span><input class="input" [(ngModel)]="gFirst" maxlength="40" /></label>
              <label class="field"><span>Cognome</span><input class="input" [(ngModel)]="gLast" maxlength="40" /></label>
            </div>
            <div class="pair">
              <label class="field"><span>Soprannome</span><input class="input" [(ngModel)]="gNick" maxlength="30" /></label>
              <label class="field"><span>Ruolo in campo</span>
                <select class="input" [(ngModel)]="gRole">
                  <option value="">—</option>
                  @for (r of fieldRoles; track r.key) { <option [value]="r.key">{{ r.label }}</option> }
                </select>
              </label>
            </div>
            <button class="btn small primary" [disabled]="busy() || !gFirst.trim()" (click)="addGuest()">Aggiungi il giocatore</button>
          </div>
        </section>
      }

      <section class="section">
        <header><h2>Giocatori</h2><span class="small muted">{{ active().length }}</span></header>
        <ul class="list">
          @for (m of active(); track m.id) {
            <li class="list-item member" [class.stacked]="session.isLeader()">
              <app-avatar [userId]="m.id" />
              <span class="grow">
                <a class="who" [routerLink]="['/giocatore', m.id]"><strong>{{ session.fullName(m.id) }}</strong></a>
                @if (m.role !== 'user') { <span class="tag armband">{{ roleLabel[m.role] }}</span> }
                @if (isPunished(m.id)) { <span class="tag danger">in punizione</span> }
                @if (m.guest) { <span class="tag">senza account</span> }<br />
                @if (m.guest) { <span class="small muted">lo metti in lista tu</span> }
                @else { <span class="small muted">ultimo accesso {{ m.last_seen_at ? ago(m.last_seen_at) : 'mai' }}</span> }
              </span>
              @if (m.guest && session.isLeader()) {
                <div class="tools">
                  <button class="btn small" [disabled]="busy()" (click)="invite(m)" [attr.aria-label]="'Invita ' + m.first_name + ' a collegare un account'">Invita</button>
                  <button class="btn small ghost" (click)="startGuestEdit(m)" [attr.aria-label]="'Modifica ' + m.first_name">Modifica</button>
                  <button class="icon-btn" (click)="removeGuest(m)" [attr.aria-label]="'Elimina ' + m.first_name" title="Elimina">✕</button>
                </div>
              } @else if (!m.guest && ((session.isLeader() && m.role !== 'leader') || canRemove(m))) {
                <div class="tools">
                @if (session.isLeader() && m.role !== 'leader') {
                  <select class="input role" [ngModel]="m.role" (ngModelChange)="setRole(m, $event)" [attr.aria-label]="'Ruolo di ' + m.first_name">
                    <option value="user">Giocatore</option>
                    <option value="premier1">Primo Premier</option>
                    <option value="premier2">Secondo Premier</option>
                  </select>
                }
                @if (session.isLeader() && m.role !== 'leader' && m.id !== session.uid() && !isPunished(m.id)) {
                  <button class="btn small ghost" (click)="startPunish(m)" [attr.aria-label]="'Metti in punizione ' + m.first_name">Punisci</button>
                }
                @if (session.isStaff() && m.avatar_path && m.id !== session.uid()) {
                  <button class="btn small ghost" (click)="removePhoto(m)" [attr.aria-label]="'Togli la foto di ' + m.first_name">Togli foto</button>
                }
                @if (canRemove(m)) {
                  <button class="icon-btn" (click)="resetPassword(m)" [disabled]="busy()" [attr.aria-label]="'Reimposta la password di ' + m.first_name" title="Reimposta password">
                    <app-icon name="key" [size]="20" />
                  </button>
                  <button class="icon-btn" (click)="remove(m)" [attr.aria-label]="'Cancella ' + m.first_name">✕</button>
                }
                </div>
              }
            </li>
          }
        </ul>
        @if (removed().length) {
          <details class="panel">
            <summary>Ex giocatori ({{ removed().length }})</summary>
            <ul class="plain">
              @for (m of removed(); track m.id) {
                <li class="spread"><span>{{ session.fullName(m.id) }}</span><button class="btn small" (click)="approve(m)">Riammetti</button></li>
              }
            </ul>
          </details>
        }
      </section>

      @if (isTitular()) {
        <section class="section">
          <header><h2>Delega i tuoi poteri</h2></header>
          <div class="panel stack">
            @if (session.me()?.delegation; as d) {
              <p>Ora ha i poteri del Leader: <strong>{{ session.name(d.delegate_id) }}</strong>{{ d.until ? ', fino a ' + when(d.until) : ', fino a revoca' }}.</p>
              <button class="btn small" (click)="delegate(null)">Revoca la delega</button>
            } @else {
              <p class="small muted">Per un periodo di assenza: il delegato avrà i tuoi stessi poteri, e tu li conservi.</p>
            }
            <select class="input" [(ngModel)]="delegateId" aria-label="Delegato">
              <option value="">Scegli un giocatore</option>
              @for (m of others(); track m.id) { <option [value]="m.id">{{ session.name(m.id) }}{{ m.role === 'premier1' ? ' (Primo Premier)' : '' }}</option> }
            </select>
            <label class="field"><span>Fino a (vuoto = finché non revochi)</span><input class="input" type="datetime-local" [(ngModel)]="delegateUntil" /></label>
            <button class="btn small primary" [disabled]="!delegateId" (click)="delegate(delegateId)">Delega</button>
          </div>

          <details class="panel">
            <summary>Passa il ruolo di Leader</summary>
            <div class="stack" style="margin-top: 12px">
              <p class="small muted">Diventerai un giocatore normale. Non si torna indietro senza il nuovo Leader.</p>
              <select class="input" [(ngModel)]="newLeader" aria-label="Nuovo Leader">
                <option value="">Scegli il nuovo Leader</option>
                @for (m of others(); track m.id) { <option [value]="m.id">{{ session.name(m.id) }}</option> }
              </select>
              <button class="btn small danger" [disabled]="!newLeader" (click)="transfer()">Passa il ruolo</button>
            </div>
          </details>
        </section>
      }

      @if (session.isLeader() && settings(); as s) {
        <section class="section" aria-labelledby="logo-h">
          <header><h2 id="logo-h">Logo del tabellone</h2></header>
          <div class="panel stack">
            <div class="row">
              <span class="logo-stage" aria-hidden="true">
                @if (branding.headerUrl(); as u) { <img [src]="u" alt="" /> } @else { <span class="none">nessuno</span> }
              </span>
              <p class="small muted grow">Compare a sinistra nel tabellone della partita, al posto del calendario. Resta trasparente: niente sfondo dietro.</p>
            </div>
            <div class="row-wrap">
              <label class="btn small primary file-btn">
                {{ branding.headerId() ? 'Cambia il logo' : 'Carica il logo' }}
                <input type="file" accept="image/*" class="sr-only" [disabled]="logoBusy()" (change)="pickHeader($event)" />
              </label>
              @if (branding.headerId()) { <button class="btn small ghost" [disabled]="logoBusy()" (click)="removeHeader()">Rimuovi</button> }
            </div>
          </div>
        </section>

        <section class="section" aria-labelledby="icon-h">
          <header><h2 id="icon-h">Icona dell'app</h2></header>
          <div class="panel stack">
            <div class="row">
              <span class="icon-prev" aria-hidden="true">
                @if (iconPreview() ?? branding.icon512(); as u) { <img [src]="u" alt="" /> } @else { <span class="none">G.d.L.</span> }
              </span>
              <p class="small muted grow">È l'icona che compare sul telefono quando si aggiunge l'app alla schermata Home. Chi l'ha già aggiunta la vede cambiata togliendo l'app e aggiungendola di nuovo.</p>
            </div>
            @if (iconFile()) {
              <div class="row-wrap" role="group" aria-label="Come adattare l'immagine">
                <button class="chip" [attr.aria-pressed]="iconMode() === 'cover'" (click)="setIconMode('cover')">Riempi il quadrato</button>
                <button class="chip" [attr.aria-pressed]="iconMode() === 'contain'" (click)="setIconMode('contain')">Intera su colore</button>
              </div>
              @if (iconMode() === 'contain') {
                <div class="row-wrap" role="group" aria-label="Colore dello sfondo">
                  @for (c of iconColors(); track c.color) {
                    <button class="swatch" [style.background]="c.color" [attr.aria-pressed]="iconBg() === c.color" [attr.aria-label]="c.label" [title]="c.label" (click)="setIconBg(c.color)"></button>
                  }
                </div>
              }
              <p class="small muted">{{ iconHint() }}</p>
              <div class="row-wrap">
                <button class="btn small primary" [disabled]="logoBusy()" (click)="saveIcon()">Salva l'icona</button>
                <button class="btn small ghost" [disabled]="logoBusy()" (click)="cancelIcon()">Annulla</button>
              </div>
            } @else {
              <div class="row-wrap">
                <label class="btn small primary file-btn">
                  {{ iconButtonText() }}
                  <input type="file" accept="image/*" class="sr-only" [disabled]="logoBusy()" (change)="pickIcon($event)" />
                </label>
                @if (branding.iconId()) { <button class="btn small ghost" [disabled]="logoBusy()" (click)="removeIcon()">Rimuovi</button> }
              </div>
            }
          </div>
        </section>

        <section class="section" aria-labelledby="stats-h">
          <header><h2 id="stats-h">Statistiche</h2></header>
          <div class="panel stack">
            @if (s.stats_since) {
              <p class="small">Classifica azzerata {{ when(s.stats_since) }}: contano solo le partite successive.</p>
              <button class="btn small" [disabled]="busy()" (click)="restoreAll()">Ripristina tutte le statistiche</button>
            } @else {
              <p class="small muted"><strong>Azzera</strong>: la classifica riparte da zero da adesso, per tutti. Le partite giocate restano nello storico e puoi ripristinare in ogni momento.</p>
              <button class="btn small" [disabled]="busy()" (click)="resetAll()">Azzera tutta la classifica</button>
            }
            <p class="small muted">Per un solo giocatore, apri la sua scheda toccando il nome nell'elenco qui sopra.</p>
          </div>
          <div class="panel stack danger-zone">
            <h3>Elimina tutto lo storico</h3>
            <p class="small muted">Cancella definitivamente le partite giocate con risultati, formazioni, marcatori, voti, presenze e chat. Le partite in programma restano. Non si può annullare.</p>
            <label class="field"><span>Per confermare scrivi «elimina»</span>
              <input class="input" [(ngModel)]="deleteAllText" autocomplete="off" autocapitalize="off" />
            </label>
            <button class="btn small danger" [disabled]="busy() || deleteAllText.trim().toLowerCase() !== 'elimina'" (click)="deleteAll()">Elimina tutto lo storico</button>
          </div>
        </section>

        <form class="section" (ngSubmit)="saveSettings()">
          <header><h2>Regole del gruppo</h2></header>
          <div class="panel stack">
            <label class="field"><span>Codice invito (chi si registra senza resta in attesa di approvazione)</span>
              <input class="input" name="invite" [(ngModel)]="s.invite_code" autocomplete="off" /></label>
            <p class="small muted">Giorno, ora, numero di giocatori, colori e orari di prenotazioni e votazioni si impostano in <a routerLink="/partite">Partite</a>, nella configurazione predefinita.</p>
            <div class="row">
              <label class="field grow"><span>Votanti minimi perché la media conti in classifica</span><input class="input" type="number" min="1" max="9" name="vm" [(ngModel)]="s.vote_min_voters" /></label>
            </div>
            <button class="btn primary" type="submit">Salva le regole</button>
          </div>
        </form>
      }
    </main>
  `,
  styles: `
    .member { flex-wrap: wrap; row-gap: 4px; }
    .member.stacked > .grow { flex: 1 1 calc(100% - 48px); }
    .tools { display: flex; align-items: center; gap: 2px; margin-left: auto; }
    .member .role { width: auto; min-height: 36px; padding: 4px 8px; font-size: var(--step--1); }
    summary { cursor: pointer; font-weight: 600; }
    .temp { border: 2px solid var(--armband); }
    .punish { border: 2px solid var(--danger); }
    .danger-zone { border-color: var(--danger); }
    .logo-stage { width: 96px; height: 96px; border-radius: 16px; flex: none; display: grid; place-items: center; padding: 8px; background: var(--turf); }
    .logo-stage img { max-width: 100%; max-height: 100%; object-fit: contain; filter: drop-shadow(0 3px 8px rgb(0 0 0 / 25%)); }
    .icon-prev { width: 72px; height: 72px; border-radius: 18px; flex: none; overflow: hidden; display: grid; place-items: center; box-shadow: 0 0 0 1px var(--line), 0 4px 12px rgb(0 0 0 / 12%); background: var(--surface-2); }
    .icon-prev img { width: 100%; height: 100%; object-fit: cover; }
    .none { font: 700 0.85rem/1 var(--font-display); color: var(--chalk, #fff); opacity: 0.8; }
    .icon-prev .none { color: var(--turf); }
    .swatch { appearance: none; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; border: 2px solid var(--line); padding: 0; }
    .swatch[aria-pressed='true'] { box-shadow: 0 0 0 3px var(--surface), 0 0 0 5px var(--turf); }
    .file-btn { position: relative; }
    .file-btn:focus-within { outline: 3px solid var(--focus); outline-offset: 2px; }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .who { color: inherit; text-decoration: none; }
    .pw { font: 700 var(--step-3)/1.1 ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace; letter-spacing: 0.04em; user-select: all; overflow-wrap: anywhere; }
    .plain { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  `,
})
export class AdminPage implements OnInit {
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);

  protected readonly roleLabel = ROLE_LABEL;
  protected readonly weekdays = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  protected readonly ago = fmtAgo;
  protected readonly when = fmtWhen;
  protected readonly settings = signal<AppSettings | null>(null);
  protected readonly temp = signal<{ name: string; password: string } | null>(null);
  protected readonly punished = signal<{ user_id: string; ends_at: string | null; reason: string | null; since: string }[]>([]);
  protected readonly punishing = signal<string | null>(null);
  protected readonly punishFor = signal('1w');
  protected punishUntil = '';
  protected punishReason = '';
  protected readonly durations = [
    { id: '1d', label: '1 giorno', days: 1 },
    { id: '3d', label: '3 giorni', days: 3 },
    { id: '1w', label: '1 settimana', days: 7 },
    { id: '2w', label: '2 settimane', days: 14 },
    { id: '1m', label: '1 mese', days: 30 },
    { id: 'forever', label: 'Fino a revoca', days: 0 },
    { id: 'custom', label: 'Scegli la data', days: 0 },
  ];
  protected readonly busy = signal(false);
  protected readonly canShare = typeof navigator.share === 'function';
  protected delegateId = '';
  protected delegateUntil = '';
  protected newLeader = '';

  protected readonly pending = computed(() => this.session.members().filter((m) => m.pending));
  protected readonly active = computed(() => this.session.activeMembers());
  protected readonly removed = computed(() => this.session.members().filter((m) => !m.active && !m.pending));
  /** per delega e passaggio di ruolo servono un account */
  protected readonly others = computed(() => this.active().filter((m) => m.id !== this.session.uid() && !m.guest));
  protected readonly fieldRoles = Object.entries(FIELD_ROLE_LABEL).map(([key, label]) => ({ key, label }));
  protected readonly editingGuest = signal<string | null>(null);
  protected readonly inviteLink = signal<{ name: string; url: string; expires: string } | null>(null);
  protected gFirst = '';
  protected gLast = '';
  protected gNick = '';
  protected gRole = '';
  protected readonly isTitular = computed(() => this.session.me()?.titular_leader === this.session.uid());

  protected readonly leadershipText = computed(() => {
    const me = this.session.me();
    if (!me) return '';
    if (me.acting_leader && me.acting_leader !== me.titular_leader) {
      return `Il Leader non si collega da oltre 15 giorni: ora comanda ${this.session.name(me.acting_leader)}.`;
    }
    return `Leader: ${this.session.name(me.titular_leader)}.`;
  });

  async ngOnInit(): Promise<void> {
    await this.session.loadMembers();
    if (this.session.isLeader()) this.settings.set(await this.api.settings());
    await this.loadPunishments();
  }

  private async loadPunishments(): Promise<void> {
    if (this.session.isStaff()) this.punished.set(await this.api.activePunishments().catch(() => []));
  }

  protected isPunished(id: string): boolean {
    return this.punished().some((p) => p.user_id === id);
  }

  protected startPunish(m: Member): void {
    this.punishFor.set('1w');
    this.punishUntil = '';
    this.punishReason = '';
    this.punishing.set(m.id);
    scrollAppTo('start');
  }

  protected async confirmPunish(userId: string): Promise<void> {
    const choice = this.durations.find((d) => d.id === this.punishFor())!;
    let until: string | null = null;
    if (choice.id === 'custom') {
      if (!this.punishUntil) return this.toasts.error('Scegli fino a quando.');
      until = fromLocalInput(this.punishUntil);
    } else if (choice.days) {
      until = new Date(Date.now() + choice.days * 86_400_000).toISOString();
    }
    const name = this.session.name(userId);
    this.busy.set(true);
    try {
      const res = await this.api.punishMember(userId, until, this.punishReason.trim());
      this.punishing.set(null);
      await this.loadPunishments();
      this.toasts.show(`${name} è in punizione ${until ? 'fino a ' + fmtWhen(until) : 'fino a nuovo ordine'}.`);
      if (res.booked_matches > 0) {
        this.toasts.show(
          `${name} è ancora in lista per ${res.booked_matches === 1 ? 'la prossima partita' : res.booked_matches + ' partite'}: se vuoi toglierlo usa «Assente» o «Azzera risposta» nella partita.`,
          'info', 9000);
      }
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  // ------------------------------------------------ giocatori senza account
  private clearGuestForm(): void {
    this.gFirst = this.gLast = this.gNick = this.gRole = '';
  }

  protected async addGuest(): Promise<void> {
    const name = this.gFirst.trim();
    await this.run(() => this.api.createGuest(name, this.gLast.trim(), this.gNick.trim(), this.gRole),
      `${name} aggiunto: mettilo in lista dalla partita, negli Strumenti del Leader.`);
    this.clearGuestForm();
  }

  protected startGuestEdit(m: Member): void {
    this.gFirst = m.first_name;
    this.gLast = m.last_name ?? '';
    this.gNick = m.nickname ?? '';
    this.gRole = m.field_role ?? '';
    this.editingGuest.set(m.id);
    scrollAppTo('start');
  }

  protected closeGuestEdit(): void {
    this.editingGuest.set(null);
    this.clearGuestForm();
  }

  protected async saveGuest(id: string): Promise<void> {
    await this.run(() => this.api.updateGuest(id, this.gFirst.trim(), this.gLast.trim(), this.gNick.trim(), this.gRole), 'Giocatore aggiornato.');
    this.closeGuestEdit();
  }

  protected async removeGuest(m: Member): Promise<void> {
    if (!confirm(`Eliminare ${m.first_name}? Spariscono anche le sue presenze, i gol e i voti ricevuti. Per conservarli, invitalo a collegare un account.`)) return;
    await this.run(() => this.api.deleteGuest(m.id), `${m.first_name} eliminato.`);
  }

  protected async invite(m: Member): Promise<void> {
    try {
      const r = await this.api.createGuestInvite(m.id);
      this.inviteLink.set({ name: m.first_name, url: new URL(`invito/${r.token}`, document.baseURI).href, expires: r.expires_at });
      scrollAppTo('start');
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }

  protected selectAll(e: Event): void {
    (e.target as HTMLInputElement).select();
  }

  protected async copyInvite(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.toasts.show('Link copiato.');
    } catch {
      this.toasts.error('Copia non riuscita: tieni premuto sul link per copiarlo.');
    }
  }

  protected shareInvite(name: string, url: string): void {
    void navigator.share({ title: 'G.d.L.', text: `Ciao ${name}! Collega il tuo profilo del calcetto:`, url }).catch(() => undefined);
  }

  protected readonly branding = inject(Branding);
  protected readonly logoBusy = signal(false);

  // ---------------------------------------------------------------- loghi
  protected readonly iconFile = signal<File | null>(null);
  protected readonly iconButtonText = computed(() => (this.branding.iconId() ? "Cambia l'icona" : "Carica l'icona"));
  protected readonly iconHint = computed(() => this.iconMode() === 'cover'
    ? "L'immagine riempie tutta l'icona: i bordi in eccesso si tagliano."
    : "L'immagine resta intera; le parti trasparenti prendono il colore scelto.");
  protected readonly iconMode = signal<IconMode>('cover');
  protected readonly iconBg = signal('#1F6B45');
  protected readonly iconPreview = signal<string | null>(null);
  protected readonly logoTint = signal<string | null>(null);
  protected readonly iconColors = computed(() => [
    { color: '#1F6B45', label: "Verde dell'app" },
    { color: '#111111', label: 'Nero' },
    ...(this.logoTint() ? [{ color: this.logoTint()!, label: 'Colore del logo' }] : []),
  ]);

  private async run2(fn: () => Promise<void>, ok: string): Promise<void> {
    this.logoBusy.set(true);
    try {
      await fn();
      this.toasts.show(ok);
    } catch (err) {
      this.toasts.error(errorMessage(err));
    } finally {
      this.logoBusy.set(false);
    }
  }

  protected async pickHeader(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.run2(() => this.branding.uploadHeader(file), 'Logo del tabellone aggiornato.');
  }

  protected async removeHeader(): Promise<void> {
    if (confirm('Togliere il logo del tabellone? Torna il calendario.')) await this.run2(() => this.branding.removeHeader(), 'Logo rimosso.');
  }

  protected async pickIcon(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.iconFile.set(file);
    this.iconMode.set('cover');
    this.logoTint.set(await logoColor(file).catch(() => null));
    await this.refreshIconPreview();
  }

  protected async setIconMode(m: IconMode): Promise<void> {
    this.iconMode.set(m);
    await this.refreshIconPreview();
  }

  protected async setIconBg(c: string): Promise<void> {
    this.iconBg.set(c);
    await this.refreshIconPreview();
  }

  private async refreshIconPreview(): Promise<void> {
    const f = this.iconFile();
    if (!f) return;
    const blob = await toIconPng(f, 180, this.iconMode(), this.iconBg());
    const old = this.iconPreview();
    this.iconPreview.set(URL.createObjectURL(blob));
    if (old) URL.revokeObjectURL(old);
  }

  protected cancelIcon(): void {
    const old = this.iconPreview();
    if (old) URL.revokeObjectURL(old);
    this.iconPreview.set(null);
    this.iconFile.set(null);
  }

  protected async saveIcon(): Promise<void> {
    const f = this.iconFile();
    if (!f) return;
    await this.run2(() => this.branding.uploadIcon(f, this.iconMode(), this.iconBg()), "Icona dell'app aggiornata.");
    this.cancelIcon();
  }

  protected async removeIcon(): Promise<void> {
    if (confirm("Togliere l'icona? Torna quella predefinita.")) await this.run2(() => this.branding.removeIcon(), 'Icona rimossa.');
  }

  protected deleteAllText = '';

  protected async resetAll(): Promise<void> {
    if (!confirm('Azzerare la classifica di tutti? Da adesso si riparte da zero; potrai ripristinarla.')) return;
    await this.run(() => this.api.resetStats(null), 'Classifica azzerata.');
    this.settings.set(await this.api.settings());
  }

  protected async restoreAll(): Promise<void> {
    await this.run(() => this.api.restoreStats(null), 'Classifica ripristinata.');
    this.settings.set(await this.api.settings());
  }

  protected async deleteAll(): Promise<void> {
    if (!confirm('Eliminare definitivamente tutto lo storico delle partite giocate? Non si può annullare.')) return;
    await this.run(async () => {
      const n = await this.api.deleteAllStats(this.deleteAllText);
      this.deleteAllText = '';
      this.toasts.show(n === 1 ? 'Eliminata 1 partita dallo storico.' : `Eliminate ${n} partite dallo storico.`, 'info');
    }, 'Storico eliminato: la classifica riparte da zero.');
    this.settings.set(await this.api.settings());
  }

  protected async pardon(userId: string): Promise<void> {
    const name = this.session.name(userId);
    if (!confirm(`Revocare la punizione di ${name}?`)) return;
    await this.run(() => this.api.pardonMember(userId), `Punizione di ${name} revocata.`);
    await this.loadPunishments();
  }

  protected canRemove(m: Member): boolean {
    if (m.role === 'leader' || m.id === this.session.uid()) return false;
    return m.role === 'user' ? this.session.isStaff() : this.session.isLeader();
  }

  protected async setRole(m: Member, role: Exclude<Role, 'leader'>): Promise<void> {
    await this.run(() => this.api.setRole(m.id, role), `${m.first_name}: ${ROLE_LABEL[role]}.`);
  }

  protected async approve(m: Member): Promise<void> {
    await this.run(() => this.api.approve(m.id), `${m.first_name} è nel gruppo.`);
  }

  protected async remove(m: Member): Promise<void> {
    if (!confirm(`Cancellare ${m.first_name} dal gruppo? Le sue statistiche restano nello storico.`)) return;
    await this.run(() => this.api.deactivate(m.id), `${m.first_name} è stato cancellato.`);
  }

  /** Password temporanea per chi l'ha dimenticata (funziona anche senza email). */
  protected async resetPassword(m: Member): Promise<void> {
    if (!confirm(`Reimpostare la password di ${m.first_name}? Riceverà una password temporanea da cambiare al primo accesso, e un avviso.`)) return;
    this.busy.set(true);
    try {
      const password = await this.api.resetMemberPassword(m.id);
      this.temp.set({ name: this.session.fullName(m.id), password });
      scrollAppTo('start');
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async removePhoto(m: Member): Promise<void> {
    if (!confirm(`Togliere la foto profilo di ${m.first_name}? Riceverà un avviso e potrà caricarne un'altra.`)) return;
    await this.run(() => this.api.removeMemberAvatar(m.id), 'Foto rimossa.');
  }

  protected async copy(pw: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(pw);
      this.toasts.show('Copiata.');
    } catch {
      this.toasts.error('Copia non riuscita: selezionala e copiala a mano.');
    }
  }

  protected async share(name: string, pw: string): Promise<void> {
    await navigator.share({
      text: `Ciao ${name.split(' ')[0]}, la tua password temporanea per G.d.L. è ${pw}. Entra con la tua email e questa password: ti chiederà di sceglierne una nuova.`,
    }).catch(() => undefined);
  }

  protected async delegate(id: string | null): Promise<void> {
    const until = id && this.delegateUntil ? fromLocalInput(this.delegateUntil) : null;
    await this.run(() => this.api.delegate(id, until), id ? 'Delega attivata.' : 'Delega revocata.');
    this.delegateId = '';
  }

  protected async transfer(): Promise<void> {
    if (!confirm(`Passare il ruolo di Leader a ${this.session.name(this.newLeader)}?`)) return;
    await this.run(() => this.api.transferLeadership(this.newLeader), 'Hai passato il ruolo di Leader.');
  }

  protected async saveSettings(): Promise<void> {
    const s = this.settings()!;
    await this.run(() => this.api.updateSettings({
      invite_code: s.invite_code?.trim() || null, vote_min_voters: s.vote_min_voters,
    }), 'Regole salvate.');
  }

  private async run(fn: () => Promise<unknown>, ok: string): Promise<void> {
    try {
      await fn();
      await this.session.refresh();
      this.toasts.show(ok);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }
}
