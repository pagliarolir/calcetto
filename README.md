# G.d.L.

PWA per organizzare la partita settimanale: prenotazioni a slot con riserve, squadre bianchi contro neri disposte sul campo, risultato con omologazione, pagelle segrete, chat di partita e statistiche. Notifiche push con pulsanti di risposta rapida.

Tutto gira su servizi gratuiti: **Angular 21** per l'app, **Supabase** (piano Free) per database, accessi, tempo reale e funzioni, **GitHub** per codice, versioni, test e pubblicazione su **GitHub Pages**.

## Come è fatta

```
Telefono (PWA Angular)  ──REST/Realtime──▶  Supabase Postgres
   │  service worker                          │  regole RLS + funzioni SQL (tutta la logica)
   │  ◀── Web Push ──┐                        │  pg_cron ogni 5 minuti (scheduler)
   │                 │                        │  coda "notifications" ──pg_net──┐
   └─ pulsanti ──▶ Edge Function             ◀┘                                 │
      notifica      quick-action      Edge Function push-dispatch ◀─────────────┘
```

Le regole del gioco stanno nel database, non nell'app: nessuno può aggirarle modificando il client. Ogni scrittura passa da una funzione SQL che controlla permessi, orari e coerenza. I voti sono protetti da Row Level Security, quindi un giocatore non può leggere quelli degli altri nemmeno interrogando l'API direttamente.

```
src/app/core        sessione, API, push, formattazione
src/app/match       pagina partita e schede (lista, squadre, risultato, pagelle, chat)
src/app/pages       classifica, giocatore, avvisi, profilo, gestione, accesso
public/sw-custom.js service worker: motore Angular + pulsanti delle notifiche
supabase/migrations schema, logica, sicurezza, statistiche, scheduler
supabase/functions  push-dispatch (invio push), quick-action (risposte dalle notifiche),
                    admin-reset-password (password temporanea data dal Leader)
supabase/templates  email di recupero password in italiano
supabase/tests      scenari di test sul database
```

## Messa in funzione

Serve un account GitHub e uno Supabase, entrambi gratuiti. Calcola circa mezz'ora.

**1. Repository.** Crea un repository **pubblico** su GitHub e carica questi file. GitHub Pages gratuito richiede un repository pubblico; non ci sono segreti nel codice, quindi va bene. Se lo vuoi privato, pubblica su Cloudflare Pages (gratuito anche per repository privati) invece che su GitHub Pages.

**2. Progetto Supabase.** Crea un progetto, regione europea (es. Francoforte). Da *Project Settings → API* annota l'URL del progetto, l'ID (la parte prima di `.supabase.co`) e la chiave pubblica (*anon* / *publishable*).

**3. Accessi.** In *Authentication → Sign In / Providers → Email* disattiva **Confirm email**: il servizio email incluso in Supabase consegna solo agli indirizzi del team del progetto, quindi le conferme non arriverebbero agli amici. In *Authentication → URL Configuration* imposta come Site URL e Redirect URL l'indirizzo dell'app, es. `https://tuonome.github.io/calcetto/`. Facoltativo: abilita Google come provider e imposta la variabile `GOOGLE_LOGIN=true` (punto 8).

**3b. Recupero password via email (consigliato).** Senza un servizio email il recupero funziona comunque tramite il Leader (vedi più sotto), ma è comodo che ognuno possa farlo da solo.
- Crea un account presso un servizio SMTP con piano gratuito e verifica l'indirizzo mittente (es. `gdl.gruppo@gmail.com` o un indirizzo tuo). Controlla i limiti attuali del piano scelto: per un gruppo bastano poche email al mese.
- In Supabase, *Authentication → Emails → SMTP Settings*: attiva l'SMTP personalizzato e inserisci host, porta, utente, password e mittente forniti dal servizio.
- In *Authentication → Emails → Templates → Reset Password* incolla `supabase/templates/recupero-password.html` (modello in italiano) e come oggetto "Recupera la password di G.d.L.".
- In *Authentication → URL Configuration* aggiungi tra i Redirect URL anche `https://tuonome.github.io/calcetto/nuova-password`.

**4. Database.** Due strade.
- *Da GitHub (consigliata)*: crea un token in Supabase (*Account → Access Tokens*), limitato al solo progetto di G.d.L. e con permessi minimi: Project Settings, API Keys e API Key Secrets in lettura, Edge Functions in lettura-scrittura; nulla sul Database, perché le migrazioni usano la password del database, poi nel repository aggiungi i secret `SUPABASE_ACCESS_TOKEN` e `SUPABASE_DB_PASSWORD` e la variabile `SUPABASE_PROJECT_REF`. Lancia il workflow **Aggiorna Supabase** dalla scheda *Actions*: applica le migrazioni e pubblica le tre funzioni.
- *A mano*: incolla nel *SQL Editor* i file di `supabase/migrations` uno alla volta, in ordine.

Se `create extension pg_cron` o `pg_net` dà errore, abilitale da *Database → Extensions* e rilancia.

**5. Chiavi per le notifiche.** Sul tuo computer:
```
npx web-push generate-vapid-keys
```

**6. Segreti delle funzioni.** In *Edge Functions → Secrets* aggiungi:

| Nome | Valore |
|---|---|
| `VAPID_PUBLIC_KEY` | chiave pubblica del punto 5 |
| `VAPID_PRIVATE_KEY` | chiave privata del punto 5 |
| `VAPID_SUBJECT` | `mailto:` seguito dalla tua email |
| `DISPATCH_SECRET` | una stringa casuale lunga |
| `QUICK_ACTION_SECRET` | un'altra stringa casuale lunga |

Se hai pubblicato le funzioni a mano: `push-dispatch` e `quick-action` vanno con `--no-verify-jwt` (sono protette dai segreti), `admin-reset-password` invece senza (serve un utente collegato).

**7. Collegamento database → notifiche.** Apri `scripts/setup-secrets.sql`, sostituisci ID del progetto e `DISPATCH_SECRET`, eseguilo nel *SQL Editor*.

**8. Pubblicazione.** Nel repository: *Settings → Pages → Source: GitHub Actions*. In *Settings → Secrets and variables → Actions → Variables* aggiungi `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VAPID_PUBLIC_KEY`. Ogni push su `main` ricompila e pubblica l'app.

**9. Primo accesso.** Il primo utente che si registra diventa Leader. Da *Gestione* nomina i due Premier e, se vuoi, imposta un codice invito: chi si registra senza codice resta in attesa di approvazione.

**10. Sul telefono.** Android: apri il link in Chrome e scegli *Installa app*. iPhone (iOS 16.4 o successivo): Safari, *Condividi → Aggiungi alla schermata Home*, poi apri l'app dall'icona. Infine *Profilo → Attiva le notifiche*.

## Recupero password

Ci sono due strade, pensate per coprirsi a vicenda.

**Da soli, via email.** Nella pagina di accesso, *Password dimenticata?* manda un link valido un'ora. Il link apre la pagina *Nuova password*. Il messaggio di conferma è lo stesso che l'email esista o no, così nessuno può scoprire chi è iscritto. Serve l'SMTP del punto 3b.

**Dal Leader, senza email.** In *Gestione* ogni giocatore ha un pulsante con la chiave. Genera una password temporanea di 12 caratteri senza simboli ambigui, da copiare o condividere in privato. Chi la riceve entra e viene obbligato a sceglierne una sua prima di poter fare qualsiasi altra cosa. Regole:
- il Leader (o chi ne ha i poteri) può farlo per tutti tranne sé stesso;
- i Premier solo per i giocatori semplici;
- il Leader titolare usa sempre l'email.

Chi subisce la reimpostazione riceve un avviso. Se l'ha fatta un Premier, viene avvisato anche il Leader: nessuno può entrare nell'account di un altro senza che si sappia.

Chiunque può cambiare la propria password da *Profilo → Cambia password*.

## Sviluppo in locale

```
npm ci
# inserisci URL, chiave pubblica e chiave VAPID in src/environments/environment.ts
npm start
```
Il service worker è attivo solo nella build di produzione: per provare installazione e push usa `npx ng build` e servi `dist/calcetto/browser` in HTTPS o su `localhost`.

Test del database, con un Postgres 16 locale:
```
PGHOST=localhost PGPORT=5432 bash supabase/tests/run.sh
```
`supabase/tests/seed_demo.sql` carica 14 giocatori e 4 partite di esempio, ma solo su un database di prova locale: non eseguirlo su quello vero.

### Giocatori finti sul progetto vero

Per provare l'app con un gruppo pieno, `scripts/mock-users.sql` crea fino a 24 giocatori finti (indirizzi `@mock.calcetto.test`, che non ricevono email) e, se vuoi, li prenota alla prossima partita.

1. Registrati tu per primo dall'app: il primo account creato diventa Leader.
2. Apri `scripts/mock-users.sql`, copia tutto e incollalo nel *SQL Editor* di Supabase.
3. In cima al file puoi cambiare `n` (quanti finti) e `prenota` (quanti metterne in partita; oltre il decimo vanno tra le riserve). Premi **Run**: in basso compare un riepilogo.
4. Quando hai finito, esegui la riga di cancellazione che trovi in fondo al file: con i finti spariscono anche prenotazioni e voti.

I finti non hanno password, quindi nessuno può accedere con i loro account; si vedono nella lista, si prenotano, entrano nelle squadre e nelle statistiche. Si può rilanciare: salta chi esiste già. Se sono rimasti nel gruppo vero, compaiono nelle statistiche: cancellali subito dopo le prove.

*Facoltativo, se vuoi entrare come uno dei finti per provare l'app da giocatore normale:* `scripts/mock-users.mjs` li crea con una password, usando la chiave segreta del progetto (*Project Settings → API Keys*) da un terminale.

```
npm ci
export SUPABASE_URL="https://IDPROGETTO.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="la-chiave-segreta"      # PowerShell: $env:NOME = "valore"
node scripts/mock-users.mjs create --count 12 --prenota 11
node scripts/mock-users.mjs delete --yes
```

La chiave segreta dà accesso totale al progetto: tienila solo nel terminale, mai in un file del repository.

## Requisiti e dove sono realizzati

| Requisito | Realizzazione |
|---|---|
| Parte alta fissa e schede della Classifica (aggiornamento) | In Classifica (titolo, periodo e schede), Profilo (foto e schede) e Partita (intestazione verde con le schede) la parte alta è fissa e scorre solo il contenitore centrale (`.page-head` + `.scroll-area` in `styles.scss`): la barra di scorrimento comincia sotto l'intestazione; la barra in basso resta sempre ferma. Le altre pagine scorrono come prima. Schede della Classifica larghe quanto la parola, 3 sopra e 2 sotto, equidistanti |
| Soprannome, missioni e ritocchi (aggiornamento) | Migrazione `20261010000032`. Nel Profilo il nome si può nascondere: si apre una finestra per il soprannome, che prende il posto del nome per gli altri (`members_list`, `display_name`; il database lo impone con `trg_profiles_name_visibility`). La missione di uno sticker si vede appena qualcuno l'ha sbloccato (`achievement_missions`). App: via «Ti arriva una notifica»; schede degli elenchi più leggibili; striscia Bianchi/Neri più grande e senza «contro»; logo del tabellone quadrato, alto quanto le scritte accanto e con gli angoli arrotondati; schede della Classifica su più righe; colonne Gol, Pt, PG, V, N, P, Aut…; niente numerini sugli sticker; «Indietro» nella scheda del giocatore |
| Correzioni e premi (aggiornamento) | Migrazione `20261010000031`. Corretto l'errore "null value in column body" quando il Leader cambia lo stato di un giocatore con «sceglie il Leader» (i posti non sono numerati), anche nelle azioni rapide; con quella modalità un solo avviso al giocatore. Monnezza solo a chi era nella formazione ufficiale e si ritira da sé (`bookings.left_official_lineup`; tolti quelli automatici assegnati con la regola vecchia). Nuovo premio automatico «Salva Leader»: «ci sono» detto da sé nelle 24 ore prima della partita ed entrare in squadra (`bookings.present_at`). App: tolta la frase «puoi cambiare idea»; pulsanti di risposta su tutta la riga; schede degli elenchi sempre in una riga (compatte con quattro); nel Profilo interruttori senza scritta e centrati sul campo, data di nascita più corta |
| Partita finita: formazioni e segni (aggiornamento) | A partita finita l'intestazione non ha più la striscia squadre/risultato; nel Risultato il punteggio è centrato tra due maglie dei colori delle squadre, alte quanto punteggio ed etichetta; sotto le formazioni complete con pallone bianco (gol), pallone rosso (autogol) e scarpino (assist) (`ui/match-marks.ts`); i dati si inseriscono toccando il proprio nome (il Leader qualsiasi); «Correggi il risultato» diventa una tendina sotto le formazioni. Prima della partita la striscia ha solo i pallini dei colori. Obiettivi: gli sticker con l'immagine caricata ma non ancora sbloccati si vedono come sagoma nera con contorno bianco |
| Obiettivi e intestazione della Classifica (aggiunta) | Migrazione `20261010000030`. Periodo della Classifica in un menu a tendina accanto al titolo, senza la riga delle date. Scheda **Obiettivi** dopo Punti Leader: album di sticker a 4 colonne (`achievements`, `player_achievements`), missione segreta finché non lo sblocchi (`achievement_missions`: il Leader le vede tutte), classifica degli obiettivi, sticker sotto la foto nella scheda del giocatore, avviso a tutti per 24 ore (raggruppato per sticker) e notifica (voce «Obiettivi sbloccati»). 8 premi automatici calcolati da `check_achievements` (trigger su partite, risultati, marcatori, ritiri); il Leader carica le immagini (contenitore pubblico `stickers`), assegna e toglie gli sticker, crea ed elimina i propri obiettivi. Lo storico presente al momento dell'aggiornamento si assegna in silenzio |
| Classifica senza scorrimento, ex giocatori (aggiornamento) | Classifica: tolte le colonne Ast, GF, GS, DR, Serie V, Pres, Rin, Forf; Gol e Aut davanti; la tabella non supera mai la larghezza dello schermo (si vedono le colonne scelte finché c'è posto) e la finestra «Colonne» permette di scegliere quali vedere entro quel limite (scelta salvata sul dispositivo). Tolta la scheda Presenze. «Squadre e coppie» in una scheda: vittorie per colore, coppie e rivalità a tendina, in fondo le affinità del giocatore scelto. Il Leader elimina definitivamente un ex giocatore (migrazione `20261010000029`, `delete_former_member`: profilo, account e dati) |
| Due loghi, elenchi a schede, partita finita (aggiornamento) | Migrazione `20261010000028`. Due loghi dal Leader: **logo del tabellone** (`header_logo_id`, trasparente, intero) e **icona dell'app** (`logo_id`: ritagliata a riempire il quadrato oppure intera su un colore scelto, mai bianco di default). Migliore in campo obbligatorio nelle partite a migliore unico. Tabellone: Titolari, Riserve, Assenti (e Disponibili con «sceglie il Leader») in schede con i conteggi; chi non ha risposto dentro Assenti. A partita finita le schede sono Risultato (prima, con i marcatori in due colonne aggiornati in tempo reale), Pagelle (migliore in evidenza con il numero di voti da migliore) e Chat; prima della partita Lista, Squadre e Chat |
| Marcatori, omologazione, durata, logo, migliore in campo (aggiornamento) | Migrazione `20261010000027`. Marcatori: ognuno inserisce solo i propri gol/assist/autogol, il Leader quelli di tutti, e i dati del Leader (`scorers.set_by_leader`) non si cambiano dagli altri. Il risultato lo omologa solo il Leader (o chi ne fa le veci): niente più omologazione automatica con le conferme né da parte dei Premier; il Leader riceve «Risultato da omologare». Durata della partita da 1 a 90 minuti nella configurazione. Logo dell'app (`core/branding.ts`, contenitore pubblico `branding`): icona della scheda, icona per iPhone e manifest, e nel tabellone della partita al posto del calendario. Un solo migliore in campo, scelto in cima alle pagelle (`matches.mvp_mode`: le partite votate prima restano «uno per squadra»). Tabellone: centro sportivo e indirizzo su due righe, si apre la mappa solo dall'indirizzo; niente «C» al Leader nella lista |
| Profilo a schede e intestazione a biglietto (aggiornamento) | Profilo con le schede Dati, Foto, Notifiche e Sicurezza (icona e nome; indirizzo `/profilo?scheda=…`; frecce da tastiera); gli avvisi di foto rimossa e password reimpostata aprono la scheda giusta (migrazione `20261010000026`). Intestazione della partita a biglietto: riquadro calendario, data grande, orario in evidenza, luogo su una riga (mappa) con il sito del circolo accanto, striscia delle squadre che diventa il punteggio |
| Pagelle: medie e cursore (aggiornamento) | Migrazione `20261010000025`: le medie nelle Pagelle si vedono sempre; la soglia `vote_min_voters` vale solo per far contare la media in classifica (in Gestione: «Votanti minimi perché la media conti in classifica»). Cursore del voto `ui/vote-slider.ts`: con il dito cambia solo trascinando di lato (tocchi e scorrimento verticale non lo toccano), con il mouse basta un clic, frecce da tastiera; barra dal rosso al verde passando per il giallo. Intestazione della partita compatta su tutta la larghezza |
| Preferenze sulle notifiche (aggiunta) | Migrazione `20261010000024`: nel Profilo ognuno sceglie quali avvisi ricevere (`profiles.notify_prefs`): chat, apertura prenotazioni, squadra al completo, rinuncia di un titolare, formazioni ufficiali, cambi di formazione, giorno/orario/campo, risultato, votazioni. Valgono per notifiche e Avvisi; la chat parte spenta; gli avvisi personali e i compiti dello staff arrivano sempre (`notify_category`, `notify_wanted` in `notify`). Nuovi avvisi: messaggi in chat (al massimo uno ogni 10 minuti finché non lo leggi), squadra al completo, rinuncia di un titolare; chi compie l'azione non viene avvisato |
| Votazioni e intestazione (aggiornamento) | Migrazione `20261010000023`: il Leader (o chi ne fa le veci) vota anche se non ha giocato; i voti inviati sono definitivi per tutti; invio vuoto rifiutato. App: nessun cursore (scorrendo non cambia più nulla); ogni compagno parte da 6, che vale come voto; righe compatte con il voto in un distintivo colorato che si tocca per aprire un pannello nativo (`<dialog>`) con i voti da 1 a 10; conferma esplicita; sotto-schede Vota, Medie, I miei voti, Per votante. Intestazione della partita a tabellone: squadre ai lati, al centro l'orario o il punteggio |
| Sicurezza e permessi (aggiornamento) | Migrazione `20261010000022`: permessi espliciti a `service_role` su tutte le tabelle (Supabase dal 30/10/2026 non li assegna più in automatico ai nuovi progetti); vista `members` non più "security definer": le regole di visibilità stanno nella funzione `members_list` e la vista è `security_invoker` |
| Interfaccia (aggiornamento) | Tabellone a figurine (`ui/figurina.ts`): foto o sigla nel cerchio, numero del posto come distintivo, fascia «C» del Leader; sigle con un colore per giocatore; riquadro calendario nell'elenco partite; icona per tipo negli avvisi; foto accanto ai messaggi in chat; pannelli ed elenchi più morbidi e titoli di sezione con il segno verde |
| Rinunce in qualsiasi momento (aggiunta) | Migrazione `20261010000021`: `bookings.withdrew` segna ogni rinuncia (chi era in squadra ed esce, in qualunque momento e modalità), accanto a `late_withdrawal` (nelle 24 ore). Classifica: colonne Rin (tutte) e Forf (nelle 24 ore); registro presenze: «r» rinuncia, «!» rinuncia nelle 24 ore, «●» se alla fine ha giocato |
| Punti Leader e statistiche a schede (aggiunta) | Migrazione `20261010000020`. **Punti Leader**: il Leader (o chi ne fa le veci) assegna o toglie da -99 a +99 punti alla volta con motivazione (`award_leader_points`, annullabili con `delete_leader_points`); classifica (`leader_points_table`) e storico visibili a tutti; avviso al giocatore; indipendenti da partite e azzeramento; seguono il giocatore quando collega un account. **Classifica a schede**: Classifica, Record, Presenze, Squadre (`team_kit_stats`, `player_kit_stats`: vittorie per colore della divisa), Coppie (`pair_stats`: affinità da compagni e da avversari, coppie più affiatate e rivalità), Punti Leader; la scheda si apre anche da indirizzo (`/classifica?scheda=punti`) |
| Modalità di prenotazione (aggiunta) | Migrazione `20261010000019`, parte della configurazione della partita e di quella predefinita. **In ordine di arrivo** (predefinita): come sempre. **Sceglie il Leader**: i giocatori rispondono solo ci sono (lista `pending`, disponibili) o non ci sono; il Leader sceglie titolari e riserve (`leader_assign`, anche le riserve senza ordine) e conferma (`leader_confirm_lists`: i rimasti diventano riserve, avvisi a tutti, prenotazioni chiuse); dopo la conferma ogni cambio avvisa solo l'interessato; nessuna promozione automatica. Il Leader chiude prima o riapre le prenotazioni in entrambe le modalità (`leader_close_bookings`, `leader_reopen_bookings`). Cambiando modalità le risposte si convertono (`convert_booking_mode`) |
| Giocatori senza account (aggiunta) | Migrazione `20261010000018`: il Leader (o delegato) crea, modifica ed elimina profili di giocatori senza account (`create_guest`, `update_guest`, `delete_guest`). Si mettono in lista, entrano nelle formazioni, vengono votati e restano nelle statistiche; non ricevono avvisi e non possono avere ruoli, deleghe, punizioni o password. Invito personale (`create_guest_invite`, 14 giorni, una volta): chi crea l'account dal link (`/invito/:token`) prende il posto del profilo anche con il codice di gruppo attivo; chi ha già un account si unisce con `claim_guest_profile` (`merge_profiles`: nelle partite in comune restano i dati dell'account). Il profilo non è più legato per vincolo all'account: eliminando un utente un trigger elimina il suo profilo, come prima |
| Azzerare ed eliminare le statistiche (aggiunta) | Migrazione `20261010000017`, solo Leader o delegato. **Azzera** (reversibile, con **Ripristina**): per un giocatore (`profiles.stats_since`) o per tutti (`app_settings.stats_since`) contano solo le partite successive; lo storico resta intatto. **Elimina** (definitivo, conferma scrivendo «elimina», controllata anche nel database): di un giocatore cancella presenze, gol, assist, voti ricevuti e scelte come migliore in campo nelle partite giocate, non i voti dati agli altri; di tutti cancella lo storico delle partite giocate, le partite in programma restano. Scheda giocatore (singolo), Gestione (tutti); Classifica e scheda mostrano da quando contano le statistiche |
| Configurazione delle partite (aggiunta) | Migrazione `20261010000015`: ogni partita ha giocatori per squadra (5–8; posti in lista 10–16, riserve dopo, Leader sempre numero 1), colori delle due squadre da una tavolozza di 10 divise, apertura e chiusura delle prenotazioni (giorni prima e ora; dopo la chiusura cambia solo il Leader), apertura e durata delle votazioni. Gli orari si ricalcolano da soli (fuso di Roma, ora legale compresa). Configurazione predefinita in `app_settings`. Pagina Partite: creazione di una partita o di una serie settimanale fino a una data (date doppie o passate saltate); modifica della configurazione predefinita o di una partita con proposta di applicarla alle partite successive tramite caselle. Cambiando il numero di giocatori la lista si riassesta e le squadre vanno rifatte. La partita automatica settimanale ora viene creata solo se non ce n'è nessuna in programma |
| Punizioni (aggiunta) | Migrazione `20261010000014`: il Leader punisce un giocatore (1 giorno, 3 giorni, 1 o 2 settimane, 1 mese, fino a revoca o data a scelta, con motivo facoltativo) e la revoca quando vuole. Il punito legge tutto ma non interviene: prenotazioni, risposta da riserva, chat, risultato, marcatori, voti e formazioni sono bloccati nel database con l'errore `GDL01` (funzioni "guardiano" davanti alle originali `*_unchecked`); da Premier o delegato perde i poteri; non riceve gli inviti ad agire. A ogni tentativo l'app mostra il rimprovero con il cartellino rosso (`ui/reprimand.ts`) |
| Campo della partita (aggiunta) | `set_match_venue` (migrazione `20261010000013`): nome, indirizzo e link del circolo per partita; campo abituale in `app_settings` ereditato dalle nuove partite; link accettato solo http/https (`www.…` completato con `https://`); cambio di campo per una partita in programma avvisa squadra e riserve. App: nell'intestazione della partita il nome del circolo (link al sito, se c'è) e sotto l'indirizzo con le iniziali maiuscole e l'icona della mappa (Mappe di Apple su iPhone, Google Maps altrove); modulo negli Strumenti del Leader; campo nell'elenco delle partite |
| Azzeramento della risposta (aggiunta) | `leader_reset_booking` (migrazione `20261010000012`): il Leader riporta un giocatore a "non ha risposto"; se era in squadra sale la prima riserva, a 9 parte "manca un giocatore", con formazioni ufficiali esce dalle squadre; nessun forfait tardivo; il giocatore riceve un avviso con i pulsanti per rispondere (o con la data di apertura). Strumenti del Leader: stato attuale accanto a ogni nome |
| Foto profilo (aggiunta) | Storage di Supabase, contenitore privato `avatars` (migrazione `20261010000011`): ognuno carica solo nella propria cartella, le vedono solo i membri attivi con link firmati, si possono nascondere; ritaglio a 320 px nel browser senza metadati (`core/image.ts`); componente `<app-avatar>` in campo, classifica, pagelle, marcatori, scheda giocatore, profilo e gestione; Leader e Premier possono toglierne una (`remove_member_avatar`) |
| Recupero password (aggiunta) | email via Supabase Auth con modello italiano; password temporanea dal Leader con `admin-reset-password`, `can_reset_password`, obbligo di cambio al primo accesso |
| REQ-001…003 Dati utente, solo nome obbligatorio, visibilità | `profiles`, vista `members` che nasconde i campi privati; pagina Profilo |
| REQ-004 Leader, due Premier, utenti | `profiles.role`, un solo titolare per ruolo |
| REQ-005 Delega del Leader | `delegate_leadership`, con scadenza facoltativa; Gestione |
| REQ-006, 007 Regola dei 15 giorni | `acting_leader()`: Leader, poi Primo Premier, poi Secondo Premier se anche il Primo è inattivo; il Leader riprende i poteri appena si riconnette |
| REQ-008 Cancellazione utenti | `deactivate_member`: libera i posti futuri, lo storico statistico resta |
| REQ-009, 010 Giovedì 20–21, apertura lunedì a mezzogiorno con notifica | `create_match`, `compute_open_at`, scheduler |
| REQ-011 Presente, assente, riserva anche dalla notifica | `book`; pulsanti nella push via `quick-action` |
| REQ-012…014 Slot 1–10, riserve dall'11, eccedenza in coda | `_book`, vista `booking_board` |
| REQ-015…017 Cambi entro 24 ore, scorrimento riserve, rientro in coda | `_book` |
| REQ-018 Rinuncia nelle 24 ore avvisa Leader e Premier | `_book` |
| REQ-019 Notifica speciale quando si scende a 9 | `_book`, con pulsante "Ci sono" |
| REQ-020 Conferma delle riserve | promemoria 16 ore prima; "Disponibile" o "Non posso" (che registra come assente) |
| REQ-021, 022 Leader numero 1; se assente si conta dal 2 all'11 | `booking_board`; il numero 1 non viene mai riassegnato |
| REQ-023 Inserimenti diretti e finestre esclusive | `leader_book` (il giocatore inserito, riserva o segnato assente riceve un avviso, con pulsante "Non posso"), `set_priority_window`; Strumenti del Leader |
| REQ-024 Spostare la partita | `move_match`: le prenotazioni seguono la nuova data |
| REQ-025 Chat della partita | aperta dalla creazione della partita fino a 24 ore dopo la fine (migrazione `20261010000016`), in tempo reale |
| REQ-026…029 Squadre, formazioni, delegato con approvazione | `save_lineup`, `review_lineup`, `set_lineup_delegate`; formazioni fatte e pubblicate da subito (migrazione `20261010000016`), con promemoria a Leader e Premier a 24 ore dalla partita se non sono ancora ufficiali |
| REQ-030, 031 Campo 5 contro 5, notifica col proprio colore | scheda Squadre: tocca il giocatore e poi la posizione |
| REQ-032 Variazioni notificate | `notify_lineup_change`, anche per ingressi e uscite di riserve |
| REQ-033…036 Risultato alle 21:30, differenza o punteggio, conferme | `submit_result`, `review_result`, omologazione a 5 conferme |
| REQ-037, 038 Gol, assist, autogol con controllo dal vivo | scheda Risultato blocca i valori incoerenti; `scorer_issues` lato server |
| REQ-039, 040 Omologazione dello staff, chiusura a mezzanotte | `staff_homologate`, scheduler; dopo, modifica solo il Leader |
| REQ-041…044 Voti segreti 1–10 con mezzi voti, migliore per squadra | `submit_votes`, `vote_summary`, `mvp_picks` (scelta dedotta se manca) |
| REQ-045, 046 Il Leader vede tutto e può condividere | regole RLS su `player_votes`, `grant_vote_visibility` |
| REQ-047 Statistiche, serie aperte e chiuse, classifica, presenze | `stats_table`, `player_match_facts`, `attendance_register`; pagine Classifica e Giocatore |
| REQ-048 Periodi personalizzati | Classifica: sempre, anno, ultimo mese, ultima partita, date a scelta |
| REQ-049 PWA con push | service worker Angular più `sw-custom.js`, Web Push VAPID |
| REQ-050 Tutto gratuito | Supabase Free, GitHub Pages e Actions, font inclusi nell'app |
| REQ-051 Angular | Angular 21, componenti standalone, signals, senza zone.js |
| REQ-052, 053 Mobile, accessibile, animato | pulsanti grandi, focus visibile, etichette per lettori di schermo, tema chiaro e scuro, movimento ridotto rispettato |

## Scelte confermate

- La leadership passa al Secondo Premier solo se anche il Primo è inattivo da 15 giorni.
- Una riserva che risponde "Non posso" viene registrata come assente.
- Le votazioni restano aperte 48 ore dalle 21:30; il valore si cambia in *Gestione → Regole del gruppo*.
- Una riserva volontaria entra in squadra solo quando qualcuno libera un posto. Chi si è dichiarato presente ed è finito in coda entra appena c'è spazio.
- Se il Leader inserisce qualcuno a squadra piena, l'ultimo arrivato passa in testa alle riserve.
- Un risultato si può sostituire solo se ha più contestazioni che conferme. Leader e Premier possono sempre correggerlo fino a mezzanotte.
- Il migliore in campo può essere più di uno in caso di parità di preferenze.

## Limiti da conoscere

- **Sospensione Supabase**: i progetti gratuiti si sospendono dopo una settimana senza attività. L'uso settimanale basta; il workflow *Tieni sveglio Supabase* fa comunque un ping due volte a settimana.
- **Email**: la registrazione non richiede conferma via email, quindi non serve un server di posta. Il recupero via email sì (punto 3b). Finché non lo configuri, resta disponibile la password temporanea data dal Leader.
- **iPhone**: le push arrivano solo con l'app aggiunta alla schermata Home, e iOS non mostra i pulsanti nella notifica: toccandola si apre la partita.
- **Avvisi Supabase**: il linter della dashboard segnala la vista `members` come "security definer". È voluto: è il modo in cui la vista mostra agli altri solo i campi che hai scelto di rendere visibili.
