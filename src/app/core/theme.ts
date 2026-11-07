import { effect, Injectable, signal } from '@angular/core';

export type ThemeChoice = 'auto' | 'gesso' | 'notturno' | 'figurina' | 'contrasto';
export type ThemeName = Exclude<ThemeChoice, 'auto'>;

/** colore della barra del telefono per ogni tema (come l'intestazione) */
const BAR: Record<ThemeName, string> = { gesso: '#1B6A43', notturno: '#0F1A14', figurina: '#C81E36', contrasto: '#000000' };
const KEY = 'gdl-theme';

/**
 * Tema dell'app: lo sceglie ognuno nel Profilo → Aspetto e resta su questo dispositivo.
 * «Automatico» = Gesso di giorno, Notturno quando il telefono è in modalità scura (e cambia da solo).
 * index.html applica già il tema prima dell'avvio, così non c'è il lampo del tema sbagliato.
 */
@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly dark = window.matchMedia?.('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(!!this.dark?.matches);
  readonly choice = signal<ThemeChoice>(Theme.read());

  constructor() {
    this.dark?.addEventListener?.('change', (e) => this.systemDark.set(e.matches));
    effect(() => {
      const t = this.resolved();
      document.documentElement.setAttribute('data-theme', t);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[t]);
    });
  }

  resolved(): ThemeName {
    const c = this.choice();
    return c === 'auto' ? (this.systemDark() ? 'notturno' : 'gesso') : c;
  }

  set(c: ThemeChoice): void {
    this.choice.set(c);
    try { localStorage.setItem(KEY, c); } catch { /* memoria non disponibile: vale per questa sessione */ }
  }

  private static read(): ThemeChoice {
    try {
      const v = localStorage.getItem(KEY) as ThemeChoice | null;
      return v && ['auto', 'gesso', 'notturno', 'figurina', 'contrasto'].includes(v) ? v : 'auto';
    } catch {
      return 'auto';
    }
  }
}
