#!/usr/bin/env node
// Giocatori finti per provare l'app: crea, prenota e rimuove.
//
//   node scripts/mock-users.mjs create [--count 12] [--prenota 10]
//   node scripts/mock-users.mjs delete [--yes]
//
// Servono due variabili d'ambiente (la chiave "secret" / "service_role" resta sul tuo computer:
// non scriverla in un file del repository e non incollarla in chat):
//   SUPABASE_URL                 https://IDPROGETTO.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    la chiave segreta, da Project Settings > API Keys
//
// Gli utenti finti usano indirizzi @mock.calcetto.test (dominio riservato, non riceve email),
// così si riconoscono e si cancellano in blocco senza toccare quelli veri.

import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const DOMAIN = 'mock.calcetto.test';
const MAX = 24;

// nome, cognome, soprannome, ruolo in campo, altezza (cm), peso (kg), data di nascita
const PLAYERS = [
  ['Giovanni', 'Esposito', 'Gianni', 'difensore', 178, 76, '1988-03-14'],
  ['Francesco', 'Romano', 'Checco', 'pivot', 183, 82, '1991-07-02'],
  ['Alberto', 'Colombo', null, 'laterale', 174, 70, '1985-11-23'],
  ['Michele', 'Ricci', 'Miki', 'jolly', 180, 78, '1993-01-30'],
  ['Roberto', 'De Luca', 'Robi', 'portiere', 186, 85, '1982-09-09'],
  ['Claudio', 'Mancini', null, 'difensore', 176, 74, '1987-05-18'],
  ['Antonio', 'Vitale', 'Totò', 'laterale', 171, 68, '1995-12-04'],
  ['Vincenzo', 'Leone', 'Enzo', 'pivot', 188, 90, '1984-02-27'],
  ['Massimo', 'Longo', null, 'jolly', 179, 77, '1990-08-16'],
  ['Gabriele', 'Giordano', 'Gabbo', 'laterale', 175, 71, '1997-04-11'],
  ['Daniele', 'Rinaldi', 'Dani', 'difensore', 181, 80, '1989-10-05'],
  ['Salvatore', 'Caruso', 'Salvo', 'portiere', 184, 83, '1981-06-21'],
  ['Federico', 'Ferrara', 'Fede', 'pivot', 182, 79, '1994-09-28'],
  ['Lorenzo', 'Santoro', 'Lollo', 'laterale', 173, 69, '1996-02-13'],
  ['Pietro', 'Mariani', null, 'jolly', 177, 75, '1986-12-19'],
  ['Emilio', 'Rizzo', null, 'difensore', 179, 78, '1983-01-07'],
  ['Tommaso', 'Fabbri', 'Tommy', 'laterale', 172, 67, '1998-05-25'],
  ['Cristian', 'Monti', null, 'pivot', 185, 88, '1992-11-02'],
  ['Valerio', 'Gentile', 'Vale', 'jolly', 176, 73, '1990-03-08'],
  ['Nunzio', 'Pellegrini', null, 'portiere', 187, 86, '1980-07-15'],
  ['Riccardo', 'Palumbo', 'Ricky', 'difensore', 180, 77, '1995-08-31'],
  ['Samuele', 'Sala', 'Samu', 'laterale', 174, 70, '1999-01-17'],
  ['Mirko', 'Parisi', null, 'pivot', 184, 84, '1988-06-06'],
  ['Domenico', 'Bianco', 'Mimmo', 'jolly', 178, 79, '1985-04-22'],
];

const args = process.argv.slice(2);
const command = args[0];
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const has = (name) => args.includes(name);

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!['create', 'delete'].includes(command)) {
  fail(`Uso:
  node scripts/mock-users.mjs create [--count 12] [--prenota 10]
  node scripts/mock-users.mjs delete [--yes]

  --count N     quanti giocatori finti creare (1-${MAX}, predefinito 12)
  --prenota N   prenota i primi N nella prossima partita (oltre il decimo vanno tra le riserve)
  --yes         conferma la cancellazione (senza, mostra soltanto cosa cancellerebbe)`);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  fail(`Mancano SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.

macOS / Linux:
  export SUPABASE_URL="https://IDPROGETTO.supabase.co"
  export SUPABASE_SERVICE_ROLE_KEY="la-chiave-segreta"

Windows PowerShell:
  $env:SUPABASE_URL = "https://IDPROGETTO.supabase.co"
  $env:SUPABASE_SERVICE_ROLE_KEY = "la-chiave-segreta"`);
}

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]+/g, '');
const emailOf = ([first, last]) => `${slug(first)}.${slug(last)}@${DOMAIN}`;

/** Tutti gli utenti finti già presenti, con il loro id. */
async function listMockUsers() {
  const found = [];
  const perPage = 200;
  for (let page = 1; page < 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage });
    if (error) fail(`Impossibile leggere gli utenti: ${error.message}`);
    const users = data?.users ?? [];
    for (const u of users) if (u.email?.toLowerCase().endsWith(`@${DOMAIN}`)) found.push({ id: u.id, email: u.email });
    if (users.length < perPage) break;
  }
  return found;
}

async function create() {
  const count = Math.min(MAX, Math.max(1, Number(option('--count', 12)) || 12));
  const toBook = Math.max(0, Number(option('--prenota', 0)) || 0);

  // Il primo account creato diventa Leader: se il vero Leader non si è ancora registrato, ci si ferma.
  const { count: profiles, error: pErr } = await sb.from('profiles').select('id', { count: 'exact', head: true });
  if (pErr) fail(`Impossibile leggere i profili: ${pErr.message}\nControlla l'URL, la chiave e che le migrazioni siano state applicate.`);
  if (!profiles && !has('--allow-first-leader')) {
    fail(`Non c'è ancora nessun utente: il primo che si registra diventa Leader.
Registrati prima tu dall'app e poi rilancia questo comando.
(Per creare comunque i finti, aggiungi --allow-first-leader: il primo finto diventerebbe Leader.)`);
  }

  // Con un codice invito attivo, chi non lo fornisce resterebbe in attesa di approvazione e avviserebbe lo staff.
  const { data: settings } = await sb.from('app_settings').select('invite_code').eq('id', 1).maybeSingle();
  const inviteCode = settings?.invite_code || null;

  const password = randomBytes(12).toString('base64url');
  const created = [];
  const skipped = [];

  for (const player of PLAYERS.slice(0, count)) {
    const [first, last, nickname, fieldRole, height, weight, birth] = player;
    const email = emailOf(player);
    const { data, error } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: first, last_name: last, invite_code: inviteCode },
    });
    if (error) {
      if (error.code === 'email_exists' || /already (been )?registered/i.test(error.message)) {
        skipped.push(email);
        continue;
      }
      fail(`Creazione di ${email} non riuscita: ${error.message}`);
    }
    const { error: uErr } = await sb.from('profiles').update({
      nickname, field_role: fieldRole, height_cm: height, weight_kg: weight, birth_date: birth,
      active: true, pending: false,
    }).eq('id', data.user.id);
    if (uErr) fail(`Profilo di ${email} non aggiornato: ${uErr.message}`);
    created.push({ id: data.user.id, email });
  }

  if (toBook > 0) await book(toBook);

  console.log(`\nCreati: ${created.length}${skipped.length ? `, già presenti: ${skipped.length}` : ''}.`);
  if (created.length) {
    console.log(`Password dei nuovi utenti (uguale per tutti): ${password}`);
    console.log(`Per entrare come uno di loro usa, per esempio, ${created[0].email}`);
  }
  console.log(`\nQuando hai finito: node scripts/mock-users.mjs delete --yes\n`);
}

/** Prenota i primi N utenti finti alla prossima partita, come se si fossero prenotati loro. */
async function book(n) {
  const { data: match } = await sb.from('matches').select('id, starts_at').eq('status', 'scheduled')
    .order('starts_at').limit(1).maybeSingle();
  if (!match) return console.warn('\nNessuna partita in programma: salto le prenotazioni.');
  const mocks = (await listMockUsers()).sort((a, b) => a.email.localeCompare(b.email));
  const order = PLAYERS.map(emailOf).filter((e) => mocks.some((m) => m.email === e)).slice(0, n);
  let booked = 0;
  for (const email of order) {
    const id = mocks.find((m) => m.email === email).id;
    const { error } = await sb.rpc('_book', { p_actor: id, p_user: id, p_match: match.id, p_choice: 'present', p_system: true });
    if (error) {
      console.warn(`Prenotazione di ${email} non riuscita: ${error.message}`);
      continue;
    }
    booked++;
  }
  console.log(`\nPrenotati ${booked} giocatori finti alla partita del ${new Date(match.starts_at).toLocaleString('it-IT')}.`);
}

async function remove() {
  const mocks = await listMockUsers();
  if (!mocks.length) return console.log('\nNessun utente finto da cancellare.\n');

  // Se un finto è diventato Leader (cessione di ruolo durante le prove) non lo tocchiamo.
  const { data: leaders } = await sb.from('profiles').select('id').eq('role', 'leader').in('id', mocks.map((m) => m.id));
  const protectedIds = new Set((leaders ?? []).map((l) => l.id));

  const targets = mocks.filter((m) => !protectedIds.has(m.id));
  console.log(`\nUtenti finti trovati: ${mocks.length}.`);
  for (const m of protectedIds.size ? mocks.filter((x) => protectedIds.has(x.id)) : []) {
    console.log(`  ! ${m.email} è Leader: non viene cancellato. Cedi prima il ruolo a un utente vero.`);
  }
  if (!has('--yes')) {
    for (const t of targets) console.log(`  - ${t.email}`);
    return console.log('\nNon ho cancellato niente. Per procedere: node scripts/mock-users.mjs delete --yes\n');
  }
  let removed = 0;
  for (const t of targets) {
    const { error } = await sb.auth.admin.deleteUser(t.id);
    if (error) console.warn(`  ${t.email}: ${error.message}`);
    else removed++;
  }
  console.log(`${removed === 1 ? 'Cancellato 1 utente finto' : `Cancellati ${removed} utenti finti`}, con le prenotazioni e i voti.\n`);
}

if (command === 'create') await create();
else await remove();
