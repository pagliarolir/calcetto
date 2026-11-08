import { computed, effect, Injectable, signal } from '@angular/core';
import { CustomTheme, deriveTheme } from './color';

export type ThemeChoice = 'auto' | 'gesso' | 'notturno' | 'figurina' | 'contrasto' | 'custom';
export type ThemeName = Exclude<ThemeChoice, 'auto'>;

/** colore della barra del telefono per ogni tema (come l'intestazione) */
const BAR: Record<Exclude<ThemeName, 'custom'>, string> = { gesso: '#1B6A43', notturno: '#0F1A14', figurina: '#C81E36', contrasto: '#000000' };
const KEY = 'gdl-theme';
const KEY_CUSTOM = 'gdl-custom';            // le scelte (base, principale, secondario)
const KEY_VARS = 'gdl-custom-vars';         // i colori calcolati, che index.html applica prima dell'avvio
const DEFAULT_CUSTOM: CustomTheme = { base: 'light', primary: '#1D4ED8', accent: 'auto' };
const KEY_TEXT = 'gdl-text';               // dimensione (85-130) e spaziatura (0-100) del testo

/**
 * Tema dell'app: lo sceglie ognuno nel Profilo → Aspetto e resta su questo dispositivo.
 * «Automatico» = Gesso di giorno, Notturno quando il telefono è in modalità scura (e cambia da solo).
 * «Personalizzato» = colori ricavati dal principale e dal secondario scelti (core/color.ts, contrasti garantiti).
 * index.html applica già il tema prima dell'avvio, così non c'è il lampo del tema sbagliato.
 */
@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly dark = window.matchMedia?.('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(!!this.dark?.matches);
  readonly choice = signal<ThemeChoice>(Theme.read());
  readonly custom = signal<CustomTheme>(Theme.readCustom());
  /** colori calcolati del tema personalizzato e i contrasti ottenuti */
  readonly derived = computed(() => deriveTheme(this.custom()));
  private applied: string[] = [];
  /** testo: dimensione in percentuale (85-130) e spaziatura (0 = normale, 100 = valori WCAG 1.4.12) */
  readonly textScale = signal(100);
  readonly textSpacing = signal(0);

  constructor() {
    try {
      const t = JSON.parse(localStorage.getItem(KEY_TEXT) ?? 'null') as { scale?: number; spacing?: number } | null;
      if (t?.scale) this.textScale.set(Math.min(130, Math.max(85, t.scale)));
      if (t?.spacing) this.textSpacing.set(Math.min(100, Math.max(0, t.spacing)));
    } catch { /* valori predefiniti */ }
    effect(() => {
      const root = document.documentElement;
      root.style.setProperty('--text-scale', String(this.textScale() / 100));
      root.style.setProperty('--text-spacing', String(this.textSpacing() / 100));
    });
    this.dark?.addEventListener?.('change', (e) => this.systemDark.set(e.matches));
    effect(() => {
      const t = this.resolved();
      const root = document.documentElement;
      for (const k of this.applied) root.style.removeProperty(k);
      this.applied = [];
      let bar: string;
      if (t === 'custom') {
        const d = this.derived();
        for (const [k, v] of Object.entries(d.vars)) { root.style.setProperty(k, v); this.applied.push(k); }
        bar = this.custom().base === 'dark' ? d.vars['--bg'] : d.vars['--turf'];
      } else {
        bar = BAR[t];
      }
      root.setAttribute('data-theme', t);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bar);
    });
  }

  resolved(): ThemeName {
    const c = this.choice();
    return c === 'auto' ? (this.systemDark() ? 'notturno' : 'gesso') : c;
  }

  set(c: ThemeChoice): void {
    this.choice.set(c);
    this.save(KEY, c);
    if (c === 'custom') this.saveCustom();
  }

  setText(scale: number, spacing: number): void {
    this.textScale.set(Math.min(130, Math.max(85, Math.round(scale))));
    this.textSpacing.set(Math.min(100, Math.max(0, Math.round(spacing))));
    this.save(KEY_TEXT, JSON.stringify({ scale: this.textScale(), spacing: this.textSpacing() }));
  }

  setCustom(patch: Partial<CustomTheme>): void {
    this.custom.update((v) => ({ ...v, ...patch }));
    this.saveCustom();
  }

  private saveCustom(): void {
    this.save(KEY_CUSTOM, JSON.stringify(this.custom()));
    this.save(KEY_VARS, JSON.stringify(this.derived().vars));
  }

  private save(k: string, v: string): void {
    try { localStorage.setItem(k, v); } catch { /* memoria non disponibile: vale per questa sessione */ }
  }

  private static read(): ThemeChoice {
    try {
      const v = localStorage.getItem(KEY) as ThemeChoice | null;
      return v && ['auto', 'gesso', 'notturno', 'figurina', 'contrasto', 'custom'].includes(v) ? v : 'auto';
    } catch {
      return 'auto';
    }
  }

  private static readCustom(): CustomTheme {
    try {
      const v = JSON.parse(localStorage.getItem(KEY_CUSTOM) ?? 'null') as CustomTheme | null;
      return v && /^#[0-9a-f]{6}$/i.test(v.primary) ? { ...DEFAULT_CUSTOM, ...v } : DEFAULT_CUSTOM;
    } catch {
      return DEFAULT_CUSTOM;
    }
  }
}
