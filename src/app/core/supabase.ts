import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class Supabase {
  readonly client: SupabaseClient = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // evita i blocchi del Navigator Lock API in alcune WebView mobili
      lock: async <R>(_name: string, _timeout: number, fn: () => Promise<R>) => fn(),
    },
  });
}

/** Messaggio leggibile da un errore Supabase/PostgREST: le funzioni SQL alzano già testi in italiano. */
export function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const m = String((e as { message: unknown }).message);
    if (m.includes('Failed to fetch') || m.includes('NetworkError')) return 'Sei offline: riprova appena torna la connessione.';
    if (m.includes('Invalid login credentials')) return 'Email o password non corretti.';
    if (m.includes('User already registered')) return 'Esiste già un account con questa email.';
    if (m.includes('Password should be')) return 'La password deve avere almeno 6 caratteri.';
    if (m.includes('should be different from the old')) return 'La nuova password deve essere diversa da quella attuale.';
    if (m.toLowerCase().includes('rate limit')) return 'Troppe richieste ravvicinate: riprova tra qualche minuto.';
    if (m.includes('exceeded the maximum allowed size') || m.includes('Payload too large')) return 'La foto è troppo grande.';
    if (m.toLowerCase().includes('mime type')) return 'Formato della foto non supportato.';
    if (m.includes('Auth session missing')) return 'Il link è scaduto o è già stato usato: richiedine uno nuovo.';
    if (m.toLowerCase().includes('weak password') || m.includes('pwned')) return 'Questa password è troppo debole o compare in elenchi di password rubate: scegline un\'altra.';
    return m;
  }
  return 'Qualcosa non ha funzionato. Riprova.';
}
