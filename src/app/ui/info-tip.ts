import { ChangeDetectionStrategy, Component, ElementRef, inject, input, signal } from '@angular/core';
import { Icon } from './icon';

/**
 * Pulsante «i» con una finestrella di spiegazioni (come accanto a «Sei titolare»): una frase per riga,
 * al posto dei sottotitoli fissi. Funziona anche dentro un <summary> senza aprire o chiudere la tendina.
 */
@Component({
  selector: 'app-info-tip',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="info-i" [attr.aria-label]="label()" [attr.aria-expanded]="open()" (click)="toggle($event)">
      <app-icon name="info" [size]="size()" />
    </button>
    @if (open()) {
      <div class="pop-shield" aria-hidden="true" (click)="close($event)"></div>
      <div class="info-pop panel" role="note" [class.right]="right()" (click)="$event.preventDefault(); $event.stopPropagation()">
        <ul>@for (l of lines(); track $index) { <li>{{ l }}</li> }</ul>
      </div>
    }
  `,
  styles: `
    :host { position: relative; display: inline-flex; flex: none; vertical-align: middle; }
    .info-i { width: 32px; height: 32px; flex: none; border: 0; border-radius: 50%; background: none; color: var(--muted); display: grid; place-items: center; cursor: pointer; padding: 0; }
    /* area di tocco di 44 px */
    .info-i { position: relative; } .info-i::after { content: ''; position: absolute; inset: -6px; }
    .info-i[aria-expanded='true'] { color: var(--turf); background: var(--turf-soft); }
    .pop-shield { position: fixed; inset: 0; z-index: 5; cursor: default; }
    .info-pop { position: absolute; left: -8px; top: calc(100% + 4px); z-index: 6; width: min(300px, 84vw); padding: 12px 14px; text-align: left;
                font: 400 var(--step--1)/1.4 var(--font-body); text-transform: none; letter-spacing: normal; color: var(--ink); cursor: default;
                box-shadow: 0 12px 30px rgb(0 0 0 / 22%); }
    .info-pop.right { left: auto; right: -8px; }
    .info-pop ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; }
  `,
})
export class InfoTip {
  /** le frasi della spiegazione, una per riga */
  readonly lines = input.required<string[]>();
  readonly label = input('Spiegazione');
  readonly size = input(18);
  protected readonly open = signal(false);
  protected readonly right = signal(false);
  private readonly host = inject(ElementRef).nativeElement as HTMLElement;

  protected toggle(e: Event): void {
    // dentro un <summary> il tocco non deve aprire o chiudere la tendina
    e.preventDefault();
    e.stopPropagation();
    if (!this.open()) {
      const r = this.host.getBoundingClientRect();
      this.right.set(r.left + r.width / 2 > window.innerWidth / 2);
    }
    this.open.update((v) => !v);
  }

  protected close(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    this.open.set(false);
  }
}
