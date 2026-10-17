import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { fmtDayLong, fmtTime } from '../core/format';
import { kit } from '../core/kits';
import { ConfigField, FIELD_LABEL } from '../core/match-config';
import { Match } from '../core/models';

/** Chiede a quali partite già create applicare le impostazioni appena cambiate. */
@Component({
  selector: 'app-apply-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel stack apply enter-drop" role="dialog" aria-labelledby="apply-h">
      <h2 id="apply-h">{{ title() }}</h2>
      <p class="small">Hai cambiato: <strong>{{ changedText() }}</strong>.</p>
      @if (fields().includes('players_per_team')) {
        <p class="small muted">Con un numero di giocatori diverso le liste si riassestano (le riserve salgono o gli ultimi arrivati scendono tra le riserve, con un avviso) e le squadre già fatte vanno rifatte.</p>
      }
      <label class="switch all">
        <span>Tutte ({{ matches().length }})</span>
        <input type="checkbox" [checked]="allSelected()" (change)="toggleAll()" />
      </label>
      <ul class="plain">
        @for (m of matches(); track m.id) {
          <li>
            <label class="item">
              <input type="checkbox" [checked]="selected().has(m.id)" (change)="toggle(m.id)" />
              <span class="grow">
                <span class="day">{{ day(m.starts_at) }}</span><span class="small muted"> alle {{ time(m.starts_at) }}</span><br />
                <span class="small muted">{{ m.players_per_team }} contro {{ m.players_per_team }}, {{ kitName(m.team_a_kit) }} contro {{ kitName(m.team_b_kit) }}</span>
              </span>
            </label>
          </li>
        }
      </ul>
      <div class="row-wrap">
        <button class="btn small primary" [disabled]="!selected().size || busy()" (click)="confirm.emit([...selected()])">
          Applica a {{ selected().size === 1 ? '1 partita' : selected().size + ' partite' }}
        </button>
        <button class="btn small ghost" [disabled]="busy()" (click)="cancel.emit()">{{ cancelLabel() }}</button>
      </div>
    </section>
  `,
  styles: `
    .apply { border: 2px solid var(--turf); }
    .plain { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; max-height: 320px; overflow-y: auto; }
    .item { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line); cursor: pointer; }
    .item input { width: 22px; height: 22px; accent-color: var(--turf); flex: none; }
    .day { font-weight: 600; }
    .day::first-letter { text-transform: uppercase; }
  `,
})
export class ApplyDialog {
  readonly matches = input.required<Match[]>();
  readonly fields = input.required<ConfigField[]>();
  readonly title = input('Applicare anche alle partite già create?');
  readonly cancelLabel = input('No, lascia com\'erano');
  readonly busy = input(false);
  readonly confirm = output<string[]>();
  readonly cancel = output<void>();

  protected readonly selected = signal(new Set<string>());
  protected readonly allSelected = computed(() => this.matches().length > 0 && this.selected().size === this.matches().length);
  protected readonly changedText = computed(() => this.fields().map((f) => FIELD_LABEL[f]).join(', '));
  protected readonly day = fmtDayLong;
  protected readonly time = fmtTime;

  constructor() {
    // all'apertura sono selezionate tutte
    effect(() => this.selected.set(new Set(this.matches().map((m) => m.id))));
  }

  protected kitName(key: string): string {
    return kit(key).name;
  }

  protected toggle(id: string): void {
    this.selected.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  protected toggleAll(): void {
    this.selected.set(this.allSelected() ? new Set() : new Set(this.matches().map((m) => m.id)));
  }
}
