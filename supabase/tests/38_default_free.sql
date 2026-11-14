\set ON_ERROR_STOP 1
\pset footer off
-- Predefinita «sceglie il Leader» (migrazione 52)
\echo '--- 1) configurazione predefinita: free'
select booking_mode from app_settings;
\echo '--- 2) una partita creata in automatico nasce con «sceglie il Leader»'
create temp table nm as select create_match(now() + interval '20 days') as id;
select booking_mode from matches where id = (select id from nm);
