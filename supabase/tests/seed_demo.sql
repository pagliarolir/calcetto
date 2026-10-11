-- Dati dimostrativi: 14 giocatori, 4 partite giocate, la prossima con prenotazioni aperte.
insert into auth.users (email, raw_user_meta_data)
select lower(n)||'@calcetto.it', jsonb_build_object('first_name', n, 'last_name', c)
from (values (1,'Marco','Rinaldi'),(2,'Luca','Ferri'),(3,'Andrea','Costa'),(4,'Davide','Greco'),(5,'Simone','Bruno'),(6,'Matteo','Gallo'),
  (7,'Paolo','Conti'),(8,'Stefano','Marino'),(9,'Giorgio','Lombardi'),(10,'Fabio','Moretti'),(11,'Riccardo','Barbieri'),(12,'Alessio','Fontana'),
  (13,'Nicola','Santoro'),(14,'Emanuele','Rizzi')) v(o,n,c) order by o;
update profiles set role='premier1' where first_name='Luca';
update profiles set role='premier2' where first_name='Andrea';
update profiles set nickname='Il Bomber', field_role='pivot' where first_name='Davide';
update profiles set nickname='Saracinesca', field_role='portiere' where first_name='Giorgio';
create temp table ids as select first_name n, id from profiles;

do $$
declare
  m uuid; k int; players uuid[]; w text[] := array['white','black'];
  sw int[] := array[6,3,5,7]; sb int[] := array[4,5,5,2];
begin
  for k in 1..4 loop
    m := create_match(now() - make_interval(days => 7*(5-k)) - interval '2 hours', (now() - make_interval(days => 7*(5-k)))::date);
    select array_agg(id order by md5(id::text || k)) into players from profiles
      where first_name not in ('Emanuele', (array['Nicola','Riccardo','Paolo','Alessio'])[k]);
    delete from bookings where match_id = m;
    insert into bookings (match_id,user_id,choice,list,sort_key)
      select m, p, 'present', 'team', now() - make_interval(secs => ord::int) from unnest(players[1:10]) with ordinality u(p, ord);
    insert into lineup (match_id,user_id,team,field_slot)
      select m, p, w[1 + (ord::int % 2)], ((ord::int - 1) / 2) + 1 from unnest(players[1:10]) with ordinality u(p, ord);
    insert into results (match_id,diff,white_goals,black_goals,entered_by,status,homologated_by,homologated_at)
      values (m, sw[k]-sb[k], sw[k], sb[k], players[1], 'homologated', 'quorum', now());
    insert into scorers (match_id,user_id,goals,assists)
      select m, l.user_id,
        case when l.rn = 1 then ceil(tg / 2.0) when l.rn = 2 then floor(tg / 2.0) else 0 end,
        case when l.rn between 2 and 3 and tg > 0 then 1 else 0 end
      from (select user_id, team, row_number() over (partition by team order by md5(user_id::text||k)) rn,
                   case when team = 'white' then sw[k] else sb[k] end tg
            from lineup where match_id = m) l
      where l.rn <= 3;
    delete from scorers where match_id = m and goals = 0 and assists = 0;
    insert into player_votes (match_id,voter_id,target_id,score)
      select m, a.user_id, b.user_id, 5 + (abs(hashtext(a.user_id::text || b.user_id::text || k)) % 9) / 2.0
      from lineup a join lineup b on a.match_id = b.match_id and a.user_id <> b.user_id where a.match_id = m;
    insert into mvp_votes (match_id, voter_id) select m, user_id from lineup where match_id = m;
    update matches set status='played', locked=true, sent_open=true, sent_result=true, lineup_status='official' where id = m;
  end loop;
end $$;

update matches set starts_at = date_trunc('day', now()) + interval '2 days 18 hours',
  bookings_open_at = now() - interval '1 day', sent_open = true
where status = 'scheduled';
do $$ declare m uuid := (select id from matches where status='scheduled'); nm text;
begin
  foreach nm in array array['Luca','Andrea','Davide','Simone','Matteo','Stefano','Giorgio','Fabio'] loop
    perform _book((select id from ids where ids.n=nm),(select id from ids where ids.n=nm), m, 'present', true);
  end loop;
  perform _book((select id from ids where ids.n='Alessio'),(select id from ids where ids.n='Alessio'), m, 'reserve', true);
  perform _book((select id from ids where ids.n='Riccardo'),(select id from ids where ids.n='Riccardo'), m, 'absent', true);
  insert into chat_messages (match_id,user_id,body) values
   (m,(select id from ids where ids.n='Luca'),'Chi porta il pallone giovedì?'),
   (m,(select id from ids where ids.n='Davide'),'Io, ma qualcuno porti le pettorine nere'),
   (m,(select id from ids where ids.n='Marco'),'Le porto io. Manca uno, giratelo in giro!');
end $$;
select first_name, role from profiles where role <> 'user';
select count(*) matches, count(*) filter (where status='played') played from matches;
