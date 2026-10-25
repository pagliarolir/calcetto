import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { kit } from '../core/kits';
import { Api } from '../core/api';
import { fmtDate, fmtWhen } from '../core/format';
import { KitStatsRow, LeaderPointsEntry, LeaderPointsRow, PairRow, StatsRow } from '../core/models';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { Avatar } from '../ui/avatar';
import { Icon } from '../ui/icon';
import { AchievementsPanel } from '../ui/achievements-panel';

type Period = 'last' | 'month' | 'year' | 'all' | 'custom';
type Tab = 'classifica' | 'record' | 'squadre' | 'punti' | 'obiettivi';
type Col = { key: keyof StatsRow; label: string; title: string; fmt?: 'dec' | 'pct' | 'form'; asc?: boolean };

const COLUMNS: Col[] = [
  { key: 'goals', label: 'Gol', title: 'Gol segnati' },
  { key: 'points', label: 'Pt', title: 'Punti (3 vittoria, 1 pareggio)' },
  { key: 'played', label: 'PG', title: 'Partite giocate' },
  { key: 'wins', label: 'V', title: 'Vittorie' },
  { key: 'draws', label: 'N', title: 'Pareggi' },
  { key: 'losses', label: 'P', title: 'Sconfitte' },
  { key: 'own_goals', label: 'Aut', title: 'Autogol' },
  { key: 'points_per_game', label: 'Pt/PG', title: 'Punti per partita', fmt: 'dec' },
  { key: 'win_pct', label: '%V', title: 'Percentuale vittorie', fmt: 'pct' },
  { key: 'goals_per_game', label: 'Gol/PG', title: 'Gol per partita', fmt: 'dec' },
  { key: 'avg_vote', label: 'Voto', title: 'Media voto ricevuto', fmt: 'dec' },
  { key: 'best_avg_vote', label: 'Max', title: 'Miglior media in una partita', fmt: 'dec' },
  { key: 'worst_avg_vote', label: 'Min', title: 'Peggior media in una partita', fmt: 'dec' },
  { key: 'mvp_count', label: 'MVP', title: 'Volte migliore in campo' },
  { key: 'current_form', label: 'Forma', title: 'Ultime 5 partite (occupa due colonne)', fmt: 'form' },
];

/** colonne visibili all'inizio (le altre si aggiungono dalla finestra «Colonne») */
const DEFAULT_COLS = ['goals', 'own_goals', 'points', 'played', 'wins', 'draws', 'losses', 'avg_vote'];
const COLS_KEY = 'gdl-classifica-colonne';

interface Record { label: string; key: keyof StatsRow; suffix: string; open?: boolean; minPlayed?: number }

const RECORDS: Record[] = [
  { label: 'Più volte migliore in campo', key: 'mvp_count', suffix: 'volte' },
  { label: 'Capocannoniere', key: 'goals', suffix: 'gol' },
  { label: 'Re degli assist', key: 'assists', suffix: 'assist' },
  { label: 'Più vittorie', key: 'wins', suffix: 'vittorie' },
  { label: 'Media voto più alta', key: 'avg_vote', suffix: '', minPlayed: 3 },
  { label: 'Più vittorie di fila', key: 'best_win_streak', suffix: 'di fila' },
  { label: 'Serie di vittorie in corso', key: 'cur_win_streak', suffix: 'di fila', open: true },
  { label: 'Imbattuto più a lungo', key: 'best_unbeaten', suffix: 'partite' },
  { label: 'Imbattibilità in corso', key: 'cur_unbeaten', suffix: 'partite', open: true },
  { label: 'Più sconfitte di fila', key: 'worst_loss_streak', suffix: 'di fila' },
  { label: 'Digiuno di vittorie più lungo', key: 'worst_winless', suffix: 'partite' },
  { label: 'Digiuno in corso', key: 'cur_winless', suffix: 'partite', open: true },
  { label: 'Più sconfitte', key: 'losses', suffix: 'sconfitte' },
  { label: 'Più autogol', key: 'own_goals', suffix: 'autogol' },
  { label: 'Sempre presente', key: 'attendances', suffix: 'presenze' },
];

@Component({
  selector: 'app-stats',
  imports: [FormsModule, RouterLink, Avatar, Icon, AchievementsPanel],
  host: { '(window:resize)': 'onResize()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-head">
      <div class="head-in">
      <header class="stack">
        <div class="titlebar">
          <h1>Classifica</h1>
          @if (tab() !== 'punti' && tab() !== 'obiettivi') {
            <label class="period">
              <span class="sr-only">Periodo</span>
              <select class="input" [ngModel]="period()" (ngModelChange)="setPeriod($event)" aria-label="Periodo">
                @for (p of periods; track p.id) { <option [value]="p.id">{{ p.label }}</option> }
              </select>
            </label>
          }
        </div>
        @if (tab() !== 'punti' && tab() !== 'obiettivi' && period() === 'custom') {
          <div class="row">
            <label class="field grow"><span>Dal</span><input class="input" type="date" [(ngModel)]="customFrom" (change)="onDates()" /></label>
            <label class="field grow"><span>Al</span><input class="input" type="date" [(ngModel)]="customTo" (change)="onDates()" /></label>
          </div>
        }
        @if (tab() !== 'punti' && tab() !== 'obiettivi' && statsSince(); as d) { <p class="note">Classifica azzerata {{ whenFull(d) }}: contano solo le partite successive.</p> }
      </header>

      <!-- schede su due righe: la prima giustificata, la seconda centrata -->
      <nav class="stabs" role="tablist" aria-label="Statistiche">
        <div class="srow first" role="none">
          @for (t of tabs.slice(0, 3); track t.id) {
            <button role="tab" [id]="'tab-' + t.id" [attr.aria-selected]="tab() === t.id" [attr.aria-controls]="'panel-' + t.id"
                  [attr.tabindex]="tab() === t.id ? 0 : -1" (click)="selectTab(t.id)" (keydown)="tabKey($event)">{{ t.label }}</button>
          }
        </div>
        <div class="srow" role="none">
          @for (t of tabs.slice(3); track t.id) {
            <button role="tab" [id]="'tab-' + t.id" [attr.aria-selected]="tab() === t.id" [attr.aria-controls]="'panel-' + t.id"
                  [attr.tabindex]="tab() === t.id ? 0 : -1" (click)="selectTab(t.id)" (keydown)="tabKey($event)">{{ t.label }}</button>
          }
        </div>
      </nav>
      </div>
    </div>
    <main class="scroll-area">
      <div class="page stack-l in-body">

      <div class="tabpanel" role="tabpanel" [id]="'panel-' + tab()" [attr.aria-labelledby]="'tab-' + tab()">
      @if (tab() === 'punti') {
        <!-- ======================================================= Punti Leader -->
        @if (session.isLeader()) {
          <section class="panel stack award" aria-labelledby="award-h">
            <h2 id="award-h">Assegna punti Leader</h2>
            <label class="field"><span>Giocatore</span>
              <select class="input" [(ngModel)]="lpUser">
                <option value="">Scegli un giocatore</option>
                @for (mb of session.activeMembers(); track mb.id) { <option [value]="mb.id">{{ session.name(mb.id) }}</option> }
              </select>
            </label>
            <div class="row-wrap" role="group" aria-label="Punti rapidi">
              @for (q of quick; track q) {
                <button class="chip" [class.neg]="q < 0" [attr.aria-pressed]="lpPoints === q" (click)="lpPoints = q">{{ signed(q) }}</button>
              }
            </div>
            <div class="pair">
              <label class="field"><span>Punti (da -99 a +99)</span>
                <input class="input" type="number" inputmode="numeric" min="-99" max="99" step="1" [(ngModel)]="lpPoints" />
              </label>
              <label class="field"><span>Motivazione</span>
                <input class="input" [(ngModel)]="lpReason" maxlength="200" placeholder="Es. ha portato i palloni" />
              </label>
            </div>
            <button class="btn primary" [disabled]="busy() || !canAward()" (click)="award()">
              {{ lpPoints > 0 ? 'Assegna ' + signed(lpPoints) : lpPoints < 0 ? 'Togli ' + (-lpPoints) : 'Assegna' }}{{ lpUser ? ' a ' + session.name(lpUser) : '' }}
            </button>
          </section>
        }

        <section class="section" aria-labelledby="lp-h">
          <header><h2 id="lp-h">Classifica punti Leader</h2></header>
          @if (lpTable().length) {
            <ol class="lp-rank">
              @for (r of lpTable(); track r.user_id; let i = $index) {
                <li [class.me]="r.user_id === session.uid()" [class.top]="i < 3 && r.total > 0">
                  <span class="pos num">{{ i + 1 }}</span>
                  <app-avatar [userId]="r.user_id" [size]="34" />
                  <span class="grow"><a [routerLink]="['/giocatore', r.user_id]">{{ session.name(r.user_id) }}</a><br />
                    <span class="small muted">{{ r.awards === 1 ? '1 assegnazione' : r.awards + ' assegnazioni' }}</span></span>
                  <span class="pts num" [class.neg]="r.total < 0">{{ signed(r.total) }}</span>
                </li>
              }
            </ol>
          } @else { <p class="empty">Ancora nessun punto Leader.</p> }
        </section>

        @if (lpHistory().length) {
          <section class="section" aria-labelledby="lph-h">
            <header><h2 id="lph-h">Storico</h2></header>
            <ul class="lp-hist">
              @for (e of lpHistory(); track e.id) {
                <li>
                  <span class="pts num" [class.neg]="e.points < 0">{{ signed(e.points) }}</span>
                  <span class="grow">
                    <strong>{{ session.name(e.user_id) }}</strong>: {{ e.reason }}<br />
                    <span class="small muted">{{ e.created_by ? session.name(e.created_by) + ', ' : '' }}{{ whenFull(e.created_at) }}</span>
                  </span>
                  @if (session.isLeader()) {
                    <button class="icon-btn" [disabled]="busy()" (click)="undoPoints(e)" [attr.aria-label]="'Annulla ' + signed(e.points) + ' a ' + session.name(e.user_id)">✕</button>
                  }
                </li>
              }
            </ul>
          </section>
        }
      } @else if (tab() === 'obiettivi') {
        <!-- ======================================================= Obiettivi -->
        <app-achievements-panel />
      } @else if (loading()) {
        <p class="muted">Calcolo in corso…</p>
      } @else if (!played().length) {
        <p class="empty">Nessuna partita omologata in questo periodo.</p>
      } @else {
        @switch (tab()) {
          @case ('classifica') {
        <section class="section">
          <header>
            <h2>Classifica</h2>
            <button class="btn small ghost cols-btn" (click)="openCols()" aria-haspopup="dialog"><app-icon name="table" [size]="16" /> Colonne</button>
          </header>
          <p class="small muted">Tocca una colonna per ordinare. Con «Colonne» scegli cosa vedere.</p>
          <div class="fit-wrap">
            <table class="data fit">
              <thead>
                <tr>
                  <th scope="col">Giocatore</th>
                  @for (c of shownCols(); track c.key) {
                    <th scope="col" [class.wide]="c.fmt === 'form'" [attr.aria-sort]="sortKey() === c.key ? (sortAsc() ? 'ascending' : 'descending') : null" [title]="c.title">
                      <button (click)="sort(c)">{{ c.label }}</button>
                    </th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (r of sorted(); track r.user_id) {
                  <tr [class.me]="r.user_id === session.uid()">
                    <td><a class="who" [routerLink]="['/giocatore', r.user_id]"><app-avatar [userId]="r.user_id" [size]="26" />{{ session.name(r.user_id) }}</a></td>
                    @for (c of shownCols(); track c.key) { <td [class.wide]="c.fmt === 'form'">{{ cell(r, c) }}</td> }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <!-- «Scegli dettagli»: quali colonne vedere, senza mai superare la larghezza dello schermo -->
        <dialog #colsDialog class="sheet" (click)="colsBackdrop($event)" aria-labelledby="cols-h">
          <div class="grab" aria-hidden="true"></div>
          <h2 id="cols-h">Colonne della classifica</h2>
          <p class="small muted">Su questo schermo ne entrano {{ maxCols() }}: ne hai scelte {{ chosenWeight() }}. Per aggiungerne una, togline un'altra.</p>
          <ul class="cols">
            @for (c of columns; track c.key) {
              <li>
                <label class="check" [class.off]="!shownKeys().includes(c.key) && chosenWeight() + weight(c) > maxCols()">
                  <input type="checkbox" [checked]="shownKeys().includes(c.key)"
                         [disabled]="(!shownKeys().includes(c.key) && chosenWeight() + weight(c) > maxCols()) || (shownKeys().includes(c.key) && shownKeys().length === 1)"
                         (change)="toggleCol(c.key)" />
                  <span class="cl">{{ c.label }}</span>
                  <span class="small muted grow">{{ c.title }}</span>
                </label>
              </li>
            }
          </ul>
          <div class="row-wrap">
            <button class="btn small ghost" (click)="resetCols()">Ripristina</button>
            <button class="btn small primary" (click)="closeCols()">Fatto</button>
          </div>
        </dialog>

          }
          @case ('record') {
        <section class="section">
          <header><h2>Serie e record</h2></header>
          <ul class="list">
            @for (r of records(); track r.label) {
              <li class="list-item">
                <span class="grow">
                  <span class="small muted">{{ r.label }}</span>
                  @if (r.open) { <span class="tag turf">aperta</span> }<br />
                  <strong>{{ r.names }}</strong>
                </span>
                <span class="num big">{{ r.value }}</span><span class="small muted">{{ r.suffix }}</span>
              </li>
            }
          </ul>
        </section>

          }
          @case ('squadre') {
            <!-- ======================================================= Squadre e coppie -->
            <section class="section" aria-labelledby="kit-h">
              <header><h2 id="kit-h">Vittorie per colore</h2></header>
              <div class="table-wrap">
                <table class="data">
                  <thead><tr><th scope="col">Squadra</th><th scope="col">PG</th><th scope="col">V</th><th scope="col">N</th><th scope="col">P</th><th scope="col">%V</th></tr></thead>
                  <tbody>
                    @for (k of kitRows(); track k.kit) {
                      <tr><td><span class="who"><i class="dot" [style.background]="kitOf(k.kit).color"></i>{{ kitOf(k.kit).name }}</span></td>
                        <td>{{ k.played }}</td><td>{{ k.wins }}</td><td>{{ k.draws }}</td><td>{{ k.losses }}</td><td>{{ pct(k.wins, k.played) }}</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            </section>

            <details class="panel fold" [open]="folds().has('coppie')" (toggle)="foldToggled('coppie', $event)">
              <summary><span class="grow"><strong>Coppie più affiatate</strong><br /><span class="small muted">più partite da compagni</span></span><app-icon name="chevron" [size]="18" /></summary>
              <ol class="pairs">
                @for (x of topTogether(); track x.a_id + x.b_id) {
                  <li><span class="duo"><app-avatar [userId]="x.a_id" [size]="24" /><app-avatar [userId]="x.b_id" [size]="24" /></span>
                    <span class="grow">{{ session.name(x.a_id) }} e {{ session.name(x.b_id) }}</span>
                    <span class="small"><strong>{{ x.together }}</strong> insieme, {{ pct(x.together_wins, x.together) }} vinte</span></li>
                }
              </ol>
            </details>
            <details class="panel fold" [open]="folds().has('rivalita')" (toggle)="foldToggled('rivalita', $event)">
              <summary><span class="grow"><strong>Grandi rivalità</strong><br /><span class="small muted">più partite da avversari</span></span><app-icon name="chevron" [size]="18" /></summary>
              <ol class="pairs">
                @for (x of topAgainst(); track x.a_id + x.b_id) {
                  <li><span class="duo"><app-avatar [userId]="x.a_id" [size]="24" /><app-avatar [userId]="x.b_id" [size]="24" /></span>
                    <span class="grow">{{ session.name(x.a_id) }} contro {{ session.name(x.b_id) }}</span>
                    <span class="small"><strong>{{ x.against }}</strong> sfide, {{ x.a_wins }}-{{ x.against_draws }}-{{ x.b_wins }}</span></li>
                }
              </ol>
            </details>

            <section class="section" aria-labelledby="aff-h">
              <header><h2 id="aff-h">Affinità di un giocatore</h2></header>
              <label class="field"><span>Giocatore</span>
                <select class="input" [ngModel]="focus()" (ngModelChange)="setFocus($event)">
                  @for (r of played(); track r.user_id) { <option [value]="r.user_id">{{ session.name(r.user_id) }}</option> }
                </select>
              </label>
              <h3>Con quale colore vince</h3>
              <ul class="bars">
                @for (k of focusKits(); track k.kit) {
                  <li>
                    <span class="who"><i class="dot" [style.background]="kitOf(k.kit).color"></i>{{ kitOf(k.kit).name }}</span>
                    <span class="bar" aria-hidden="true"><i [style.width.%]="share(k.wins, k.played)"></i></span>
                    <span class="small"><strong>{{ pct(k.wins, k.played) }}</strong> {{ k.wins }}V {{ k.draws }}N {{ k.losses }}P</span>
                  </li>
                } @empty { <li class="small muted">Nessuna partita in questo periodo.</li> }
              </ul>
              @if (bestMate(); as b) {
                <p class="note">Con <strong>{{ session.name(b.other) }}</strong> vince il {{ pct(b.wins, b.games) }} delle partite giocate insieme ({{ b.wins }} su {{ b.games }}).</p>
              }
              <h3>Da compagni</h3>
              <ul class="bars">
                @for (x of mates(); track x.other) {
                  <li>
                    <span class="who"><app-avatar [userId]="x.other" [size]="24" />{{ session.name(x.other) }}</span>
                    <span class="bar" aria-hidden="true"><i [style.width.%]="share(x.wins, x.games)"></i></span>
                    <span class="small"><strong>{{ pct(x.wins, x.games) }}</strong> {{ x.wins }} su {{ x.games }}</span>
                  </li>
                } @empty { <li class="small muted">Nessuna partita insieme in questo periodo.</li> }
              </ul>
              <h3>Da avversari</h3>
              <ul class="bars">
                @for (x of rivals(); track x.other) {
                  <li>
                    <span class="who"><app-avatar [userId]="x.other" [size]="24" />{{ session.name(x.other) }}</span>
                    <span class="bar rival" aria-hidden="true"><i [style.width.%]="share(x.wins, x.games)"></i></span>
                    <span class="small"><strong>{{ x.wins }}-{{ x.draws }}-{{ x.losses }}</strong> in {{ x.games }}</span>
                  </li>
                } @empty { <li class="small muted">Nessuna sfida in questo periodo.</li> }
              </ul>
              <p class="small muted">Barre: percentuale di vittorie. Da avversari: vittorie, pareggi e sconfitte di {{ session.name(focus()) }}.</p>
            </section>
          }
        }
      }
      </div>
    </div>
    </main>
  `,
  styles: `
    :host { display: flex; flex-direction: column; flex: 1 1 0; min-height: 0; }
    .big { font-size: var(--step-2); font-weight: 700; margin-left: 8px; }
    .list-item .small.muted:last-child { margin-left: 4px; min-width: 52px; }
    td a { text-decoration: none; font-weight: 600; }
    .who { display: inline-flex; align-items: center; gap: 8px; }
    /* classifica senza scorrimento laterale */
    .fit-wrap { overflow: hidden; }
    table.fit { table-layout: fixed; width: 100%; }
    table.fit th:first-child, table.fit td:first-child { width: auto; }
    table.fit th:not(:first-child), table.fit td:not(:first-child) { width: 32px; padding-left: 1px; padding-right: 1px; text-align: center; font-size: 0.85rem; }
    table.fit td.wide, table.fit th.wide { width: 64px; }
    table.fit .who { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    table.fit th button { font-size: 0.72rem; padding: 0; }
    .section > header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .cols-btn { gap: 6px; }
    .titlebar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .period { position: relative; flex: 0 1 auto; }
    .period select { min-height: 40px; padding-top: 6px; padding-bottom: 6px; font-weight: 600; max-width: 180px; }
    .sheet {
      position: fixed; inset: auto 0 0 0; margin: 0 auto; width: 100%; max-width: 560px; max-height: 85vh; overflow-y: auto; border: 0; color: var(--ink);
      background: var(--surface); border-radius: 22px 22px 0 0; padding: 8px 16px calc(16px + env(safe-area-inset-bottom, 0px)); box-shadow: 0 -10px 40px rgb(0 0 0 / 25%);
    }
    .sheet[open] { display: flex; flex-direction: column; gap: 10px; }
    .sheet::backdrop { background: rgb(10 20 14 / 45%); }
    .grab { width: 40px; height: 5px; border-radius: 3px; background: var(--line); align-self: center; }
    .cols { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .cols li { border-top: 1px solid var(--line); }
    .cols li:first-child { border-top: 0; }
    .check { display: flex; align-items: center; gap: 12px; min-height: 48px; cursor: pointer; }
    .check.off { opacity: 0.45; cursor: not-allowed; }
    .check input { width: 20px; height: 20px; accent-color: var(--turf); flex: none; }
    .cl { width: 52px; font-weight: 700; flex: none; }
    /* tendine delle coppie */
    .fold summary { display: flex; align-items: center; gap: 10px; cursor: pointer; list-style: none; min-height: 44px; }
    .fold summary::-webkit-details-marker { display: none; }
    .fold summary app-icon { transition: transform 200ms; transform: rotate(90deg); }
    .fold[open] summary app-icon { transform: rotate(-90deg); }
    .fold .pairs { margin-top: 10px; }
    /* schede su due righe (3 sopra, giustificate; 2 sotto, centrate), larghe quanto la parola */
    .stabs { display: flex; flex-direction: column; border-bottom: 1px solid var(--line); }
    /* schede equidistanti, sopra e sotto */
    .srow { display: flex; justify-content: space-evenly; }
    .stabs button {
      flex: 0 0 auto; appearance: none; background: none; border: 0; border-bottom: 3px solid transparent; cursor: pointer;
      padding: 10px 12px 8px; min-height: 42px; color: var(--muted); font: 600 var(--step--1)/1.1 var(--font-body); white-space: nowrap;
    }
    .stabs button[aria-selected='true'] { color: var(--ink); border-bottom-color: var(--turf); }
    .tabpanel { display: flex; flex-direction: column; gap: var(--space-l, 24px); }
    .pair { display: grid; grid-template-columns: 1fr 1.6fr; gap: 8px; }
    .chip.neg[aria-pressed='true'] { background: var(--danger); border-color: var(--danger); }
    .award { border: 2px solid var(--armband); }
    .lp-rank, .lp-hist, .bars, .pairs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .lp-rank li, .lp-hist li, .pairs li { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line); min-width: 0; }
    .lp-rank li.me { background: var(--turf-soft); border-radius: 12px; padding-left: 8px; padding-right: 8px; }
    .lp-rank a { color: inherit; text-decoration: none; font-weight: 600; }
    .pos { width: 22px; text-align: center; color: var(--muted); font-weight: 700; }
    .lp-rank li.top .pos { color: var(--armband-ink, var(--ink)); background: var(--armband); border-radius: 50%; height: 22px; line-height: 22px; font-size: 0.8rem; }
    .pts { font: 700 var(--step-1)/1 var(--font-display); color: var(--turf); min-width: 48px; text-align: right; }
    .pts.neg { color: var(--danger); }
    .lp-hist .pts { min-width: 44px; text-align: left; font-size: var(--step-0); }
    .bars li { display: grid; grid-template-columns: minmax(0, 1.1fr) 1fr auto; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line); }
    .bar { height: 8px; border-radius: 999px; background: var(--surface-2, rgb(0 0 0 / 8%)); overflow: hidden; }
    .bar i { display: block; height: 100%; background: var(--turf); border-radius: inherit; }
    .bar.rival i { background: var(--armband); }
    .dot { display: inline-block; width: 14px; height: 14px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 25%); flex: none; }
    .duo { display: inline-flex; }
    .duo app-avatar + app-avatar { margin-left: -8px; box-shadow: 0 0 0 2px var(--bg); }
    h3 { font: 600 var(--step-1)/1.2 var(--font-display); margin: 8px 0 0; }
  `,
})
export class StatsPage {
  private readonly api = inject(Api);
  protected readonly session = inject(Session);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);

  protected readonly periods: { id: Period; label: string }[] = [
    { id: 'all', label: 'Sempre' },
    { id: 'year', label: 'Quest\'anno' },
    { id: 'month', label: 'Ultimo mese' },
    { id: 'last', label: 'Ultima partita' },
    { id: 'custom', label: 'Scegli le date' },
  ];
  protected readonly columns = COLUMNS;

  // ---------------------------------------------------------- colonne visibili
  private readonly colsDialog = viewChild<ElementRef<HTMLDialogElement>>('colsDialog');
  private readonly viewport = signal(typeof window === 'undefined' ? 400 : window.innerWidth);
  protected readonly chosen = signal<string[]>(this.loadCols());
  /** quante colonne entrano: larghezza utile meno il nome, diviso la larghezza di una colonna */
  protected readonly maxCols = computed(() => Math.max(3, Math.floor((Math.min(this.viewport(), 640) - 32 - 92) / 32)));
  /** colonne mostrate: quelle scelte, nell'ordine della tabella, finché c'è posto */
  protected readonly shownCols = computed(() => {
    const out: Col[] = [];
    let used = 0;
    for (const c of this.columns) {
      if (!this.chosen().includes(c.key)) continue;   // la scelta salvata (non quella visibile: sarebbe circolare)
      if (used + this.weight(c) > this.maxCols()) break;
      out.push(c);
      used += this.weight(c);
    }
    return out;
  });
  /** le colonne spuntate nella finestra sono esattamente quelle visibili */
  protected readonly shownKeys = computed(() => this.shownCols().map((c) => c.key as string));
  protected readonly chosenWeight = computed(() => this.shownCols().reduce((n, c) => n + this.weight(c), 0));

  protected weight(c: Col): number {
    return c.fmt === 'form' ? 2 : 1;
  }

  private loadCols(): string[] {
    try {
      const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? 'null');
      if (Array.isArray(v) && v.length) return v.filter((k) => COLUMNS.some((c) => c.key === k));
    } catch {
      /* si usano le colonne predefinite */
    }
    return [...DEFAULT_COLS];
  }

  private saveCols(v: string[]): void {
    this.chosen.set(v);
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(v));
    } catch {
      /* la scelta vale finché la pagina resta aperta */
    }
  }

  protected toggleCol(key: string): void {
    const cur = this.shownKeys();
    this.saveCols(cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]);
  }

  protected resetCols(): void {
    this.saveCols([...DEFAULT_COLS]);
  }

  protected openCols(): void {
    const d = this.colsDialog()?.nativeElement;
    if (d && !d.open) d.showModal();
  }

  protected closeCols(): void {
    this.colsDialog()?.nativeElement.close();
  }

  protected colsBackdrop(e: MouseEvent): void {
    if (e.target === this.colsDialog()?.nativeElement) this.closeCols();
  }

  protected onResize(): void {
    this.viewport.set(window.innerWidth);
  }
  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'classifica', label: 'Classifica' },
    { id: 'record', label: 'Record' },
    { id: 'squadre', label: 'Squadre e coppie' },
    { id: 'punti', label: 'Punti Leader' },
    { id: 'obiettivi', label: 'Obiettivi' },
  ];
  protected readonly tab = signal<Tab>('classifica');
  protected readonly busy = signal(false);
  protected readonly quick = [-10, -5, -1, 1, 5, 10];
  protected lpUser = '';
  protected lpPoints = 5;
  protected lpReason = '';
  protected readonly lpTable = signal<LeaderPointsRow[]>([]);
  protected readonly lpHistory = signal<LeaderPointsEntry[]>([]);
  protected readonly kitRows = signal<KitStatsRow[]>([]);
  protected readonly playerKits = signal<KitStatsRow[]>([]);
  protected readonly pairs = signal<PairRow[]>([]);
  /** giocatore di riferimento per Squadre e Coppie (all'inizio chi guarda) */
  protected readonly focus = signal<string>('');
  protected readonly kitOf = kit;
  protected readonly date = fmtDate;
  protected readonly whenFull = fmtWhen;
  protected readonly statsSince = signal<string | null>(null);

  protected readonly period = signal<Period>('year');
  protected readonly rows = signal<StatsRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly range = signal<{ from: string | null; to: string | null }>({ from: null, to: null });
  protected readonly sortKey = signal<keyof StatsRow>('points');
  protected readonly sortAsc = signal(false);
  protected customFrom = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
  protected customTo = new Date().toISOString().slice(0, 10);

  protected readonly played = computed(() => this.rows().filter((r) => r.played > 0));

  protected readonly sorted = computed(() => {
    const k = this.sortKey();
    const dir = this.sortAsc() ? 1 : -1;
    return [...this.rows().filter((r) => r.played > 0 || r.attendances > 0)].sort((a, b) => {
      const av = a[k] as number | null;
      const bv = b[k] as number | null;
      if (av === bv) return b.points - a.points;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av > bv ? 1 : -1) * dir;
    });
  });

  protected readonly records = computed(() =>
    RECORDS.map((r) => {
      const pool = this.played().filter((x) => x.played >= (r.minPlayed ?? 1));
      const best = Math.max(...pool.map((x) => Number(x[r.key] ?? 0)));
      if (!isFinite(best) || best <= 0) return null;
      const who = pool.filter((x) => Number(x[r.key] ?? 0) === best).map((x) => this.session.name(x.user_id));
      return {
        ...r,
        value: r.key === 'avg_vote' ? best.toFixed(2).replace('.', ',') : best,
        names: who.length > 3 ? `${who.slice(0, 3).join(', ')} e altri ${who.length - 3}` : who.join(', '),
      };
    }).filter((x): x is NonNullable<typeof x> => x !== null),
  );



  /** tendine aperte in «Squadre e coppie» (anche loro nell'indirizzo: si torna indietro con le stesse aperte) */
  protected readonly folds = signal<Set<string>>(new Set());

  constructor() {
    // tutto quello che si sceglie è nell'indirizzo: «Indietro» da una scheda giocatore riapre la stessa vista
    const qp = inject(ActivatedRoute).snapshot.queryParamMap;
    const raw = qp.get('scheda');
    const q = (raw === 'coppie' ? 'squadre' : raw === 'presenze' ? 'classifica' : raw) as Tab | null;
    if (q && this.tabs.some((t) => t.id === q)) this.tab.set(q);
    const per = qp.get('periodo') as Period | null;
    if (per && this.periods.some((x) => x.id === per)) this.period.set(per);
    if (qp.get('dal')) this.customFrom = qp.get('dal')!;
    if (qp.get('al')) this.customTo = qp.get('al')!;
    this.focus.set(qp.get('giocatore') ?? this.session.uid() ?? '');
    this.folds.set(new Set((qp.get('aperte') ?? '').split(',').filter(Boolean)));
    effect(() => {
      this.period();
      void this.reload();
    });
    void this.loadPoints();
  }

  // ------------------------------------------------------------------ schede
  protected selectTab(t: Tab): void {
    this.tab.set(t);
    this.syncUrl();
  }

  protected setPeriod(p: Period): void {
    this.period.set(p);
    this.syncUrl();
  }

  protected onDates(): void {
    void this.reload();
    this.syncUrl();
  }

  protected setFocus(id: string): void {
    this.focus.set(id);
    this.syncUrl();
  }

  protected foldToggled(key: string, e: Event): void {
    const open = (e.target as HTMLDetailsElement).open;
    const next = new Set(this.folds());
    if (open) next.add(key); else next.delete(key);
    if (next.size === this.folds().size && [...next].every((k) => this.folds().has(k))) return;
    this.folds.set(next);
    this.syncUrl();
  }

  /** scrive le scelte nell'indirizzo senza aggiungere passaggi alla cronologia */
  private syncUrl(): void {
    const custom = this.period() === 'custom';
    void this.router.navigate([], {
      replaceUrl: true,
      queryParams: {
        scheda: this.tab() === 'classifica' ? null : this.tab(),
        periodo: this.period() === 'year' ? null : this.period(),
        dal: custom ? this.customFrom : null,
        al: custom ? this.customTo : null,
        giocatore: this.focus() && this.focus() !== this.session.uid() ? this.focus() : null,
        aperte: this.folds().size ? [...this.folds()].sort().join(',') : null,
      },
    });
  }

  /** frecce sinistra e destra per passare da una scheda all'altra (tastiera) */
  protected tabKey(e: KeyboardEvent): void {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = this.tabs.findIndex((t) => t.id === this.tab());
    const next = this.tabs[(i + (e.key === 'ArrowRight' ? 1 : this.tabs.length - 1)) % this.tabs.length].id;
    this.selectTab(next);
    document.getElementById('tab-' + next)?.focus();
  }

  // ------------------------------------------------------------------ squadre e coppie
  protected pct(n: number, d: number): string {
    return d ? `${Math.round((100 * n) / d)}%` : '–';
  }

  protected share(n: number, d: number): number {
    return d ? (100 * n) / d : 0;
  }

  protected readonly focusKits = computed(() =>
    this.playerKits().filter((k) => k.user_id === this.focus()).sort((a, b) => this.share(b.wins, b.played) - this.share(a.wins, a.played) || b.played - a.played));

  /** compagni del giocatore scelto, dal più vincente */
  protected readonly mates = computed(() => {
    const me = this.focus();
    return this.pairs()
      .filter((p) => (p.a_id === me || p.b_id === me) && p.together > 0)
      .map((p) => ({ other: p.a_id === me ? p.b_id : p.a_id, games: p.together, wins: p.together_wins, draws: p.together_draws }))
      .sort((a, b) => this.share(b.wins, b.games) - this.share(a.wins, a.games) || b.games - a.games);
  });

  /** avversari del giocatore scelto, dal più battuto */
  protected readonly rivals = computed(() => {
    const me = this.focus();
    return this.pairs()
      .filter((p) => (p.a_id === me || p.b_id === me) && p.against > 0)
      .map((p) => {
        const mine = p.a_id === me;
        return { other: mine ? p.b_id : p.a_id, games: p.against, wins: mine ? p.a_wins : p.b_wins, losses: mine ? p.b_wins : p.a_wins, draws: p.against_draws };
      })
      .sort((a, b) => this.share(b.wins, b.games) - this.share(a.wins, a.games) || b.games - a.games);
  });

  /** il compagno con cui vince di più (almeno 3 partite insieme, per non premiare il caso) */
  protected readonly bestMate = computed(() => this.mates().find((m) => m.games >= 3 && m.wins > 0) ?? null);

  protected readonly topTogether = computed(() =>
    [...this.pairs()].filter((p) => p.together > 0).sort((a, b) => b.together - a.together || b.together_wins - a.together_wins).slice(0, 10));

  protected readonly topAgainst = computed(() =>
    [...this.pairs()].filter((p) => p.against > 0).sort((a, b) => b.against - a.against).slice(0, 10));

  // ------------------------------------------------------------------ punti Leader
  protected signed(n: number): string {
    return n > 0 ? `+${n}` : String(n);
  }

  protected canAward(): boolean {
    const n = Number(this.lpPoints);
    return !!this.lpUser && Number.isInteger(n) && n !== 0 && n >= -99 && n <= 99 && !!this.lpReason.trim();
  }

  private async loadPoints(): Promise<void> {
    try {
      const [t, h] = await Promise.all([this.api.leaderPointsTable(), this.api.leaderPointsHistory()]);
      this.lpTable.set(t);
      this.lpHistory.set(h);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }

  protected async award(): Promise<void> {
    const n = Number(this.lpPoints);
    const name = this.session.name(this.lpUser);
    this.busy.set(true);
    try {
      await this.api.awardLeaderPoints(this.lpUser, n, this.lpReason.trim());
      this.toasts.show(`${this.signed(n)} punti Leader a ${name}.`);
      this.lpReason = '';
      await this.loadPoints();
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async undoPoints(e: LeaderPointsEntry): Promise<void> {
    if (!confirm(`Annullare ${this.signed(e.points)} a ${this.session.name(e.user_id)} («${e.reason}»)?`)) return;
    this.busy.set(true);
    try {
      await this.api.deleteLeaderPoints(e.id);
      this.toasts.show('Assegnazione annullata.');
      await this.loadPoints();
    } catch (err) {
      this.toasts.error(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async reload(): Promise<void> {
    this.loading.set(true);
    try {
      const r = await this.computeRange();
      this.range.set(r);
      const [rows, kits, pkits, pairs] = await Promise.all([
        this.api.stats(r.from, r.to),
        this.api.teamKitStats(r.from, r.to), this.api.playerKitStats(r.from, r.to), this.api.pairStats(r.from, r.to),
      ]);
      this.rows.set(rows);
      this.kitRows.set(kits);
      this.playerKits.set(pkits);
      this.pairs.set(pairs);
      // se chi guarda non ha giocato nel periodo, si parte dal primo della classifica
      if (!rows.some((x) => x.user_id === this.focus() && x.played > 0)) {
        const first = rows.find((x) => x.played > 0);
        if (first) this.focus.set(first.user_id);
      }
      void this.api.statsResetInfo(null).then((i) => this.statsSince.set(i.global)).catch(() => undefined);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  private async computeRange(): Promise<{ from: string | null; to: string | null }> {
    const now = new Date();
    switch (this.period()) {
      case 'all': return { from: null, to: null };
      case 'year': return { from: new Date(now.getFullYear(), 0, 1).toISOString(), to: new Date(now.getFullYear() + 1, 0, 1).toISOString() };
      case 'month': return { from: new Date(now.getTime() - 30 * 86_400_000).toISOString(), to: null };
      case 'last': {
        const m = await this.api.lastPlayedMatch();
        if (!m) return { from: now.toISOString(), to: now.toISOString() };
        return { from: m.starts_at, to: new Date(new Date(m.starts_at).getTime() + 60_000).toISOString() };
      }
      case 'custom': {
        const to = new Date(this.customTo);
        to.setDate(to.getDate() + 1);
        return { from: new Date(this.customFrom).toISOString(), to: to.toISOString() };
      }
    }
  }

  protected sort(c: Col): void {
    if (this.sortKey() === c.key) this.sortAsc.set(!this.sortAsc());
    else {
      this.sortKey.set(c.key);
      this.sortAsc.set(!!c.asc);
    }
  }

  protected cell(r: StatsRow, c: Col): string {
    const v = r[c.key];
    if (v === null || v === undefined || v === '') return '–';
    if (c.fmt === 'form') return String(v).replace(/W/g, 'V').replace(/D/g, 'N').replace(/L/g, 'P');
    if (c.fmt === 'dec') return Number(v).toFixed(2).replace('.', ',');
    if (c.fmt === 'pct') return `${Number(v).toFixed(0)}%`;
    return String(v);
  }

}
