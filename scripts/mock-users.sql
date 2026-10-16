-- =====================================================================
-- GIOCATORI FINTI per provare l'app
-- Incolla TUTTO nel SQL Editor di Supabase e premi Run. Nessuna chiave, nessun terminale.
--
-- Cambia solo i due numeri qui sotto (n e prenota). Si può rilanciare: salta chi esiste già.
-- Gli utenti finti NON hanno password: non possono accedere, ma compaiono nel gruppo,
-- si prenotano, entrano nelle squadre e nelle statistiche. Per cancellarli: vedi in fondo.
-- =====================================================================

do $$
declare
  n       int := 12;   -- quanti giocatori finti creare (da 1 a 24)
  prenota int := 11;   -- quanti metterne nella prossima partita (0 = nessuno; oltre il decimo vanno tra le riserve)

  r record;
  v_code text;
  v_match uuid;
  v_id uuid;
begin
  -- Il primo account creato diventa Leader: prima deve registrarsi il vero Leader.
  if not exists (select 1 from public.profiles) then
    raise exception 'Registrati prima tu dall''app: il primo utente diventa Leader. Poi rilancia questo script.';
  end if;

  -- Con un codice invito attivo, i finti devono fornirlo, altrimenti resterebbero "in attesa" e avviserebbero lo staff.
  select invite_code into v_code from public.app_settings where id = 1;

  for r in
    select o, first, last, nick, frole, h, w, birth,
           lower(replace(first, ' ', '')) || '.' || lower(replace(last, ' ', '')) || '@mock.calcetto.test' as email
    from (values
      (1,  'Giovanni', 'Esposito',   'Gianni', 'difensore', 178, 76, date '1988-03-14'),
      (2,  'Francesco', 'Romano',    'Checco', 'pivot',     183, 82, date '1991-07-02'),
      (3,  'Alberto',  'Colombo',    null,     'laterale',  174, 70, date '1985-11-23'),
      (4,  'Michele',  'Ricci',      'Miki',   'jolly',     180, 78, date '1993-01-30'),
      (5,  'Roberto',  'De Luca',    'Robi',   'portiere',  186, 85, date '1982-09-09'),
      (6,  'Claudio',  'Mancini',    null,     'difensore', 176, 74, date '1987-05-18'),
      (7,  'Antonio',  'Vitale',     'Totò',   'laterale',  171, 68, date '1995-12-04'),
      (8,  'Vincenzo', 'Leone',      'Enzo',   'pivot',     188, 90, date '1984-02-27'),
      (9,  'Massimo',  'Longo',      null,     'jolly',     179, 77, date '1990-08-16'),
      (10, 'Gabriele', 'Giordano',   'Gabbo',  'laterale',  175, 71, date '1997-04-11'),
      (11, 'Daniele',  'Rinaldi',    'Dani',   'difensore', 181, 80, date '1989-10-05'),
      (12, 'Salvatore', 'Caruso',    'Salvo',  'portiere',  184, 83, date '1981-06-21'),
      (13, 'Federico', 'Ferrara',    'Fede',   'pivot',     182, 79, date '1994-09-28'),
      (14, 'Lorenzo',  'Santoro',    'Lollo',  'laterale',  173, 69, date '1996-02-13'),
      (15, 'Pietro',   'Mariani',    null,     'jolly',     177, 75, date '1986-12-19'),
      (16, 'Emilio',   'Rizzo',      null,     'difensore', 179, 78, date '1983-01-07'),
      (17, 'Tommaso',  'Fabbri',     'Tommy',  'laterale',  172, 67, date '1998-05-25'),
      (18, 'Cristian', 'Monti',      null,     'pivot',     185, 88, date '1992-11-02'),
      (19, 'Valerio',  'Gentile',    'Vale',   'jolly',     176, 73, date '1990-03-08'),
      (20, 'Nunzio',   'Pellegrini', null,     'portiere',  187, 86, date '1980-07-15'),
      (21, 'Riccardo', 'Palumbo',    'Ricky',  'difensore', 180, 77, date '1995-08-31'),
      (22, 'Samuele',  'Sala',       'Samu',   'laterale',  174, 70, date '1999-01-17'),
      (23, 'Mirko',    'Parisi',     null,     'pivot',     184, 84, date '1988-06-06'),
      (24, 'Domenico', 'Bianco',     'Mimmo',  'jolly',     178, 79, date '1985-04-22')
    ) as v(o, first, last, nick, frole, h, w, birth)
    where o <= least(greatest(n, 1), 24)
    order by o
  loop
    if not exists (select 1 from auth.users where email = r.email) then
      -- il trigger del database crea da solo il profilo a partire da questi dati
      insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
              r.email, now(),
              '{"provider":"email","providers":["email"]}',
              jsonb_build_object('first_name', r.first, 'last_name', r.last, 'invite_code', v_code),
              now(), now());
    end if;

    select id into v_id from auth.users where email = r.email;
    update public.profiles
       set nickname = r.nick, field_role = r.frole, height_cm = r.h, weight_kg = r.w, birth_date = r.birth,
           active = true, pending = false
     where id = v_id;
  end loop;

  -- Prenotazioni alla prossima partita, come se si fossero prenotati loro
  if prenota > 0 then
    select id into v_match from public.matches where status = 'scheduled' order by starts_at limit 1;
    if v_match is null then
      raise notice 'Nessuna partita in programma: salto le prenotazioni.';
    else
      for r in
        select u.id
        from auth.users u
        where u.email like '%@mock.calcetto.test'
        order by u.email
        limit prenota
      loop
        perform public._book(r.id, r.id, v_match, 'present', true);
      end loop;
    end if;
  end if;
end $$;

-- Riepilogo (compare come risultato dopo il Run)
select
  (select count(*) from auth.users where email like '%@mock.calcetto.test') as giocatori_finti,
  (select count(*) from public.profiles where role = 'leader')              as leader,
  (select count(*) from public.bookings b join public.matches m on m.id = b.match_id
    where m.status = 'scheduled' and b.list = 'team')                       as in_squadra,
  (select count(*) from public.bookings b join public.matches m on m.id = b.match_id
    where m.status = 'scheduled' and b.list = 'reserve')                    as riserve;

-- =====================================================================
-- PER CANCELLARLI (esegui questo a parte, quando hai finito di provare).
-- Con loro spariscono anche prenotazioni e voti. Il Leader vero non viene toccato.
--
-- delete from auth.users
--  where email like '%@mock.calcetto.test'
--    and id not in (select id from public.profiles where role = 'leader');
-- =====================================================================
