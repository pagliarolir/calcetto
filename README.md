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
| REQ-025 Chat da 24 ore prima a 24 ore dopo | `chat_messages` con regola di scrittura a tempo, in tempo reale |
| REQ-026…029 Bianchi e neri, formazioni dalle 24 ore, delegato con approvazione | `save_lineup`, `review_lineup`, `set_lineup_delegate` |
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
