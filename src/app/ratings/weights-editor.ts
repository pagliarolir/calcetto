import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Ratings } from '../core/ratings';
import { errorMessage, Supabase } from '../core/supabase';
import { Toasts } from '../core/toast';

type Col = 'punta' | 'centrale' | 'est_off' | 'est_dif';
interface Row { attr: string; label: string; punta: number; centrale: number; est_off: number; est_dif: number }

/** Solo il Leader: i coefficienti dei 4 ruoli (percentuali; ogni colonna deve fare 100). */
@Component({
  selector: 'app-weights-editor',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length) {
      <div class="wrap">
        <table>
          <thead><tr><th>Caratteristica</th>@for (c of cols; track c.key) { <th>{{ c.label }}</th> }</tr></thead>
          <tbody>
            @for (r of rows(); track r.attr) {
              <tr><td>{{ r.label }}</td>
                @for (c of cols; track c.key) {
                  <td><input class="num" type="number" inputmode="decimal" min="0" max="100" step="0.1" [ngModel]="r[c.key]" (ngModelChange)="set(r.attr, c.key, $event)" [attr.aria-label]="r.label + ', ' + c.label" /></td>
                }
              </tr>
            }
          </tbody>
          <tfoot><tr><td>Totale</td>@for (c of cols; track c.key) { <td [class.ok]="okCol(c.key)" [class.ko]="!okCol(c.key)">{{ total(c.key) }}%</td> }</tr></tfoot>
        </table>
      </div>
      <button class="btn primary block" [disabled]="busy() || !allOk()" (click)="save()">{{ allOk() ? 'Salva i coefficienti' : 'Ogni colonna deve fare 100%' }}</button>
    }
  `,
  styles: `
    .wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: var(--step--1); }
    th, td { padding: 4px 3px; text-align: center; border-bottom: 1px solid var(--line); white-space: nowrap; }
    th:first-child, td:first-child { text-align: left; white-space: normal; }
    .num { width: 58px; min-height: 36px; padding: 2px 4px; text-align: center; border: 1.5px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); font: inherit; }
    tfoot td { font-weight: 800; } .ok { color: var(--turf); } .ko { color: var(--danger); }
    .btn { margin-top: 10px; }
  `,
})
export class WeightsEditor {
  private readonly sb = inject(Supabase).client;
  private readonly toasts = inject(Toasts);
  private readonly ratings = inject(Ratings);
  protected readonly cols: { key: Col; label: string }[] = [
    { key: 'punta', label: 'Punta' }, { key: 'est_off', label: 'Est. off.' }, { key: 'est_dif', label: 'Est. dif.' }, { key: 'centrale', label: 'Centrale' },
  ];
  protected readonly rows = signal<Row[]>([]);
  protected readonly busy = signal(false);
  protected readonly allOk = computed(() => this.cols.every((c) => this.okCol(c.key)));

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const r = await this.sb.from('rating_weights').select('attr, label, punta, centrale, est_off, est_dif').order('sort');
    if (r.error) { this.toasts.error(errorMessage(r.error)); return; }
    this.rows.set(((r.data ?? []) as Row[]).map((x) => ({ ...x, punta: +x.punta, centrale: +x.centrale, est_off: +x.est_off, est_dif: +x.est_dif })));
  }

  protected set(attr: string, c: Col, v: number | string | null): void {
    const n = Math.max(0, Math.min(100, Number(v) || 0));
    this.rows.update((rs) => rs.map((r) => (r.attr === attr ? { ...r, [c]: n } : r)));
  }
  protected total(c: Col): string {
    return (Math.round(this.rows().reduce((s, r) => s + r[c], 0) * 10) / 10).toString().replace('.', ',');
  }
  protected okCol(c: Col): boolean {
    return Math.abs(this.rows().reduce((s, r) => s + r[c], 0) - 100) <= 0.05;
  }

  protected async save(): Promise<void> {
    const p = Object.fromEntries(this.rows().map((r) => [r.attr, { punta: r.punta, centrale: r.centrale, est_off: r.est_off, est_dif: r.est_dif }]));
    this.busy.set(true);
    try {
      const r = await this.sb.rpc('set_rating_weights', { p });
      if (r.error) throw r.error;
      this.ratings.clear();
      this.toasts.show('Coefficienti salvati: i valori dei giocatori sono ricalcolati.');
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
