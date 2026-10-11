# Calcetto del giovedì: istruzioni per chi lavora sul codice

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

## Decisioni confermate dal proprietario

- La leadership passa al Secondo Premier solo se anche il Primo è inattivo da 15 giorni.
- La riserva che risponde "Non posso" viene registrata come assente.
- Finestra di voto di 48 ore, configurabile in Gestione.
- Tutto deve restare gratuito: niente servizi o librerie a pagamento.

## Pubblicazione

Un push su `main` ricompila e pubblica su GitHub Pages. Le modifiche al database e alle Edge Functions vanno applicate lanciando il workflow "Aggiorna Supabase".
