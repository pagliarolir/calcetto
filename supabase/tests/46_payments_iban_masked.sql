\set ON_ERROR_STOP 1
\pset footer off
-- Pagamenti (migrazione 60): IBAN degli altri mascherato (anche al Leader), copiabile solo da chi deve pagare;
-- i debiti di tutti solo al Leader (migrazione 61)
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,4) g;
update profiles set nickname = 'Bobbo' where first_name = 'P2';
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated, anon;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
grant execute on function as_user(text), pid(text) to authenticated, anon;
select as_user('P1'), pay_set_visibility(false, array[pid('P3'), pid('P4')]);
select as_user('P3'), pay_save_methods(null, 'IT60 X054 2811 1010 0000 0123 456', 'P Tre');
-- P3 ha pagato 40 € per tutti: P1, P2, P4 gli devono 10 € a testa
select as_user('P3'), pay_add_expense('Campo', 4000, pid('P3'), array[pid('P1'), pid('P2'), pid('P3'), pid('P4')]) is not null as spesa;
\echo '--- IBAN di P3 visto da P2 (debitore), dal Leader e da P3 stesso'
select as_user('P2'), (select m->>'iban' from jsonb_array_elements(pay_overview()->'methods') m where m->>'user_id' = pid('P3')::text) as visto_da_p2;
select as_user('P1'), (select m->>'iban' from jsonb_array_elements(pay_overview()->'methods') m where m->>'user_id' = pid('P3')::text) as visto_dal_leader;
select as_user('P3'), (select m->>'iban' from jsonb_array_elements(pay_overview()->'methods') m where m->>'user_id' = pid('P3')::text) as visto_da_p3;
\echo '--- copia: P2 sì, P3 il suo sì'
select as_user('P2'), pay_reveal_iban(pid('P3')) as copia_p2;
select as_user('P3'), pay_reveal_iban(pid('P3')) as copia_p3;
\echo '--- dalla migrazione 61 i debiti di tutti li vede solo il Leader: P4 vede solo il suo (1 riga)'
select as_user('P4'), jsonb_array_length(pay_overview()->'transfers') as debiti_visti_da_p4;
do $$ begin
  perform as_user('P2');
  if (select m->>'iban' from jsonb_array_elements(pay_overview()->'methods') m where m->>'user_id' = pid('P3')::text) <> 'IT60***********************' then
    raise exception 'IBAN non mascherato per P2'; end if;
  if pay_reveal_iban(pid('P3')) <> 'IT60X0542811101000000123456' then raise exception 'P2 deve poter copiare'; end if;
  perform as_user('P1');
  if (select m->>'iban' from jsonb_array_elements(pay_overview()->'methods') m where m->>'user_id' = pid('P3')::text) not like 'IT60*%' then
    raise exception 'anche al Leader va mascherato'; end if;
  perform as_user('P4');
  if jsonb_array_length(pay_overview()->'transfers') <> 1 then raise exception 'P4 vede solo i suoi debiti'; end if;
  perform as_user('P1');
  if jsonb_array_length(pay_overview()->'transfers') <> 3 then raise exception 'il Leader vede tutti i debiti'; end if;
end $$;
\set ON_ERROR_STOP 0
\echo '--- P3 (creditore) non può copiare l IBAN di P2, P2 salda e poi non può più copiare quello di P3 (attesi 2 errori; in mezzo P3 segna «Ricevuti» da sé)'
select as_user('P3'), pay_reveal_iban(pid('P2'));
select as_user('P3'), pay_mark_paid(pid('P3'), 1000, 'cash', pid('P2')) is not null as saldato;
select as_user('P2'), pay_reveal_iban(pid('P3'));
\set ON_ERROR_STOP 1
do $$ begin
  if not exists (select 1 from pay_settlements where from_id = pid('P2') and to_id = pid('P3') and status = 'confirmed') then
    raise exception 'il «Ricevuti» di P3 deve valere subito'; end if;
end $$;
