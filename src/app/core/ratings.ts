import { inject, Injectable, signal } from '@angular/core';
import { Supabase } from './supabase';

function must<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data as T;
}

export interface Hex { attacco: number; tiro: number; difesa: number; velocita: number; tecnica: number; forza: number }
export type Gk = 'green' | 'yellow' | 'red' | null;
/** fasce del campo: difesa (Centrale), esterni (Esterno), centrocampo centrale (media), attacco (Punta) */
/** zone del campo, una per ruolo; il centro è la media delle quattro */
export type Zone = 'dc' | 'ed' | 'eo' | 'pu';
export type Band = Zone | 'cen';
/** tipo di posto nella formazione: 'est' = laterale che fa entrambe le fasi (media tra esterno difensivo e offensivo) */
export type SlotKind = Band | 'est' | 'gk';

/** La scheda che vedono tutti: solo valori calcolati (le 13 caratteristiche le vede solo il Leader). */
export interface RatingCard {
  user_id: string; has: boolean; role: string | null; gk: Gk;
  best?: string; role_value?: number; overall?: number;
  dc?: number; ed?: number; eo?: number; pu?: number; cen?: number; hex?: Hex;
}
export interface RawRatings { [attr: string]: number | string | null }

export const ROLE_SHORT: Record<string, string> = { difensore_centrale: 'DC', esterno_difensivo: 'ED', esterno_offensivo: 'EO', punta: 'PU' };
export const ROLE_ZONE: Record<string, Zone> = { difensore_centrale: 'dc', esterno_difensivo: 'ed', esterno_offensivo: 'eo', punta: 'pu' };
export const ATTRS: { key: string; label: string }[] = [
  { key: 'shot_accuracy', label: 'Precisione tiro' }, { key: 'shot_power', label: 'Potenza tiro' }, { key: 'finishing', label: 'Finalizzazione' },
  { key: 'dribbling', label: 'Dribbling' }, { key: 'speed', label: 'Velocità' }, { key: 'agility', label: 'Agilità' },
  { key: 'stamina', label: 'Corsa' }, { key: 'marking', label: 'Marcatura' }, { key: 'ball_protection', label: 'Protezione della palla' },
  { key: 'strength', label: 'Forza fisica' }, { key: 'positioning', label: 'Posizione' }, { key: 'ball_control', label: 'Controllo palla' },
  { key: 'passing', label: 'Passaggio' },
];

const GREEN = 'hsl(150 58% 40%)';
export const GK_COLOR: Record<string, string> = { green: GREEN, yellow: 'hsl(48 88% 52%)', red: 'hsl(4 76% 50%)' };

/**
 * Colore di una zona del campo: dal verde (il ruolo del giocatore, o il migliore se non ne ha) al rosso
 * in modo continuo, secondo la distanza dal ruolo migliore; più il valore è alto, più il colore è acceso.
 */
export function zoneHsl(c: RatingCard, z: Zone): [number, number, number] {
  const v = c[z] ?? 0;
  const best = Math.max(c.dc ?? 0, c.ed ?? 0, c.eo ?? 0, c.pu ?? 0);
  const mine = ROLE_ZONE[c.role ?? c.best ?? ''];
  const t = z === mine ? 0 : Math.max(0, Math.min(1, (best - v) / 18));
  const k = Math.max(0, Math.min(1, (v - 35) / 55));          // forza del giocatore in quella zona
  return [140 * (1 - t), 25 + 60 * k, 52 - 6 * k];
}
export function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  s /= 100; l /= 100;
  const f = (n: number) => { const k = (n + h / 30) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255)) as [number, number, number];
}
export function zoneCss(c: RatingCard, z: Zone): string {
  const [r, g, b] = hslToRgb(zoneHsl(c, z));
  return `rgb(${r} ${g} ${b})`;
}
/** centro: la sfumatura delle quattro zone intorno */
export function centerCss(c: RatingCard): string {
  const all = (['dc', 'ed', 'eo', 'pu'] as Zone[]).map((z) => hslToRgb(zoneHsl(c, z)));
  const m = [0, 1, 2].map((i) => Math.round(all.reduce((s, x) => s + x[i], 0) / 4));
  return `rgb(${m[0]} ${m[1]} ${m[2]})`;
}

/** valore di un giocatore in un tipo di posto (portiere = valore generale con il bonus del portiere) */
export function valueAt(c: RatingCard | undefined, kind: SlotKind): number | null {
  if (!c?.has) return null;
  if (kind === 'gk') return c.overall ?? null;
  if (kind === 'est') return c.ed !== undefined && c.eo !== undefined ? Math.round((c.ed + c.eo) / 2) : null;
  return c[kind] ?? null;
}

@Injectable({ providedIn: 'root' })
export class Ratings {
  private readonly sb = inject(Supabase).client;
  /** schede già caricate */
  readonly cards = signal<Map<string, RatingCard>>(new Map());

  async load(ids: string[], force = false): Promise<void> {
    const need = force ? ids : ids.filter((id) => !this.cards().has(id));
    if (!need.length) return;
    const rows = must(await this.sb.rpc('player_cards', { p_users: need })) as RatingCard[];
    const next = new Map(this.cards());
    for (const r of rows) next.set(r.user_id, r);
    this.cards.set(next);
  }

  /** dopo un cambio dei coefficienti le schede si ricalcolano */
  clear(): void {
    this.cards.set(new Map());
  }

  card(id: string): RatingCard | undefined {
    return this.cards().get(id);
  }

  /** solo il Leader: le 13 caratteristiche */
  async raw(id: string): Promise<RawRatings | null> {
    return must(await this.sb.from('player_ratings').select('*').eq('user_id', id).maybeSingle()) as RawRatings | null;
  }

  async save(id: string, vals: Record<string, number | null>, gk: Gk, override: number | null): Promise<RatingCard> {
    const card = must(await this.sb.rpc('set_player_ratings', { p_user: id, p_vals: vals, p_gk: gk, p_override: override })) as RatingCard;
    const next = new Map(this.cards());
    next.set(id, card);
    this.cards.set(next);
    return card;
  }
}

// ------------------------------------------------------------------ formazioni consigliate
/** assegnazione di peso massimo (algoritmo ungherese): righe = giocatori, colonne = posti (righe <= colonne) */
export function bestAssignment(w: number[][]): { total: number; cols: number[] } {
  const n = w.length, m = w[0]?.length ?? 0;
  if (!n) return { total: 0, cols: [] };
  const size = Math.max(n, m);
  const max = Math.max(0, ...w.flat());
  const cost = Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => (i < n && j < m ? max - w[i][j] : max)));
  const u = new Array(size + 1).fill(0), v = new Array(size + 1).fill(0), p = new Array(size + 1).fill(0), way = new Array(size + 1).fill(0);
  for (let i = 1; i <= size; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(size + 1).fill(Infinity), used = new Array(size + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= size; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= size; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const cols = new Array(n).fill(-1);
  for (let j = 1; j <= size; j++) if (p[j] && p[j] <= n && j <= m) cols[p[j] - 1] = j - 1;
  const total = cols.reduce((s, c, i) => s + (c >= 0 ? w[i][c] : 0), 0);
  return { total, cols };
}

/**
 * Divide i titolari in due squadre e assegna i posti: prova tutte le divisioni e tiene quella con i valori
 * medi più vicini; a parità, quella in cui ognuno gioca nel posto più adatto.
 */
export function suggestTeams(players: string[], kinds: SlotKind[], value: (id: string, k: SlotKind) => number):
  { a: { id: string; slotIndex: number }[]; b: { id: string; slotIndex: number }[]; avgA: number; avgB: number } {
  const k = Math.min(players.length, kinds.length * 2);
  const ps = players.slice(0, k);
  const sizeA = Math.ceil(k / 2);
  const w = ps.map((id) => kinds.map((kd) => value(id, kd)));
  let best: { diff: number; total: number; a: number[]; colsA: number[]; colsB: number[]; b: number[]; avgA: number; avgB: number } | null = null;
  const pick: number[] = [];
  const rec = (start: number) => {
    if (pick.length === sizeA) {
      const a = [...pick], b = ps.map((_, i) => i).filter((i) => !a.includes(i));
      const ra = bestAssignment(a.map((i) => w[i])), rb = bestAssignment(b.map((i) => w[i]));
      const avgA = a.length ? ra.total / a.length : 0, avgB = b.length ? rb.total / b.length : 0;
      const diff = Math.abs(avgA - avgB), total = ra.total + rb.total;
      if (!best || diff < best.diff - 1e-9 || (Math.abs(diff - best.diff) < 1e-9 && total > best.total)) {
        best = { diff, total, a, b, colsA: ra.cols, colsB: rb.cols, avgA, avgB };
      }
      return;
    }
    for (let i = start; i < k; i++) {
      if (pick.length === 0 && i > 0 && sizeA * 2 === k) break;   // con squadre uguali, il primo sta sempre in A (niente doppioni)
      pick.push(i); rec(i + 1); pick.pop();
    }
  };
  rec(0);
  const r = best!;
  return {
    a: r.a.map((i, x) => ({ id: ps[i], slotIndex: r.colsA[x] })),
    b: r.b.map((i, x) => ({ id: ps[i], slotIndex: r.colsB[x] })),
    avgA: r.avgA, avgB: r.avgB,
  };
}
