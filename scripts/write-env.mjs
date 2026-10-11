// Genera src/environments/environment.ts dalle variabili d'ambiente (usato dalla pipeline).
import { writeFileSync } from 'node:fs';

const need = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'VAPID_PUBLIC_KEY'];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Variabili mancanti: ${missing.join(', ')}. Impostale in Settings > Secrets and variables > Actions > Variables.`);
  process.exit(1);
}
const env = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
  googleLogin: process.env.GOOGLE_LOGIN === 'true',
};
writeFileSync('src/environments/environment.ts', `export const environment = ${JSON.stringify(env, null, 2)};\n`);
console.log('environment.ts scritto.');
