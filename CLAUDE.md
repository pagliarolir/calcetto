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

- Permessi espliciti (Supabase non li dà più in automatico alle nuove tabelle dal 30/10/2026): ogni migrazione che crea una tabella o una vista in `public` dichiara subito i suoi grant: `service_role` select, insert, update, delete; `authenticated` solo ciò che serve (di norma select, il resto passa da funzioni); niente ad `anon`. I test non simulano permessi automatici, quindi una grant mancante fa fallire la suite.
- Viste: niente viste "security definer". Se una vista deve leggere oltre le regole di sicurezza della tabella, metti la logica in una funzione `security definer` e crea la vista con `with (security_invoker = true)` che legge dalla funzione (come `members` / `members_list`).
- Punizioni: ogni nuova funzione con cui un giocatore interviene (prenota, scrive, vota, inserisce dati) deve chiamare `perform assert_not_punished();` all'inizio. Le azioni esistenti hanno un guardiano con lo stesso nome davanti alla funzione originale `*_unchecked` (privata): per cambiarne la logica modifica la `*_unchecked`, non il guardiano. Gli inviti ad agire vanno aggiunti all'elenco dei tipi filtrati in `notify()`.

- Modalità di prenotazione (`matches.booking_mode`): con `'free'` la lista `'pending'` sono i disponibili e niente ordine né promozioni automatiche; ogni nuova logica che sposta giocatori tra squadra e riserve deve valere solo per `'order'` (vedi il ramo dedicato in `_book` e `leader_reset_booking`).
- Configurazione per partita: la dimensione della lista è `players_per_team * 2` della partita, mai un numero fisso. Nelle tabelle le squadre restano `'white'` (squadra A) e `'black'` (squadra B): i nomi veri vengono da `team_a_kit`/`team_b_kit` (`team_name(m, team)` in SQL). Gli orari `bookings_open_at`, `bookings_close_at`, `votes_opens_at`, `votes_closes_at` li calcola il trigger `trg_matches_config` dalla configurazione: non calcolarli a mano. Nei test, se sposti `starts_at` vicino a ora, imposta anche `bookings_close_at` nella stessa istruzione.

## Regole del frontend

- Componenti standalone, `ChangeDetectionStrategy.OnPush`, signals, niente zone.js. Negli `effect` leggi solo i segnali che devono farlo ripartire; usa `untracked` per il resto (un effect che legge e scrive lo stesso segnale blocca l'app).
- Stile: token e classi condivise in `src/styles.scss` (colori campo, maglie bianche e nere, fascia ambra del Leader). Riusa `.btn`, `.panel`, `.list`, `.chip`, `.field` prima di creare stili nuovi.
- Testi in italiano, tono amichevole e diretto. Niente maiuscole su intere etichette, niente separatori a punto centrale tra informazioni.
- Accessibilità: pulsanti di almeno 44 px, etichette per i lettori di schermo, rispetto di `prefers-reduced-motion`.
- Date sempre nel fuso Europe/Rome tramite `src/app/core/format.ts`.
- Giocatori senza account (`profiles.guest`): `profiles.id` non è più vincolato ad `auth.users`. Ogni nuova tabella o colonna che fa riferimento a un giocatore va aggiunta in `merge_profiles`, altrimenti collegando un account quei dati resterebbero indietro. Ogni nuova funzione che richiede un account (ruoli, deleghe, azioni personali) deve rifiutare i profili `guest`. `notify()` salta già i profili senza account.
- Statistiche per partita: per nuove statistiche di giocatori parti da `player_match_facts` (rispetta già periodo, risultati omologati e azzeramento), come `player_kit_stats` e `pair_stats`.
- Statistiche: ogni nuova statistica calcolata deve rispettare l'azzeramento, cioè contare solo le partite con `starts_at >= coalesce(greatest(app_settings.stats_since, profiles.stats_since), '-infinity')`, come fanno `player_match_facts`, `stats_table` e `attendance_register`.
- Giocatori: `session.activeMembers()` comprende quelli senza account (vanno in lista, formazioni, voti); per tutto ciò che richiede un account (precedenza, deleghe, "non hanno risposto", permessi sui voti) usa `session.accountMembers()`.
- Squadre e posti: usa `store.size()` per i posti in lista, `store.teamNames()` (o `teamNames()` di `core/kits.ts`) per i nomi, `formation(n)` di `core/formations.ts` per le posizioni in campo. I colori delle divise arrivano come variabili CSS `--team-a`/`--team-b` (e `-ink`) impostate dalla pagina della partita.
- Punizioni: ogni azione di intervento nei componenti inizia con `if (this.reprimand.guard()) return;`. Un errore `GDL01` dal server mostra comunque il rimprovero (passa da `Toasts.error`).
- Giocatori nel tabellone: usa `<app-figurina>` (foto o sigla, distintivo del numero, fascia «C» del capitano, nota sotto il nome). Le sigle senza foto hanno un colore tenue ricavato dall'identificativo (`--av-h` in `<app-avatar>`); in campo valgono i colori delle squadre (classi `.white`/`.black`).
- Foto profilo: mostrale sempre con `<app-avatar [userId] [size] [team]>` (usa i link firmati di `Session.avatarUrls` e ripiega sulle iniziali). Il contenitore `avatars` è privato: non renderlo pubblico e non costruire URL a mano. Per cancellare un file usa l'API dello Storage, non SQL (resterebbe orfano).
- iPhone: la barra di stato resta "default" (in `index.html`). Non usare "black-translucent": con quella modalità Safari sposta gli elementi fissati in basso (bug WebKit 236445) e la barra di navigazione salta durante i caricamenti. La classe `.page` lascia comunque lo spazio di `env(safe-area-inset-top)`; sotto un'intestazione che lo lascia da sé (pagina partita) usa `.page.below-header`. App shell (`app.ts`): la colonna è alta `100dvh` con `max-height: 100%`, mai `100vh` (sull'iPhone con l'app installata supera l'area visibile e nasconde la barra); il documento non scorre mai; scorre solo il riquadro `.app-scroller` e la barra è l'ultimo elemento della colonna. Non rendere scorrevole la finestra e non usare `window.scrollTo`: usa `scrollAppTo` di `core/scroller.ts`. La colonna ha `overflow: clip` e il riquadro `.app-scroller` è `position: relative`: non togliere nessuno dei due, altrimenti un elemento nascosto (`.sr-only`) che riceve il fuoco fa scorrere l'intera colonna fuori dallo schermo (schermo nero). Nelle guardie del router chiama `inject()` prima di qualsiasi `await` (errore NG0203). Così la barra non si muove quando una pagina carica e cambia altezza. Niente View Transitions né animazioni con `transform` sul cambio pagina.

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
