-- Cartellini dei Pagamenti, regole confermate dal proprietario:
-- * la scadenza è sempre le 12 del giorno dopo la partita, anche se la spesa del campo viene inserita più tardi;
-- * il Leader titolare non prende cartellini (né giallo né rosso); tutti gli altri sì;
-- * lo sticker segreto si cerca anche con le lettere accentate;
-- * col rosso il giocatore esce dalle liste delle partite non ancora iniziate (non può giocare).

create or replace function public.pay_cards_tick() returns void
language plpgsql security definer set search_path = public as $$
declare c record; r record; u uuid; pid bigint; nag uuid; mm record;
begin
  -- 1) chi ha saldato (con le conferme) perde il cartellino; il rosso toglie anche la punizione
  for c in select * from pay_cards where cleared_at is null loop
    if pay_net(c.user_id) >= 0 then
      update pay_cards set cleared_at = now() where id = c.id;
      if c.punishment_id is not null then
        update punishments set revoked_at = now() where id = c.punishment_id and revoked_at is null;
      end if;
      perform notify(array[c.user_id], 'pay_card_cleared', 'Conti in regola',
        case when c.color = 'red' then 'Hai saldato e i pagamenti sono confermati: la punizione è finita.'
             else 'Hai saldato e i pagamenti sono confermati: il cartellino giallo è tolto.' end, '/pagamenti');
    end if;
  end loop;

  -- 2) partite con la spesa del campo arrivate alla scadenza e non ancora controllate
  for r in
    select e.match_id
    from pay_expenses e join matches m on m.id = e.match_id
    where e.deleted_at is null and e.match_id is not null
      and not exists (select 1 from pay_card_checks k where k.match_id = e.match_id)
    group by e.match_id
    having now() >= max(scorers_close_at(m))   -- sempre le 12 del giorno dopo, anche se la spesa arriva tardi
  loop
    insert into pay_card_checks (match_id) values (r.match_id) on conflict do nothing;
    for u in
      select distinct s.user_id from pay_shares s join pay_expenses e on e.id = s.expense_id
      where e.match_id = r.match_id and e.deleted_at is null and s.user_id <> e.payer_id
    loop
      continue when not pay_can_see(u) or pay_net(u) >= 0;
      -- il Leader titolare non prende cartellini
      continue when exists (select 1 from profiles where id = u and role = 'leader');
      if exists (select 1 from pay_cards where user_id = u and cleared_at is null) then
        -- già ammonito e ancora in debito: rosso (una volta sola)
        if not exists (select 1 from pay_cards where user_id = u and cleared_at is null and color = 'red') then
          insert into punishments (user_id, ends_at, reason, created_by)
          values (u, null, 'Quota del campo non pagata: finisce quando saldi e chi riceve conferma', null) returning id into pid;
          insert into pay_cards (user_id, color, match_id, punishment_id) values (u, 'red', r.match_id, pid);
          -- col rosso non si gioca: esce dalle liste delle partite non ancora iniziate (come se rispondesse «Non ci sono»;
          -- le riserve salgono come sempre). Un problema qui non deve fermare il giro dei cartellini.
          for mm in select b.match_id from bookings b join matches x on x.id = b.match_id
                    where b.user_id = u and b.list <> 'out' and x.status = 'scheduled' and x.starts_at > now() loop
            begin
              perform _book(null, u, mm.match_id, 'absent', true);
            exception when others then
              raise warning 'cartellino rosso: non tolgo % dalla partita %: %', u, mm.match_id, sqlerrm;
            end;
          end loop;
          perform notify(array[u], 'pay_red', 'Cartellino rosso',
            'Hai ancora un debito del campo: sei in punizione finché non saldi e chi riceve conferma. In Conti puoi sempre pagare.', '/pagamenti');
        end if;
      else
        insert into pay_cards (user_id, color, match_id) values (u, 'yellow', r.match_id);
        select id into nag from achievements where lower(translate(name, 'àáèéìíòóùúÀÁÈÉÌÍÒÓÙÚ', 'aaeeiioouuaaeeiioouu')) like '%nagal%' order by number limit 1;
        if nag is not null then
          insert into player_achievements (user_id, achievement_id, awarded_by, announced) values (u, nag, null, true)
          on conflict do nothing;
        end if;
        perform notify(array[u], 'pay_yellow', 'Cartellino giallo',
          'La quota del campo non è stata pagata entro le 12. Salda in Conti: se alla prossima partita hai ancora un debito, è rosso.', '/pagamenti');
      end if;
    end loop;
  end loop;
end $$;
revoke execute on function public.pay_cards_tick() from public, anon, authenticated;
