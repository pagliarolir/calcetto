-- Conti visibili a tutti (scelta del proprietario): Pagamenti fuori dall'anteprima.
-- I cartellini partono da adesso: le partite con la scadenza già passata si segnano come controllate,
-- così nessuno prende gialli o rossi per i campi vecchi (con più partite arretrate arriverebbe subito il rosso).
insert into public.pay_card_checks (match_id)
select e.match_id
from public.pay_expenses e join public.matches m on m.id = e.match_id
where e.match_id is not null
group by e.match_id
having now() >= max(public.scorers_close_at(m))
on conflict do nothing;

update public.pay_settings set public = true where id = 1;
