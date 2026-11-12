/**
 * Colori del tema personalizzato: dal colore principale (e dal secondario, se scelto) si ricavano tutti i
 * colori dell'app. Ogni accoppiamento di testo è controllato con la formula WCAG (testo >= 4,5:1): se un
 * colore scelto non sarebbe leggibile lo si scurisce o schiarisce il minimo indispensabile.
 */
export type Base = 'light' | 'dark';
export interface CustomTheme { base: Base; primary: string; accent: string | 'auto' }
export interface Derived { vars: Record<string, string>; adjusted: { primary: boolean; accent: boolean }; checks: { label: string; ratio: number }[] }

export const PALETTE: { name: string; hex: string }[] = [
  { name: 'Verde', hex: '#1B6A43' }, { name: 'Smeraldo', hex: '#0E8A6A' }, { name: 'Petrolio', hex: '#0F6E7A' }, { name: 'Azzurro', hex: '#1E88E5' },
  { name: 'Blu', hex: '#1D4ED8' }, { name: 'Indaco', hex: '#4338CA' }, { name: 'Viola', hex: '#7C3AED' }, { name: 'Magenta', hex: '#BE185D' },
  { name: 'Rosso', hex: '#C81E36' }, { name: 'Arancio', hex: '#EA580C' }, { name: 'Ambra', hex: '#D97706' }, { name: 'Grafite', hex: '#374151' },
];

type HSL = [number, number, number];
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '').trim();
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0) as [number, number, number];
}
export function rgbToHex([r, g, b]: number[]): string {
  return '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase();
}
export function toHsl(hex: string): HSL {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
export function fromHsl([h, s, l]: HSL): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}
export function luminance(hex: string): number {
  const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** mescola a con b (t = quota di b) */
export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
}
/** sposta la luminosità (tenendo tinta e saturazione) finché il contrasto con `against` arriva a `min` */
export function ensureContrast(hex: string, against: string, min: number): { hex: string; changed: boolean } {
  if (contrast(hex, against) >= min) return { hex, changed: false };
  const [h, s, l0] = toHsl(hex);
  const darker = luminance(against) > 0.18;   // su fondo chiaro si scurisce, su fondo scuro si schiarisce
  for (let k = 1; k <= 100; k++) {
    const l = clamp(darker ? l0 - k / 100 : l0 + k / 100);
    const c = fromHsl([h, s, l]);
    if (contrast(c, against) >= min) return { hex: c, changed: true };
  }
  return { hex: darker ? '#000000' : '#FFFFFF', changed: true };
}
/** il testo che si legge meglio su un colore pieno (bianco o quasi nero) */
function inkOn(bg: string, dark = '#0E1512'): string {
  return contrast('#FFFFFF', bg) >= contrast(dark, bg) ? '#FFFFFF' : dark;
}

/** secondario automatico: oro caldo per i colori freddi, petrolio chiaro per i colori caldi */
export function autoAccent(primary: string, base: Base): string {
  const [h] = toHsl(primary);
  const warm = h < 75 || h >= 330;
  return warm ? fromHsl([188, 0.62, base === 'dark' ? 0.58 : 0.42]) : fromHsl([44, 0.9, base === 'dark' ? 0.6 : 0.52]);
}

/** tutti i colori dell'app dal colore principale e dal secondario */
export function deriveTheme(t: CustomTheme): Derived {
  const dark = t.base === 'dark';
  const [h] = toHsl(t.primary);
  // fondo e superfici appena intonati al colore principale
  const bg = dark ? fromHsl([h, 0.22, 0.06]) : fromHsl([h, 0.16, 0.955]);
  const surface = dark ? fromHsl([h, 0.18, 0.1]) : '#FFFFFF';
  const surface2 = dark ? fromHsl([h, 0.16, 0.14]) : fromHsl([h, 0.14, 0.9]);
  const line = dark ? fromHsl([h, 0.14, 0.22]) : fromHsl([h, 0.12, 0.82]);
  const ink = dark ? fromHsl([h, 0.2, 0.93]) : fromHsl([h, 0.25, 0.1]);
  const muted = ensureContrast(dark ? fromHsl([h, 0.1, 0.68]) : fromHsl([h, 0.1, 0.35]), surface, 4.6).hex;
  // principale: leggibile come testo sulla superficie (4,5:1) e con il suo testo sopra (4,5:1)
  const p1 = ensureContrast(t.primary, surface, 4.5);
  let primary = p1.hex;
  let primaryInk = inkOn(primary);
  if (contrast(primaryInk, primary) < 4.5) { primary = ensureContrast(primary, primaryInk, 4.5).hex; }
  const primarySoft = mix(surface, primary, dark ? 0.22 : 0.14);
  // secondario (fascia da capitano, migliore in campo, sticker): pieno, con il suo testo sopra
  const accentIn = t.accent === 'auto' ? autoAccent(t.primary, t.base) : t.accent;
  let accent = accentIn;
  let accentInk = inkOn(accent, dark ? '#140F00' : '#1E1600');
  let accentChanged = false;
  if (contrast(accentInk, accent) < 4.5) { const a = ensureContrast(accent, accentInk, 4.5); accent = a.hex; accentChanged = a.changed; }
  // intestazione: sfumatura del principale con testo bianco sempre leggibile (anche sul punto più chiaro)
  const [ph, ps, pl] = toHsl(primary);
  let heroA: string, heroB: string, heroBg: string;
  if (dark) {
    heroB = fromHsl([ph, Math.min(ps, 0.5), 0.09]);
    // bagliore del colore principale: lo si attenua finché il bianco resta leggibile anche nel punto più luminoso
    let alpha = 0.27;
    while (alpha > 0 && contrast('#FFFFFF', mix(heroB, primary, alpha)) < 4.8) alpha -= 0.03;
    alpha = Math.max(0, alpha);
    heroA = mix(heroB, primary, alpha);
    heroBg = `radial-gradient(120% 90% at 85% -10%, ${primary}${Math.round(alpha * 255).toString(16).padStart(2, '0')} 0%, transparent 55%), ${heroB}`;
  } else {
    heroA = ensureContrast(fromHsl([ph, ps, clamp(pl + 0.05, 0, 0.62)]), '#FFFFFF', 4.8).hex;
    heroB = ensureContrast(fromHsl([ph, ps, clamp(pl - 0.1, 0.06, 1)]), '#FFFFFF', 4.8).hex;
    heroBg = `linear-gradient(160deg, ${heroA} 0%, ${heroB} 100%)`;
  }
  const heroInk = '#FFFFFF';
  const danger = ensureContrast(dark ? '#FF7A6E' : '#B92F27', surface, 4.5).hex;
  // testo sui pulsanti rossi: bianco sul rosso scuro, quasi nero sul rosso chiaro dei temi scuri
  const dangerInk = contrast('#FFFFFF', danger) >= contrast('#1A0805', danger) ? '#FFFFFF' : '#1A0805';
  const vars: Record<string, string> = {
    'color-scheme': dark ? 'dark' : 'light',
    '--bg': bg, '--surface': surface, '--surface-2': surface2, '--ink': ink, '--muted': muted, '--line': line,
    '--turf': primary, '--turf-ink': primaryInk, '--turf-soft': primarySoft, '--chalk': dark ? ink : '#FFFFFF',
    '--armband': accent, '--armband-ink': accentInk,
    '--kit-white': dark ? '#ECEEE9' : '#FAFAF7', '--kit-white-ink': '#13201A', '--kit-black': dark ? '#050607' : '#1A1C20', '--kit-black-ink': '#F4F4F1',
    '--danger': danger, '--danger-ink': dangerInk, '--danger-soft': mix(surface, danger, dark ? 0.2 : 0.12), '--focus': primary,
    '--backdrop': dark ? 'rgb(0 0 0 / 60%)' : 'rgb(10 20 14 / 45%)',
    '--hero-bg': heroBg, '--hero-ink': heroInk,
  };
  const checks = [
    { label: 'Testo', ratio: contrast(ink, bg) },
    { label: 'Testo secondario', ratio: contrast(muted, surface) },
    { label: 'Pulsanti', ratio: contrast(primaryInk, primary) },
    { label: 'Collegamenti', ratio: contrast(primary, surface) },
    { label: 'Secondario', ratio: contrast(accentInk, accent) },
    { label: 'Pulsanti rossi', ratio: contrast(dangerInk, danger) },
    { label: 'Intestazione', ratio: Math.min(contrast(heroInk, heroA), contrast(heroInk, heroB)) },
  ];
  return { vars, adjusted: { primary: p1.changed || primary !== p1.hex, accent: accentChanged }, checks };
}

// ================================================================ tavolozze dei temi
/**
 * Tavolozze pronte: ogni tema (tranne Alto contrasto e Personalizzato) mantiene caratteri, forme e luminosità,
 * ma prende la TINTA del colore scelto ovunque: fondo (con una leggera sfumatura verso il basso), superfici,
 * linee, testi, ombre dei temi neumorphism, intestazione e colore principale.
 * I contrasti restano garantiti: testo ≥ 7:1, testo secondario e principale ≥ 4,5:1 su fondo e superfici.
 */
export type HeroStyle = 'linear' | 'glow' | 'dots';
export type ToneKind = 'light' | 'dark' | 'figurina' | 'neu' | 'neu-dark';
export interface ThemeSpec { kind: ToneKind; hero: HeroStyle }
/** chiave = valore di data-theme, con «:dark» per la variante scura dei temi neumorphism */
export const THEME_SPECS: Record<string, ThemeSpec> = {
  gesso: { kind: 'light', hero: 'linear' },
  notturno: { kind: 'dark', hero: 'glow' },
  figurina: { kind: 'figurina', hero: 'dots' },
  azzurro: { kind: 'light', hero: 'linear' },
  tramonto: { kind: 'dark', hero: 'glow' },
  rilievo: { kind: 'neu', hero: 'linear' },
  'rilievo:dark': { kind: 'neu-dark', hero: 'glow' },
  rientranza: { kind: 'neu', hero: 'linear' },
  'rientranza:dark': { kind: 'neu-dark', hero: 'glow' },
};

/** saturazione e luminosità di ogni colore del tema (la tinta è quella scelta) */
type SL = [number, number];
const TONES: Record<ToneKind, { bg: SL; surface: SL; surface2: SL; line: SL | 'ink'; ink: SL; muted: SL; lo?: SL; hi?: SL; heroBase?: SL; grad: number }> = {
  light:      { bg: [0.42, 0.95], surface: [0.7, 0.99], surface2: [0.36, 0.9], line: [0.3, 0.82], ink: [0.35, 0.12], muted: [0.16, 0.36], grad: 0.2 },
  figurina:   { bg: [0.55, 0.9], surface: [0.75, 0.97], surface2: [0.45, 0.84], line: 'ink', ink: [0.45, 0.18], muted: [0.18, 0.32], grad: 0.18 },
  dark:       { bg: [0.32, 0.06], surface: [0.26, 0.1], surface2: [0.22, 0.14], line: [0.18, 0.24], ink: [0.25, 0.94], muted: [0.12, 0.7], heroBase: [0.38, 0.09], grad: 0.12 },
  neu:        { bg: [0.34, 0.9], surface: [0.34, 0.9], surface2: [0.3, 0.85], line: [0.25, 0.78], ink: [0.35, 0.13], muted: [0.16, 0.33], lo: [0.32, 0.7], hi: [0.7, 0.98], grad: 0.16 },
  'neu-dark': { bg: [0.22, 0.16], surface: [0.22, 0.16], surface2: [0.2, 0.19], line: [0.16, 0.27], ink: [0.2, 0.94], muted: [0.12, 0.72], lo: [0.28, 0.09], hi: [0.16, 0.24], heroBase: [0.3, 0.1], grad: 0.1 },
};

export interface PaletteResult { vars: Record<string, string>; bar: string; checks: { label: string; ratio: number }[] }

/** il colore che rispetta il contrasto `min` con TUTTI i fondi indicati */
function readableOn(hex: string, bgs: string[], min: number): string {
  let c = hex;
  for (let k = 0; k < 3; k++) for (const b of bgs) c = ensureContrast(c, b, min).hex;
  return c;
}

/** tutti i colori di un tema con la tinta e il principale scelti dalla tavolozza */
export function paletteVars(spec: ThemeSpec, hex: string): PaletteResult {
  const t = TONES[spec.kind];
  const dark = spec.kind === 'dark' || spec.kind === 'neu-dark';
  const [h, s0, l] = toHsl(hex);
  // i colori poco saturi (grafite) danno un tema quasi grigio: la saturazione non supera quella scelta (×1,6)
  const cap = Math.min(1, s0 * 1.6);
  const tone = ([s, lum]: SL) => fromHsl([h, Math.min(s, cap), lum]);
  const bg = tone(t.bg), surface = tone(t.surface), surface2 = tone(t.surface2);
  const bgEnd = mix(bg, hex, t.grad);
  const fondi = [bg, bgEnd, surface, surface2];
  const ink = readableOn(tone(t.ink), fondi, 7);
  const muted = readableOn(tone(t.muted), fondi, 4.6);
  const line = t.line === 'ink' ? ink : tone(t.line);
  // principale: sui temi scuri una versione chiara e viva del colore scelto
  let primary = dark ? fromHsl([h, Math.max(s0, 0.55), Math.max(l, 0.64)]) : hex.toUpperCase();
  primary = readableOn(primary, fondi, 4.6);
  const primaryInk = dark ? inkOn(primary, '#0B1210') : inkOn(primary);
  if (contrast(primaryInk, primary) < 4.6) primary = ensureContrast(primary, primaryInk, 4.6).hex;
  // fondo tenue (etichette, avvisi): il principale ci si legge sopra
  let k = dark ? 0.22 : 0.16;
  let soft = mix(surface, primary, k);
  while (k > 0.02 && contrast(primary, soft) < 4.5) { k -= 0.02; soft = mix(surface, primary, k); }
  // intestazione: testo bianco sempre leggibile
  const [ph, ps, pl] = toHsl(primary);
  let heroBg: string, bar: string, heroMin: number;
  if (spec.hero === 'glow') {
    const base = tone(t.heroBase ?? t.bg);
    let alpha = 0.34;
    while (alpha > 0 && contrast('#FFFFFF', mix(base, primary, alpha)) < 4.8) alpha -= 0.03;
    alpha = Math.max(0, alpha);
    heroBg = `radial-gradient(120% 90% at 85% -10%, ${primary}${Math.round(alpha * 255).toString(16).padStart(2, '0')} 0%, transparent 55%), ${base}`;
    bar = base; heroMin = contrast('#FFFFFF', mix(base, primary, alpha));
  } else if (spec.hero === 'dots') {
    // puntini bianchi al 18%: si parte da un colore più scuro perché il testo resti leggibile anche sopra i puntini
    const c = ensureContrast(fromHsl([h, Math.max(s0, 0.5), Math.min(l, 0.45)]), '#FFFFFF', 7.2).hex;
    heroBg = `radial-gradient(circle at 1px 1px, rgb(255 255 255 / 18%) 1.2px, transparent 1.6px) 0 0 / 10px 10px, ${c}`;
    bar = c; heroMin = contrast('#FFFFFF', mix(c, '#FFFFFF', 0.18));
  } else {
    // come nei temi scuri: un bagliore più chiaro del principale in alto a destra che si mescola con la base
    const a = ensureContrast(fromHsl([ph, ps, clamp(pl + 0.05, 0, 0.62)]), '#FFFFFF', 4.8).hex;
    const b = ensureContrast(fromHsl([ph, ps, clamp(pl - 0.1, 0.06, 1)]), '#FFFFFF', 4.8).hex;
    const glow = fromHsl([ph, Math.min(1, ps + 0.1), clamp(pl + 0.25, 0, 0.85)]);
    let alpha = 0.6;
    while (alpha > 0 && contrast('#FFFFFF', mix(a, glow, alpha)) < 4.8) alpha -= 0.03;
    alpha = Math.max(0, alpha);
    heroBg = `radial-gradient(120% 90% at 85% -10%, ${glow}${Math.round(alpha * 255).toString(16).padStart(2, '0')} 0%, transparent 60%), linear-gradient(160deg, ${a} 0%, ${b} 100%)`;
    bar = b; heroMin = Math.min(contrast('#FFFFFF', mix(a, glow, alpha)), contrast('#FFFFFF', b));
  }
  const vars: Record<string, string> = {
    '--bg': bg, '--surface': surface, '--surface-2': surface2, '--ink': ink, '--muted': muted, '--line': line,
    // il fondo si colora un po' di più verso il basso (in alto resta uguale: le parti fisse non stonano)
    '--bg-grad': `linear-gradient(180deg, ${bg} 0%, ${bg} 30%, ${bgEnd} 100%)`,
    '--turf': primary, '--turf-ink': primaryInk, '--turf-soft': soft, '--focus': primary, '--hero-bg': heroBg, '--hero-ink': '#FFFFFF',
  };
  // rosso degli avvisi: leggibile anche sui fondi colorati
  const danger = readableOn(dark ? '#FF7A6E' : '#B92F27', fondi, 4.6);
  vars['--danger'] = danger;
  vars['--danger-ink'] = contrast('#FFFFFF', danger) >= contrast('#1A0805', danger) ? '#FFFFFF' : '#1A0805';
  let kd = dark ? 0.2 : 0.12;
  let dsoft = mix(surface, danger, kd);
  while (kd > 0.02 && contrast(danger, dsoft) < 4.5) { kd -= 0.02; dsoft = mix(surface, danger, kd); }
  vars['--danger-soft'] = dsoft;
  if (t.lo && t.hi) { vars['--neu-lo'] = tone(t.lo); vars['--neu-hi'] = tone(t.hi); }
  const minOn = (c: string) => Math.min(...fondi.map((f) => contrast(c, f)));
  const checks = [
    { label: 'Testo', ratio: minOn(ink) },
    { label: 'Testo secondario', ratio: minOn(muted) },
    { label: 'Collegamenti', ratio: minOn(primary) },
    { label: 'Pulsanti', ratio: contrast(primaryInk, primary) },
    { label: 'Etichette', ratio: contrast(primary, soft) },
    { label: 'Intestazione', ratio: heroMin },
    { label: 'Avvisi', ratio: Math.min(minOn(danger), contrast(danger, dsoft), contrast(vars['--danger-ink'], danger)) },
  ];
  return { vars, bar, checks };
}

/** variabili che una tavolozza può scrivere su <html> (per toglierle cambiando tema) */
export const PALETTE_KEYS = ['--bg', '--surface', '--surface-2', '--ink', '--muted', '--line', '--bg-grad', '--turf', '--turf-ink', '--turf-soft',
  '--focus', '--hero-bg', '--hero-ink', '--neu-lo', '--neu-hi', '--danger', '--danger-ink', '--danger-soft', '--bar'];
