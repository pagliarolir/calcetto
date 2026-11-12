// Verifica il tema personalizzato e le tavolozze pronte dei temi: per ogni colore della tavolozza (principale e secondario), su base chiara e
// scura, e per 2000 colori casuali, tutti gli accoppiamenti di testo devono rispettare i contrasti WCAG.
// Uso: node scripts/check-colors.mjs   (esce con errore se qualcosa non è a norma)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const src = readFileSync(new URL('../src/app/core/color.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
const m = {}; new Function('exports', js)(m);
const need = { 'Testo': 7, 'Testo secondario': 4.5, 'Pulsanti': 4.5, 'Collegamenti': 4.5, 'Secondario': 4.5, 'Intestazione': 4.5, 'Pulsanti rossi': 4.5 };
let total = 0; const fails = []; const worst = {};
const run = (base, primary, accent) => {
  const d = m.deriveTheme({ base, primary, accent }); total++;
  for (const c of d.checks) {
    worst[c.label] = Math.min(worst[c.label] ?? 99, c.ratio);
    if (c.ratio < need[c.label]) fails.push(`${base} ${primary}/${accent}: ${c.label} ${c.ratio.toFixed(2)}`);
  }
};
for (const base of ['light', 'dark']) for (const p of m.PALETTE) { run(base, p.hex, 'auto'); for (const a of m.PALETTE) run(base, p.hex, a.hex); }
const rnd = () => '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
for (let i = 0; i < 2000; i++) run(Math.random() < 0.5 ? 'light' : 'dark', rnd(), Math.random() < 0.5 ? 'auto' : rnd());
for (const x of ['#FFFFFF', '#000000', '#FFFF00', '#00FFFF', '#F0F0F0', '#101010']) for (const base of ['light', 'dark']) run(base, x, x);
// tavolozze pronte: ogni tema con ogni colore della tavolozza (e qualche colore estremo)
for (const [k, spec] of Object.entries(m.THEME_SPECS)) for (const hex of [...m.PALETTE.map((p) => p.hex), '#FFFFFF', '#000000', '#FFFF00', '#00FFFF']) {
  const r = m.paletteVars(spec, hex); total++;
  for (const c of r.checks) {
    worst['Tavolozza ' + c.label] = Math.min(worst['Tavolozza ' + c.label] ?? 99, c.ratio);
    if (c.ratio < (c.label === 'Testo' ? 7 : 4.5)) fails.push(`${k} ${hex}: ${c.label} ${c.ratio.toFixed(2)}`);
  }
}
console.log(`combinazioni: ${total} · non a norma: ${fails.length}`);
console.log('contrasto peggiore:', Object.entries(worst).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · '));
if (fails.length) { console.log(fails.slice(0, 20).join('\n')); process.exit(1); }
