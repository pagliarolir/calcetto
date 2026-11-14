import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, OnDestroy, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { Session } from '../core/session';
import { overallOf, Ratings, RatingCard } from '../core/ratings';
import { Icon } from '../ui/icon';
import { HexChart, HexSeries } from './charts';

type Key = 'dc' | 'ed' | 'eo' | 'pu' | 'ovr';
const ROWS: { key: Key; short: string; label: string }[] = [
  { key: 'dc', short: 'DC', label: 'Difensore centrale' },
  { key: 'ed', short: 'ED', label: 'Esterno difensivo' },
  { key: 'eo', short: 'EO', label: 'Esterno offensivo' },
  { key: 'pu', short: 'PU', label: 'Punta' },
  { key: 'ovr', short: 'Gen.', label: 'Valore generale' },
];
const COLORS = ['var(--turf)', 'hsl(28 90% 52%)', 'hsl(212 80% 55%)', 'hsl(285 55% 58%)', 'hsl(48 90% 42%)'];
const MAX = 5;

interface Row { id: string; name: string; color: string; vals: Record<Key, number | null>; hex: RatingCard['hex'] }

/**
 * Confronto tra giocatori: esagoni sovrapposti e valori per ruolo.
 * Due giocatori: uno di fronte all'altro, con le barre. Di più: una colonna per giocatore finché
 * c'è spazio, altrimenti una tabella con i ruoli in alto e i giocatori sulle righe.
 * Con [fixed] il primo giocatore è fisso (la scheda del giocatore che si sta guardando).
 */
@Component({
  selector: 'app-compare',
  imports: [HexChart, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="who" aria-label="Giocatori a confronto">
      @for (r of rows(); track r.id) {
        <li class="chip-p"><i class="dot" [style.background]="r.color"></i><span class="nm">{{ r.name }}</span>
          @if (r.id !== fixed()) {
            <button type="button" class="rm" [attr.aria-label]="'Togli ' + r.name" (click)="remove(r.id)"><app-icon name="x" [size]="14" /></button>
          }
        </li>
      }
    </ul>
    @if (ids().length < max) {
      <label class="add"><app-icon name="plus" [size]="18" />
        <select class="input" (change)="add($any($event.target).value); $any($event.target).value = ''" aria-label="Aggiungi un giocatore al confronto">
          <option value="">{{ ids().length ? 'Aggiungi un giocatore…' : 'Scegli un giocatore…' }}</option>
          @for (m of members(); track m.id) { @if (!ids().includes(m.id)) { <option [value]="m.id">{{ session.name(m.id) }}</option> } }
        </select>
      </label>
    }

    @if (rows().length > 1) {
      @if (series().length) { <div class="hex"><app-hex-chart [series]="series()" [size]="230" /></div> }

      @switch (layout()) {
        @case ('duel') {
          @let a = rows()[0]; @let b = rows()[1];
          <table class="duel">
            <caption class="sr-only">{{ a.name }} contro {{ b.name }}, valori per ruolo</caption>
            <thead><tr>
              <th scope="col" class="l"><i class="dot" [style.background]="a.color"></i>{{ a.name }}</th>
              <th scope="col"><span class="sr-only">Ruolo</span></th>
              <th scope="col" class="r">{{ b.name }}<i class="dot" [style.background]="b.color"></i></th>
            </tr></thead>
            <tbody>
              @for (k of keys; track k.key) {
                @let va = a.vals[k.key]; @let vb = b.vals[k.key];
                <tr [class.total]="k.key === 'ovr'">
                  <td class="l"><div class="c"><span class="bar"><i [style.width.%]="bar(va)" [style.background]="a.color"></i></span>
                    <strong class="num" [class.win]="(va ?? -1) > (vb ?? -1)">{{ va ?? '–' }}</strong></div></td>
                  <th scope="row" [attr.aria-label]="k.label">{{ k.short }}</th>
                  <td class="r"><div class="c"><strong class="num" [class.win]="(vb ?? -1) > (va ?? -1)">{{ vb ?? '–' }}</strong>
                    <span class="bar"><i [style.width.%]="bar(vb)" [style.background]="b.color"></i></span></div></td>
                </tr>
              }
            </tbody>
          </table>
        }
        @case ('cols') {
          <table class="mx cols">
            <caption class="sr-only">Valori per ruolo, un giocatore per colonna</caption>
            <thead><tr><th scope="col"><span class="sr-only">Ruolo</span></th>
              @for (r of rows(); track r.id) { <th scope="col"><i class="dot" [style.background]="r.color"></i><span class="nm">{{ r.name }}</span></th> }
            </tr></thead>
            <tbody>
              @for (k of keys; track k.key) {
                <tr [class.total]="k.key === 'ovr'"><th scope="row" [attr.aria-label]="k.label">{{ k.short }}</th>
                  @for (r of rows(); track r.id) { <td class="num"><span class="v" [class.win]="best()[k.key] === r.vals[k.key] && r.vals[k.key] !== null">{{ r.vals[k.key] ?? '–' }}</span></td> }
                </tr>
              }
            </tbody>
          </table>
        }
        @default {
          <table class="mx grid">
            <caption class="sr-only">Valori per ruolo, un giocatore per riga</caption>
            <thead><tr><th scope="col"><span class="sr-only">Giocatore</span></th>
              @for (k of keys; track k.key) { <th scope="col" [attr.aria-label]="k.label" [class.total]="k.key === 'ovr'">{{ k.short }}</th> }
            </tr></thead>
            <tbody>
              @for (r of rows(); track r.id) {
                <tr><th scope="row"><i class="dot" [style.background]="r.color"></i><span class="nm">{{ r.name }}</span></th>
                  @for (k of keys; track k.key) { <td class="num" [class.total]="k.key === 'ovr'"><span class="v" [class.win]="best()[k.key] === r.vals[k.key] && r.vals[k.key] !== null">{{ r.vals[k.key] ?? '–' }}</span></td> }
                </tr>
              }
            </tbody>
          </table>
        }
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .who { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .chip-p { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 4px 0 10px; border-radius: 999px; background: var(--surface-2);
              font: 600 var(--step--1)/1 var(--font-body); color: var(--ink); max-width: 100%; }
    .chip-p:not(:has(.rm)) { padding-right: 12px; }
    .chip-p .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rm { width: 32px; height: 32px; border: 0; border-radius: 50%; background: none; color: var(--muted); display: grid; place-items: center; cursor: pointer; flex: none; }
    .dot { width: 10px; height: 10px; border-radius: 3px; flex: none; display: inline-block; }
    .add { display: flex; align-items: center; gap: 8px; color: var(--turf); } .add select { flex: 1; }
    .hex { display: grid; place-items: center; }
    .num { font-variant-numeric: tabular-nums; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    caption { caption-side: top; }
    /* uno contro uno: valori ai lati, ruolo al centro, barre che crescono verso l'esterno */
    .duel thead th { font: 700 var(--step--1)/1.2 var(--font-body); color: var(--ink); padding: 0 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .duel thead th.l { text-align: left; } .duel thead th.r { text-align: right; }
    .duel thead .dot { margin: 0 6px; vertical-align: 0; }
    .duel th[scope='row'] { width: 52px; text-align: center; font: 700 var(--step--1)/1 var(--font-body); color: var(--muted); }
    .duel thead th:nth-child(2) { width: 52px; }
    .duel td { padding: 5px 0; }
    .duel .c { display: flex; align-items: center; gap: 8px; }
    .duel .bar { flex: 1; height: 8px; border-radius: 4px; background: var(--surface-2); display: flex; overflow: hidden; }
    .duel td.l .bar { justify-content: flex-end; }
    .duel .bar i { display: block; height: 100%; border-radius: 4px; }
    .duel strong { width: 2.2em; text-align: center; font-size: 1.05rem; color: var(--muted); font-weight: 700; }
    .duel strong.win { color: var(--ink); font-weight: 800; }
    .duel tr.total td, .duel tr.total th { border-top: 1px solid var(--line); padding-top: 9px; }
    .duel tr.total strong { font-size: 1.2rem; }
    /* tabelle: il migliore di ogni ruolo è evidenziato */
    .mx { font-size: var(--step--1); }
    .mx th, .mx td { padding: 8px 4px; border-bottom: 1px solid var(--line); }
    .mx thead th { color: var(--muted); font-weight: 600; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mx td { text-align: center; color: var(--muted); font-weight: 600; font-size: 1rem; }
    .mx .v { display: inline-block; min-width: 2.4em; padding: 4px 0; border-radius: 999px; }
    .mx .v.win { color: var(--ink); font-weight: 800; background: var(--turf-soft); }
    .mx tbody tr:last-child th, .mx tbody tr:last-child td { border-bottom: 0; }
    .mx .dot { margin-right: 6px; }
    .cols thead th:first-child, .cols tbody th { width: 46px; text-align: left; color: var(--muted); font-weight: 700; }
    .cols thead th { color: var(--ink); }
    .cols tr.total th, .cols tr.total td { border-top: 1px solid var(--line); }
    .grid thead th:first-child { width: 34%; }
    .grid tbody th { text-align: left; font-weight: 700; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .grid .total { border-left: 1px solid var(--line); }
  `,
})
export class Compare implements OnDestroy {
  protected readonly session = inject(Session);
  private readonly ratings = inject(Ratings);
  private readonly host = inject(ElementRef<HTMLElement>);
  /** giocatore fisso (primo, non si toglie): la scheda che si sta guardando */
  readonly fixed = input<string | null>(null);
  protected readonly max = MAX;
  protected readonly keys = ROWS;
  readonly ids = signal<string[]>([]);
  private readonly width = signal(360);
  private readonly ro = new ResizeObserver(([e]) => this.width.set(e.contentRect.width));

  constructor() {
    this.ro.observe(this.host.nativeElement);
    // i giocatori scelti stanno nell'indirizzo (?con=…): «Indietro» ritrova lo stesso confronto
    effect(() => {
      const f = this.fixed();
      const saved = (new URLSearchParams(location.search).get('con') ?? '').split(',').filter(Boolean);
      untracked(() => this.ids.set([...new Set([...(f ? [f] : []), ...saved])].slice(0, MAX)));
    });
    // le schede di tutti servono per scegliere chi aggiungere
    void this.ratings.load(this.session.members().map((m) => m.id)).catch(() => undefined);
  }
  ngOnDestroy(): void { this.ro.disconnect(); }

  protected readonly members = computed(() => [...this.session.members()].filter((m) => this.ratings.cards().get(m.id)?.has)
    .sort((a, b) => this.session.name(a.id).localeCompare(this.session.name(b.id), 'it')));

  protected readonly rows = computed<Row[]>(() => this.ids().map((id, i) => {
    const c = this.ratings.cards().get(id);
    return { id, name: this.session.name(id), color: COLORS[i % COLORS.length], hex: c?.hex,
      vals: { dc: c?.dc ?? null, ed: c?.ed ?? null, eo: c?.eo ?? null, pu: c?.pu ?? null, ovr: overallOf(c) } };
  }));
  protected readonly series = computed<HexSeries[]>(() => this.rows().filter((r) => r.hex).map((r) => ({ hex: r.hex!, color: r.color, name: r.name })));
  protected readonly best = computed(() => {
    const out = {} as Record<Key, number | null>;
    for (const k of ROWS) {
      const v = this.rows().map((r) => r.vals[k.key]).filter((x): x is number => x !== null);
      out[k.key] = v.length ? Math.max(...v) : null;
    }
    return out;
  });
  /** due: uno di fronte all'altro; di più: colonne finché ognuna ha almeno 64 px, poi la tabella con i ruoli in alto */
  protected readonly layout = computed(() => {
    const n = this.rows().length;
    if (n === 2) return 'duel';
    return (this.width() - 46) / n >= 64 ? 'cols' : 'grid';
  });

  /** barre da 40 a 100: i valori stanno quasi tutti tra 60 e 90, così le differenze si vedono */
  protected bar(v: number | null): number { return v === null ? 0 : Math.max(4, Math.min(100, ((v - 40) / 60) * 100)); }

  add(id: string): void { if (id && !this.ids().includes(id)) { this.ids.update((l) => [...l, id].slice(0, MAX)); this.saveUrl(); } }
  remove(id: string): void { this.ids.update((l) => l.filter((x) => x !== id)); this.saveUrl(); }
  private readonly router = inject(Router);
  private saveUrl(): void {
    const others = this.ids().filter((x) => x !== this.fixed());
    void this.router.navigate([], { replaceUrl: true, queryParamsHandling: 'merge', queryParams: { con: others.length ? others.join(',') : null } });
  }
}
