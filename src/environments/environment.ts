// Valori pubblici: è normale che finiscano nel bundle.
// La chiave "anon" di Supabase è pensata per il browser; la sicurezza sta nelle regole RLS.
export const environment = {
  supabaseUrl: 'https://TUO-PROGETTO.supabase.co',
  supabaseAnonKey: 'INCOLLA-QUI-LA-ANON-KEY',
  vapidPublicKey: 'INCOLLA-QUI-LA-CHIAVE-PUBBLICA-VAPID',
  // facoltativo: abilita il pulsante "Entra con Google" se configurato su Supabase
  googleLogin: false,
};
