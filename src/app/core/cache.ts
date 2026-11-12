import { Injectable } from '@angular/core';

const PREFIX = 'gdl-cache:';
/** dati più vecchi di così non si mostrano nemmeno come anteprima */
const MAX_AGE = 7 * 24 * 3600_000;

interface Entry<T> { at: number; v: T }

/**
 * Memoria dei dati già visti, per mostrarli subito e aggiornarli in sottofondo («mostra subito, poi aggiorna»).
 * Sta in RAM e, per le chiavi segnate come `persist`, anche nel telefono (localStorage), separata per utente:
 * così anche l'apertura dell'app parte dagli ultimi dati visti. All'uscita si cancella tutto.
 * Mai dati riservati al Leader (`player_ratings`): solo quello che l'utente vede già nell'app.
 */
@Injectable({ providedIn: 'root' })
export class Cache {
  private readonly mem = new Map<string, Entry<unknown>>();
  private user: string | null = null;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** utente collegato: le chiavi salvate sono sue; cambiando utente si riparte da zero */
  setUser(uid: string | null): void {
    if (uid === this.user) return;
    if (this.user && uid !== this.user) this.clear();
    this.user = uid;
    // sul telefono restano solo i dati di chi è collegato adesso
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith(PREFIX) && (!uid || !k.startsWith(`${PREFIX}${uid}:`))) localStorage.removeItem(k);
      }
    } catch { /* niente memoria */ }
  }

  get<T>(key: string): T | undefined {
    const m = this.mem.get(key) as Entry<T> | undefined;
    if (m) return m.v;
    if (!this.user) return undefined;
    try {
      const raw = localStorage.getItem(this.storageKey(key));
      if (!raw) return undefined;
      const e = JSON.parse(raw) as Entry<T>;
      if (Date.now() - e.at > MAX_AGE) return undefined;
      this.mem.set(key, e);
      return e.v;
    } catch {
      return undefined;
    }
  }

  /** `persist`: salva anche sul telefono (con un attimo di ritardo, per non scrivere a ogni cambiamento) */
  set<T>(key: string, v: T, persist = false): void {
    const e: Entry<T> = { at: Date.now(), v };
    this.mem.set(key, e);
    if (!persist || !this.user) return;
    const sk = this.storageKey(key);
    clearTimeout(this.timers.get(sk));
    this.timers.set(sk, setTimeout(() => {
      this.timers.delete(sk);
      try { localStorage.setItem(sk, JSON.stringify(e)); } catch { /* memoria piena o non disponibile: resta in RAM */ }
    }, 300));
  }

  /** all'uscita (o cambiando utente): via tutto, in RAM e sul telefono */
  clear(): void {
    this.mem.clear();
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith(PREFIX)) localStorage.removeItem(k);
      }
    } catch { /* niente memoria */ }
  }

  private storageKey(key: string): string {
    return `${PREFIX}${this.user}:${key}`;
  }
}
