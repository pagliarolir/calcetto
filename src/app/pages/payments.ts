import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Api } from '../core/api';
import { fmtDate, fmtDayShort } from '../core/format';
import { Match } from '../core/models';
import { eur, ibanGroups, parseEuro, PayExpense, PayMethod, PayMethods, Payments, paypalLink, PaySettlement, PayTransfer } from '../core/payments';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { Avatar } from '../ui/avatar';
import { Icon } from '../ui/icon';
import { InfoTip } from '../ui/info-tip';
import { Reprimand } from '../ui/reprimand';
import { Sheet } from '../ui/sheet';
import { Skeleton } from '../ui/skeleton';

const METHOD_LABEL: Record<PayMethod, string> = { paypal: 'PayPal', iban: 'Bonifico', cash: 'Contanti' };
const METHOD_ICON: Record<PayMethod, string> = { paypal: 'send', iban: 'bank', cash: 'cash' };
type Fold = 'tutti' | 'spese' | 'storico' | 'metodi' | 'visibilita';

/**
 * Pagamenti: conti tipo Splitwise. In alto il proprio saldo, poi le conferme da dare, i debiti da saldare
 * (con «Salda»: PayPal.me con l'importo, IBAN da copiare o contanti) e i crediti; sotto, in tendine,
 * tutti i conti (Leader), le spese, lo storico, i propri dati di pagamento e chi vede la sezione (Leader).
 */
@Component({
  selector: 'app-payments-page',
  imports: [FormsModule, Avatar, Icon, InfoTip, Sheet, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page stack-l">
      <header class="titlebar">
        <h1>Pagamenti</h1>
        <app-info-tip label="Come funziona" [lines]="[
          'Chi paga una spesa la inserisce e sceglie tra chi dividerla.',
          'I conti si semplificano: ognuno fa meno passaggi possibili.',
          'Salda apre PayPal con l’importo o mostra l’IBAN: i soldi non passano dall’app.',
          'Il debito si chiude quando chi riceve conferma.']" />
        <button type="button" class="btn small primary push" (click)="openExpense()"><app-icon name="plus" [size]="16" /> Spesa</button>
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
                      dato <b>{{ eur(s.amount_cents) }}</b> <span class="how sym" role="img" [attr.aria-label]="'con ' + methodLabel(s.method)" [title]="methodLabel(s.method)"><app-icon [name]="methodIcon(s.method)" [size]="18" /></span></span></div>
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
              <div class="debt">
                <div class="who-line"><app-avatar [userId]="t.to_id" [size]="28" /><span class="grow">{{ session.name(t.to_id) }}</span></div>
                <div class="amt-line">
                  <b class="num amt owe">{{ eur(t.amount_cents) }}</b>
                  @if (waiting(t.to_id)) {
                    <span class="wait" role="img" aria-label="In attesa di conferma" title="In attesa di conferma"><app-icon name="clock" [size]="20" /></span>
                  } @else {
                    <button type="button" class="btn primary act" (click)="openPay(t)">Salda</button>
                  }
                </div>
                @if (waiting(t.to_id)) { <span class="small muted">In attesa di conferma</span> }
              </div>
            } @empty {
              <p class="muted small none">Non devi niente a nessuno.</p>
            }
          </section>
          <section class="panel col" aria-labelledby="h-get">
            <h2 id="h-get">Da ricevere</h2>
            @for (t of myCredits(); track t.from_id) {
              <div class="debt">
                <div class="who-line"><app-avatar [userId]="t.from_id" [size]="28" /><span class="grow">{{ session.name(t.from_id) }}</span></div>
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
            } @else { <p class="muted small">Ancora nessuna spesa.</p> }
          </details>

          @if (d.history.length) {
            <details class="panel fold cfold" [open]="folds().has('storico')" (toggle)="toggled('storico', $event)">
              <summary><h3>Pagamenti fatti</h3><app-icon name="chevron" [size]="18" class="chev" /></summary>
              <ul class="list">
                @for (s of d.history; track s.id) {
                  <li class="list-item tight hist">
                    <span class="grow"><span>{{ session.name(s.from_id) }} <app-icon name="back" [size]="14" class="to" /> {{ session.name(s.to_id) }}</span>
                      <span class="small muted how"><span class="sym" role="img" [attr.aria-label]="methodLabel(s.method)" [title]="methodLabel(s.method)"><app-icon [name]="methodIcon(s.method)" [size]="16" /></span> {{ when(s.decided_at ?? s.created_at) }}</span></span>
                    <b class="num" [class.struck]="s.status === 'rejected'">{{ eur(s.amount_cents) }}</b>
                    @if (s.status === 'rejected') { <span class="tag danger">Non ricevuto</span> }
                  </li>
                }
              </ul>
              <button type="button" class="btn small ghost clear" [disabled]="busy()" (click)="clearHistory()"><app-icon name="trash" [size]="16" /> Svuota lo storico</button>
            </details>
          }

          <details class="panel fold cfold" [open]="folds().has('metodi')" (toggle)="toggled('metodi', $event)">
            <summary><h3>Come ricevi i soldi</h3><app-info-tip label="Chi li vede" [lines]="['Li vede solo chi ti deve dei soldi, e il Leader.', 'Il nome PayPal.me è quello dopo paypal.me/ nel tuo link.']" /><app-icon name="chevron" [size]="18" class="chev" /></summary>
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
              <button class="btn primary" [disabled]="busy()">Salva</button>
            </form>
          </details>

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
    </div>

    <!-- Salda: come pagare chi deve ricevere -->
    <dialog #payDlg class="sheet" (click)="backdrop($event)" aria-labelledby="pay-h">
      <div class="grab" aria-hidden="true"></div>
      <button type="button" class="x-close" (click)="payDlg.close()" aria-label="Chiudi"><span><app-icon name="x" [size]="16" /></span></button>
      @if (payTo(); as t) {
        @let m = methodsOf(t.to_id);
        <h2 id="pay-h">{{ onBehalf() ? 'Segna un pagamento' : receiving() ? 'Segna che hai ricevuto' : 'Paga ' + session.name(t.to_id) }}</h2>
        @if (onBehalf() || receiving()) {
          <p class="muted small">{{ session.name(t.from_id) }} <app-icon name="back" [size]="12" class="to" /> {{ session.name(t.to_id) }}: vale subito, senza conferma.</p>
        }
        <label class="field"><span>Importo</span>
          <div class="pre amount"><input class="input num" inputmode="decimal" [(ngModel)]="fAmount" aria-label="Importo in euro" /><span class="muted">€</span></div>
        </label>
        @if (!onBehalf() && !receiving()) {
          @if (m?.paypal) {
            <a class="btn block paypal" [href]="paypalUrl(m!.paypal!)" target="_blank" rel="noopener" (click)="method.set('paypal')">
              <app-icon name="send" [size]="16" /> Apri PayPal con {{ amountText() }}
            </a>
            <p class="small muted hint">Scegli «Amici e familiari»: tra amici in Italia è gratis con saldo PayPal o conto collegato.</p>
          }
          @if (m?.iban) {
            <div class="iban panel">
              <span class="small muted how"><app-icon name="bank" [size]="14" /> Bonifico a {{ m!.holder || session.fullName(t.to_id) }}: tocca per copiare</span>
              <button type="button" class="copy-row" (click)="copy(m!.iban!, 'IBAN copiato'); method.set('iban')" aria-label="Copia l'IBAN">
                <code class="grow">{{ ibanGroups(m!.iban!) }}</code><app-icon name="copy" [size]="18" /></button>
              <button type="button" class="copy-row" (click)="copy(causale(), 'Causale copiata')" aria-label="Copia la causale">
                <span class="grow small">Causale: {{ causale() }}</span><app-icon name="copy" [size]="18" /></button>
            </div>
          }
          @if (!m?.paypal && !m?.iban) {
            <p class="note small">{{ session.name(t.to_id) }} non ha ancora messo PayPal o IBAN: puoi pagare in contanti o chiederglieli.</p>
          }
        }
        <div class="field"><span>{{ onBehalf() || receiving() ? 'Come ha pagato' : 'Come hai pagato' }}</span>
          <div class="choice">
            @for (k of methods; track k) {
              <button type="button" class="sym-btn" [attr.aria-pressed]="method() === k" (click)="method.set(k)" [attr.aria-label]="methodLabel(k)" [title]="methodLabel(k)"><app-icon [name]="methodIcon(k)" [size]="28" /></button>
            }
          </div>
        </div>
        <button type="button" class="btn primary block" [disabled]="busy() || !amountCents()" (click)="confirmPay()">
          {{ onBehalf() ? 'Segna pagato' : receiving() ? 'Ho ricevuto ' + amountText() : 'Ho pagato ' + amountText() }}
        </button>
        @if (!onBehalf() && !receiving()) { <p class="small muted hint">Il debito si chiude quando {{ session.name(t.to_id) }} conferma di averli ricevuti.</p> }
      }
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
            @for (m of pastMatches(); track m.id) { <option [ngValue]="m.id">{{ day(m.starts_at) }}</option> }
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
            <select class="input" name="payer" [ngModel]="ePayer()" (ngModelChange)="ePayer.set($event)" [disabled]="!pay.data()?.boss">
              @for (m of session.activeMembers(); track m.id) { <option [ngValue]="m.id">{{ session.name(m.id) }}</option> }
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
          <span>A testa</span>
          <span class="each-val">
            <b class="num">{{ each()?.main ?? '—' }}</b>
            @if (each()?.note; as note) { <small class="muted">{{ note }}</small> }
          </span>
        </div>
        <button class="btn primary block" [disabled]="busy() || !canSaveExpense()">Aggiungi la spesa</button>
      </form>
    </dialog>
  `,
  styles: `
    .titlebar { gap: 4px; justify-content: flex-start; }
    .titlebar .push { margin-left: auto; }
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
    .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: start; }
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
    .round-btn:focus-visible { outline: 2px solid var(--turf); outline-offset: 2px; }
    .wait { flex: none; width: 44px; height: 44px; display: grid; place-items: center; color: var(--muted); }
    .none { margin: 0; }
    .clear { margin-top: 10px; gap: 6px; }
    .copy-row { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 10px; min-height: 44px; cursor: pointer; border-radius: 10px; padding: 0 4px; }
    .copy-row:focus-visible { outline: 2px solid var(--turf); outline-offset: 2px; }
    .copy-row:active { background: var(--surface); }
    .choice .sym-btn { display: grid; place-items: center; min-height: 56px; }
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
    .iban { display: flex; flex-direction: column; gap: 6px; padding: 12px; background: var(--surface-2); border-color: transparent; }
    .hint { margin: -4px 0 0; }
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
    .each { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 12px 16px; border-radius: 14px; background: var(--surface-2); }
    .each > span:first-child { font-weight: 600; }
    .each-val { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
    .each-val small { font-size: var(--step--1); }
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

  // nuova spesa
  private readonly expDlg = viewChild<ElementRef<HTMLDialogElement>>('expDlg');
  protected readonly pastMatches = signal<Match[]>([]);
  protected readonly eMatch = signal<string | null>(null);
  protected eTitle = '';
  protected readonly eAmount = signal('');
  protected readonly ePayer = signal<string>('');
  protected readonly eUsers = signal(new Set<string>());
  protected readonly whoOpen = signal(false);
  /** riassunto chiuso: «10 su 14: Alberto, Checco e altri 8» */
  protected readonly pickedText = computed(() => {
    const ids = this.session.activeMembers().filter((m) => this.eUsers().has(m.id)).map((m) => this.session.name(m.id));
    const n = this.session.activeMembers().length;
    if (!ids.length) return 'Nessuno: tocca per scegliere';
    if (ids.length === n) return `Tutti (${n})`;
    const head = ids.slice(0, 2).join(', ');
    return `${ids.length} su ${n}: ${head}${ids.length > 2 ? ` e altri ${ids.length - 2}` : ''}`;
  });
  protected readonly allPicked = computed(() => { const n = this.session.activeMembers().length; return n > 0 && this.eUsers().size === n; });
  /** quota a testa: se non si divide in parti uguali, in grande la più alta e sotto quanti pagano un centesimo in meno */
  protected readonly each = computed(() => {
    const c = parseEuro(this.eAmount()), n = this.eUsers().size;
    if (!c || !n) return null;
    const lo = Math.floor(c / n), extra = c - lo * n;
    return extra ? { main: eur(lo + 1), note: `${n - extra} su ${n} pagano ${eur(lo)}` } : { main: eur(lo), note: null };
  });

  async ngOnInit(): Promise<void> {
    try {
      const d = await this.pay.load();
      const mine = d.methods.find((m) => m.user_id === d.me);
      this.fPaypal = mine?.paypal ?? '';
      this.fIban = mine?.iban ? ibanGroups(mine.iban) : '';
      this.fHolder = mine?.holder ?? '';
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }

  /** tocco sul velo: chiude. Niente espressione che restituisce false nel template: Angular annullerebbe il clic (e l'invio dei moduli) */
  protected backdrop(e: MouseEvent): void {
    const d = e.target as HTMLElement;
    if (d instanceof HTMLDialogElement) d.close();
  }

  protected methodLabel(m: PayMethod): string { return METHOD_LABEL[m]; }
  protected methodIcon(m: PayMethod): string { return METHOD_ICON[m]; }
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
    if (this.reprimand.guard()) return;
    this.payTo.set(t);
    this.onBehalf.set(behalf);
    this.receiving.set(receiving);
    const m = this.methodsOf(t.to_id);
    this.method.set(behalf || receiving ? 'cash' : m?.paypal ? 'paypal' : m?.iban ? 'iban' : 'cash');
    this.fAmount = (t.amount_cents / 100).toFixed(2).replace('.', ',').replace(',00', '');
    queueMicrotask(() => { const d = this.payDlg()?.nativeElement; if (d && !d.open) d.showModal(); });
  }

  protected async confirmPay(): Promise<void> {
    if (this.reprimand.guard()) return;
    const t = this.payTo(), c = this.amountCents();
    if (!t || !c) return;
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

  protected async decide(s: PaySettlement, ok: boolean): Promise<void> {
    if (this.reprimand.guard()) return;
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
    queueMicrotask(() => { const d = this.expDlg()?.nativeElement; if (d && !d.open) d.showModal(); });
    if (!this.pastMatches().length) {
      try {
        const now = Date.now();
        const all = await this.api.matches(30);
        this.pastMatches.set(all.filter((m) => m.status !== 'cancelled' && Date.parse(m.starts_at) < now)
          .sort((a, b) => b.starts_at.localeCompare(a.starts_at)).slice(0, 8));
      } catch { /* senza partite si inserisce a mano */ }
    }
  }

  /** scegliendo una partita: titolo «Campo gg/mm/aa» e divisione tra chi era in formazione */
  protected async pickMatch(id: string | null): Promise<void> {
    this.eMatch.set(id);
    if (!id) return;
    const m = this.pastMatches().find((x) => x.id === id);
    if (m && (!this.eTitle || this.eTitle.startsWith('Campo'))) this.eTitle = `Campo ${fmtDate(m.starts_at)}`;
    try {
      const rows = await this.api.lineup(id);
      if (rows.length) this.eUsers.set(new Set(rows.map((r) => r.user_id)));
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
    if (!confirm(`Togliere «${e.title}» (${eur(e.amount_cents)})? I conti si ricalcolano.`)) return;
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

  protected async clearHistory(): Promise<void> {
    if (this.reprimand.guard()) return;
    if (!confirm('Svuotare lo storico dei pagamenti? Sparisce solo dalla tua vista: i conti non cambiano.')) return;
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
    if (this.reprimand.guard()) return;
    this.busy.set(true);
    try {
      await this.pay.saveMethods(this.fPaypal, this.fIban, this.fHolder);
      const mine = this.methodsOf(this.me() ?? '');
      this.fPaypal = mine?.paypal ?? '';
      this.fIban = mine?.iban ? ibanGroups(mine.iban) : '';
      this.toasts.show('Salvato');
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
