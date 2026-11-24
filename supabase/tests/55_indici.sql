\set ON_ERROR_STOP 1
\pset footer off
-- Migrazione 73: le colonne più lette per giocatore o partita hanno un indice.
do $$
declare
  manca text;
begin
  select string_agg(t || '.' || c, ', ') into manca
  from (values ('bookings','user_id'), ('lineup','user_id'), ('scorers','user_id'), ('player_votes','target_id'),
               ('player_votes','voter_id'), ('mvp_votes','voter_id'), ('chat_messages','user_id'), ('notifications','match_id'),
               ('pay_expenses','match_id'), ('pay_expenses','payer_id'), ('pay_cards','match_id')) as x(t, c)
  where not exists (
    select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where i.indrelid = ('public.' || x.t)::regclass and a.attname = x.c);
  if manca is not null then raise exception 'indici mancanti: %', manca; end if;
end $$;
select 'indici ok' as esito;
