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
 * Tavolozze pronte: ogni tema (tranne Alto contrasto e Personalizzato) mantiene fondo, superfici, caratteri e forme,
 * e cambia solo il colore principale (pulsanti, collegamenti, intestazione, fuoco). I contrasti restano garantiti:
 * principale come testo su fondo e superfici, testo sui pulsanti, testo bianco sull'intestazione.
 */
export type HeroStyle = 'linear' | 'glow' | 'dots';
export interface ThemeSpec { dark: boolean; bg: string; surface: string; surface2: string; hero: HeroStyle; heroBase?: string }
/** chiave = valore di data-theme, con «:dark» per la variante scura dei temi neumorphism */
export const THEME_SPECS: Record<string, ThemeSpec> = {
  gesso: { dark: false, bg: '#F3F5F0', surface: '#FFFFFF', surface2: '#E6ECE4', hero: 'linear' },
  notturno: { dark: true, bg: '#0A120E', surface: '#121C17', surface2: '#1B2721', hero: 'glow', heroBase: '#0F1A14' },
  figurina: { dark: false, bg: '#F5ECD7', surface: '#FFF9EC', surface2: '#EBDFC2', hero: 'dots' },
  azzurro: { dark: false, bg: '#F2F5FA', surface: '#FFFFFF', surface2: '#E3EAF5', hero: 'linear' },
  tramonto: { dark: true, bg: '#170F14', surface: '#22161D', surface2: '#2D1E27', hero: 'glow', heroBase: '#1E1219' },
  rilievo: { dark: false, bg: '#E4E9F0', surface: '#E4E9F0', surface2: '#D8DFE8', hero: 'linear' },
  'rilievo:dark': { dark: true, bg: '#252A31', surface: '#252A31', surface2: '#2C323A', hero: 'glow', heroBase: '#1C2026' },
  rientranza: { dark: false, bg: '#E4E9F0', surface: '#E4E9F0', surface2: '#D8DFE8', hero: 'linear' },
  'rientranza:dark': { dark: true, bg: '#252A31', surface: '#252A31', surface2: '#2C323A', hero: 'glow', heroBase: '#1C2026' },
};

export interface PaletteResult { vars: Record<string, string>; bar: string; checks: { label: string; ratio: number }[] }

/** colori di un tema con il principale scelto dalla tavolozza */
export function paletteVars(spec: ThemeSpec, hex: string): PaletteResult {
  const [h, s, l] = toHsl(hex);
  // sui temi scuri il principale è una versione chiara e viva del colore scelto
  let primary = spec.dark ? fromHsl([h, Math.max(s, 0.55), Math.max(l, 0.64)]) : hex.toUpperCase();
  for (const against of [spec.surface, spec.bg, spec.surface2]) primary = ensureContrast(primary, against, 4.6).hex;
  const primaryInk = spec.dark ? inkOn(primary, '#0B1210') : inkOn(primary);
  if (contrast(primaryInk, primary) < 4.6) primary = ensureContrast(primary, primaryInk, 4.6).hex;
  // fondo tenue (etichette, avvisi): il principale ci si legge sopra
  let t = spec.dark ? 0.22 : 0.14;
  let soft = mix(spec.surface, primary, t);
  while (t > 0.02 && contrast(primary, soft) < 4.5) { t -= 0.02; soft = mix(spec.surface, primary, t); }
  // intestazione: testo bianco sempre leggibile
  const [ph, ps, pl] = toHsl(primary);
  let heroBg: string, bar: string, heroMin: number;
  if (spec.hero === 'glow') {
    const base = spec.heroBase ?? spec.bg;
    let alpha = 0.3;
    while (alpha > 0 && contrast('#FFFFFF', mix(base, primary, alpha)) < 4.8) alpha -= 0.03;
    alpha = Math.max(0, alpha);
    heroBg = `radial-gradient(120% 90% at 85% -10%, ${primary}${Math.round(alpha * 255).toString(16).padStart(2, '0')} 0%, transparent 55%), ${base}`;
    bar = base; heroMin = contrast('#FFFFFF', mix(base, primary, alpha));
  } else if (spec.hero === 'dots') {
    // puntini bianchi al 18%: si parte da un colore più scuro perché il testo resti leggibile anche sopra i puntini
    const c = ensureContrast(fromHsl([h, Math.max(s, 0.5), Math.min(l, 0.45)]), '#FFFFFF', 7.2).hex;
    heroBg = `radial-gradient(circle at 1px 1px, rgb(255 255 255 / 18%) 1.2px, transparent 1.6px) 0 0 / 10px 10px, ${c}`;
    bar = c; heroMin = contrast('#FFFFFF', mix(c, '#FFFFFF', 0.18));
  } else {
    const a = ensureContrast(fromHsl([ph, ps, clamp(pl + 0.05, 0, 0.62)]), '#FFFFFF', 4.8).hex;
    const b = ensureContrast(fromHsl([ph, ps, clamp(pl - 0.1, 0.06, 1)]), '#FFFFFF', 4.8).hex;
    heroBg = `linear-gradient(160deg, ${a} 0%, ${b} 100%)`;
    bar = b; heroMin = Math.min(contrast('#FFFFFF', a), contrast('#FFFFFF', b));
  }
  const vars: Record<string, string> = {
    '--turf': primary, '--turf-ink': primaryInk, '--turf-soft': soft, '--focus': primary, '--hero-bg': heroBg, '--hero-ink': '#FFFFFF',
  };
  const checks = [
    { label: 'Collegamenti', ratio: Math.min(contrast(primary, spec.surface), contrast(primary, spec.bg), contrast(primary, spec.surface2)) },
    { label: 'Pulsanti', ratio: contrast(primaryInk, primary) },
    { label: 'Etichette', ratio: contrast(primary, soft) },
    { label: 'Intestazione', ratio: heroMin },
  ];
  return { vars, bar, checks };
}
