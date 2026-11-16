import { inject, Injectable } from '@angular/core';
import { Supabase } from './supabase';

/** Leader News (migrazione 62): avvisi scritti dal Leader, visti una volta da ognuno al primo avvio dopo la pubblicazione. */
export interface LeaderNews { id: number; body: string; created_at: string; created_by?: string }
export interface LeaderNewsAdmin extends LeaderNews { created_by: string; seen: number; members: number }

@Injectable({ providedIn: 'root' })
export class LeaderNewsService {
  private readonly sb = inject(Supabase).client;

  /** notizie non ancora lette (vuoto se la migrazione non c'è ancora o in caso di errore: l'avvio non deve bloccarsi) */
  async pending(): Promise<LeaderNews[]> {
    const { data, error } = await this.sb.rpc('leader_news_pending');
    return error || !Array.isArray(data) ? [] : (data as LeaderNews[]);
  }
  async seen(id: number): Promise<void> {
    await this.sb.rpc('leader_news_seen', { p_id: id });
  }
  async post(body: string): Promise<void> {
    const { error } = await this.sb.rpc('leader_news_post', { p_body: body });
    if (error) throw error;
  }
  async list(): Promise<LeaderNewsAdmin[]> {
    const { data, error } = await this.sb.rpc('leader_news_list');
    if (error) throw error;
    return (data ?? []) as LeaderNewsAdmin[];
  }
  async remove(id: number): Promise<void> {
    const { error } = await this.sb.rpc('leader_news_delete', { p_id: id });
    if (error) throw error;
  }
}
