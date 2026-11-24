-- Indici sulle colonne che collegano un giocatore o una partita e che finora ne erano senza.
-- Con i dati attuali le letture restano sotto i 10 ms anche senza: servono a non rallentare quando
-- lo storico cresce, e rendono più rapide le cancellazioni a cascata e l'unione dei profili (merge_profiles).
-- Nessun cambiamento di comportamento.
create index if not exists bookings_user_idx            on public.bookings (user_id);
create index if not exists lineup_user_idx              on public.lineup (user_id);
create index if not exists scorers_user_idx             on public.scorers (user_id);
create index if not exists player_votes_target_idx      on public.player_votes (target_id);
create index if not exists player_votes_voter_idx       on public.player_votes (voter_id);
create index if not exists mvp_votes_voter_idx          on public.mvp_votes (voter_id);
create index if not exists chat_messages_user_idx       on public.chat_messages (user_id);
create index if not exists notifications_match_idx      on public.notifications (match_id);
create index if not exists push_subscriptions_user_idx  on public.push_subscriptions (user_id);
create index if not exists priority_windows_user_idx    on public.priority_windows (user_id);
create index if not exists vote_grants_user_idx         on public.vote_grants (user_id);
create index if not exists result_reviews_user_idx      on public.result_reviews (user_id);
create index if not exists player_achievements_ach_idx  on public.player_achievements (achievement_id);
create index if not exists pay_expenses_match_idx       on public.pay_expenses (match_id);
create index if not exists pay_expenses_payer_idx       on public.pay_expenses (payer_id);
create index if not exists pay_cards_match_idx          on public.pay_cards (match_id);
create index if not exists fl_coefficients_user_idx     on public.fl_coefficients (user_id);
create index if not exists fl_points_revisions_match_idx on public.fl_points_revisions (match_id);
create index if not exists fl_points_revisions_user_idx on public.fl_points_revisions (user_id);
