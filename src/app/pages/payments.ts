import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Api } from '../core/api';
import { Confirm } from '../core/confirm';
import { fmtDate, fmtDayShort } from '../core/format';
import { Match } from '../core/models';
import { eur, fieldChoices, ibanGroups, parseEuro, PayExpense, PayMethod, PayMethods, Payments, paypalLink, PaySettlement, PayTransfer } from '../core/payments';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { Avatar } from '../ui/avatar';
import { Icon } from '../ui/icon';
import { FitText } from '../ui/fit-text';
import { InfoTip } from '../ui/info-tip';
import { Reprimand } from '../ui/reprimand';
import { Sheet } from '../ui/sheet';
import { Skeleton } from '../ui/skeleton';

const METHOD_LABEL: Record<PayMethod, string> = { paypal: 'PayPal', iban: 'Bonifico', cash: 'Contanti' };

/** simbolo del metodo: per PayPal il suo marchio (file fornito dal proprietario, su un tondino chiaro perché si legga in ogni tema), per gli altri un'icona */
@Component({
  selector: 'app-pay-mark',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (method() === 'paypal') {
      <span class="tile" [style.width.px]="size() + 8" [style.height.px]="size() + 8"><img src="/pay/paypal.png" alt="" [width]="size()" [height]="size()" /></span>
    } @else {
      <app-icon [name]="method() === 'iban' ? 'bank' : 'cash'" [size]="size()" />
    }
  `,
  styles: `
    :host { display: inline-grid; place-items: center; }
    .tile { display: grid; place-items: center; border-radius: 50%; background: #fff; box-shadow: 0 0 0 1px rgb(0 0 0 / 8%); }
    img { display: block; object-fit: contain; }
  `,
})
export class PayMark {
  readonly method = input.required<PayMethod>();
  readonly size = input(20);
}
type Fold = 'tutti' | 'spese' | 'storico' | 'visibilita';

/**
 * Pagamenti: conti tipo Splitwise. In alto il proprio saldo, poi le conferme da dare, i debiti da saldare
 * (con «Salda»: PayPal.me con l'importo, IBAN da copiare o contanti) e i crediti; sotto, in tendine,
 * tutti i conti (Leader), le spese, lo storico, i propri dati di pagamento e chi vede la sezione (Leader).
 */
@Component({
  selector: 'app-payments-page',
  imports: [FormsModule, Avatar, FitText, Icon, InfoTip, PayMark, Sheet, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page stack-l pay-page">
      <header class="titlebar">
        <h1 appFitText>Pagamenti</h1>
        <app-info-tip label="Come funziona" [lines]="[
          'Chi paga una spesa la inserisce e sceglie tra chi dividerla.',
          'I conti si semplificano: ognuno fa meno passaggi possibili.',
          'Salda apre PayPal con l’importo o mostra l’IBAN: i soldi non passano dall’app.',
          'Il debito si chiude quando chi riceve conferma.']" />
        <button type="button" class="btn small push data-btn" (click)="openMethods()">
          <app-icon name="wallet" [size]="18" /> Dati di pagamento
          @if (pay.data() && !hasMyMethods()) { <span class="dot" aria-hidden="true"></span><span class="sr-only">(da aggiungere)</span> }
        </button>
      </header>

      @if (!pay.data(); as _) {
        <app-skeleton kind="lines" [rows]="6" />
      } @else {
        @let d = pay.data()!;
        <section class="panel balance" [class.owe]="d.balance_cents < 0" [class.get]="d.balance_cents > 0">
          <span class="small muted">{{ d.balance_cents < 0 ? 'Devi dare' : d.balance_cents > 0 ? 'Devi ricevere' : 'I tuoi conti' }}</span>
          <b class="num">{{ d.balance_cents === 0 ? 'Sei in pari' : eur(abs(d.balance_cents)) }}</b>
        </section>

        @if (toConfirm().length) {
          <section class="section">
            <header><h2>Da confermare</h2></header>
            <ul class="list panel flush">
              @for (s of toConfirm(); track s.id) {
                <li class="list-item confirm">
                  <div class="row"><app-avatar [userId]="s.from_id" [size]="36" />
                    <span class="grow"><b>{{ session.name(s.from_id) }}</b> dice di {{ s.to_id === me() ? 'averti' : 'aver dato a ' + session.name(s.to_id) }}
                      dato <b>{{ eur(s.amount_cents) }}</b> <span class="how sym" role="img" [attr.aria-label]="'con ' + methodLabel(s.method)" [title]="methodLabel(s.method)"><app-pay-mark [method]="s.method" [size]="18" /></span></span></div>
                  <div class="row acts">
                    <button type="button" class="btn danger" [disabled]="busy()" (click)="decide(s, false)"><app-icon name="x" [size]="16" /> Non ricevuto</button>
                    <button type="button" class="btn primary" [disabled]="busy()" (click)="decide(s, true)"><app-icon name="check" [size]="16" /> Ricevuto</button>
                  </div>
                </li>
              }
            </ul>
          </section>
        }

        <div class="cols">
          <section class="panel col" aria-labelledby="h-pay">
            <h2 id="h-pay">Da pagare</h2>
            @for (t of myDebts(); track t.to_id) {
              <div class="debt drow">
                <app-avatar [userId]="t.to_id" [size]="28" />
                <span class="dinfo"><span class="dname">{{ session.name(t.to_id) }}</span><b class="num amt owe">{{ eur(t.amount_cents) }}</b></span>
                @if (waiting(t.to_id)) {
                  <span class="wait" role="img" aria-label="In attesa di conferma" title="In attesa di conferma"><app-icon name="clock" [size]="20" /></span>
                } @else {
                  <button type="button" class="pay-btn" (click)="openPay(t)" [attr.aria-label]="'Salda ' + session.name(t.to_id)" title="Salda"><app-icon name="euro" [size]="22" /></button>
                }
              </div>
              @if (waiting(t.to_id)) { <span class="small muted wait-note">In attesa di conferma</span> }
            } @empty {
              <p class="muted small none">Non devi niente a nessuno.</p>
            }
          </section>
          <section class="panel col" aria-labelledby="h-get">
            <h2 id="h-get">Da ricevere</h2>
            @if (myCredits().length && !hasMyMethods()) {
              <button type="button" class="btn small add-data" (click)="openMethods()"><app-icon name="wallet" [size]="16" /> Aggiungi dati di pagamento</button>
            }
            @for (t of myCredits(); track t.from_id) {
              <div class="debt">
                <div class="who-line"><app-avatar [userId]="t.from_id" [size]="28" /><span class="grow">{{ session.name(t.from_id) }}</span>
                  <button type="button" class="bell" [class.off]="!afterOne()" (click)="remind(t)" [attr.aria-label]="'Manda un promemoria a ' + session.name(t.from_id)" [title]="afterOne() ? 'Manda un promemoria' : 'Promemoria dalle 13'"><app-icon name="bell" [size]="20" /></button></div>
                <div class="amt-line">
                  <b class="num amt get">{{ eur(t.amount_cents) }}</b>
                  <button type="button" class="round-btn" (click)="openReceive(t)" [attr.aria-label]="'Segna che ' + session.name(t.from_id) + ' ti ha pagato'" title="Segna ricevuto"><app-icon name="check" [size]="20" /></button>
                </div>
              </div>
            } @empty {
              <p class="muted small none">Nessuno ti deve niente.</p>
            }
          </section>
        </div>

        <div class="folds">
          @if (d.boss) {
          <details class="panel fold cfold" [open]="folds().has('tutti')" (toggle)="toggled('tutti', $event)">
              <summary><h3>Tutti i conti</h3><app-info-tip label="Cosa vedi qui" [lines]="['I debiti di tutto il gruppo, già semplificati.', 'Puoi segnare un pagamento per conto di qualcuno: vale subito.']" /><app-icon name="chevron" [size]="18" class="chev" /></summary>
              @if (d.transfers.length) {
                <ul class="list">
                  @for (t of d.transfers; track t.from_id + t.to_id) {
                    <li class="list-item tight">
                      <span class="grow">{{ session.name(t.from_id) }} <app-icon name="back" [size]="14" class="to" /> {{ session.name(t.to_id) }}</span>
                      <b class="num">{{ eur(t.amount_cents) }}</b>
                      <button type="button" class="btn small ghost" (click)="openOnBehalf(t)">Segna pagato</button>
                    </li>
                  }
                </ul>
              } @else { <p class="muted small">Tutti in pari.</p> }
            </details>
          }

          <details class="panel fold cfold" [open]="folds().has('spese')" (toggle)="toggled('spese', $event)">
            <summary><h3>Spese</h3><app-icon name="chevron" [size]="18" class="chev" /></summary>
            @if (d.expenses.length) {
              <ul class="list">
                @for (e of d.expenses; track e.id) {
                  <li class="list-item tight exp">
                    <span class="grow">
                      <b>{{ e.title }}</b>
                      <span class="small muted">{{ when(e.created_at) }}, pagata da {{ session.name(e.payer_id) }}, divisa tra {{ e.shares.length }}</span>
                      @if (myShare(e); as q) { <span class="small">La tua quota: {{ eur(q) }}</span> }
                    </span>
                    <b class="num">{{ eur(e.amount_cents) }}</b>
                    @if (canDelete(e)) {
                      <button type="button" class="icon-btn" [attr.aria-label]="'Togli la spesa ' + e.title" (click)="removeExpense(e)"><app-icon name="trash" [size]="18" /></button>
                    }
                  </li>
                }
              </ul>
              <button type="button" class="btn small ghost clear" [disabled]="busy()" (click)="clearExpenses()"><app-icon name="trash" [size]="16" /> Svuota l'elenco</button>
            } @else { <p class="muted small">Nessuna spesa da mostrare.</p> }
          </details>

          @if (d.history.length) {
            <details class="panel fold cfold" [open]="folds().has('storico')" (toggle)="toggled('storico', $event)">
              <summary><h3>Pagamenti fatti</h3><app-icon name="chevron" [size]="18" class="chev" /></summary>
              <ul class="list">
                @for (s of d.history; track s.id) {
                  <li class="list-item tight hist">
                    <span class="grow"><span>{{ session.name(s.from_id) }} <app-icon name="back" [size]="14" class="to" /> {{ session.name(s.to_id) }}</span>
                      <span class="small muted how"><span class="sym" role="img" [attr.aria-label]="methodLabel(s.method)" [title]="methodLabel(s.method)"><app-pay-mark [method]="s.method" [size]="16" /></span> {{ when(s.decided_at ?? s.created_at) }}</span></span>
                    <b class="num" [class.struck]="s.status === 'rejected'">{{ eur(s.amount_cents) }}</b>
                    @if (s.status === 'rejected') { <span class="tag danger">Non ricevuto</span> }
                  </li>
                }
              </ul>
              <button type="button" class="btn small ghost clear" [disabled]="busy()" (click)="clearHistory()"><app-icon name="trash" [size]="16" /> Svuota lo storico</button>
            </details>
          }

          @if (d.boss && d.settings; as st) {
            <details class="panel fold cfold" [open]="folds().has('visibilita')" (toggle)="toggled('visibilita', $event)">
              <summary><h3>Chi vede i Pagamenti</h3><app-info-tip label="Anteprima" [lines]="['Per ora li vedono il Leader e le persone scelte qui.', 'Aprendoli a tutti, ognuno vede solo i propri conti.']" /><app-icon name="chevron" [size]="18" class="chev" /></summary>
              <label class="switch"><span>Aperti a tutti</span><input type="checkbox" role="switch" [checked]="st.public" (change)="setPublic($any($event.target).checked)" /></label>
              @if (!st.public) {
                <div class="row-wrap">
                  @for (m of session.accountMembers(); track m.id) {
                    @if (m.id !== me()) {
                      <button type="button" class="chip" [attr.aria-pressed]="st.preview_users.includes(m.id)" (click)="togglePreview(m.id)">{{ session.name(m.id) }}</button>
                    }
                  }
                </div>
              }
            </details>
          }
        </div>
      }
      <div class="fab-dock">
        <button type="button" class="fab" (click)="openExpense()" aria-label="Aggiungi una spesa" title="Aggiungi una spesa"><app-icon name="plus" [size]="28" /></button>
      </div>
    </div>

    <!-- Salda: come pagare chi deve ricevere -->
    <dialog #payDlg class="sheet" (click)="backdrop($event)" aria-labelledby="pay-h">
      <div class="grab" aria-hidden="true"></div>
      <button type="button" class="x-close" (click)="payDlg.close()" aria-label="Chiudi"><span><app-icon name="x" [size]="16" /></span></button>
      @if (payTo(); as t) {
        @let m = methodsOf(t.to_id);
        @let plain = onBehalf() || receiving();
        @let other = receiving() || onBehalf() ? t.from_id : t.to_id;
        <div class="phead">
          <app-avatar [userId]="other" [size]="40" />
          <span class="pname">
            <h2 id="pay-h">{{ session.name(other) }}</h2>
            <small>{{ onBehalf() ? 'Deve a ' + session.name(t.to_id) : receiving() ? 'Ti deve' : 'Gli devi' }}</small>
          </span>
          @if (editAmount()) {
            <span class="amt-in"><input #amtIn class="input num" inputmode="decimal" [(ngModel)]="fAmount" aria-label="Importo in euro" (blur)="editAmount.set(false)" (keydown.enter)="editAmount.set(false)" /><span class="muted">€</span></span>
          } @else {
            <button type="button" class="amt-ed" (click)="startEdit()" [attr.aria-label]="'Importo ' + amountText() + ', tocca per cambiarlo'">
              <b class="num">{{ amountText() || '0 €' }}</b><app-icon name="pencil" [size]="16" />
            </button>
          }
        </div>
        @if (!plain && !m?.paypal && !m?.iban) {
          <p class="note small">{{ session.name(t.to_id) }} non ha ancora aggiunto i dati di pagamento: {{ askText() }}. Intanto puoi pagare in contanti.</p>
        }
        <ul class="mrows" role="radiogroup" [attr.aria-label]="plain ? 'Come ha pagato' : 'Come paghi'">
          @for (k of rowMethods(); track k) {
            <li [class.on]="method() === k">
              <button type="button" class="mpick" role="radio" [attr.aria-checked]="method() === k" (click)="method.set(k)">
                <span class="rad" aria-hidden="true">@if (method() === k) { <app-icon name="check" [size]="14" /> }</span>
                <span class="mi"><app-pay-mark [method]="k" [size]="k === 'paypal' ? 20 : 22" /></span>
                <span class="mt"><b>{{ methodLabel(k) }}</b>
                  @if (!plain) {
                    <small>{{ k === 'paypal' ? 'Amici e familiari, gratis' : k === 'iban' ? m!.iban!.slice(0, 4) + ' ••••' : 'A mano' }}</small>
                  }
                </span>
              </button>
              @if (!plain && k === 'paypal') {
                <a class="mact" [href]="paypalUrl(m!.paypal!)" target="_blank" rel="noopener" (click)="method.set('paypal')" [attr.aria-label]="'Apri PayPal con ' + amountText()" title="Apri PayPal"><app-icon name="external" [size]="20" /></a>
              }
              @if (!plain && k === 'iban') {
                <button type="button" class="mact" (click)="copyIban(t.to_id); method.set('iban')" aria-label="Copia l'IBAN" title="Copia l'IBAN"><app-icon name="copy" [size]="20" /></button>
              }
            </li>
            @if (!plain && k === 'iban' && method() === 'iban') {
              <li class="sub">
                <button type="button" class="copy-row" (click)="copy(causale(), 'Causale copiata')" aria-label="Copia la causale">
                  <span class="mt"><small>A {{ m!.holder || session.fullName(t.to_id) }}, causale</small><span>{{ causale() }}</span></span><app-icon name="copy" [size]="18" /></button>
              </li>
            }
          }
        </ul>
        <button type="button" class="btn primary block go" [disabled]="busy() || !amountCents()" (click)="confirmPay()">
          <app-icon name="check" [size]="18" />
          {{ onBehalf() ? 'Segna pagato' : receiving() ? 'Ricevuto' : 'Ho pagato' }}
        </button>
        <p class="foot">
          @if (plain) { <app-icon name="check" [size]="14" /> Vale subito, senza conferma }
          @else { <app-icon name="clock" [size]="14" /> Si chiude quando {{ session.name(t.to_id) }} conferma }
        </p>
      }
    </dialog>

    <!-- i miei dati di pagamento -->
    <dialog #methodsDlg class="sheet" (click)="backdrop($event)" aria-labelledby="dati-h">
      <div class="grab" aria-hidden="true"></div>
      <button type="button" class="x-close" (click)="methodsDlg.close()" aria-label="Chiudi"><span><app-icon name="x" [size]="16" /></span></button>
      <div class="dati-head"><h2 id="dati-h" appFitText>I miei dati di pagamento</h2></div>
      <form class="stack" (ngSubmit)="saveMethods()">
        <label class="field"><span>Nome PayPal.me</span>
          <div class="pre"><span class="muted">paypal.me/</span><input class="input" name="pp" [(ngModel)]="fPaypal" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="60" /></div>
        </label>
        <label class="field"><span>IBAN</span>
          <input class="input mono" name="iban" [(ngModel)]="fIban" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="42" placeholder="IT00 X000 0000 0000 0000 0000 000" />
        </label>
        <label class="field"><span>Intestatario del conto</span>
          <input class="input" name="holder" [(ngModel)]="fHolder" maxlength="80" />
        </label>
        <button class="btn primary block" [disabled]="busy()">Salva</button>
      </form>
    </dialog>

    <!-- nuova spesa -->
    <dialog #expDlg class="sheet" (click)="backdrop($event)" aria-labelledby="exp-h">
      <div class="grab" aria-hidden="true"></div>
      <button type="button" class="x-close" (click)="expDlg.close()" aria-label="Chiudi"><span><app-icon name="x" [size]="16" /></span></button>
      <h2 id="exp-h">Nuova spesa</h2>
      <form class="stack" (ngSubmit)="saveExpense()">
        <label class="field"><span>Partita (per il campo)</span>
          <select class="input" name="match" [ngModel]="eMatch()" (ngModelChange)="pickMatch($event)">
            <option [ngValue]="null">Nessuna</option>
            @for (m of pastMatches(); track m.id) {
              <option [ngValue]="m.id" [disabled]="matchLock(m) !== null">{{ day(m.starts_at) }}{{ matchLock(m) ? ' (' + matchLock(m) + ')' : '' }}</option>
            }
          </select>
        </label>
        <label class="field"><span>Cosa</span>
          <input class="input" name="title" [(ngModel)]="eTitle" maxlength="80" placeholder="Campo, pallone, pizza…" />
        </label>
        <div class="two">
          <label class="field"><span>Importo</span>
            <div class="pre amount"><input class="input num" name="amount" inputmode="decimal" [ngModel]="eAmount()" (ngModelChange)="eAmount.set($event)" /><span class="muted">€</span></div>
          </label>
          <label class="field"><span>Ha pagato</span>
            <select class="input" name="payer" [ngModel]="ePayer()" (ngModelChange)="ePayer.set($event)">
              @for (m of payerOptions(); track m.id) { <option [ngValue]="m.id">{{ session.name(m.id) }}</option> }
            </select>
          </label>
        </div>
        <details class="who-fold" [open]="whoOpen()" (toggle)="whoOpen.set($any($event.target).open)">
          <summary>
            <span class="grow"><span class="lbl">Tra chi dividere</span><span class="small muted sum">{{ pickedText() }}</span></span>
            <app-icon name="chevron" [size]="18" class="chev" />
          </summary>
          <ul class="who" role="list">
            <li>
              <label class="who-row all">
                <input type="checkbox" [checked]="allPicked()" [indeterminate]="eUsers().size > 0 && !allPicked()" (change)="toggleAll()" />
                <span class="grow">Tutti</span>
                <span class="small muted">{{ eUsers().size }} su {{ session.activeMembers().length }}</span>
              </label>
            </li>
            @for (m of session.activeMembers(); track m.id) {
              <li>
                <label class="who-row">
                  <input type="checkbox" [checked]="eUsers().has(m.id)" (change)="toggleUser(m.id)" />
                  <app-avatar [userId]="m.id" [size]="32" />
                  <span class="grow">{{ session.name(m.id) }}</span>
                </label>
              </li>
            }
          </ul>
        </details>
        <div class="each" aria-live="polite">
          <span class="each-lbl">A testa</span>
          <b class="num">{{ each()?.main ?? '—' }}</b>
          @if (each()?.note; as note) { <small class="muted">{{ note }}</small> }
        </div>
        <button class="btn primary block" [disabled]="busy() || !canSaveExpense()">Aggiungi la spesa</button>
      </form>
    </dialog>
  `,
  styles: `
    /* la pagina riempie almeno lo schermo: il pulsante tondo sta sempre in basso, anche con poco contenuto */
    :host { display: flex; flex-direction: column; flex: 1 0 auto; }
    .pay-page { flex: 1 0 auto; display: flex; flex-direction: column; width: 100%; box-sizing: border-box; }
    .pay-page > .fab-dock { margin-top: auto; }
    .titlebar { gap: 4px; justify-content: flex-start; flex-wrap: nowrap; }
    .titlebar h1 { flex: 0 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .titlebar app-info-tip { flex: none; }
    .titlebar .push { margin-left: auto; }
    .data-btn { position: relative; gap: 6px; white-space: nowrap; flex: none; min-height: 44px; }
    /* schermi stretti: l'etichetta va su due righe e il titolo resta intero */
    @media (max-width: 380px) { .data-btn { white-space: normal; max-width: 8.5em; line-height: 1.1; text-align: left; } }
    .data-btn .dot { position: absolute; top: -2px; right: -2px; width: 9px; height: 9px; border-radius: 50%; background: var(--danger); box-shadow: 0 0 0 2px var(--bg); }
    .add-data { gap: 6px; white-space: normal; text-align: left; line-height: 1.2; min-height: 44px; }
    /* titolo su una riga */
    .dati-head { display: flex; align-items: center; gap: 2px; padding-right: 48px; min-width: 0; }
    .dati-head h2 { padding-right: 0; flex: 0 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      font-size: var(--step-2); }
    /* pulsante tondo «Aggiungi una spesa»: in fondo alla pagina ma «appiccicato» in basso a destra mentre si scorre */
    .fab-dock { position: sticky; bottom: 16px; display: flex; justify-content: flex-end; pointer-events: none; z-index: 5; }
    .fab { pointer-events: auto; width: 60px; height: 60px; border-radius: 50%; border: 0; cursor: pointer; display: grid; place-items: center;
      background: var(--turf); color: var(--turf-ink); box-shadow: 0 6px 18px rgb(0 0 0 / 28%), 0 0 0 3px var(--bg); }
    .fab:active { filter: brightness(0.92); }
    .fab:focus-visible { outline: 3px solid var(--ink); outline-offset: 3px; }
    .balance { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 18px; }
    .balance b { font-size: calc(var(--step-2) * 1.25); color: var(--ink); }
    .balance.owe b { color: var(--danger); }
    .balance.get b { color: var(--turf); }
    .list.flush { padding: 0; }
    .list-item.confirm { flex-direction: column; align-items: stretch; gap: 10px; }
    .list-item.tight { padding: 10px 14px; gap: 8px; }
    .acts { justify-content: flex-end; flex-wrap: wrap; }
    .how { display: inline-flex; align-items: center; gap: 4px; margin-left: 4px; }
    .small.how { margin-left: 0; }
    /* le due colonne alte uguali; se una è vuota, la scritta sta al centro */
    .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: stretch; }
    .col > .none { margin: auto 0; flex: 1; display: grid; place-items: center; text-align: center; }
    /* riga «Da pagare»: avatar, nome e importo, tasto tondo */
    .debt.drow { flex-direction: row; align-items: center; gap: 8px; min-height: 52px; }
    .dinfo { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .dname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .drow .amt { font-size: var(--step-1); }
    .pay-btn { position: relative; flex: none; width: 40px; height: 40px; border-radius: 50%; border: 0; display: grid; place-items: center; cursor: pointer;
      background: var(--turf); color: var(--turf-ink); }
    .pay-btn::after { content: ''; position: absolute; inset: -2px; }
    .pay-btn:active { filter: brightness(0.92); }
    .pay-btn:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
    .drow .wait { width: 24px; height: 40px; }
    .wait-note { margin-top: -6px; }
    /* foglio «Salda»: intestazione con importo, metodi in elenco */
    .phead { display: flex; align-items: center; gap: 12px; min-height: 48px; padding-right: 48px; }
    .pname { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .pname h2 { padding: 0; font-size: var(--step-1); line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pname small, .mt small { color: var(--muted); font-size: var(--step--1); }
    .amt-ed { flex: none; display: inline-flex; align-items: center; gap: 4px; min-height: 44px; padding: 0 2px; border: 0; background: none; color: var(--ink); cursor: pointer; }
    .amt-ed b { font-size: var(--step-2); line-height: 1; }
    .amt-ed app-icon { color: var(--muted); }
    .amt-in { flex: none; display: inline-flex; align-items: center; gap: 4px; }
    .amt-in .input { width: 4.5em; height: 44px; font-size: var(--step-1); text-align: right; }
    .mrows { list-style: none; margin: 14px 0 0; padding: 0; border-radius: 16px; background: var(--surface-2); overflow: hidden; }
    .mrows > li { display: flex; align-items: center; min-height: 56px; padding-right: 6px; }
    .mrows > li + li { border-top: 1px solid var(--line); }
    .mrows > li.sub { border-top: 0; padding: 0 6px 6px 50px; min-height: 0; }
    .mpick { all: unset; box-sizing: border-box; flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 6px 0 6px 14px; cursor: pointer; }
    .mpick:focus-visible, .mact:focus-visible { outline: 2px solid var(--turf); outline-offset: -2px; border-radius: 12px; }
    .rad { width: 22px; height: 22px; box-sizing: border-box; border-radius: 50%; border: 2px solid var(--muted); flex: none; display: grid; place-items: center; }
    .on .rad { border-color: var(--turf); background: var(--turf); color: var(--turf-ink); }
    .mi { width: 30px; flex: none; display: grid; place-items: center; color: var(--ink); }
    .mt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .mt > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mact { flex: none; width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; color: var(--ink); background: none; border: 0; cursor: pointer; }
    .mact:active { background: var(--surface); }
    .sub .copy-row { width: 100%; padding: 4px 4px 4px 12px; background: var(--surface); }
    .go { margin-top: 14px; gap: 8px; }
    .foot { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 10px 0 0; color: var(--muted); font-size: var(--step--1); text-align: center; }
    .col { display: flex; flex-direction: column; gap: 10px; padding: 12px; min-width: 0; }
    .col h2 { margin: 0; font-size: var(--step-1); }
    .debt { display: flex; flex-direction: column; gap: 6px; padding-top: 10px; border-top: 1px solid var(--line); }
    .who-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .who-line .grow { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .amt { font-size: var(--step-2); line-height: 1.1; }
    .amt.owe { color: var(--danger); }
    .amt.get { color: var(--turf); }
    .amt-line { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-height: 44px; }
    .act { min-height: 44px; padding: 0 14px; }
    .round-btn { flex: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; cursor: pointer;
      border: 1.5px solid var(--turf); background: var(--surface); color: var(--turf); }
    .round-btn:active { background: var(--surface-2); }
    /* promemoria a chi mi deve dei soldi: campanella accanto al nome */
    .bell { appearance: none; border: 0; background: transparent; color: var(--ink); cursor: pointer; flex: none;
      width: 44px; height: 44px; margin: -8px -8px -8px 0; display: grid; place-items: center; border-radius: 50%; }
    .bell.off { color: var(--muted); }
    .bell:active { background: var(--surface-2); }
    .bell:focus-visible { outline: 2px solid var(--turf); outline-offset: -2px; }
    .round-btn:focus-visible { outline: 2px solid var(--turf); outline-offset: 2px; }
    .wait { flex: none; width: 44px; height: 44px; display: grid; place-items: center; color: var(--muted); }
    .none { margin: 0; }
    .clear { margin-top: 10px; gap: 6px; }
    .copy-row { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 10px; min-height: 44px; cursor: pointer; border-radius: 10px; padding: 0 4px; }
    .copy-row:focus-visible { outline: 2px solid var(--turf); outline-offset: 2px; }
    .copy-row:active { background: var(--surface); }
    .sym { display: inline-grid; place-items: center; }
    .exp .grow, .hist .grow { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
    .to { display: inline-block; transform: rotate(180deg); vertical-align: -2px; color: var(--muted); }
    .struck { text-decoration: line-through; color: var(--muted); }
    .folds { display: flex; flex-direction: column; gap: 12px; }
    /* tendine compatte come gli Strumenti del Leader */
    details.cfold { padding: 0 12px; }
    details.cfold > summary { min-height: 52px; justify-content: center; gap: 2px; position: relative; padding: 0 28px; }
    details.cfold > summary > h3 { font-size: calc(var(--step-0) * 1.12); text-align: center; }
    details.cfold > summary .chev { position: absolute; right: 0; top: 50%; margin: -9px 0 0; }
    details.cfold[open] { padding-bottom: 12px; }
    .pre { display: flex; align-items: center; gap: 6px; }
    .pre .input { flex: 1; min-width: 0; }
    .amount .input { font-size: var(--step-1); max-width: 160px; }
    .mono, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.02em; }
    code { font-size: var(--step--1); word-break: break-all; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .who-fold > summary { list-style: none; display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 6px 14px; cursor: pointer;
      border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
    .who-fold > summary::-webkit-details-marker { display: none; }
    .who-fold > summary .grow { display: flex; flex-direction: column; gap: 2px; }
    .who-fold > summary .lbl { font-weight: 600; }
    .who-fold > summary .chev { transition: transform 0.2s; flex: none; }
    .who-fold[open] > summary .chev { transform: rotate(90deg); }
    .who-fold[open] > summary { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
    .who-fold[open] .who { border-top: 0; border-top-left-radius: 0; border-top-right-radius: 0; }
    .who-fold .who { max-height: 320px; overflow-y: auto; }
    .who { list-style: none; margin: 0; padding: 0 12px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
    .who li + li { border-top: 1px solid var(--line); }
    .who-row { display: flex; align-items: center; gap: 12px; min-height: 52px; cursor: pointer; }
    .who-row input { width: 22px; height: 22px; accent-color: var(--turf); flex: none; margin: 0; }
    .who-row.all { font-weight: 700; }
    .each { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 2px; padding: 12px 16px; border-radius: 14px; background: var(--surface-2); }
    .each-lbl { font-weight: 600; }
    .each small { font-size: var(--step--1); }
    /* tutti i campi del modulo alti come la tendina «Ha pagato» */
    form .input { height: 48px; box-sizing: border-box; }
    /* apertura della tendina dei giocatori: scende con l'altezza dove si può, altrimenti compare con una dissolvenza */
    @media (prefers-reduced-motion: no-preference) {
      @supports (interpolate-size: allow-keywords) {
        .who-fold { interpolate-size: allow-keywords; }
        .who-fold::details-content { block-size: 0; overflow: clip; transition: block-size 260ms var(--ease-out, ease-out), content-visibility 260ms allow-discrete; }
        .who-fold[open]::details-content { block-size: auto; }
      }
      .who-fold[open] .who { animation: who-in 260ms var(--ease-out, ease-out); }
      @keyframes who-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
    }
    .each b { font-size: calc(var(--step-2) * 1.2); color: var(--ink); line-height: 1.1; }
    dialog.sheet h2 { margin: 0; padding-right: 40px; }
  `,
})
export class PaymentsPage implements OnInit {
  protected readonly pay = inject(Payments);
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly reprimand = inject(Reprimand);
  private readonly confirm = inject(Confirm);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly eur = eur;
  protected readonly ibanGroups = ibanGroups;
  protected readonly abs = Math.abs;
  protected readonly methods: PayMethod[] = ['paypal', 'iban', 'cash'];
  protected readonly busy = signal(false);
  protected readonly me = computed(() => this.session.uid());

  // tendine aperte nell'indirizzo («Indietro» le ritrova)
  protected readonly folds = signal(new Set<Fold>((this.route.snapshot.queryParamMap.get('aperte') ?? '').split(',').filter(Boolean) as Fold[]));

  protected readonly myDebts = computed(() => (this.pay.data()?.transfers ?? []).filter((t) => t.from_id === this.me()));
  protected readonly myCredits = computed(() => (this.pay.data()?.transfers ?? []).filter((t) => t.to_id === this.me()));
  /** conferme da dare: a me, o (per il Leader) a chiunque */
  /** ho messo almeno PayPal o IBAN */
  protected readonly hasMyMethods = computed(() => {
    const d = this.pay.data(), mine = d?.methods.find((m) => m.user_id === d.me);
    return !!(mine?.paypal || mine?.iban);
  });
  private readonly methodsDlg = viewChild<ElementRef<HTMLDialogElement>>('methodsDlg');
  /** richiesta dei dati a chi deve ricevere (aprendo «Salda» verso chi non li ha) */
  protected readonly asked = signal<'none' | 'sent' | 'already'>('none');
  protected readonly toConfirm = computed(() => {
    const d = this.pay.data();
    if (!d) return [];
    return d.pending.filter((s) => s.to_id === this.me() || (d.boss && s.from_id !== this.me()));
  });

  // metodi di pagamento propri (modulo)
  protected fPaypal = '';
  protected fIban = '';
  protected fHolder = '';

  // Salda / Segna ricevuto / Segna pagato
  private readonly payDlg = viewChild<ElementRef<HTMLDialogElement>>('payDlg');
  protected readonly payTo = signal<PayTransfer | null>(null);
  protected readonly onBehalf = signal(false);
  protected readonly receiving = signal(false);
  protected readonly method = signal<PayMethod>('paypal');
  protected fAmount = '';
  protected readonly amountCents = () => parseEuro(this.fAmount);
  protected readonly amountText = () => { const c = this.amountCents(); return c ? eur(c) : ''; };
  /** importo: si mostra come numero, il campo compare solo toccandolo */
  protected readonly editAmount = signal(false);
  private readonly amtIn = viewChild<ElementRef<HTMLInputElement>>('amtIn');
  protected startEdit(): void {
    this.editAmount.set(true);
    setTimeout(() => { const i = this.amtIn()?.nativeElement; i?.focus(); i?.select(); });
  }
  /** metodi in elenco: a chi paga solo quelli che chi riceve ha messo (più i contanti); per conto di altri o da chi riceve, tutti */
  protected rowMethods(): PayMethod[] {
    const t = this.payTo();
    if (!t || this.onBehalf() || this.receiving()) return this.methods;
    const m = this.methodsOf(t.to_id);
    return this.methods.filter((k) => k === 'cash' || (k === 'paypal' && !!m?.paypal) || (k === 'iban' && !!m?.iban));
  }

  // nuova spesa
  private readonly expDlg = viewChild<ElementRef<HTMLDialogElement>>('expDlg');
  protected readonly pastMatches = signal<Match[]>([]);
  protected readonly eMatch = signal<string | null>(null);
  protected eTitle = '';
  protected readonly eAmount = signal('');
  protected readonly ePayer = signal<string>('');
  protected readonly eUsers = signal(new Set<string>());
  protected readonly whoOpen = signal(false);
  /** formazione della partita scelta: finché la scelta è quella, il riassunto dice «Chi ha giocato il giorno …» */
  protected readonly matchLineup = signal<{ ids: Set<string>; day: string; future?: boolean } | null>(null);
  /** chi può aver pagato: con una partita scelta, solo chi era in campo */
  protected readonly payerOptions = computed(() => {
    const ml = this.matchLineup();
    return ml ? this.session.activeMembers().filter((m) => ml.ids.has(m.id)) : this.session.activeMembers();
  });
  /** riassunto chiuso: «10 su 14: Alberto, Checco e altri 8» */
  protected readonly pickedText = computed(() => {
    const ids = this.session.activeMembers().filter((m) => this.eUsers().has(m.id)).map((m) => this.session.name(m.id));
    const n = this.session.activeMembers().length;
    if (!ids.length) return 'Nessuno: tocca per scegliere';
    const ml = this.matchLineup(), picked = this.eUsers();
    if (ml && ml.ids.size === picked.size && [...ml.ids].every((x) => picked.has(x))) return `${ml.future ? 'Chi gioca' : 'Chi ha giocato'} il giorno ${ml.day} (${picked.size})`;
    if (ids.length === n) return `Tutti (${n})`;
    const head = ids.slice(0, 2).join(', ');
    return `${ids.length} su ${n}: ${head}${ids.length > 2 ? ` e altri ${ids.length - 2}` : ''}`;
  });
  protected readonly allPicked = computed(() => { const n = this.session.activeMembers().length; return n > 0 && this.eUsers().size === n; });
  /** quota a testa, arrotondata per eccesso al centesimo: uguale per tutti, chi ha pagato tiene il resto (migrazione 68) */
  protected readonly each = computed(() => {
    const c = parseEuro(this.eAmount()), n = this.eUsers().size;
    if (!c || !n) return null;
    return { main: eur(Math.ceil(c / n)), note: null as string | null };
  });

  async ngOnInit(): Promise<void> {
    try {
      const d = await this.pay.load();
      const mine = d.methods.find((m) => m.user_id === d.me);
      this.fPaypal = mine?.paypal ?? '';
      this.fIban = mine?.iban ? ibanGroups(mine.iban) : '';
      this.fHolder = mine?.holder ?? '';
      // dall'avviso «Aggiungi i dati di pagamento»: si apre subito il foglio
      // da «Dividi il campo» nella partita: spesa già pronta (partita, 30 €, chi ha giocato)
      const fromMatch = this.route.snapshot.queryParamMap.get('spesa');
      if (fromMatch) {
        void this.router.navigate([], { replaceUrl: true, queryParamsHandling: 'merge', queryParams: { spesa: null } });
        await this.openExpense();
        const m = this.pastMatches().find((x) => x.id === fromMatch);
        const lock = m ? this.matchLock(m) : null;
        if (m && !lock) await this.pickMatch(fromMatch);
        else this.toasts.show(lock ? 'Il campo di questa partita è già nei Conti' : 'Sono passati più di 3 giorni: il campo lo può dividere solo il Leader', 'ok', 4500);
      }
      if (this.route.snapshot.queryParamMap.get('dati')) {
        void this.router.navigate([], { replaceUrl: true, queryParamsHandling: 'merge', queryParams: { dati: null } });
        this.openMethods();
      }
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }

  protected askText(): string {
    const a = this.asked();
    return a === 'sent' ? 'gli abbiamo mandato un avviso per chiederglieli' : a === 'already' ? "gliel'abbiamo già chiesto con un avviso" : 'glieli chiediamo con un avviso';
  }

  protected openMethods(): void {
    queueMicrotask(() => { const d = this.methodsDlg()?.nativeElement; if (d && !d.open) d.showModal(); });
  }

  /** tocco sul velo: chiude. Niente espressione che restituisce false nel template: Angular annullerebbe il clic (e l'invio dei moduli) */
  protected backdrop(e: MouseEvent): void {
    const d = e.target as HTMLElement;
    if (d instanceof HTMLDialogElement) d.close();
  }

  protected methodLabel(m: PayMethod): string { return METHOD_LABEL[m]; }
  protected when(iso: string): string { return fmtDate(iso); }
  protected day(iso: string): string { return fmtDayShort(iso); }
  protected methodsOf(uid: string): PayMethods | undefined { return this.pay.data()?.methods.find((m) => m.user_id === uid); }
  protected waiting(to: string): PaySettlement | undefined { return this.pay.data()?.pending.find((s) => s.from_id === this.me() && s.to_id === to); }
  protected myShare(e: PayExpense): number | null { return e.shares.find((s) => s.user_id === this.me())?.amount_cents ?? null; }
  protected canDelete(e: PayExpense): boolean { return !!this.pay.data()?.boss || e.created_by === this.me() || e.payer_id === this.me(); }
  protected paypalUrl(user: string): string { return paypalLink(user, this.amountCents() ?? this.payTo()?.amount_cents ?? 0); }
  protected causale(): string { return `G.d.L. saldo conti ${this.session.name(this.payTo()?.from_id ?? null)}`; }

  protected toggled(f: Fold, e: Event): void {
    const open = (e.target as HTMLDetailsElement).open;
    if (open === this.folds().has(f)) return;
    const next = new Set(this.folds());
    if (open) next.add(f); else next.delete(f);
    this.folds.set(next);
    void this.router.navigate([], { replaceUrl: true, queryParams: { aperte: next.size ? [...next].sort().join(',') : null } });
  }

  // ------------------------------------------------ Salda
  protected openPay(t: PayTransfer): void { this.openSheet(t, false, false); }
  protected openReceive(t: PayTransfer): void { this.openSheet(t, false, true); }
  protected openOnBehalf(t: PayTransfer): void { this.openSheet(t, true, false); }
  private openSheet(t: PayTransfer, behalf: boolean, receiving: boolean): void {
    // niente blocco della punizione: i conti si saldano sempre (migrazione 64)
    this.payTo.set(t);
    this.editAmount.set(false);
    this.onBehalf.set(behalf);
    this.receiving.set(receiving);
    const m = this.methodsOf(t.to_id);
    this.method.set(behalf || receiving ? 'cash' : m?.paypal ? 'paypal' : m?.iban ? 'iban' : 'cash');
    this.fAmount = (t.amount_cents / 100).toFixed(2).replace('.', ',').replace(',00', '');
    queueMicrotask(() => { const d = this.payDlg()?.nativeElement; if (d && !d.open) d.showModal(); });
    // chi deve ricevere non ha dati: glieli chiediamo con un avviso (il server ne manda al massimo uno ogni 12 ore)
    this.asked.set('none');
    if (!behalf && !receiving && !m?.paypal && !m?.iban) {
      this.pay.askMethods(t.to_id).then((sent) => this.asked.set(sent ? 'sent' : 'already')).catch(() => this.asked.set('none'));
    }
  }

  protected async confirmPay(): Promise<void> {
    // niente blocco della punizione: i conti si saldano sempre (migrazione 64)
    const t = this.payTo(), c = this.amountCents();
    if (!t || !c || this.busy()) return;   // due tocchi rapidi: il secondo non parte
    this.busy.set(true);
    try {
      // il Leader per altri, o chi riceve che segna da sé: vale subito
      await this.pay.markPaid(t.to_id, c, this.method(), this.onBehalf() || this.receiving() ? t.from_id : null);
      this.payDlg()?.nativeElement.close();
      this.toasts.show(this.onBehalf() || this.receiving() ? 'Pagamento registrato' : `Fatto: ${this.session.name(t.to_id)} deve confermare`);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** dalle 13 (ora di Roma) si può mandare il promemoria; prima il pulsante resta, ma spiega quando */
  protected afterOne(): boolean {
    return Number(new Intl.DateTimeFormat('it-IT', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Rome' }).format(new Date())) >= 13;
  }

  /** promemoria a chi mi deve dei soldi: una volta al giorno per persona, dalle 13 (migrazione 64) */
  protected async remind(t: PayTransfer): Promise<void> {
    if (this.reprimand.guard()) return;
    const name = this.session.name(t.from_id);
    try {
      const r = await this.pay.remind(t.from_id);
      this.toasts.show(r === 'sent' ? `Promemoria mandato a ${name}` : r === 'already' ? `Hai già mandato un promemoria a ${name} oggi` : 'I promemoria si mandano dalle 13', r === 'sent' ? 'ok' : 'info');
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }

  protected async decide(s: PaySettlement, ok: boolean): Promise<void> {
    // niente blocco della punizione: i conti si saldano sempre (migrazione 64)
    this.busy.set(true);
    try {
      await this.pay.decide(s.id, ok);
      this.toasts.show(ok ? 'Confermato: debito chiuso' : 'Segnato come non ricevuto');
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * L'IBAN degli altri arriva mascherato: quello intero si chiede al server solo per copiarlo (e solo se gli devi dei soldi).
   * Con ClipboardItem la copia parte subito al tocco e il testo arriva dopo (Safari non permette di copiare dopo un'attesa).
   */
  protected async copyIban(to: string): Promise<void> {
    const text = this.pay.revealIban(to);
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })) })]);
      } else {
        await navigator.clipboard.writeText(await text);
      }
      this.toasts.show('IBAN copiato');
    } catch (e) {
      const msg = await text.then(() => '', (err) => errorMessage(err));
      this.toasts.error(msg || 'Non riesco a copiare l\'IBAN');
    }
  }

  protected async copy(text: string, done: string): Promise<void> {
    try { await navigator.clipboard.writeText(text); this.toasts.show(done); } catch { this.toasts.error('Non riesco a copiare: tieni premuto per selezionarlo'); }
  }

  // ------------------------------------------------ spese
  protected async openExpense(): Promise<void> {
    if (this.reprimand.guard()) return;
    this.eMatch.set(null);
    this.eTitle = '';
    this.eAmount.set('');
    this.ePayer.set(this.me() ?? '');
    this.eUsers.set(new Set());
    this.whoOpen.set(false);
    this.matchLineup.set(null);
    queueMicrotask(() => { const d = this.expDlg()?.nativeElement; if (d && !d.open) d.showModal(); });
    if (!this.pastMatches().length) {
      try {
        // stesse partite di «Dividi il campo» nel Risultato (fieldChoices)
        this.pastMatches.set(fieldChoices(await this.api.matches(30), !!this.pay.data()?.boss));
      } catch { /* senza partite si inserisce a mano */ }
    }
    // partite che hanno già il campo nei Conti (si riguarda a ogni apertura: qualcuno può averlo appena diviso)
    this.fieldDone.set(await this.pay.fieldMatches(this.pastMatches().map((m) => m.id)));
  }

  /** partite con il campo già nei Conti (migrazione 68) */
  protected readonly fieldDone = signal(new Set<string>());
  /** perché una partita non si può scegliere: campo già diviso (quelle di più di 3 giorni fa non sono in elenco) */
  protected matchLock(m: Match): string | null {
    return this.fieldDone().has(m.id) ? 'già divisa' : null;
  }

  /** scegliendo una partita: titolo «Campo gg/mm/aa» e divisione tra chi era in formazione */
  protected async pickMatch(id: string | null): Promise<void> {
    this.eMatch.set(id);
    this.matchLineup.set(null);
    if (!id) { if (!this.ePayer()) this.ePayer.set(this.me() ?? ''); return; }
    const m = this.pastMatches().find((x) => x.id === id);
    if (m && (!this.eTitle || this.eTitle.startsWith('Campo'))) this.eTitle = `Campo ${fmtDate(m.starts_at)}`;
    // il campo di solito costa 30 €: si propone, si può cambiare
    if (!parseEuro(this.eAmount())) this.eAmount.set('30');
    try {
      const rows = await this.api.lineup(id);
      if (rows.length) {
        const ids = new Set(rows.map((r) => r.user_id));
        this.eUsers.set(new Set(ids));
        this.matchLineup.set({ ids, day: fmtDate(m?.starts_at ?? ''), future: !!m && Date.parse(m.starts_at) > Date.now() });
        // chi ha pagato il campo è tra chi ha giocato: se non c'era, si propone il primo dell'elenco
        if (!ids.has(this.ePayer())) this.ePayer.set(this.payerOptions()[0]?.id ?? this.ePayer());
      }
    } catch { /* si scelgono a mano */ }
  }


  protected toggleUser(id: string): void {
    const s = new Set(this.eUsers());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.eUsers.set(s);
  }
  protected toggleAll(): void {
    const all = this.session.activeMembers();
    this.eUsers.set(this.eUsers().size === all.length ? new Set() : new Set(all.map((m) => m.id)));
  }
  protected canSaveExpense(): boolean {
    return !!this.eTitle.trim() && !!parseEuro(this.eAmount()) && this.eUsers().size > 0 && !!this.ePayer();
  }

  protected async saveExpense(): Promise<void> {
    if (this.reprimand.guard()) return;
    const c = parseEuro(this.eAmount());
    if (!c || !this.canSaveExpense()) return;
    this.busy.set(true);
    try {
      await this.pay.addExpense(this.eTitle.trim(), c, this.ePayer(), [...this.eUsers()], this.eMatch());
      this.expDlg()?.nativeElement.close();
      this.toasts.show('Spesa aggiunta');
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async removeExpense(e: PayExpense): Promise<void> {
    if (this.reprimand.guard()) return;
    if (!(await this.confirm.ask({ title: `Togliere «${e.title}» (${eur(e.amount_cents)})? I conti si ricalcolano e chi è coinvolto riceve un avviso.`, ok: 'Togli', danger: true }))) return;
    this.busy.set(true);
    try {
      await this.pay.deleteExpense(e.id);
      this.toasts.show('Spesa tolta');
    } catch (err) {
      this.toasts.error(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async clearExpenses(): Promise<void> {
    if (this.reprimand.guard()) return;
    if (!(await this.confirm.ask({ title: "Svuotare l'elenco delle spese? Spariscono solo dalla tua vista: i conti non cambiano.", ok: 'Svuota' }))) return;
    this.busy.set(true);
    try {
      await this.pay.clearExpenses();
      this.toasts.show('Elenco delle spese svuotato');
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async clearHistory(): Promise<void> {
    if (this.reprimand.guard()) return;
    if (!(await this.confirm.ask({ title: 'Svuotare lo storico dei pagamenti? Sparisce solo dalla tua vista: i conti non cambiano.', ok: 'Svuota' }))) return;
    this.busy.set(true);
    try {
      await this.pay.clearHistory();
      this.toasts.show('Storico svuotato');
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  // ------------------------------------------------ dati propri e visibilità
  protected async saveMethods(): Promise<void> {
    // niente blocco della punizione: i conti si saldano sempre (migrazione 64)
    this.busy.set(true);
    try {
      await this.pay.saveMethods(this.fPaypal, this.fIban, this.fHolder);
      const mine = this.methodsOf(this.me() ?? '');
      this.fPaypal = mine?.paypal ?? '';
      this.fIban = mine?.iban ? ibanGroups(mine.iban) : '';
      this.methodsDlg()?.nativeElement.close();
      this.toasts.show('Dati di pagamento salvati');
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async setPublic(v: boolean): Promise<void> {
    const st = this.pay.data()?.settings;
    if (!st) return;
    try { await this.pay.setVisibility(v, st.preview_users); } catch (e) { this.toasts.error(errorMessage(e)); }
  }
  protected async togglePreview(id: string): Promise<void> {
    const st = this.pay.data()?.settings;
    if (!st) return;
    const users = st.preview_users.includes(id) ? st.preview_users.filter((u) => u !== id) : [...st.preview_users, id];
    try { await this.pay.setVisibility(st.public, users); } catch (e) { this.toasts.error(errorMessage(e)); }
  }
}
