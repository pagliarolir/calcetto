import { inject, Injectable, signal } from '@angular/core';
import { onForeground } from './foreground';
import { Match } from './models';
import { Cache } from './cache';
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
  transfers: PayTransfer[]; pending: PaySettlement[]; history: PaySettlement[]; history_cleared_at?: string | null; expenses_cleared_at?: string | null; expenses: PayExpense[]; methods: PayMethods[];
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
/**
 * Link PayPal.me con l'importo già scritto (punto come separatore, come vuole PayPal).
 * Niente valuta in fondo («7.00EUR»): con la valuta l'app di PayPal sul telefono si apre ma lascia l'importo vuoto;
 * senza, vale la valuta principale di chi riceve (per noi l'euro) e l'importo arriva sia nell'app sia nel sito.
 */
export function paypalLink(user: string, cents: number): string {
  const amount = cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
  return `https://paypal.me/${encodeURIComponent(user)}/${amount}`;
}
/** IBAN a gruppi di 4, più leggibile */
export function ibanGroups(iban: string): string {
  return iban.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Partite della tendina della spesa: la prossima (solo da due ore prima dell'inizio) e le ultime giocate,
 * 6 in tutto; quelle di più di 3 giorni fa solo per il Leader (il server lo controlla comunque).
 */
export function fieldChoices<T extends Match>(all: T[], boss: boolean, now = Date.now()): T[] {
  const ok = all.filter((m) => m.status !== 'cancelled');
  // la prossima partita compare solo da due ore prima dell'inizio (scelta del proprietario)
  const next = ok.filter((m) => Date.parse(m.starts_at) >= now && Date.parse(m.starts_at) - 2 * 3600e3 <= now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  const past = ok.filter((m) => Date.parse(m.starts_at) < now && (boss || Date.parse(m.starts_at) >= now - 3 * 864e5))
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  return [...(next ? [next] : []), ...past].slice(0, 6);
}

@Injectable({ providedIn: 'root' })
export class Payments {
  private readonly sb = inject(Supabase).client;
  private readonly session = inject(Session);
  private readonly cache = inject(Cache);
  readonly visible = signal(false);
  /** ultimi dati della pagina (solo in memoria: dentro ci sono IBAN di altri, non si salvano sul telefono) */
  readonly data = signal<PayOverview | null>(null);

  private visCheck: { uid: string; at: number; p: Promise<boolean | null> } | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;

  constructor() {
    // tornando nell'app (da un'altra applicazione o dal telefono in standby) si ricontrolla: copre accessi scaduti e reti tornate
    onForeground(() => { if (this.session.uid()) void this.checkVisible(); });
  }

  /**
   * Se l'utente vede i Pagamenti (Leader, elenco o aperti a tutti); richieste ravvicinate fanno una sola chiamata.
   * true/false = risposta del server; null = il server non ha risposto (rete, accesso da rinnovare): in quel caso la
   * voce resta com'era, l'app riprova da sola (3, 10, 30, 60 s) e la nasconde solo davanti a un «no» vero.
   */
  async checkVisible(): Promise<boolean | null> {
    const uid = this.session.uid();
    if (!uid) { this.visible.set(false); this.visCheck = null; this.data.set(null); this.stopRetry(); return false; }
    if (this.visCheck && this.visCheck.uid === uid && Date.now() - this.visCheck.at < 30_000) return this.visCheck.p;
    // la voce «Conti» compare subito, come l'ultima volta (aperti a tutti: senza ricordo si mostra); il server poi conferma
    if (!this.visible() && this.cache.get<boolean>('vis-pay') !== false) this.visible.set(true);
    const p = (async (): Promise<boolean | null> => {
      let res = await this.sb.rpc('pay_visible');
      if (res.error) {
        // spesso è l'accesso scaduto mentre l'app era in sottofondo: lo si rinnova e si riprova subito una volta
        await this.sb.auth.getSession().catch(() => null);
        res = await this.sb.rpc('pay_visible');
      }
      if (res.error) {
        this.visCheck = null;
        this.scheduleRetry();
        return null;
      }
      this.stopRetry();
      const v = res.data === true;
      this.visible.set(v);
      this.cache.set('vis-pay', v, true);
      return v;
    })();
    this.visCheck = { uid, at: Date.now(), p };
    return p;
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    const wait = [3, 10, 30, 60][Math.min(this.retries, 3)] * 1000;
    this.retries++;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; if (this.session.uid()) void this.checkVisible(); }, wait);
  }

  private stopRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retries = 0;
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
  /** quali di queste partite hanno già il campo nei Conti (migrazione 68: uno solo per partita) */
  async fieldMatches(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const { data, error } = await this.sb.rpc('pay_field_matches', { p_ids: ids });
    return new Set(error || !Array.isArray(data) ? [] : (data as string[]));
  }
  async deleteExpense(id: number): Promise<void> {
    must(await this.sb.rpc('pay_delete_expense', { p_id: id }));
    await this.load();
  }
  /**
   * Il server registra, poi i conti si rileggono in sottofondo: l'esito si vede subito.
   * Se vale subito (Leader per altri o chi riceve, `from` presente) il debito scende già a schermo.
   */
  async markPaid(to: string, cents: number, method: PayMethod, from: string | null = null): Promise<void> {
    must(await this.sb.rpc('pay_mark_paid', { p_to: to, p_amount_cents: cents, p_method: method, p_from: from }));
    const d = this.data();
    if (d && from) {
      const transfers = d.transfers
        .map((t) => (t.from_id === from && t.to_id === to ? { ...t, amount_cents: t.amount_cents - cents } : t))
        .filter((t) => t.amount_cents > 0);
      this.data.set({ ...d, transfers });
    }
    void this.load().catch(() => undefined);
  }
  /** conferma o rifiuto: la riga sparisce subito; se il server rifiuta, torna con la rilettura */
  async decide(id: number, ok: boolean): Promise<void> {
    const d = this.data();
    if (d) this.data.set({ ...d, pending: d.pending.filter((s) => s.id !== id) });
    try {
      must(await this.sb.rpc('pay_decide', { p_id: id, p_ok: ok }));
    } catch (e) {
      await this.load().catch(() => undefined);
      throw e;
    }
    void this.load().catch(() => undefined);
  }
  async saveMethods(paypal: string, iban: string, holder: string): Promise<void> {
    must(await this.sb.rpc('pay_save_methods', { p_paypal: paypal, p_iban: iban, p_holder: holder }));
    await this.load();
  }
  /** «Svuota»: lo storico sparisce solo dalla propria vista, i saldi non cambiano (migrazione 56) */
  /** IBAN intero di chi devo pagare, solo per copiarlo (agli altri arriva mascherato; migrazione 60) */
  async revealIban(to: string): Promise<string> {
    const { data, error } = await this.sb.rpc('pay_reveal_iban', { p_to: to });
    if (error) throw error;
    return String(data ?? '');
  }
  /** promemoria a chi mi deve dei soldi: 'sent', 'already' (già oggi) o 'early' (prima delle 13) */
  async remind(from: string): Promise<'sent' | 'already' | 'early'> {
    const { data, error } = await this.sb.rpc('pay_remind', { p_from: from });
    if (error) throw error;
    return data as 'sent' | 'already' | 'early';
  }
  /** chiede a chi deve ricevere di aggiungere PayPal o IBAN (avviso, al massimo uno ogni 12 ore; migrazione 59) */
  async askMethods(to: string): Promise<boolean> {
    const { data, error } = await this.sb.rpc('pay_ask_methods', { p_to: to });
    if (error) throw error;
    return data === true;
  }
  /** «Svuota l'elenco» delle spese: spariscono solo dalla propria vista, i saldi non cambiano (migrazione 58) */
  async clearExpenses(): Promise<void> {
    must(await this.sb.rpc('pay_clear_expenses'));
    await this.load();
  }
  async clearHistory(): Promise<void> {
    must(await this.sb.rpc('pay_clear_history'));
    await this.load();
  }
  async setVisibility(isPublic: boolean, users: string[]): Promise<void> {
    must(await this.sb.rpc('pay_set_visibility', { p_public: isPublic, p_users: users }));
    await this.load();
  }
}
