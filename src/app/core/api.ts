import { inject, Injectable } from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  AppNotification, AppSettings, AttendanceRow, BoardRow, ChatMessage, Choice, LineupRow, Match, MatchFact, MvpVote,
  PlayerVote, Result, ResultReview, Role, Scorer, StatsRow, Team, VoteSummary,
} from './models';
import { Supabase } from './supabase';

const MATCH_COLS = '*,ends_at,result_opens_at,lock_at,votes_close_at,lineup_opens_at,chat_opens_at,chat_closes_at';

/** Solleva l'errore di Supabase così che i componenti lo mostrino. */
function must<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data as T;
}

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly sb = inject(Supabase).client;

  // ------------------------------------------------------------------ partite
  async nextMatch(): Promise<Match | null> {
    const since = new Date(Date.now() - 30 * 3600_000).toISOString();
    const res = await this.sb.from('matches').select(MATCH_COLS)
      .neq('status', 'cancelled').gte('starts_at', since).order('starts_at').limit(1);
    return (must(res) as unknown as Match[])[0] ?? null;
  }

  async match(id: string): Promise<Match> {
    return must(await this.sb.from('matches').select(MATCH_COLS).eq('id', id).single()) as unknown as Match;
  }

  async matches(limit = 40): Promise<(Match & { results: Result | null })[]> {
    const res = await this.sb.from('matches').select(`${MATCH_COLS},results(*)`).order('starts_at', { ascending: false }).limit(limit);
    return must(res) as unknown as (Match & { results: Result | null })[];
  }

  async board(matchId: string): Promise<BoardRow[]> {
    return must(await this.sb.from('booking_board').select('*').eq('match_id', matchId)) as BoardRow[];
  }

  async book(matchId: string, choice: Choice): Promise<{ list: string; slot: number | null }> {
    return must(await this.sb.rpc('book', { p_match: matchId, p_choice: choice }));
  }

  async leaderBook(matchId: string, userId: string, choice: Choice) {
    return must(await this.sb.rpc('leader_book', { p_match: matchId, p_user: userId, p_choice: choice }));
  }

  async reserveReply(matchId: string, reply: 'confirmed' | 'declined') {
    return must(await this.sb.rpc('reserve_reply', { p_match: matchId, p_reply: reply }));
  }

  async priorityWindows(matchId: string): Promise<{ user_id: string; opens_at: string }[]> {
    return must(await this.sb.from('priority_windows').select('user_id,opens_at').eq('match_id', matchId));
  }

  async setPriorityWindow(matchId: string, users: string[], opensAt: string) {
    return must(await this.sb.rpc('set_priority_window', { p_match: matchId, p_users: users, p_opens_at: opensAt }));
  }

  async clearPriorityWindow(matchId: string, userId: string) {
    return must(await this.sb.rpc('clear_priority_window', { p_match: matchId, p_user: userId }));
  }

  async moveMatch(matchId: string, startsAt: string) {
    return must(await this.sb.rpc('move_match', { p_match: matchId, p_starts: startsAt }));
  }

  async cancelMatch(matchId: string) {
    return must(await this.sb.rpc('cancel_match', { p_match: matchId }));
  }

  // --------------------------------------------------------------- formazioni
  async lineup(matchId: string): Promise<LineupRow[]> {
    return must(await this.sb.from('lineup').select('*').eq('match_id', matchId)) as LineupRow[];
  }

  async saveLineup(matchId: string, entries: { user_id: string; team: Team; field_slot: number | null }[], publish: boolean): Promise<string> {
    return must(await this.sb.rpc('save_lineup', { p_match: matchId, p_entries: entries, p_publish: publish }));
  }

  async reviewLineup(matchId: string, approve: boolean) {
    return must(await this.sb.rpc('review_lineup', { p_match: matchId, p_approve: approve }));
  }

  async setLineupDelegate(matchId: string, userId: string | null) {
    return must(await this.sb.rpc('set_lineup_delegate', { p_match: matchId, p_user: userId }));
  }

  // ---------------------------------------------------------------- risultato
  async result(matchId: string): Promise<Result | null> {
    return must(await this.sb.from('results').select('*').eq('match_id', matchId).maybeSingle()) as Result | null;
  }

  async reviews(matchId: string): Promise<ResultReview[]> {
    return must(await this.sb.from('result_reviews').select('*').eq('match_id', matchId)) as ResultReview[];
  }

  async submitResult(matchId: string, diff: number | null, white: number | null, black: number | null) {
    return must(await this.sb.rpc('submit_result', { p_match: matchId, p_diff: diff, p_white: white, p_black: black }));
  }

  async reviewResult(matchId: string, agree: boolean, note: string | null) {
    return must(await this.sb.rpc('review_result', { p_match: matchId, p_agree: agree, p_note: note }));
  }

  async staffHomologate(matchId: string) {
    return must(await this.sb.rpc('staff_homologate', { p_match: matchId }));
  }

  async scorers(matchId: string): Promise<Scorer[]> {
    return must(await this.sb.from('scorers').select('*').eq('match_id', matchId)) as Scorer[];
  }

  async saveScorers(matchId: string, rows: Omit<Scorer, 'match_id'>[]) {
    return must(await this.sb.rpc('save_scorers', { p_match: matchId, p_rows: rows }));
  }

  // -------------------------------------------------------------------- voti
  async myVotes(matchId: string, uid: string): Promise<{ votes: PlayerVote[]; mvp: MvpVote | null }> {
    const [v, m] = await Promise.all([
      this.sb.from('player_votes').select('*').eq('match_id', matchId).eq('voter_id', uid),
      this.sb.from('mvp_votes').select('*').eq('match_id', matchId).eq('voter_id', uid).maybeSingle(),
    ]);
    return { votes: must(v) as PlayerVote[], mvp: must(m) as MvpVote | null };
  }

  /** Tutti i voti: le regole RLS li restituiscono solo al Leader o a chi è autorizzato. */
  async allVotes(matchId: string): Promise<{ votes: PlayerVote[]; mvp: MvpVote[] }> {
    const [v, m] = await Promise.all([
      this.sb.from('player_votes').select('*').eq('match_id', matchId),
      this.sb.from('mvp_votes').select('*').eq('match_id', matchId),
    ]);
    return { votes: must(v) as PlayerVote[], mvp: must(m) as MvpVote[] };
  }

  async canSeeVotes(matchId: string): Promise<boolean> {
    return must(await this.sb.rpc('can_see_votes', { p_match: matchId })) as boolean;
  }

  async submitVotes(matchId: string, votes: { target_id: string; score: number }[], white: string | null, black: string | null) {
    return must(await this.sb.rpc('submit_votes', { p_match: matchId, p_votes: votes, p_white_pick: white, p_black_pick: black }));
  }

  async voteSummary(matchId: string): Promise<VoteSummary> {
    return must(await this.sb.rpc('vote_summary', { p_match: matchId })) as VoteSummary;
  }

  async grantVotes(matchId: string, users: string[]) {
    return must(await this.sb.rpc('grant_vote_visibility', { p_match: matchId, p_users: users }));
  }

  // -------------------------------------------------------------------- chat
  async chat(matchId: string): Promise<ChatMessage[]> {
    return must(await this.sb.from('chat_messages').select('*').eq('match_id', matchId).order('created_at').limit(500)) as ChatMessage[];
  }

  async sendChat(matchId: string, userId: string, body: string) {
    return must(await this.sb.from('chat_messages').insert({ match_id: matchId, user_id: userId, body }));
  }

  async deleteChat(id: number) {
    return must(await this.sb.from('chat_messages').delete().eq('id', id));
  }

  // ------------------------------------------------------------- statistiche
  async stats(from: string | null, to: string | null): Promise<StatsRow[]> {
    return must(await this.sb.rpc('stats_table', { p_from: from ?? '-infinity', p_to: to ?? 'infinity' })) as StatsRow[];
  }

  async history(userId: string, from: string | null, to: string | null): Promise<MatchFact[]> {
    return must(await this.sb.rpc('player_history', { p_user: userId, p_from: from ?? '-infinity', p_to: to ?? 'infinity' })) as MatchFact[];
  }

  async attendance(from: string | null, to: string | null): Promise<AttendanceRow[]> {
    return must(await this.sb.rpc('attendance_register', { p_from: from ?? '-infinity', p_to: to ?? 'infinity' })) as AttendanceRow[];
  }

  async lastPlayedMatch(): Promise<Match | null> {
    const res = await this.sb.from('matches').select(MATCH_COLS).eq('status', 'played').order('starts_at', { ascending: false }).limit(1);
    return (must(res) as unknown as Match[])[0] ?? null;
  }

  // ------------------------------------------------------------------ avvisi
  async notifications(): Promise<AppNotification[]> {
    return must(await this.sb.from('notifications').select('id,kind,title,body,url,match_id,created_at,read_at')
      .order('created_at', { ascending: false }).limit(80)) as AppNotification[];
  }

  async unreadCount(): Promise<number> {
    const res = await this.sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
    return res.count ?? 0;
  }

  async markAllRead() {
    return must(await this.sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null));
  }

  // ---------------------------------------------------------------- gestione
  async updateProfile(id: string, patch: Record<string, unknown>) {
    return must(await this.sb.from('profiles').update(patch).eq('id', id));
  }

  // ------------------------------------------------------------- foto profilo
  /** Carica la foto (già ritagliata) nella cartella dell'utente, la collega al profilo e cancella la precedente. */
  async setAvatar(userId: string, photo: Blob, oldPath: string | null): Promise<void> {
    const path = `${userId}/${crypto.randomUUID()}.jpg`;
    const up = await this.sb.storage.from('avatars').upload(path, photo, { contentType: 'image/jpeg', cacheControl: '604800', upsert: false });
    if (up.error) throw up.error;
    const res = await this.sb.from('profiles').update({ avatar_path: path }).eq('id', userId);
    if (res.error) {
      await this.sb.storage.from('avatars').remove([path]);
      throw res.error;
    }
    if (oldPath) await this.sb.storage.from('avatars').remove([oldPath]);
  }

  async removeAvatar(userId: string, path: string): Promise<void> {
    must(await this.sb.from('profiles').update({ avatar_path: null }).eq('id', userId));
    await this.sb.storage.from('avatars').remove([path]);
  }

  /** Leader e Premier: toglie la foto di un altro (l'interessato riceve un avviso). */
  async removeMemberAvatar(userId: string): Promise<void> {
    const path = must(await this.sb.rpc('remove_member_avatar', { p_user: userId })) as string | null;
    if (path) await this.sb.storage.from('avatars').remove([path]);
  }

  async setRole(userId: string, role: Exclude<Role, 'leader'>) {
    return must(await this.sb.rpc('set_member_role', { p_user: userId, p_role: role }));
  }

  async transferLeadership(userId: string) {
    return must(await this.sb.rpc('transfer_leadership', { p_user: userId }));
  }

  async delegate(userId: string | null, until: string | null) {
    return must(await this.sb.rpc('delegate_leadership', { p_user: userId, p_until: until }));
  }

  async deactivate(userId: string) {
    return must(await this.sb.rpc('deactivate_member', { p_user: userId }));
  }

  async approve(userId: string) {
    return must(await this.sb.rpc('approve_member', { p_user: userId }));
  }

  /** Password temporanea generata dalla Edge Function (Leader e Premier). */
  async resetMemberPassword(userId: string): Promise<string> {
    const { data, error } = await this.sb.functions.invoke('admin-reset-password', { body: { user_id: userId } });
    if (error) {
      let message = 'Reimpostazione non riuscita. Riprova.';
      try {
        const body = await (error as { context?: Response }).context?.json();
        if (body?.message) message = body.message;
      } catch { /* risposta non JSON */ }
      throw new Error(message);
    }
    return (data as { temp_password: string }).temp_password;
  }

  async canResetPassword(userId: string): Promise<boolean> {
    return must(await this.sb.rpc('can_reset_password', { p_target: userId })) as boolean;
  }

  async settings(): Promise<AppSettings> {
    return must(await this.sb.from('app_settings').select('*').single()) as AppSettings;
  }

  async updateSettings(patch: Partial<AppSettings>) {
    return must(await this.sb.from('app_settings').update(patch).eq('id', 1));
  }

  // ---------------------------------------------------------------- realtime
  /** Ascolta le modifiche alle tabelle di una partita; restituisce la funzione per smettere. */
  watchMatch(matchId: string, tables: string[], onChange: (table: string) => void): () => void {
    let ch: RealtimeChannel = this.sb.channel(`match:${matchId}:${tables.join(',')}`);
    for (const table of tables) {
      const filter = table === 'matches' ? `id=eq.${matchId}` : `match_id=eq.${matchId}`;
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => onChange(table));
    }
    ch.subscribe();
    return () => void this.sb.removeChannel(ch);
  }

  watchChat(matchId: string, onInsert: (m: ChatMessage) => void, onDelete: (id: number) => void): () => void {
    const ch = this.sb.channel(`chat:${matchId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `match_id=eq.${matchId}` },
        (p) => onInsert(p.new as ChatMessage))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_messages' },
        (p) => onDelete((p.old as { id: number }).id))
      .subscribe();
    return () => void this.sb.removeChannel(ch);
  }

  watchNotifications(userId: string, onInsert: () => void): () => void {
    const ch = this.sb.channel(`notif:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, onInsert)
      .subscribe();
    return () => void this.sb.removeChannel(ch);
  }
}
