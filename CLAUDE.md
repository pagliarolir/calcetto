# G.d.L.: istruzioni per chi lavora sul codice

PWA Angular 21 + Supabase per la partita settimanale. Leggi `README.md` per l'architettura e la mappa dei requisiti (REQ-001…053).

## Comandi

- `npm ci`, poi `npx ng build` per verificare la compilazione (deve restare senza errori né avvisi).
- `PGHOST=localhost PGPORT=5432 bash supabase/tests/run.sh` esegue migrazioni e scenari su un Postgres 16 locale.
- Prima di chiudere un lavoro: build pulita e, se hai toccato `supabase/`, test del database verdi.

## Regole del database

- La logica di gioco vive in SQL, non nel client. Ogni scrittura passa da una funzione `security definer` che controlla permessi e orari; le tabelle hanno RLS attiva e nessun permesso di scrittura diretto.
- Non modificare migrazioni già pubblicate: aggiungi un nuovo file `supabase/migrations/AAAAMMGGhhmmss_descrizione.sql` con `create or replace` o `alter`.
- Ogni nuova funzione richiamabile dall'app va aggiunta ai `grant execute ... to authenticated`; quelle interne vanno revocate a `authenticated` e `anon`.
- Notifiche: usa `notify(...)`, che accoda in `notifications`; l'invio push è automatico.
- Aggiungi uno scenario in `supabase/tests/` per ogni regola nuova o modificata.

## Regole del frontend

- Componenti standalone, `ChangeDetectionStrategy.OnPush`, signals, niente zone.js. Negli `effect` leggi solo i segnali che devono farlo ripartire; usa `untracked` per il resto (un effect che legge e scrive lo stesso segnale blocca l'app).
- Stile: token e classi condivise in `src/styles.scss` (colori campo, maglie bianche e nere, fascia ambra del Leader). Riusa `.btn`, `.panel`, `.list`, `.chip`, `.field` prima di creare stili nuovi.
- Testi in italiano, tono amichevole e diretto. Niente maiuscole su intere etichette, niente separatori a punto centrale tra informazioni.
- Accessibilità: pulsanti di almeno 44 px, etichette per i lettori di schermo, rispetto di `prefers-reduced-motion`.
- Date sempre nel fuso Europe/Rome tramite `src/app/core/format.ts`.
- iPhone con l'app installata (barra di stato "black-translucent"): la classe `.page` lascia già lo spazio della barra di stato; sotto un'intestazione che lo lascia da sé (pagina partita) usa `.page.below-header`. Tutto ciò che è fissato in basso deve sottrarre `var(--vp-gap)`, lo scarto del bug WebKit 236445 misurato in `src/app/core/ios-viewport.ts` (vale 0 dove il bug non c'è).

## Decisioni confermate dal proprietario

- La leadership passa al Secondo Premier solo se anche il Primo è inattivo da 15 giorni.
- La riserva che risponde "Non posso" viene registrata come assente.
- Finestra di voto di 48 ore, configurabile in Gestione.
- Tutto deve restare gratuito: niente servizi o librerie a pagamento.
- Delega: il Leader titolare può delegare i suoi poteri a un solo giocatore, con scadenza facoltativa, conservando i propri. Il delegato non può ridelegare né cedere il ruolo.
- Password dimenticata: via email (serve un SMTP su Supabase) oppure password temporanea generata da Leader o Premier (i Premier solo per i giocatori semplici; il Leader titolare usa l'email). Chi la riceve deve cambiarla al primo accesso e viene avvisato, e il Leader viene avvisato se l'ha fatta un Premier.
- Il primo account creato diventa Leader; gli altri sono giocatori. Con un codice invito impostato, chi si registra senza codice resta in attesa di approvazione.
- I voti sono segreti per i giocatori, ma chi è proprietario del progetto Supabase li vede dal Table Editor.

## Dove sono le statistiche

Non sono salvate in tabelle: `stats_table()`, `player_match_facts()` e `attendance_register()` le calcolano al momento, solo dalle partite con risultato omologato. Dal SQL Editor di Supabase `stats_table()` restituisce zero righe perché controlla `auth.uid()`: per leggerla si simula un utente nello stesso Run, così:

```sql
select set_config('request.jwt.claim.sub', (select id::text from profiles where role = 'leader'), false);
select p.first_name, s.* from stats_table() s join profiles p on p.id = s.user_id order by s.points desc;
```

`select * from player_match_facts();` funziona anche senza simulare nessun utente.

## Diagnostica in produzione

Cose che Claude Code non vede da solo: se serve, chiedi al proprietario di eseguire queste query nel SQL Editor di Supabase e di incollare il risultato (mai password, token o chiavi).

- Scheduler attivo: `select jobname, schedule, active from cron.job;` deve mostrare `calcetto-scheduler`.
- Ultime esecuzioni: `select status, start_time, return_message from cron.job_run_details order by start_time desc limit 10;`
- Segreti del vault presenti (solo i nomi): `select name from vault.secrets;` devono esserci `dispatch_url` e `dispatch_secret`.
- Notifiche accodate e non spedite: `select kind, created_at from notifications where push_claimed_at is null order by id;`
- Log delle Edge Functions: dashboard Supabase, *Edge Functions → push-dispatch / quick-action / admin-reset-password → Logs*.
- Esito di build e pubblicazione: scheda Actions del repository.

## Stato della produzione (aggiornare quando cambia)

Compilato dal proprietario. Niente password, token o chiavi: il repository può essere pubblico.

- Indirizzo dell'app: https://...
- Hosting: GitHub Pages con `.github/workflows/deploy.yml` (oppure: Vercel / Cloudflare Pages)
- Progetto Supabase: ID `...`, regione `...`
- Impostazioni fatte a mano su Supabase, non presenti nel codice:
  - Confirm email: disattivato
  - Site URL e Redirect URL impostati, compreso `.../nuova-password`
  - SMTP per il recupero password: [provider oppure "non configurato"]
  - Secret delle Edge Functions e segreti del vault configurati
  - Estensioni `pg_cron` e `pg_net` attive
- Variabili e secret del repository GitHub: [elenco dei nomi, non dei valori]
- Leader attuale: [nome]; Primo Premier: [nome]; Secondo Premier: [nome]
- Idee o cose rimandate: ...

## Pubblicazione

Un push su `main` ricompila e pubblica su GitHub Pages. Le modifiche al database e alle Edge Functions vanno applicate lanciando il workflow "Aggiorna Supabase".
