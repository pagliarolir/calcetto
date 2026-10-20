#!/usr/bin/env bash
# Esegue le migrazioni e gli scenari di test su un Postgres locale.
# Uso: PGHOST=localhost PGPORT=5432 bash supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")"
PSQL="psql -U ${PGUSER:-postgres} -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists calcetto_test" -c "create database calcetto_test" >/dev/null
$PSQL -d calcetto_test -f stubs.sql >/dev/null
for f in ../migrations/*.sql; do
  sed -E 's/^create extension if not exists (pg_net|pg_cron);//' "$f" | $PSQL -d calcetto_test >/dev/null
done
$PSQL -d calcetto_test -c "grant all on all tables in schema public to service_role" >/dev/null
for t in 01_slots.sql 02_partita_completa.sql 03_password.sql 04_leader_book_notify.sql 05_avatars.sql 06_reset_booking.sql 07_venue.sql 08_punishments.sql 09_match_config.sql 10_open_from_start.sql 11_stats_reset.sql 12_guests.sql 13_booking_modes.sql; do
  echo "== $t"
  $PSQL -d calcetto_test -f "$t" -v ON_ERROR_STOP=0 2>&1 | grep -vE "^ *as_user|^-+(\+-+)*$|^$|NOTICE|wal_level|HINT|^ *\| *\{" || true
  $PSQL -d postgres -c "drop database calcetto_test" -c "create database calcetto_test" >/dev/null
  $PSQL -d calcetto_test -f stubs.sql >/dev/null
  for f in ../migrations/*.sql; do sed -E 's/^create extension if not exists (pg_net|pg_cron);//' "$f" | $PSQL -d calcetto_test >/dev/null; done
  $PSQL -d calcetto_test -c "grant all on all tables in schema public to service_role" >/dev/null
done
echo "Migrazioni e scenari eseguiti."
