import { computed, effect, Injectable, signal } from '@angular/core';
import { CustomTheme, deriveTheme, PALETTE, paletteVars, THEME_SPECS } from './color';

export type ThemeChoice = 'auto' | 'gesso' | 'notturno' | 'figurina' | 'azzurro' | 'tramonto' | 'rilievo' | 'rientranza' | 'contrasto' | 'custom';
export type ThemeName = Exclude<ThemeChoice, 'auto'>;
/** base chiara o scura dei temi neumorphism (Rilievo e Rientranza) */
export type NeuBase = 'light' | 'dark';
const CHOICES: ThemeChoice[] = ['auto', 'gesso', 'notturno', 'figurina', 'azzurro', 'tramonto', 'rilievo', 'rientranza', 'contrasto', 'custom'];
export const isNeu = (t: string): t is 'rilievo' | 'rientranza' => t === 'rilievo' || t === 'rientranza';
/** temi a cui si può cambiare il colore principale con le tavolozze pronte */
export const hasPalette = (c: ThemeChoice): boolean => c !== 'contrasto' && c !== 'custom';

/** colore della barra del telefono per ogni tema (come l'intestazione); «:dark» = variante scura dei neumorphism */
const BAR: Record<string, string> = {
  gesso: '#1B6A43', notturno: '#0F1A14', figurina: '#C81E36', azzurro: '#0B4EA2', tramonto: '#1E1219', contrasto: '#000000',
  rilievo: '#1B6A43', 'rilievo:dark': '#1C2026', rientranza: '#1B6A43', 'rientranza:dark': '#1C2026',
};
const KEY_NEU = 'gdl-neu';                  // base chiara o scura dei temi neumorphism
const KEY_PAL = 'gdl-palette';              // colore della tavolozza scelto per ogni tema ('' = originale)
const KEY_PAL_VARS = 'gdl-palette-vars';    // i colori calcolati del tema scelto, che boot.js applica prima dell'avvio
const KEY = 'gdl-theme';
const KEY_CUSTOM = 'gdl-custom';            // le scelte (base, principale, secondario)
const KEY_VARS = 'gdl-custom-vars';         // i colori calcolati, che index.html applica prima dell'avvio
const DEFAULT_CUSTOM: CustomTheme = { base: 'light', primary: '#1D4ED8', accent: 'auto' };
const KEY_TEXT = 'gdl-text';               // dimensione (85-130) e spaziatura (0-100) del testo

/**
 * Tema dell'app: lo sceglie ognuno nel Profilo → Aspetto e resta su questo dispositivo.
 * «Automatico» = Gesso di giorno, Notturno quando il telefono è in modalità scura (e cambia da solo).
 * «Personalizzato» = colori ricavati dal principale e dal secondario scelti (core/color.ts, contrasti garantiti).
 * Rilievo e Rientranza = neumorphism, con base chiara o scura (data-base su <html>).
 * Tavolozze: negli altri temi (tranne Alto contrasto) si cambia il colore principale; i colori calcolati
 * si salvano per ogni variante del tema in gdl-palette-vars, che boot.js applica prima dell'avvio.
 * index.html applica già il tema prima dell'avvio, così non c'è il lampo del tema sbagliato.
 */
@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly dark = window.matchMedia?.('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(!!this.dark?.matches);
  readonly choice = signal<ThemeChoice>(Theme.read());
  readonly custom = signal<CustomTheme>(Theme.readCustom());
  /** base dei temi neumorphism */
  readonly neuBase = signal<NeuBase>(Theme.readNeu());
  /** tavolozza scelta per ogni tema: colore principale, assente = colori originali del tema */
  readonly palettes = signal<Partial<Record<ThemeChoice, string>>>(Theme.readPalettes());
  /** colore della tavolozza del tema scelto (null = originale) */
  readonly palette = computed(() => this.palettes()[this.choice()] ?? null);
  /** colori calcolati del tema personalizzato e i contrasti ottenuti */
  readonly derived = computed(() => deriveTheme(this.custom()));
  /** variabili scritte su <html>: all'inizio anche quelle che boot.js può aver messo per la tavolozza */
  private applied: string[] = ['--turf', '--turf-ink', '--turf-soft', '--focus', '--hero-bg', '--hero-ink', '--bar'];
  /** testo: dimensione in percentuale (85-130) e spaziatura (0 = normale, 100 = valori WCAG 1.4.12) */
  private readonly savedScale = signal<number | null>(null);
  /** dimensione scelta nel Profilo (100 = normale); «Automatico» riduce comunque tutto del 10% (data-auto) */
  readonly textScale = computed(() => this.savedScale() ?? 100);
  readonly textSpacing = signal(0);

  constructor() {
    try {
      const t = JSON.parse(localStorage.getItem(KEY_TEXT) ?? 'null') as { scale?: number; spacing?: number } | null;
      if (t?.scale) this.savedScale.set(Math.min(130, Math.max(85, t.scale)));
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
      const key = this.variant(t);
      const pal = this.palette();
      if (t === 'custom') {
        const d = this.derived();
        for (const [k, v] of Object.entries(d.vars)) { root.style.setProperty(k, v); this.applied.push(k); }
        bar = this.custom().base === 'dark' ? d.vars['--bg'] : d.vars['--turf'];
      } else if (pal && THEME_SPECS[key]) {
        const p = paletteVars(THEME_SPECS[key], pal);
        for (const [k, v] of Object.entries(p.vars)) { root.style.setProperty(k, v); this.applied.push(k); }
        bar = p.bar;
      } else {
        bar = BAR[key];
      }
      root.setAttribute('data-theme', t);
      if (isNeu(t)) root.setAttribute('data-base', this.neuBase()); else root.removeAttribute('data-base');
      root.toggleAttribute('data-auto', this.choice() === 'auto');
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bar);
    });
  }

  /** chiave del tema applicato in THEME_SPECS e BAR («rilievo:dark» per la variante scura) */
  variant(t: ThemeName = this.resolved()): string {
    return isNeu(t) && this.neuBase() === 'dark' ? `${t}:dark` : t;
  }

  /** varianti di un tema scelto: Automatico = Gesso e Notturno, Rilievo/Rientranza = chiaro e scuro */
  static variants(c: ThemeChoice): string[] {
    if (c === 'auto') return ['gesso', 'notturno'];
    if (isNeu(c)) return [c, `${c}:dark`];
    return [c];
  }

  /** colore principale e intestazione di un tema con una tavolozza (per le anteprime nel Profilo) */
  preview(c: ThemeChoice): { primary: string; hero: string } | null {
    const hex = this.palettes()[c];
    if (!hex) return null;
    const key = c === 'auto' ? (this.systemDark() ? 'notturno' : 'gesso') : isNeu(c) ? (this.neuBase() === 'dark' ? `${c}:dark` : c) : c;
    const spec = THEME_SPECS[key];
    if (!spec) return null;
    const v = paletteVars(spec, hex).vars;
    return { primary: v['--turf'], hero: v['--hero-bg'] };
  }

  /** tavolozza del tema scelto: hex del colore principale oppure null per i colori originali */
  setPalette(hex: string | null): void {
    const c = this.choice();
    if (!hasPalette(c)) return;
    this.palettes.update((p) => { const n = { ...p }; if (hex) n[c] = hex.toUpperCase(); else delete n[c]; return n; });
    this.save(KEY_PAL, JSON.stringify(this.palettes()));
    this.savePaletteVars();
  }

  setNeuBase(b: NeuBase): void {
    this.neuBase.set(b);
    this.save(KEY_NEU, b);
  }

  /** salva i colori calcolati di tutte le varianti del tema scelto: boot.js li applica prima dell'avvio */
  private savePaletteVars(): void {
    const c = this.choice();
    const hex = this.palettes()[c];
    const out: Record<string, Record<string, string>> = {};
    if (hex) for (const k of Theme.variants(c)) {
      const spec = THEME_SPECS[k];
      if (spec) { const p = paletteVars(spec, hex); out[k] = { ...p.vars, '--bar': p.bar }; }
    }
    this.save(KEY_PAL_VARS, JSON.stringify(out));
  }

  resolved(): ThemeName {
    const c = this.choice();
    return c === 'auto' ? (this.systemDark() ? 'notturno' : 'gesso') : c;
  }

  set(c: ThemeChoice): void {
    this.choice.set(c);
    this.save(KEY, c);
    if (c === 'custom') this.saveCustom();
    this.savePaletteVars();
  }

  setText(scale: number, spacing: number): void {
    this.savedScale.set(Math.min(130, Math.max(85, Math.round(scale))));
    this.textSpacing.set(Math.min(100, Math.max(0, Math.round(spacing))));
    this.save(KEY_TEXT, JSON.stringify({ scale: this.savedScale(), spacing: this.textSpacing() }));
  }

  /** «Ripristina»: torna alla dimensione e alla spaziatura normali */
  resetText(): void {
    this.savedScale.set(null);
    this.textSpacing.set(0);
    try { localStorage.removeItem(KEY_TEXT); } catch { /* niente memoria: resta per questa volta */ }
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
      return v && CHOICES.includes(v) ? v : 'auto';
    } catch {
      return 'auto';
    }
  }

  private static readNeu(): NeuBase {
    try { return localStorage.getItem(KEY_NEU) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
  }

  private static readPalettes(): Partial<Record<ThemeChoice, string>> {
    try {
      const v = JSON.parse(localStorage.getItem(KEY_PAL) ?? '{}') as Record<string, string>;
      const out: Partial<Record<ThemeChoice, string>> = {};
      for (const [k, hex] of Object.entries(v ?? {})) {
        if (CHOICES.includes(k as ThemeChoice) && hasPalette(k as ThemeChoice) && PALETTE.some((p) => p.hex === hex)) out[k as ThemeChoice] = hex;
      }
      return out;
    } catch {
      return {};
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
