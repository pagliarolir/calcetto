-- Decisione del proprietario (14/11/2026): di predefinito sceglie il Leader chi gioca.
-- Vale per la configurazione predefinita (anche per le partite create in automatico) e per le
-- partite già in programma con le prenotazioni non ancora aperte (nessuno si è ancora prenotato).

alter table public.app_settings alter column booking_mode set default 'free';
update public.app_settings set booking_mode = 'free' where id = 1;

update public.matches m set booking_mode = 'free'
where m.status = 'scheduled' and m.booking_mode = 'order' and m.bookings_open_at > now()
  and not exists (select 1 from public.bookings b where b.match_id = m.id and b.user_id is distinct from public.titular_leader());
