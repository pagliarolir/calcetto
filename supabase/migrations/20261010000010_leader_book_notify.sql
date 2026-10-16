-- =====================================================================
-- Il giocatore che il Leader prenota (o toglie) per conto suo riceve un avviso.
-- Prima la modifica era silenziosa: lo scopriva solo aprendo l'app.
-- =====================================================================

create or replace function public.leader_book(p_match uuid, p_user uuid, p_choice text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_res jsonb;
  v_when text;
  v_who text := display_name(v_actor);
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può prenotare per altri'; end if;
  v_res := _book(v_actor, p_user, p_match, p_choice, false);

  -- niente avviso se il Leader modifica sé stesso
  if p_user is distinct from v_actor then
    select fmt_when(starts_at) into v_when from matches where id = p_match;
    perform notify(
      array[p_user],
      'placed_by_leader',
      case v_res->>'list'
        when 'team' then 'Sei in squadra'
        when 'reserve' then 'Sei tra le riserve'
        else 'Segnato come assente' end,
      case v_res->>'list'
        when 'team' then v_who || ' ti ha inserito per ' || v_when || ': hai il numero ' || (v_res->>'slot') || '.'
        when 'reserve' then v_who || ' ti ha messo tra le riserve per ' || v_when || ': sei il numero ' || (v_res->>'slot') || '.'
        else v_who || ' ti ha segnato come assente per ' || v_when || '.' end,
      '/partita/' || p_match,
      p_match,
      case when v_res->>'list' = 'out' then null
           else '[{"action":"absent","title":"Non posso"}]'::jsonb end
    );
  end if;

  return v_res;
end $$;
