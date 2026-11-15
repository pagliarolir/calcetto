import { inject, Injectable, signal } from '@angular/core';
import { Session } from './session';
import { Supabase } from './supabase';

/** Pagamenti (migrazione 54): conti tipo Splitwise. Gli importi sono sempre in centesimi. */
export type PayMethod = 'paypal' | 'iban' | 'cash';
export interface PayTransfer { from_id: string; to_id: string; amount_cents: number }
export interface PaySettlement {
  id: number; from_id: string; to_id: string; amount_cents: number; method: PayMethod;
  status: 'pending' | 'confirmed' | 'rejected'; created_by: string | null; created_at: string; decided_by: string | null; decided_at: string | null;
}
export interface PayExpense {
  id: number; title: string; amount_cents: number; payer_id: string; match_id: string | null; created_by: string | null; created_at: string;
  shares: { user_id: string; amount_cents: number }[];
}
export interface PayMethods { user_id: string; paypal: string | null; iban: string | null; holder: string | null }
export interface PayOverview {
  me: string; boss: boolean; balance_cents: number;
  transfers: PayTransfer[]; pending: PaySettlement[]; history: PaySettlement[]; expenses: PayExpense[]; methods: PayMethods[];
  settings: { public: boolean; preview_users: string[] } | null;
}

function must<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data as T;
}

const euro0 = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const euro2 = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** 300 → «3 €», 350 → «3,50 €» */
export function eur(cents: number): string {
  return (cents % 100 === 0 ? euro0 : euro2).format(cents / 100);
}
/** «3», «3,5», «3,50 €» → 350; null se non è un importo valido */
export function parseEuro(text: string): number | null {
  const t = text.replace(/€/g, '').replace(/\s/g, '').replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return null;
  const c = Math.round(parseFloat(t) * 100);
  return c > 0 ? c : null;
}
/** link PayPal.me con l'importo già scritto (punto come separatore, come vuole PayPal) */
export function paypalLink(user: string, cents: number): string {
  return `https://paypal.me/${encodeURIComponent(user)}/${(cents / 100).toFixed(2)}EUR`;
}
/** IBAN a gruppi di 4, più leggibile */
export function ibanGroups(iban: string): string {
  return iban.replace(/(.{4})/g, '$1 ').trim();
}

@Injectable({ providedIn: 'root' })
export class Payments {
  private readonly sb = inject(Supabase).client;
  private readonly session = inject(Session);
  readonly visible = signal(false);
  /** ultimi dati della pagina (solo in memoria: dentro ci sono IBAN di altri, non si salvano sul telefono) */
  readonly data = signal<PayOverview | null>(null);

  private visCheck: { uid: string; at: number; p: Promise<boolean> } | null = null;
  /** se l'utente vede i Pagamenti (anteprima: Leader ed elenco); richieste ravvicinate fanno una sola chiamata */
  async checkVisible(): Promise<boolean> {
    const uid = this.session.uid();
    if (!uid) { this.visible.set(false); this.visCheck = null; this.data.set(null); return false; }
    if (this.visCheck && this.visCheck.uid === uid && Date.now() - this.visCheck.at < 30_000) return this.visCheck.p;
    const p = (async () => {
      const res = await this.sb.rpc('pay_visible');
      // finché la migrazione non è applicata la funzione non c'è: niente scheda
      const v = !res.error && res.data === true;
      this.visible.set(v);
      if (res.error) this.visCheck = null;
      return v;
    })();
    this.visCheck = { uid, at: Date.now(), p };
    return p;
  }

  async load(): Promise<PayOverview> {
    const d = must(await this.sb.rpc('pay_overview')) as PayOverview;
    d.balance_cents = +d.balance_cents;
    d.transfers = d.transfers.map((t) => ({ ...t, amount_cents: +t.amount_cents }));
    this.data.set(d);
    return d;
  }

  async addExpense(title: string, cents: number, payer: string, users: string[], matchId: string | null): Promise<void> {
    must(await this.sb.rpc('pay_add_expense', { p_title: title, p_amount_cents: cents, p_payer: payer, p_users: users, p_match: matchId }));
    await this.load();
  }
  async deleteExpense(id: number): Promise<void> {
    must(await this.sb.rpc('pay_delete_expense', { p_id: id }));
    await this.load();
  }
  async markPaid(to: string, cents: number, method: PayMethod, from: string | null = null): Promise<void> {
    must(await this.sb.rpc('pay_mark_paid', { p_to: to, p_amount_cents: cents, p_method: method, p_from: from }));
    await this.load();
  }
  async decide(id: number, ok: boolean): Promise<void> {
    must(await this.sb.rpc('pay_decide', { p_id: id, p_ok: ok }));
    await this.load();
  }
  async saveMethods(paypal: string, iban: string, holder: string): Promise<void> {
    must(await this.sb.rpc('pay_save_methods', { p_paypal: paypal, p_iban: iban, p_holder: holder }));
    await this.load();
  }
  async setVisibility(isPublic: boolean, users: string[]): Promise<void> {
    must(await this.sb.rpc('pay_set_visibility', { p_public: isPublic, p_users: users }));
    await this.load();
  }
}
