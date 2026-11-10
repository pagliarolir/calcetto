import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { overallOf, Ratings } from '../core/ratings';
import { RouterLink } from '@angular/router';
import { Session } from '../core/session';
import { Avatar } from './avatar';

/**
 * Un giocatore nel tabellone, come una figurina: foto (o sigla) nel cerchio, il numero del posto
 * agganciato come un distintivo e la fascia da capitano per il Leader.
 */
@Component({
  selector: 'app-figurina',
  imports: [Avatar, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'figurina',
    '[class.me]': 'mine()',
    '[class.reserve]': "variant() === 'reserve'",
    '[class.empty]': "variant() === 'empty'",
  },
  template: `
    <span class="pic">
      @if (userId(); as id) {
        <app-avatar [userId]="id" [size]="40" />
      } @else {
        <span class="hole" aria-hidden="true"></span>
      }
      @if (number() !== null) { <span class="num" [attr.aria-label]="'numero ' + number()">{{ number() }}</span> }
      @if (captain()) { <span class="armband" title="Capitano" aria-label="Capitano">C</span> }
    </span>
    <span class="txt">
      @if (userId(); as id) {
        <a class="name ellipsis" [routerLink]="['/giocatore', id]">{{ session.name(id) }}</a>
      } @else {
        <span class="name muted">{{ emptyLabel() }}</span>
      }
      @if (note(); as n) { <span class="sub" [class.turf]="noteTone() === 'turf'">{{ n }}</span> }
    </span>
    @if (form(); as f) {
      <span class="frm" [class.eq]="f.state === 'equal'" [style.background]="f.color || null" role="img" [attr.aria-label]="f.label" [title]="f.label">
        @if (f.state === 'equal') { = } @else {
          <svg viewBox="0 0 24 24" aria-hidden="true" [style.transform]="'rotate(' + f.rot + 'deg)'"><path d="M5 12h12M12 6l6 6-6 6" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
        }
      </span>
    }
    @if (overall(); as o) {
      <span class="ovr" [style.--h]="hue()" [attr.aria-label]="'valutazione ' + o" [title]="'Valutazione ' + o">{{ o }}</span>
    }
  `,
  styles: `
    :host {
      display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 60px;
      padding: 8px 8px 8px 6px; border-radius: 16px;
      background: var(--surface); border: 1px solid var(--line);
    }
    :host(.me) { border-color: var(--turf); box-shadow: inset 0 0 0 1px var(--turf); background: linear-gradient(var(--turf-soft), var(--turf-soft)) padding-box; }
    :host(.empty) { background: transparent; border-style: dashed; }
    .pic { position: relative; flex: none; width: 40px; height: 40px; }
    .pic app-avatar { box-shadow: 0 0 0 2px var(--surface); }
    .hole { display: block; width: 40px; height: 40px; border-radius: 50%; border: 2px dashed var(--line); }
    /* il numero del posto, agganciato alla foto come quello sulla maglia */
    .num {
      position: absolute; right: -6px; bottom: -4px; min-width: 22px; height: 22px; padding: 0 5px;
      display: grid; place-items: center; border-radius: 11px;
      background: var(--ink); color: var(--surface); box-shadow: 0 0 0 2px var(--surface);
      font: 700 0.8rem/1 var(--font-display); letter-spacing: 0.02em;
    }
    :host(.reserve) .num { background: var(--muted); }
    :host(.empty) .num { background: var(--surface-2); color: var(--muted); box-shadow: none; }
    :host(.me) .num { background: var(--turf); color: var(--turf-ink); box-shadow: 0 0 0 2px var(--turf-soft); }
    /* la fascia da capitano */
    .armband {
      position: absolute; left: -7px; top: -5px; height: 18px; padding: 0 5px; border-radius: 4px;
      display: grid; place-items: center; transform: rotate(-12deg);
      background: var(--armband); color: var(--armband-ink); box-shadow: 0 0 0 2px var(--surface);
      font: 800 0.72rem/1 var(--font-display);
    }
    .txt { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
    .name { font-weight: 700; color: inherit; text-decoration: none; font-size: var(--step-0); }
    .sub { font-size: 0.75rem; color: var(--muted); }
    /* valutazione generale: cerchio pieno dal rosso (50 o meno) al verde intenso (85 o più), testo bianco */
    .frm { margin-left: auto; flex: none; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; color: #fff; }
    .frm svg { width: 15px; height: 15px; }
    .frm.eq { background: var(--surface-2); color: var(--muted); font: 800 1rem/1 var(--font-body); padding-bottom: 1px; }
    .frm + .ovr { margin-left: 4px; }
    .ovr { margin-left: auto; flex: none; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center;
           font: 800 0.85rem/1 var(--font-display); color: #fff; background: hsl(var(--h) 72% 38%); box-shadow: 0 2px 6px hsl(var(--h) 70% 30% / 35%); }
    .nrow { display: flex; align-items: center; gap: 3px; min-width: 0; }
    /* stato di forma (ultime due giornate): freccia da ↑ a ↓; «=» se l'ultima è pareggiata o non giocata */
    .form { width: 15px; height: 15px; flex: none; transition: transform 200ms; }
    .form.idle { display: grid; place-items: center; border-radius: 50%; background: var(--surface-2); color: var(--muted); font: 800 0.72rem/1 var(--font-body); }
    .sub.turf { color: var(--turf); font-weight: 600; }
  `,
})
export class Figurina {
  protected readonly session = inject(Session);
  readonly userId = input<string | null>(null);
  readonly number = input<number | null>(null);
  readonly captain = input(false);
  readonly mine = input(false);
  readonly variant = input<'team' | 'reserve' | 'empty' | 'free'>('team');
  readonly note = input<string | null>(null);
  readonly noteTone = input<'muted' | 'turf'>('muted');
  readonly emptyLabel = input('Posto libero');

  private readonly ratings = inject(Ratings);
  /** ruolo semplificato sotto il nome (se la pagina non passa una scritta); se non è nel profilo, quello dedotto dai valori */
  protected readonly role = computed(() => {
    const id = this.userId();
    // ruolo del profilo; se non è indicato, quello dedotto dai valori (il ruolo in cui rende meglio)
    const r = id ? this.session.members().find((m) => m.id === id)?.field_role ?? this.ratings.cards().get(id)?.best ?? null : null;
    return r ? ({ difensore_centrale: 'Difensore', esterno_difensivo: 'Esterno', esterno_offensivo: 'Esterno', punta: 'Punta' } as Record<string, string>)[r] ?? null : null;
  });
  protected readonly overall = computed(() => {
    const id = this.userId();
    return id ? overallOf(this.ratings.cards().get(id)) : null;
  });
  protected readonly hue = computed(() => 130 * Math.max(0, Math.min(1, ((this.overall() ?? 50) - 50) / 35)));
  /** stato di forma: freccia ruotata (da ↑ a ↓) e colore dal verde al rosso */
  protected readonly form = computed(() => {
    const id = this.userId();
    const f = id ? this.ratings.cards().get(id)?.form : undefined;
    if (!f) return null;
    const M: Record<string, { rot: number; color: string; label: string }> = {
      up: { rot: -90, color: 'hsl(130 65% 36%)', label: 'Forma: due vittorie di fila' },
      upright: { rot: -45, color: 'hsl(95 60% 38%)', label: 'Forma: ha vinto l\'ultima' },
      equal: { rot: 0, color: '', label: 'Forma: ultima pareggiata o non giocata' },
      downright: { rot: 45, color: 'hsl(25 85% 45%)', label: 'Forma: ha perso l\'ultima' },
      down: { rot: 90, color: 'hsl(0 70% 45%)', label: 'Forma: due sconfitte di fila' },
    };
    return M[f] ? { state: f, ...M[f] } : null;
  });

  constructor() {
    effect(() => { const id = this.userId(); if (id && this.variant() !== 'empty') this.ratings.request(id); });
  }
}
